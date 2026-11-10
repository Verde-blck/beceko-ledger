import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';
import { isValidDate, isValidMonth, nextDay, nextMonth } from '../src/time.js';

function seeded() {
  const db = openDatabase(':memory:');
  const store = createStore(db, { timeZone: 'Africa/Lagos' });
  const { id } = store.createCustomer({ name: 'Korede' });
  const insert = db.prepare(`
    INSERT INTO entries (customer_id, kind, description, cost_kobo, paid_kobo, voids_entry_id, source_text, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`);
  insert.run(id, 'SALE', 'Native sewing', 3_500_000, 2_000_000, '2026-10-31 18:00:00');
  insert.run(id, 'PAYMENT', 'Payment', 0, 500_000, '2026-11-03 09:15:00');
  insert.run(id, 'PAYMENT', 'Payment', 0, 250_000, '2026-11-03 17:40:00');
  insert.run(id, 'SALE', 'Lace sewing', 1_500_000, 0, '2026-11-30 23:59:59');
  insert.run(id, 'PAYMENT', 'Payment', 0, 100_000, '2026-12-01 00:00:00');
  return store;
}

test('date helpers handle month and year ends', () => {
  assert.equal(nextDay('2026-11-30'), '2026-12-01');
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
  assert.equal(nextDay('2028-02-28'), '2028-02-29');
  assert.equal(nextMonth('2026-12'), '2027-01');
  assert.equal(isValidDate('2026-02-30'), false);
  assert.equal(isValidDate('2026-11-10'), true);
  assert.equal(isValidMonth('2026-13'), false);
});

test('a month shows money received per day, inside its own boundaries only', () => {
  const november = seeded().month('2026-11');
  assert.deepEqual(
    november.days.map((day) => [day.date, day.receivedKobo, day.salesKobo, day.entryCount]),
    [
      ['2026-11-03', 750_000, 0, 2],
      ['2026-11-30', 0, 1_500_000, 1],
    ],
  );
  assert.equal(november.receivedKobo, 750_000);
  assert.equal(november.salesKobo, 1_500_000);
});

test('a day lists its entries with customer names', () => {
  const day = seeded().day('2026-11-03');
  assert.equal(day.receivedKobo, 750_000);
  assert.deepEqual(day.entries.map((entry) => [entry.customerName, entry.paidKobo]), [['Korede', 500_000], ['Korede', 250_000]]);
  assert.equal(seeded().day('2026-11-04').entries.length, 0);
});
