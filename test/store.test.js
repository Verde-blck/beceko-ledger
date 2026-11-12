import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

function setup() {
  const db = openDatabase(':memory:');
  return { db, store: createStore(db, { timeZone: 'Africa/Lagos' }) };
}

test('sale, payment and cancellation keep the balance right', () => {
  const { store } = setup();
  const { id } = store.createCustomer({ name: 'Mama Chidi', phone: '0803 123 4567' });
  store.addEntries([{ customerId: id, kind: 'SALE', description: 'Lace sewing', costKobo: 1_500_000, paidKobo: 500_000 }]);
  const [paymentId] = store.addEntries([{ customerName: 'mama chidi', kind: 'PAYMENT', paidKobo: 300_000 }]);
  assert.equal(store.getCustomer(id).customer.balanceKobo, 700_000);

  store.voidEntry(paymentId);
  const { customer, entries } = store.getCustomer(id);
  assert.equal(customer.balanceKobo, 1_000_000);
  assert.equal(customer.status, 'PARTIAL');
  assert.equal(entries.length, 3);
  assert.equal(entries[1].voidedById, entries[2].id);
  assert.equal(entries[2].balanceKobo, 1_000_000);
  assert.throws(() => store.voidEntry(paymentId), /already cancelled/);
  assert.throws(() => store.voidEntry(entries[2].id), /cannot be cancelled/);
});

test('a failed entry rolls back the whole batch, including new customers', () => {
  const { store } = setup();
  assert.throws(
    () =>
      store.addEntries([
        { customerName: 'Baba Tunde', kind: 'SALE', description: 'Agbada', costKobo: 2_000_000, paidKobo: 0 },
        { customerName: 'Baba Tunde', kind: 'PAYMENT', paidKobo: 3_000_000 },
      ]),
    /Entry 2/,
  );
  assert.equal(store.listCustomers().length, 0);
});

test('ledger entries cannot be edited or deleted', () => {
  const { db, store } = setup();
  const [entryId] = store.addEntries([
    { customerName: 'Iya Bisi', kind: 'SALE', description: 'Ankara', costKobo: 800_000, paidKobo: 0 },
  ]);
  assert.throws(() => db.prepare('UPDATE entries SET paid_kobo = 1 WHERE id = ?').run(entryId), /cannot be changed/);
  assert.throws(() => db.prepare('DELETE FROM entries WHERE id = ?').run(entryId), /cannot be deleted/);
});

test('customer names are unique regardless of case and spacing', () => {
  const { store } = setup();
  const { id } = store.createCustomer({ name: 'Mama Chidi' });
  const other = store.createCustomer({ name: 'Iya Bisi' });
  assert.throws(() => store.createCustomer({ name: ' mama  chidi' }), /already a customer/);
  assert.throws(() => store.updateCustomer(other.id, { name: 'MAMA CHIDI' }), /already a customer/);
  assert.deepEqual(store.updateCustomer(id, { name: 'Mama Chidi', phone: '+234 803' }), {
    id,
    name: 'Mama Chidi',
    phone: '+234 803',
  });
});

test('summary counts only real debts and recent money', () => {
  const { store } = setup();
  store.addEntries([
    { customerName: 'Mama Chidi', kind: 'SALE', description: 'Lace', costKobo: 1_500_000, paidKobo: 500_000 },
    { customerName: 'Iya Bisi', kind: 'SALE', description: 'Ankara', costKobo: 800_000, paidKobo: 800_000 },
  ]);
  const summary = store.summary();
  assert.equal(summary.owedKobo, 1_000_000);
  assert.equal(summary.owingCount, 1);
  assert.equal(summary.receivedTodayKobo, 1_300_000);
  assert.equal(summary.salesMonthKobo, 2_300_000);
  assert.equal(summary.recent.length, 2);
});

test('drafts match existing customers and resolve "paid everything"', () => {
  const { store } = setup();
  store.addEntries([{ customerName: 'Mama Chidi', kind: 'SALE', description: 'Lace', costKobo: 1_500_000, paidKobo: 500_000 }]);
  const [draft] = store.draftsFrom(
    [{ customer_name: 'mama chidi', kind: 'PAYMENT', description: 'Payment', total_cost: null, amount_paid: null, clears_balance: true, needs_review: false, review_reason: '' }],
    'mama chidi don clear her balance',
  );
  assert.equal(draft.customerName, 'Mama Chidi');
  assert.equal(draft.paidKobo, 1_000_000);
  assert.equal(draft.costKobo, null);
});

test('csv export keeps running balances and blocks spreadsheet formulas', () => {
  const { store } = setup();
  store.addEntries([{ customerName: '=HYPERLINK("x")', kind: 'SALE', description: 'Lace', costKobo: 1_000_050, paidKobo: 0 }]);
  const lines = store.exportCsv().trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.match(lines[1], /,"'=HYPERLINK\(""x""\)",Sale,Lace,10000\.5,0,10000\.5,,$/);
});

test('one customer’s records can be exported on their own', () => {
  const { store } = setup();
  const { id } = store.createCustomer({ name: 'Mama Chidi' });
  store.addEntries([{ customerId: id, kind: 'SALE', description: 'Lace sewing', costKobo: 1_500_000, paidKobo: 500_000, sourceText: 'lace, 15k, gave 5k' }]);
  const [paymentId] = store.addEntries([{ customerId: id, kind: 'PAYMENT', paidKobo: 300_000 }]);
  store.voidEntry(paymentId);
  store.addEntries([{ customerName: 'Iya Bisi', kind: 'SALE', description: 'Ankara', costKobo: 800_000, paidKobo: 0 }]);

  const { customer, csv } = store.exportCustomerCsv(id);
  const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  assert.equal(customer.name, 'Mama Chidi');
  assert.equal(lines[0], 'Date,Type,Description,Price (NGN),Paid (NGN),Balance after (NGN),Cancelled,Recorded as');
  assert.equal(lines.length, 4);
  assert.match(lines[1], /,Sale,Lace sewing,15000,5000,10000,,"lace, 15k, gave 5k"$/);
  assert.match(lines[2], /,Payment,Payment,0,3000,7000,Yes,$/);
  assert.match(lines[3], /,Cancellation,Cancelled: Payment,0,-3000,10000,,$/);
  assert.equal(csv.includes('Iya Bisi') || csv.includes('Ankara'), false);
  assert.throws(() => store.exportCustomerCsv(999), /could not be found/);
});

test('a statement leaves out cancelled entries but keeps the same balance', () => {
  const { store } = setup();
  const { id } = store.createCustomer({ name: 'Mama Chidi', phone: '08031234567' });
  store.addEntries([{ customerId: id, kind: 'SALE', description: 'Lace sewing', costKobo: 1_500_000, paidKobo: 500_000 }]);
  const [mistake] = store.addEntries([{ customerId: id, kind: 'SALE', description: 'Wrong sale', costKobo: 1_200_000, paidKobo: 0 }]);
  store.voidEntry(mistake);
  store.addEntries([{ customerId: id, kind: 'PAYMENT', paidKobo: 300_000 }]);

  const statement = store.statement(id);
  assert.deepEqual(
    statement.lines.map((line) => [line.description, line.chargeKobo, line.paidKobo, line.balanceKobo]),
    [
      ['Lace sewing', 1_500_000, 500_000, 1_000_000],
      ['Payment received', 0, 300_000, 700_000],
    ],
  );
  assert.equal(statement.balanceKobo, store.getCustomer(id).customer.balanceKobo);
  assert.deepEqual([statement.chargedKobo, statement.paidKobo], [1_500_000, 800_000]);
  assert.equal(statement.customer.phone, '08031234567');
  assert.match(statement.issuedOn, /^\d{4}-\d{2}-\d{2}$/);
});
