import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';

const COOKIE_NAME = 'beceko_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function readCookie(header, name) {
  for (const part of (header ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export function createAuth({ pin, sessionSecret, secureCookies }) {
  const mac = (value) => createHmac('sha256', sessionSecret).update(value).digest();
  const expectedPin = mac(`pin:${pin}`);
  const failures = new Map();
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure: secureCookies, path: '/' };

  function isSignedIn(req) {
    const [expires, signature] = (readCookie(req.headers.cookie, COOKIE_NAME) ?? '').split('.');
    if (!expires || !signature || Number(expires) < Date.now()) return false;
    const expected = mac(`session:${expires}`);
    const given = Buffer.from(signature, 'base64url');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  function signIn(req, res, submittedPin) {
    const now = Date.now();
    const record = failures.get(req.ip);
    const current = record && now - record.since < LOCKOUT_MS ? record : null;

    if (current?.count >= MAX_FAILURES) {
      throw new HttpError(429, 'Too many wrong PINs. Wait 15 minutes and try again.');
    }
    if (!timingSafeEqual(mac(`pin:${String(submittedPin ?? '')}`), expectedPin)) {
      failures.set(req.ip, { count: (current?.count ?? 0) + 1, since: current?.since ?? now });
      throw new HttpError(401, 'That PIN is not correct.');
    }

    failures.delete(req.ip);
    const expires = String(now + SESSION_MS);
    const token = `${expires}.${mac(`session:${expires}`).toString('base64url')}`;
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_MS });
  }

  function signOut(res) {
    res.clearCookie(COOKIE_NAME, cookieOptions);
  }

  function requireSignIn(req, res, next) {
    next(isSignedIn(req) ? undefined : new HttpError(401, 'Sign in to continue.'));
  }

  return { isSignedIn, signIn, signOut, requireSignIn };
}
