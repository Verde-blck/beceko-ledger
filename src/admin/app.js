import express from 'express';
import { fileURLToPath } from 'node:url';
import { createAuth } from '../auth.js';
import { HttpError } from '../errors.js';
import { addMonths } from '../subscription.js';
import { isValidDate, periodStarts } from '../time.js';
import { copiesClient } from './copies.js';
import { businessToken } from './token.js';
import { dashboardPage, loginPage, notFoundPage, tokenPage } from './views.js';

const PUBLIC_DIR = fileURLToPath(new URL('../../admin-public', import.meta.url));

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function createAdminApp({ config, fetchImpl }) {
  const auth = createAuth({
    pin: config.password,
    sessionSecret: config.sessionSecret,
    secureCookies: config.secureCookies,
    cookieName: 'iwe_oja_admin',
    wrongMessage: 'That password is not correct.',
  });
  const copies = copiesClient({ operatorSecret: config.operatorSecret, fetchImpl });
  const today = () => periodStarts(config.timeZone).today;
  const findBusiness = (id) => config.businesses.find((b) => b.id === id);

  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Cache-Control': 'no-store',
    });
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '8kb' }));
  app.use(express.static(PUBLIC_DIR, { index: false }));

  app.get('/login', (req, res) => (auth.isSignedIn(req) ? res.redirect('/') : res.send(loginPage())));

  app.post('/login', (req, res) => {
    try {
      auth.signIn(req, res, req.body?.password);
      res.redirect(303, '/');
    } catch (error) {
      res.status(error instanceof HttpError ? error.status : 500).send(loginPage(error.message));
    }
  });

  app.post('/logout', (req, res) => {
    auth.signOut(res);
    res.redirect(303, '/login');
  });

  app.use((req, res, next) => (auth.isSignedIn(req) ? next() : res.redirect(303, '/login')));

  app.get('/', async (req, res) => {
    const results = await Promise.all(
      config.businesses.map((business) =>
        copies.status(business).then(
          (status) => ({ business, status }),
          (error) => ({ business, error: error.message }),
        ),
      ),
    );
    const order = { locked: 0, grace: 1, ending: 2, error: 3, active: 4, none: 5 };
    const rank = (r) => (r.error ? order.error : r.status.subscription.suspended ? order.locked : order[r.status.subscription.state] ?? 6);
    results.sort((a, b) => rank(a) - rank(b));
    res.send(dashboardPage(results, { message: req.query.message, error: req.query.error }));
  });

  app.get('/businesses/:id/token', (req, res) => {
    const business = findBusiness(req.params.id);
    if (!business) return res.status(404).send(notFoundPage());
    res.send(tokenPage(business, businessToken(config.operatorSecret, business.id)));
  });

  const action = (handler) => async (req, res) => {
    const business = findBusiness(req.params.id);
    if (!business) return res.status(404).send(notFoundPage());
    try {
      const message = await handler(business, req.body ?? {});
      res.redirect(303, `/?message=${encodeURIComponent(message)}`);
    } catch (error) {
      res.redirect(303, `/?error=${encodeURIComponent(`${business.id}: ${error.message}`)}`);
    }
  };

  const named = (status) => status.businessName || status.appName;
  const longDate = (date) =>
    new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  app.post(
    '/businesses/:id/extend',
    action(async (business, body) => {
      const months = Number(body.months);
      if (![1, 3, 12].includes(months)) throw new Error('Choose 1, 3 or 12 months.');
      const current = await copies.status(business);
      const paid = current.subscription.paidUntil;
      const from = paid && paid >= today() && !current.subscription.suspended ? paid : today();
      const paidUntil = addMonths(from, months);
      const status = await copies.update(business, { paidUntil, suspended: false });
      return `${named(status)} is now paid until ${longDate(paidUntil)}.`;
    }),
  );

  app.post(
    '/businesses/:id/set',
    action(async (business, body) => {
      if (!isValidDate(body.paidUntil ?? '')) throw new Error('Choose a valid date.');
      const status = await copies.update(business, { paidUntil: body.paidUntil, suspended: false });
      return `${named(status)} is now paid until ${longDate(body.paidUntil)}.`;
    }),
  );

  app.post(
    '/businesses/:id/suspend',
    action(async (business) => `${named(await copies.update(business, { suspended: true }))} is suspended.`),
  );

  app.post(
    '/businesses/:id/resume',
    action(async (business) => `${named(await copies.update(business, { suspended: false }))} is running again.`),
  );

  app.post(
    '/businesses/:id/never',
    action(async (business) => `${named(await copies.update(business, { paidUntil: null, suspended: false }))} will never lock.`),
  );

  app.use((req, res) => res.status(404).send(notFoundPage()));
  return app;
}
