import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { loadAdminConfig } from '../src/admin/config.js';
import { createAdminApp } from '../src/admin/app.js';
import { businessToken } from '../src/admin/token.js';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { loadBrand } from '../src/brand.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';
import { addMonths } from '../src/subscription.js';
import { periodStarts } from '../src/time.js';

const OPERATOR_SECRET = 'o'.repeat(40);
const today = () => periodStarts('Africa/Lagos').today;

async function listen(t, app) {
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

async function startCopy(t, { id, adminToken, paidUntil = '', businessName }) {
  const config = {
    pin: '2468',
    sessionSecret: 'a'.repeat(32),
    secureCookies: false,
    timeZone: 'Africa/Lagos',
    businessName,
    brand: loadBrand('beceko'),
    adminToken,
    subscription: { paidUntil, graceDays: 7, renewContact: '' },
  };
  const db = openDatabase(':memory:');
  const store = createStore(db, config);
  store.createCustomer({ name: `${businessName} customer` });
  const url = await listen(t, createApp({ config, store, auth: createAuth(config), extract: null }));
  return { id, url, store };
}

test('each business gets its own token from the operator secret', () => {
  const a = businessToken(OPERATOR_SECRET, 'beceko');
  assert.equal(a, businessToken(OPERATOR_SECRET, 'beceko'));
  assert.notEqual(a, businessToken(OPERATOR_SECRET, 'mama-tola'));
  assert.notEqual(a, businessToken('x'.repeat(40), 'beceko'));
  assert.ok(a.length >= 32);
});

test('admin settings list businesses and reject mistakes', () => {
  const base = { ADMIN_PASSWORD: 'correct horse', SESSION_SECRET: 's'.repeat(32), OPERATOR_SECRET };
  const config = loadAdminConfig({ ...base, BUSINESSES: 'beceko=https://beceko.example.com/, mama-tola=https://tola.example.com' });
  assert.deepEqual(config.businesses, [
    { id: 'beceko', url: 'https://beceko.example.com' },
    { id: 'mama-tola', url: 'https://tola.example.com' },
  ]);
  assert.throws(() => loadAdminConfig({ ...base, BUSINESSES: 'Beceko=not a url' }), /should look like/);
  assert.throws(() => loadAdminConfig({ ...base, BUSINESSES: 'a=https://a.com,a=https://b.com' }), /twice/);
  assert.throws(() => loadAdminConfig({ ...base, ADMIN_PASSWORD: 'short' }), /ADMIN_PASSWORD/);
});

test('months are added on calendar dates, keeping month ends sensible', () => {
  assert.equal(addMonths('2026-11-17', 1), '2026-12-17');
  assert.equal(addMonths('2026-12-17', 1), '2027-01-17');
  assert.equal(addMonths('2027-01-31', 1), '2027-02-28');
  assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
  assert.equal(addMonths('2026-11-17', 12), '2027-11-17');
});

test('a copy only answers the dashboard with the right token', async (t) => {
  const token = businessToken(OPERATOR_SECRET, 'beceko');
  const copy = await startCopy(t, { id: 'beceko', adminToken: token, businessName: 'BECEKO Fabrics & Style' });
  const closed = await startCopy(t, { id: 'other', adminToken: '', businessName: 'Other' });
  const ask = (url, auth, init = {}) => fetch(`${url}/api/admin/status`, { ...init, headers: { Authorization: `Bearer ${auth}`, ...(init.headers ?? {}) } });

  assert.equal((await ask(closed.url, token)).status, 404);
  assert.equal((await ask(copy.url, 'wrong'.repeat(9))).status, 401);
  const status = await (await ask(copy.url, token)).json();
  assert.equal(status.businessName, 'BECEKO Fabrics & Style');
  assert.equal(status.subscription.state, 'none');
  assert.equal(status.customers, 1);
  assert.equal(status.setFrom, 'none');

  const post = (body) =>
    fetch(`${copy.url}/api/admin/subscription`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ paidUntil: '31/12/2026' })).status, 400);
  assert.equal((await post({})).status, 400);
  const updated = await (await post({ paidUntil: addMonths(today(), 1) })).json();
  assert.deepEqual([updated.subscription.state, updated.setFrom], ['active', 'dashboard']);

  const suspended = await (await post({ suspended: true })).json();
  assert.deepEqual([suspended.subscription.state, suspended.subscription.suspended], ['locked', true]);
  const resumed = await (await post({ suspended: false })).json();
  assert.equal(resumed.subscription.state, 'active');
  const never = await (await post({ paidUntil: null })).json();
  assert.equal(never.subscription.state, 'none');
});

test('a suspended business is locked for its users straight away', async (t) => {
  const token = businessToken(OPERATOR_SECRET, 'beceko');
  const copy = await startCopy(t, { id: 'beceko', adminToken: token, businessName: 'Beceko' });
  copy.store.setSubscription({ suspended: true });
  const login = await fetch(`${copy.url}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2468' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${copy.url}/api/summary`, { headers: { cookie } })).status, 402);
  assert.equal((await fetch(`${copy.url}/api/export.csv`, { headers: { cookie } })).status, 200);
  const session = await (await fetch(`${copy.url}/api/session`, { headers: { cookie } })).json();
  assert.equal(session.subscription.suspended, true);
});

test('the dashboard shows every business and extends a subscription', async (t) => {
  const beceko = await startCopy(t, { id: 'beceko', adminToken: businessToken(OPERATOR_SECRET, 'beceko'), businessName: 'BECEKO Fabrics & Style' });
  const tola = await startCopy(t, { id: 'mama-tola', adminToken: businessToken(OPERATOR_SECRET, 'mama-tola'), businessName: 'Mama Tola Stores', paidUntil: today() });
  const wrong = await startCopy(t, { id: 'wrong-token', adminToken: 'x'.repeat(43), businessName: 'Wrong' });
  const config = loadAdminConfig({
    ADMIN_PASSWORD: 'correct horse battery',
    SESSION_SECRET: 's'.repeat(32),
    OPERATOR_SECRET,
    BUSINESSES: [`beceko=${beceko.url}`, `mama-tola=${tola.url}`, `wrong-token=${wrong.url}`, 'gone=http://127.0.0.1:9'].join(','),
  });
  const admin = await listen(t, createAdminApp({ config }));

  assert.equal((await fetch(`${admin}/`, { redirect: 'manual' })).headers.get('location'), '/login');
  const badLogin = await fetch(`${admin}/login`, { method: 'POST', body: new URLSearchParams({ password: 'nope' }), redirect: 'manual' });
  assert.equal(badLogin.status, 401);
  const login = await fetch(`${admin}/login`, { method: 'POST', body: new URLSearchParams({ password: 'correct horse battery' }), redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const page = await (await fetch(`${admin}/`, { headers: { cookie } })).text();
  assert.ok(page.indexOf('Mama Tola Stores') < page.indexOf('BECEKO Fabrics'), 'businesses needing attention come first');
  assert.match(page, /BECEKO Fabrics &amp; Style/);
  assert.match(page, /Never locks/);
  assert.match(page, /Mama Tola Stores/);
  assert.match(page, /Ends soon, 0 days left/);
  assert.match(page, /ADMIN_TOKEN on this copy does not match/);
  assert.match(page, /could not be reached/);

  const extend = await fetch(`${admin}/businesses/mama-tola/extend`, { method: 'POST', headers: { cookie }, body: new URLSearchParams({ months: '1' }), redirect: 'manual' });
  assert.match(decodeURIComponent(extend.headers.get('location')), /Mama Tola Stores is now paid until/);
  assert.equal(tola.store.subscriptionOverrides().paidUntil, addMonths(today(), 1));

  await fetch(`${admin}/businesses/mama-tola/suspend`, { method: 'POST', headers: { cookie }, redirect: 'manual' });
  assert.equal(tola.store.subscriptionOverrides().suspended, true);
  await fetch(`${admin}/businesses/mama-tola/resume`, { method: 'POST', headers: { cookie }, redirect: 'manual' });
  assert.equal(tola.store.subscriptionOverrides().suspended, false);

  const tokenPage = await (await fetch(`${admin}/businesses/beceko/token`, { headers: { cookie } })).text();
  assert.ok(tokenPage.includes(businessToken(OPERATOR_SECRET, 'beceko')));
  assert.equal((await fetch(`${admin}/businesses/nobody/token`, { headers: { cookie } })).status, 404);
});

test('the dashboard carries the Ìwé Ọjà icon, even before signing in', async (t) => {
  const config = loadAdminConfig({ ADMIN_PASSWORD: 'correct horse battery', SESSION_SECRET: 's'.repeat(32), OPERATOR_SECRET });
  const admin = await listen(t, createAdminApp({ config }));
  const page = await (await fetch(`${admin}/login`)).text();
  for (const tag of ['rel="manifest"', 'rel="apple-touch-icon"', 'href="/favicon.ico"', 'href="/icon.svg"']) assert.ok(page.includes(tag), tag);

  const manifest = await (await fetch(`${admin}/manifest.webmanifest`)).json();
  assert.deepEqual([manifest.name, manifest.short_name, manifest.icons.length], ['Ìwé Ọjà admin', 'Ìwé Ọjà', 3]);
  for (const path of ['/favicon.ico', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png']) {
    const response = await fetch(`${admin}${path}`, { redirect: 'manual' });
    assert.equal(response.status, 200, path);
  }
  const { readFileSync } = await import('node:fs');
  const served = Buffer.from(await (await fetch(`${admin}/icons/icon-512.png`)).arrayBuffer());
  assert.ok(served.equals(readFileSync(new URL('../brands/iwe-oja/icons/icon-512.png', import.meta.url))), 'serves the Ọ monogram');
});
