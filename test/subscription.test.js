import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { subscriptionState } from '../src/subscription.js';

const plan = { paidUntil: '2027-03-31', graceDays: 7, renewContact: 'Pay to GTBank' };

test('a copy with no PAID_UNTIL never locks', () => {
  assert.equal(subscriptionState({ paidUntil: '', graceDays: 7 }, '2099-01-01').state, 'none');
});

test('subscription moves from active to ending, grace and locked on the right days', () => {
  assert.equal(subscriptionState(plan, '2027-03-01').state, 'active');
  assert.deepEqual(
    [subscriptionState(plan, '2027-03-25').state, subscriptionState(plan, '2027-03-25').daysLeft],
    ['ending', 6],
  );
  assert.equal(subscriptionState(plan, '2027-03-31').state, 'ending');
  assert.equal(subscriptionState(plan, '2027-04-01').state, 'grace');
  assert.equal(subscriptionState(plan, '2027-04-01').graceEndsOn, '2027-04-07');
  assert.equal(subscriptionState(plan, '2027-04-07').state, 'grace');
  assert.equal(subscriptionState(plan, '2027-04-08').state, 'locked');
  assert.equal(subscriptionState(plan, '2027-04-08').renewContact, 'Pay to GTBank');
});

test('grace crosses months and leap years correctly', () => {
  assert.equal(subscriptionState({ paidUntil: '2028-02-25', graceDays: 7 }, '2028-03-03').state, 'grace');
  assert.equal(subscriptionState({ paidUntil: '2028-02-25', graceDays: 7 }, '2028-03-04').state, 'locked');
  assert.equal(subscriptionState({ paidUntil: '2027-04-10', graceDays: 0 }, '2027-04-11').state, 'locked');
});

test('subscription and brand settings are checked at start-up', () => {
  const base = { LEDGER_PIN: '2468', SESSION_SECRET: 'a'.repeat(32) };
  assert.throws(() => loadConfig({ ...base, PAID_UNTIL: '31/03/2027' }), /PAID_UNTIL/);
  assert.throws(() => loadConfig({ ...base, GRACE_DAYS: 'a week' }), /GRACE_DAYS/);
  assert.throws(() => loadConfig({ ...base, BRAND: 'nobody' }), /BRAND "nobody" was not found/);
  assert.throws(() => loadConfig({ ...base, BRAND: '../etc' }), /must be a folder name/);

  const beceko = loadConfig({ ...base, BRAND: 'beceko', PAID_UNTIL: '2027-03-31', GRACE_DAYS: '3' });
  assert.equal(beceko.brand.appName, 'Beceko Ledger');
  assert.equal(beceko.businessName, 'Beceko Ledger');
  assert.deepEqual(beceko.subscription, { paidUntil: '2027-03-31', graceDays: 3, renewContact: '' });
  assert.equal(loadConfig(base).brand.appName, 'Ìwé Ọjà');
});
