import assert from 'node:assert/strict';
import test from 'node:test';
import { checkNewEntry, nairaToKobo, nameKey, statusFor, withRunningBalance } from '../src/ledger.js';
import { periodStarts } from '../src/time.js';

test('status follows the running position', () => {
  assert.equal(statusFor(0, 500), 'PAID');
  assert.equal(statusFor(1000, 0), 'OWING');
  assert.equal(statusFor(1000, 500), 'PARTIAL');
  assert.equal(statusFor(-200, 500), 'CREDIT');
});

test('running balance accumulates in kobo', () => {
  const rows = withRunningBalance([
    { costKobo: 1_500_000, paidKobo: 500_000 },
    { costKobo: 0, paidKobo: 300_000 },
    { costKobo: 0, paidKobo: 700_000 },
  ]);
  assert.deepEqual(
    rows.map((row) => [row.balanceKobo, row.status]),
    [[1_000_000, 'PARTIAL'], [700_000, 'PARTIAL'], [0, 'PAID']],
  );
});

test('sales need a price and cannot be overpaid', () => {
  assert.throws(() => checkNewEntry({ kind: 'SALE', description: 'Lace', costKobo: 0 }, 0), /price/);
  assert.throws(() => checkNewEntry({ kind: 'SALE', description: 'Lace', costKobo: 100, paidKobo: 200 }, 0), /more than the price/);
  assert.deepEqual(checkNewEntry({ kind: 'SALE', description: ' Lace ', costKobo: 100 }, 0), {
    kind: 'SALE',
    description: 'Lace',
    costKobo: 100,
    paidKobo: 0,
  });
});

test('payments cannot exceed the balance', () => {
  assert.throws(() => checkNewEntry({ kind: 'PAYMENT', paidKobo: 100 }, 0), /does not owe/);
  assert.throws(() => checkNewEntry({ kind: 'PAYMENT', paidKobo: 300 }, 200), /more than/);
  assert.equal(checkNewEntry({ kind: 'PAYMENT', paidKobo: 200 }, 200).description, 'Payment');
});

test('amounts and names are normalised', () => {
  assert.equal(nairaToKobo(0.1 + 0.2), 30);
  assert.equal(nairaToKobo(-5), null);
  assert.equal(nairaToKobo(null), null);
  assert.equal(nameKey('  Mama   Chidi '), 'mama chidi');
});

test('periods use the business time zone', () => {
  const lateSundayUtc = new Date('2026-11-08T23:30:00Z');
  assert.deepEqual(periodStarts('Africa/Lagos', lateSundayUtc), {
    today: '2026-11-09',
    week: '2026-11-09',
    month: '2026-11-01',
  });
});
