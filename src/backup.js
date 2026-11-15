import { AwsClient } from 'aws4fetch';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { openDatabase } from './db.js';
import { localTimestamp } from './time.js';

const SETTINGS = ['BACKUP_ENDPOINT', 'BACKUP_REGION', 'BACKUP_BUCKET', 'BACKUP_ACCESS_KEY_ID', 'BACKUP_SECRET_ACCESS_KEY'];
const SQLITE_HEADER = 'SQLite format 3\0';
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;
const DAY_SECONDS = 24 * 60 * 60;
const CATCH_UP_AFTER_MS = 26 * 60 * 60 * 1000;

const clean = (value) => String(value ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').trim();

function normaliseEndpoint(value) {
  const text = clean(value).replace(/\/+$/, '');
  if (!text) return { endpoint: '' };
  const endpoint = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(endpoint);
    if (url.pathname !== '/' || url.search) {
      return { endpoint, problem: 'BACKUP_ENDPOINT should be only the address, such as https://s3.eu-central-003.backblazeb2.com, without the bucket name.' };
    }
    return { endpoint: url.origin };
  } catch {
    return { endpoint, problem: `BACKUP_ENDPOINT "${value}" is not a web address. Copy it from the bucket page, for example https://s3.eu-central-003.backblazeb2.com.` };
  }
}

export function backupSettings(rawEnv, brandId) {
  const env = Object.fromEntries(Object.entries(rawEnv).map(([name, value]) => [name, name.startsWith('BACKUP_') ? clean(value) : value]));
  const given = SETTINGS.filter((name) => env[name]);
  const problems = [];
  const { endpoint, problem } = normaliseEndpoint(env.BACKUP_ENDPOINT);
  if (problem) problems.push(problem);
  if (given.length > 0 && given.length < SETTINGS.length) {
    problems.push(`Backups need all of ${SETTINGS.join(', ')}. Missing: ${SETTINGS.filter((n) => !env[n]).join(', ')}.`);
  }
  const hour = env.BACKUP_HOUR === undefined || env.BACKUP_HOUR === '' ? 2 : Number(env.BACKUP_HOUR);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) problems.push('BACKUP_HOUR must be a whole hour from 0 to 23.');
  const prefix = (env.BACKUP_PREFIX || brandId || 'ledger').replace(/^\/+|\/+$/g, '');
  if (!KEY_PATTERN.test(prefix) || prefix.includes('..')) problems.push('BACKUP_PREFIX may only use letters, digits, ".", "_", "-" and "/".');
  const restore = (env.RESTORE_BACKUP || '').trim();
  if (restore && (!KEY_PATTERN.test(restore) || restore.includes('..'))) problems.push('RESTORE_BACKUP must be a backup name such as beceko/2026-11-14-0200.db.gz.');
  if (restore && given.length < SETTINGS.length) problems.push('RESTORE_BACKUP needs the BACKUP_ settings so the backup can be downloaded.');

  return {
    problems,
    enabled: given.length === SETTINGS.length && problems.length === 0,
    endpoint,
    region: env.BACKUP_REGION || '',
    bucket: env.BACKUP_BUCKET || '',
    accessKeyId: env.BACKUP_ACCESS_KEY_ID || '',
    secretAccessKey: env.BACKUP_SECRET_ACCESS_KEY || '',
    prefix,
    hour,
    restore,
  };
}

function storage(settings) {
  const client = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: 's3',
    region: settings.region,
    retries: 3,
  });
  const url = (key = '', query = '') =>
    `${settings.endpoint}/${encodeURIComponent(settings.bucket)}${key ? `/${key.split('/').map(encodeURIComponent).join('/')}` : ''}${query}`;

  async function request(target, init) {
    const response = await client.fetch(target, init);
    if (!response.ok) {
      const text = (await response.text()).replace(/\s+/g, ' ').slice(0, 300);
      throw new Error(`Storage replied ${response.status}: ${text || response.statusText}`);
    }
    return response;
  }

  return {
    put: (key, body) =>
      request(url(key), { method: 'PUT', body, headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(body.length) } }),
    get: async (key) => Buffer.from(await (await request(url(key), { method: 'GET' })).arrayBuffer()),
    async list(prefix) {
      const xml = await (await request(url('', `?list-type=2&prefix=${encodeURIComponent(`${prefix}/`)}`), { method: 'GET' })).text();
      return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, part]) => ({
        key: /<Key>([\s\S]*?)<\/Key>/.exec(part)?.[1] ?? '',
        size: Number(/<Size>(\d+)<\/Size>/.exec(part)?.[1] ?? 0),
        modified: /<LastModified>([\s\S]*?)<\/LastModified>/.exec(part)?.[1] ?? '',
      }));
    },
  };
}

const setMeta = (db, key, value) =>
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
const getMeta = (db, key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value;

function snapshot(db) {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-backup-'));
  const file = join(dir, 'ledger.db');
  try {
    db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    return readFileSync(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function backupNow(db, settings, timeZone) {
  const stamp = localTimestamp(timeZone).replace(' ', '-').replace(/:/g, '').slice(0, 15);
  const key = `${settings.prefix}/${stamp}.db.gz`;
  const body = gzipSync(snapshot(db));
  await storage(settings).put(key, body);
  setMeta(db, 'last_backup_at', new Date().toISOString());
  setMeta(db, 'last_backup_key', key);
  return { key, bytes: body.length };
}

export const listBackups = (settings) => storage(settings).list(settings.prefix);

export function secondsUntilHour(timeZone, hour, date = new Date()) {
  const [h, m, s] = localTimestamp(timeZone, date).slice(11).split(':').map(Number);
  const wait = (hour * 3600 - (h * 3600 + m * 60 + s) + DAY_SECONDS) % DAY_SECONDS;
  return wait === 0 ? DAY_SECONDS : wait;
}

export function scheduleBackups(db, settings, timeZone, log = console) {
  if (!settings.enabled) return { stop() {} };
  let timer;

  const run = async () => {
    try {
      const { key, bytes } = await backupNow(db, settings, timeZone);
      log.log(`Backup saved: ${key} (${Math.ceil(bytes / 1024)} KB)`);
    } catch (error) {
      log.error(`Backup failed: ${error.message}`);
    }
  };

  const next = () => {
    timer = setTimeout(async () => {
      await run();
      next();
    }, secondsUntilHour(timeZone, settings.hour) * 1000);
    timer.unref?.();
  };

  const last = Date.parse(getMeta(db, 'last_backup_at') ?? '');
  if (!(Date.now() - last < CATCH_UP_AFTER_MS)) {
    const catchUp = setTimeout(run, 60_000);
    catchUp.unref?.();
  }
  next();
  return { stop: () => clearTimeout(timer) };
}

export async function restoreIfAsked(file, settings, timeZone, log = console) {
  if (!settings.restore) return null;
  if (existsSync(file)) {
    const current = openDatabase(file);
    const done = getMeta(current, 'restored_from') === settings.restore;
    current.close();
    if (done) {
      log.log(`RESTORE_BACKUP is still set, but ${settings.restore} has already been restored. Remove the variable.`);
      return { done: false };
    }
  }

  const data = gunzipSync(await storage(settings).get(settings.restore));
  if (data.subarray(0, SQLITE_HEADER.length).toString('latin1') !== SQLITE_HEADER) {
    throw new Error(`${settings.restore} is not a ledger backup.`);
  }

  let saved = null;
  if (existsSync(file)) {
    const stamp = localTimestamp(timeZone).replace(/[^0-9]/g, '').slice(0, 12);
    saved = file.replace(/(\.db)?$/, `-before-restore-${stamp}.db`);
    const current = openDatabase(file);
    current.exec(`VACUUM INTO '${saved.replaceAll("'", "''")}'`);
    current.close();
  }
  for (const suffix of ['-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });
  writeFileSync(file, data);

  const restored = openDatabase(file);
  setMeta(restored, 'restored_from', settings.restore);
  restored.close();
  return { done: true, saved };
}
