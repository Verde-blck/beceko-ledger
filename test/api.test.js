import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import { createStore } from '../src/store.js';

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
    const data = response.status === 204 ? null : await response.json().catch(() => null);
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
