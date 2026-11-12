import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openLedger } from '../src/reset.js';
import { createStore } from '../src/store.js';

const options = (resetToken) => ({ resetToken, timeZone: 'Africa/Lagos' });

test('RESET_LEDGER clears the ledger once, keeps a backup, and is harmless if left set', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'beceko-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'ledger.db');

  let { db } = openLedger(file, options(''));
  createStore(db, options('')).addEntries([{ customerName: 'Test Customer', kind: 'SALE', description: 'Test', costKobo: 100, paidKobo: 0 }]);
  db.close();

  const first = openLedger(file, options('fresh-start-1'));
  assert.equal(first.reset.done, true);
  assert.equal(createStore(first.db, options('')).listCustomers().length, 0);
  createStore(first.db, options('')).createCustomer({ name: 'Real Customer' });
  first.db.close();

  const backupFile = join(dir, readdirSync(dir).find((name) => name.includes('before-reset')));
  const backup = new DatabaseSync(backupFile, { readOnly: true });
  assert.equal(backup.prepare('SELECT name FROM customers').get().name, 'Test Customer');
  backup.close();

  const again = openLedger(file, options('fresh-start-1'));
  assert.equal(again.reset.done, false);
  assert.deepEqual(createStore(again.db, options('')).listCustomers().map((c) => c.name), ['Real Customer']);
  again.db.close();
  assert.ok(existsSync(file));
});

test('RESET_LEDGER must look deliberate', async () => {
  const { loadConfig } = await import('../src/config.js');
  const base = { LEDGER_PIN: '2468', SESSION_SECRET: 'a'.repeat(32) };
  assert.throws(() => loadConfig({ ...base, RESET_LEDGER: 'yes' }), /RESET_LEDGER/);
  assert.equal(loadConfig({ ...base, RESET_LEDGER: 'fresh-start-1' }).resetToken, 'fresh-start-1');
});
