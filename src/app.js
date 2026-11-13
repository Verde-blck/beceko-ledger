import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandCss, loadBrand, manifest, renderIndex } from './brand.js';
import { HttpError } from './errors.js';
import { aiErrorDetail, quickEntryProblem } from './extract.js';
import { DEFAULT_CLOSING, statementPdf } from './statement.js';
import { subscriptionState } from './subscription.js';
import { isValidDate, isValidMonth, localTimestamp, periodStarts } from './time.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));
const MAX_NOTE = 1000;

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  next();
}

const fileSlug = (name) =>
  name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'customer';

function idParam(req) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, 'Not found.');
  return id;
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request is not valid JSON.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'The request is too large.' });
  console.error(error);
  res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
}

const LOCKED_ALLOWED = new Set(['/export.csv', '/subscription']);

export function createApp({ config, store, auth, extract }) {
  const brand = config.brand ?? loadBrand();
  const subscription = () =>
    subscriptionState(config.subscription ?? {}, periodStarts(config.timeZone).today);
  const indexHtml = renderIndex(readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8'), brand);

  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '64kb' }));

  app.get(['/', '/index.html'], (req, res) => res.type('html').set('Cache-Control', 'no-cache').send(indexHtml));
  app.get('/manifest.webmanifest', (req, res) => res.type('application/manifest+json').send(manifest(brand)));
  app.get('/brand.css', (req, res) => res.type('css').send(brandCss(brand)));
  app.get('/icon.svg', (req, res) => res.sendFile(join(brand.dir, 'icon.svg')));
  app.get('/favicon.ico', (req, res) => res.sendFile(join(brand.dir, 'favicon.ico')));
  app.use('/icons', express.static(join(brand.dir, 'icons')));
  app.use(express.static(PUBLIC_DIR, { index: false }));

  app.get('/api/session', (req, res) => {
    const authenticated = auth.isSignedIn(req);
    res.json({
      authenticated,
      aiEnabled: Boolean(extract),
      appName: brand.appName,
      businessName: config.businessName,
      ...(authenticated ? { subscription: subscription() } : {}),
    });
  });

  app.post('/api/session', (req, res) => {
    auth.signIn(req, res, req.body?.pin);
    res.status(204).end();
  });

  app.delete('/api/session', (req, res) => {
    auth.signOut(res);
    res.status(204).end();
  });

  app.use('/api', auth.requireSignIn);

  app.use('/api', (req, res, next) => {
    if (subscription().state !== 'locked' || (req.method === 'GET' && LOCKED_ALLOWED.has(req.path))) return next();
    res.status(402).json({ error: 'The subscription has ended. Renew it to carry on.', locked: true });
  });

  app.get('/api/subscription', (req, res) => res.json(subscription()));

  app.get('/api/summary', (req, res) => res.json(store.summary()));

  app.get('/api/customers', (req, res) => res.json({ customers: store.listCustomers() }));

  app.post('/api/customers', (req, res) => res.status(201).json(store.createCustomer(req.body ?? {})));

  app.get('/api/customers/:id', (req, res) => res.json(store.getCustomer(idParam(req))));

  app.patch('/api/customers/:id', (req, res) => res.json(store.updateCustomer(idParam(req), req.body ?? {})));

  app.get('/api/calendar', (req, res) => res.json(store.month()));

  app.get('/api/calendar/:month', (req, res) => {
    if (!isValidMonth(req.params.month)) throw new HttpError(404, 'Not found.');
    res.json(store.month(req.params.month));
  });

  app.get('/api/days/:date', (req, res) => {
    if (!isValidDate(req.params.date)) throw new HttpError(404, 'Not found.');
    res.json(store.day(req.params.date));
  });

  app.post('/api/entries', (req, res) => res.status(201).json({ ids: store.addEntries(req.body?.entries) }));

  app.post('/api/entries/:id/void', (req, res) => res.status(201).json(store.voidEntry(idParam(req))));

  app.post('/api/parse', async (req, res) => {
    if (!extract) throw new HttpError(503, 'Quick entry is not set up on this server.');
    const text = String(req.body?.text ?? '').trim();
    if (!text) throw new HttpError(400, 'Type or say what happened first.');
    if (text.length > MAX_NOTE) throw new HttpError(400, 'That is too long. Record one or two things at a time.');

    const customers = store.customerNames();
    let events;
    try {
      events = await extract(text, customers);
    } catch (error) {
      const { status, message } = aiErrorDetail(error);
      console.error(`AI request failed${status ? ` (${status})` : ''}: ${message}`);
      throw new HttpError(502, quickEntryProblem(error));
    }
    res.json({ drafts: store.draftsFrom(events, text), customers });
  });

  app.get('/api/export.csv', (req, res) => {
    const date = localTimestamp(config.timeZone).slice(0, 10);
    res.attachment(`beceko-ledger-${date}.csv`).send(store.exportCsv());
  });

  const statementWording = { note: config.statementNote ?? '', closing: config.statementClosing || DEFAULT_CLOSING };

  const statementFile = (statement) => `statement-${fileSlug(statement.customer.name)}-${statement.issuedOn}.pdf`;

  app.get('/api/customers/:id/statement', (req, res) => {
    const statement = store.statement(idParam(req));
    res.json({ ...statement, ...statementWording, businessName: config.businessName, fileName: statementFile(statement) });
  });

  app.get('/api/customers/:id/statement.pdf', async (req, res) => {
    const statement = store.statement(idParam(req));
    const pdf = await statementPdf(statement, {
      businessName: config.businessName,
      logo: join(brand.dir, 'icons/icon-192.png'),
      ...statementWording,
    });
    res
      .type('application/pdf')
      .set('Content-Disposition', `inline; filename="${statementFile(statement)}"`)
      .set('Cache-Control', 'no-store')
      .send(pdf);
  });

  app.get('/api/customers/:id/export.csv', (req, res) => {
    const { customer, csv } = store.exportCustomerCsv(idParam(req));
    const date = localTimestamp(config.timeZone).slice(0, 10);
    res.attachment(`beceko-${fileSlug(customer.name)}-${date}.csv`).send(csv);
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(errorHandler);

  return app;
}
