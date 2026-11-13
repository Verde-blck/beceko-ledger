import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';
import { loadBrand } from '../src/brand.js';
import { periodStarts } from '../src/time.js';

const config = {
  pin: '2468',
  sessionSecret: 'a'.repeat(32),
  secureCookies: false,
  trustProxy: false,
  timeZone: 'Africa/Lagos',
  businessName: 'Beceko',
};

async function start(t, extract = null) {
  const db = openDatabase(':memory:');
  const app = createApp({ config, store: createStore(db, config), auth: createAuth(config), extract });
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => server.close());

  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  const call = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const isPdf = response.headers.get('content-type') === 'application/pdf';
    const data = response.status === 204 ? null : isPdf ? Buffer.from(await response.arrayBuffer()) : await response.json().catch(() => null);
    return { status: response.status, data, headers: response.headers };
  };
  return call;
}

test('the ledger is closed until the right PIN is given', async (t) => {
  const call = await start(t);
  assert.equal((await call('/summary')).status, 401);
  assert.equal((await call('/session', { method: 'POST', body: { pin: '0000' } })).status, 401);
  assert.equal((await call('/session', { method: 'POST', body: { pin: '2468' } })).status, 204);
  assert.equal((await call('/session')).data.authenticated, true);
  assert.equal((await call('/summary')).status, 200);
  await call('/session', { method: 'DELETE' });
  assert.equal((await call('/summary')).status, 401);
});

test('wrong PINs are locked out after five tries', async (t) => {
  const call = await start(t);
  for (let i = 0; i < 5; i += 1) await call('/session', { method: 'POST', body: { pin: '1111' } });
  assert.equal((await call('/session', { method: 'POST', body: { pin: '2468' } })).status, 429);
});

test('recording a sale and a payment through the API', async (t) => {
  const call = await start(t, async () => [
    {
      customer_name: 'Mama Chidi',
      kind: 'SALE',
      description: 'Lace sewing',
      total_cost: 15000,
      amount_paid: 5000,
      clears_balance: false,
      needs_review: false,
      review_reason: '',
    },
  ]);
  await call('/session', { method: 'POST', body: { pin: '2468' } });

  const parsed = await call('/parse', { method: 'POST', body: { text: 'Mama Chidi lace 15k, gave 5k' } });
  assert.equal(parsed.status, 200);
  const [draft] = parsed.data.drafts;
  assert.deepEqual([draft.costKobo, draft.paidKobo], [1_500_000, 500_000]);

  const saved = await call('/entries', { method: 'POST', body: { entries: [draft] } });
  assert.equal(saved.status, 201);

  const { customers } = (await call('/customers')).data;
  assert.equal(customers[0].balanceKobo, 1_000_000);

  const overpaid = await call('/entries', {
    method: 'POST',
    body: { entries: [{ customerId: customers[0].id, kind: 'PAYMENT', paidKobo: 2_000_000 }] },
  });
  assert.equal(overpaid.status, 400);
  assert.match(overpaid.data.error, /more than/);

  const exported = await call('/export.csv');
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get('content-disposition'), /beceko-ledger-\d{4}-\d{2}-\d{2}\.csv/);
});

test('unknown API routes return JSON 404s', async (t) => {
  const call = await start(t);
  await call('/session', { method: 'POST', body: { pin: '2468' } });
  const response = await call('/nothing-here');
  assert.equal(response.status, 404);
  assert.equal(response.data.error, 'Not found.');
});

test('a retired Gemini model gives a clear message', async (t) => {
  const { ApiError } = await import('@google/genai');
  const call = await start(t, async () => {
    throw new ApiError({ status: 404, message: '{"error":{"code":404,"message":"This model is no longer available."}}' });
  });
  await call('/session', { method: 'POST', body: { pin: '2468' } });
  const response = await call('/parse', { method: 'POST', body: { text: 'korede paid another 5k' } });
  assert.equal(response.status, 502);
  assert.match(response.data.error, /no longer available/);
});

test('calendar endpoints reject malformed dates', async (t) => {
  const call = await start(t);
  await call('/session', { method: 'POST', body: { pin: '2468' } });
  assert.equal((await call('/calendar/2026-13')).status, 404);
  assert.equal((await call('/days/2026-02-30')).status, 404);
  const month = await call('/calendar');
  assert.equal(month.status, 200);
  assert.match(month.data.month, /^\d{4}-\d{2}$/);
  assert.equal((await call(`/days/${month.data.today}`)).status, 200);
});

test('a single customer’s records download as their own file', async (t) => {
  const call = await start(t);
  await call('/session', { method: 'POST', body: { pin: '2468' } });
  const created = await call('/customers', { method: 'POST', body: { name: 'Aunty Fúnmi Adéyemí' } });
  await call('/entries', { method: 'POST', body: { entries: [{ customerId: created.data.id, kind: 'SALE', description: 'Aso ebi', costKobo: 9_000_000, paidKobo: 2_000_000 }] } });

  const file = await call(`/customers/${created.data.id}/export.csv`);
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-disposition'), /beceko-aunty-funmi-adeyemi-\d{4}-\d{2}-\d{2}\.csv/);
  assert.match(file.headers.get('content-type'), /text\/csv/);
  assert.equal((await call('/customers/999/export.csv')).status, 404);
});

test('a customer statement is available as data and as a PDF', async (t) => {
  const call = await start(t);
  await call('/session', { method: 'POST', body: { pin: '2468' } });
  const created = await call('/customers', { method: 'POST', body: { name: 'Mama Chidi' } });
  await call('/entries', { method: 'POST', body: { entries: [{ customerId: created.data.id, kind: 'SALE', description: 'Lace sewing', costKobo: 1_500_000, paidKobo: 500_000 }] } });

  const data = await call(`/customers/${created.data.id}/statement`);
  assert.equal(data.status, 200);
  assert.equal(data.data.balanceKobo, 1_000_000);
  assert.match(data.data.fileName, /^statement-mama-chidi-\d{4}-\d{2}-\d{2}\.pdf$/);
  assert.equal(data.data.closing, 'Thank you for your patronage.');

  const pdf = await call(`/customers/${created.data.id}/statement.pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(pdf.data.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.headers.get('content-disposition'), /statement-mama-chidi-/);
  assert.equal((await call('/customers/999/statement.pdf')).status, 404);
});


async function startWith(t, overrides) {
  const db = openDatabase(':memory:');
  const merged = { ...config, ...overrides };
  const app = createApp({ config: merged, store: createStore(db, merged), auth: createAuth(merged), extract: null });
  const server = app.listen(0);
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

const dayOffset = (days) => {
  const today = periodStarts('Africa/Lagos').today;
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

async function signedIn(base) {
  const response = await fetch(`${base}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '2468' }) });
  return response.headers.get('set-cookie').split(';')[0];
}

test('a locked business can still sign in, see why, and download its records', async (t) => {
  const base = await startWith(t, { subscription: { paidUntil: dayOffset(-8), graceDays: 7, renewContact: 'Pay to GTBank' } });
  const cookie = await signedIn(base);
  const get = (path) => fetch(`${base}${path}`, { headers: { cookie } });

  const session = await (await get('/api/session')).json();
  assert.equal(session.subscription.state, 'locked');
  assert.equal(session.subscription.renewContact, 'Pay to GTBank');
  assert.equal((await get('/api/summary')).status, 402);
  assert.equal((await get('/api/customers')).status, 402);
  assert.equal((await get('/api/export.csv')).status, 200);
  assert.equal((await get('/api/subscription')).status, 200);
});

test('during the grace week everything still works', async (t) => {
  const base = await startWith(t, { subscription: { paidUntil: dayOffset(-7), graceDays: 7, renewContact: '' } });
  const cookie = await signedIn(base);
  const session = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json();
  assert.equal(session.subscription.state, 'grace');
  assert.equal((await fetch(`${base}/api/summary`, { headers: { cookie } })).status, 200);
});

test('the page, manifest, colours and icons come from the chosen brand', async (t) => {
  const base = await startWith(t, { brand: loadBrand('beceko') });
  const page = await (await fetch(`${base}/`)).text();
  assert.match(page, /<title>Beceko Ledger<\/title>/);
  assert.doesNotMatch(page, /\{\{/);
  assert.equal((await (await fetch(`${base}/manifest.webmanifest`)).json()).short_name, 'Beceko');
  assert.match(await (await fetch(`${base}/brand.css`)).text(), /#2348a8/);
  for (const path of ['/icon.svg', '/favicon.ico', '/icons/icon-512.png', '/icons/apple-touch-icon.png']) {
    assert.equal((await fetch(`${base}${path}`)).status, 200, path);
  }
  const unbranded = await startWith(t, {});
  assert.match(await (await fetch(`${unbranded}/`)).text(), /<title>Ìwé Ọjà<\/title>/);
});
