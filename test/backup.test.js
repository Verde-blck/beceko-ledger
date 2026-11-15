import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { backupNow, backupSettings, listBackups, restoreIfAsked, secondsUntilHour } from '../src/backup.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

const quiet = { log() {}, error() {} };

async function fakeStorage(t) {
  const objects = new Map();
  const seen = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? '' });
    const url = new URL(req.url, 'http://storage');
    const [, bucket, ...rest] = url.pathname.split('/');
    const key = rest.map(decodeURIComponent).join('/');
    if (bucket !== 'ledger-backups') return res.writeHead(404).end('<Error><Code>NoSuchBucket</Code></Error>');
    if (req.method === 'PUT') {
      objects.set(key, Buffer.concat(chunks));
      return res.writeHead(200).end();
    }
    if (req.method === 'GET' && !key) {
      const prefix = url.searchParams.get('prefix') ?? '';
      const items = [...objects].filter(([k]) => k.startsWith(prefix));
      const xml = items.map(([k, v]) => `<Contents><Key>${k}</Key><LastModified>2026-11-14T01:00:00.000Z</LastModified><Size>${v.length}</Size></Contents>`).join('');
      return res.writeHead(200, { 'Content-Type': 'application/xml' }).end(`<ListBucketResult>${xml}</ListBucketResult>`);
    }
    if (req.method === 'GET' && objects.has(key)) return res.writeHead(200).end(objects.get(key));
    res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
  });
  server.listen(0);
  await once(server, 'listening');
  t.after(() => server.close());
  const env = {
    BACKUP_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
    BACKUP_REGION: 'eu-central-003',
    BACKUP_BUCKET: 'ledger-backups',
    BACKUP_ACCESS_KEY_ID: 'key-id',
    BACKUP_SECRET_ACCESS_KEY: 'secret',
  };
  return { objects, seen, env };
}

function tempLedger(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, 'ledger.db') };
}

const names = (db) => createStore(db, { timeZone: 'Africa/Lagos' }).listCustomers().map((c) => c.name).sort();

test('backup settings are all or nothing, and checked at start-up', () => {
  assert.equal(backupSettings({}, 'beceko').enabled, false);
  assert.match(backupSettings({ BACKUP_BUCKET: 'b' }, 'beceko').problems[0], /Missing: BACKUP_ENDPOINT/);
  const full = backupSettings({ BACKUP_ENDPOINT: 'https://s3.example.com/', BACKUP_REGION: 'r', BACKUP_BUCKET: 'b', BACKUP_ACCESS_KEY_ID: 'k', BACKUP_SECRET_ACCESS_KEY: 's' }, 'beceko');
  assert.deepEqual([full.enabled, full.prefix, full.hour, full.endpoint], [true, 'beceko', 2, 'https://s3.example.com']);
  assert.match(backupSettings({ BACKUP_HOUR: '25' }, 'x').problems[0], /BACKUP_HOUR/);
  assert.ok(backupSettings({ RESTORE_BACKUP: '../etc/passwd' }, 'x').problems.some((p) => /RESTORE_BACKUP must be/.test(p)));
  assert.ok(backupSettings({ RESTORE_BACKUP: 'beceko/a.db.gz' }, 'x').problems.some((p) => /needs the BACKUP_ settings/.test(p)));
  const halfDone = loadConfig({ LEDGER_PIN: '2468', SESSION_SECRET: 'a'.repeat(32), BACKUP_BUCKET: 'b' });
  assert.equal(halfDone.backup.enabled, false);
  assert.match(halfDone.backup.problems[0], /Backups need all of/);
});

test('the next backup waits until the chosen hour in the business time zone', () => {
  assert.equal(secondsUntilHour('Africa/Lagos', 2, new Date('2026-11-14T00:30:00Z')), 30 * 60);
  assert.equal(secondsUntilHour('Africa/Lagos', 2, new Date('2026-11-14T01:00:00Z')), 24 * 3600);
  assert.equal(secondsUntilHour('Africa/Lagos', 2, new Date('2026-11-14T02:00:00Z')), 23 * 3600);
});

test('a backup is a compressed, complete copy of the ledger, signed for the storage service', async (t) => {
  const { objects, seen, env } = await fakeStorage(t);
  const settings = backupSettings(env, 'beceko');
  const { file } = tempLedger(t);
  const db = openDatabase(file);
  createStore(db, { timeZone: 'Africa/Lagos' }).addEntries([{ customerName: 'Mama Chidi', kind: 'SALE', description: 'Lace', costKobo: 1_500_000, paidKobo: 0 }]);

  const { key } = await backupNow(db, settings, 'Africa/Lagos');
  assert.match(key, /^beceko\/\d{4}-\d{2}-\d{2}-\d{4}\.db\.gz$/);
  assert.match(seen[0].auth, /^AWS4-HMAC-SHA256 Credential=key-id\/\d{8}\/eu-central-003\/s3\/aws4_request/);
  assert.ok(db.prepare("SELECT value FROM meta WHERE key = 'last_backup_at'").get().value);

  const copyFile = join(tempLedger(t).dir, 'copy.db');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(copyFile, gunzipSync(objects.get(key)));
  const copy = new DatabaseSync(copyFile, { readOnly: true });
  assert.equal(copy.prepare('SELECT name FROM customers').get().name, 'Mama Chidi');
  assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM entries').get().n, 1);
  copy.close();

  assert.deepEqual((await listBackups(settings)).map((b) => b.key), [key]);
  db.close();
});

test('RESTORE_BACKUP replaces the ledger once, keeping the old one, and is harmless if left set', async (t) => {
  const { env } = await fakeStorage(t);
  const { dir, file } = tempLedger(t);
  let db = openDatabase(file);
  createStore(db, { timeZone: 'Africa/Lagos' }).createCustomer({ name: 'Before backup' });
  const { key } = await backupNow(db, backupSettings(env, 'beceko'), 'Africa/Lagos');
  createStore(db, { timeZone: 'Africa/Lagos' }).createCustomer({ name: 'After backup' });
  db.close();

  const settings = backupSettings({ ...env, RESTORE_BACKUP: key }, 'beceko');
  const first = await restoreIfAsked(file, settings, 'Africa/Lagos', quiet);
  assert.equal(first.done, true);
  assert.ok(existsSync(first.saved));
  db = openDatabase(file);
  assert.deepEqual(names(db), ['Before backup']);
  createStore(db, { timeZone: 'Africa/Lagos' }).createCustomer({ name: 'Added after restore' });
  db.close();

  const again = await restoreIfAsked(file, settings, 'Africa/Lagos', quiet);
  assert.equal(again.done, false);
  db = openDatabase(file);
  assert.deepEqual(names(db), ['Added after restore', 'Before backup']);
  db.close();

  const before = new DatabaseSync(first.saved, { readOnly: true });
  assert.equal(before.prepare('SELECT COUNT(*) AS n FROM customers').get().n, 2);
  before.close();
  assert.ok(readdirSync(dir).some((name) => name.includes('before-restore')));
});

test('a restore refuses anything that is not a ledger backup', async (t) => {
  const { objects, env } = await fakeStorage(t);
  const { gzipSync } = await import('node:zlib');
  objects.set('beceko/not-a-ledger.db.gz', gzipSync(Buffer.from('hello')));
  const { file } = tempLedger(t);
  openDatabase(file).close();
  await assert.rejects(restoreIfAsked(file, backupSettings({ ...env, RESTORE_BACKUP: 'beceko/not-a-ledger.db.gz' }, 'beceko'), 'Africa/Lagos', quiet), /not a ledger backup/);
  await assert.rejects(restoreIfAsked(file, backupSettings({ ...env, RESTORE_BACKUP: 'beceko/missing.db.gz' }, 'beceko'), 'Africa/Lagos', quiet), /404/);
});

test('the storage address is tidied up and checked at start-up', () => {
  const base = { BACKUP_REGION: ' eu-central-003 ', BACKUP_BUCKET: '"iwe-oja-backups"', BACKUP_ACCESS_KEY_ID: 'k', BACKUP_SECRET_ACCESS_KEY: 's' };
  const bare = backupSettings({ ...base, BACKUP_ENDPOINT: 's3.eu-central-003.backblazeb2.com' }, 'beceko');
  assert.deepEqual([bare.problems, bare.endpoint, bare.region, bare.bucket], [[], 'https://s3.eu-central-003.backblazeb2.com', 'eu-central-003', 'iwe-oja-backups']);
  assert.equal(backupSettings({ ...base, BACKUP_ENDPOINT: ' "https://s3.eu-central-003.backblazeb2.com/" ' }, 'b').endpoint, 'https://s3.eu-central-003.backblazeb2.com');
  assert.match(backupSettings({ ...base, BACKUP_ENDPOINT: 'https://s3.eu-central-003.backblazeb2.com/iwe-oja-backups' }, 'b').problems[0], /without the bucket name/);
  assert.match(backupSettings({ ...base, BACKUP_ENDPOINT: 'Endpoint: s3.eu-central-003.backblazeb2.com' }, 'b').problems[0], /is not a web address/);
});
