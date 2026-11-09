import { HttpError } from './errors.js';

const MAX_KOBO = 1e13;
const MAX_DESCRIPTION = 200;

const nairaFormat = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

export const cleanName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
export const nameKey = (value) => cleanName(value).toLowerCase();

const isKobo = (value) => Number.isSafeInteger(value) && value >= 0 && value <= MAX_KOBO;

export function nairaToKobo(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const kobo = Math.round(value * 100);
  return kobo <= MAX_KOBO ? kobo : null;
}

export function statusFor(balanceKobo, paidKobo) {
  if (balanceKobo < 0) return 'CREDIT';
  if (balanceKobo === 0) return 'PAID';
  return paidKobo > 0 ? 'PARTIAL' : 'OWING';
}

export function withRunningBalance(entries) {
  let cost = 0;
  let paid = 0;
  return entries.map((entry) => {
    cost += entry.costKobo;
    paid += entry.paidKobo;
    const balanceKobo = cost - paid;
    return { ...entry, balanceKobo, status: statusFor(balanceKobo, paid) };
  });
}

export function checkNewEntry(input, balanceKobo) {
  const description = String(input.description ?? '').trim();
  if (description.length > MAX_DESCRIPTION) {
    throw new HttpError(400, 'The description is too long.');
  }

  if (input.kind === 'SALE') {
    const paidKobo = input.paidKobo ?? 0;
    if (!description) throw new HttpError(400, 'Say what the sale was for.');
    if (!isKobo(input.costKobo) || input.costKobo === 0) throw new HttpError(400, 'Enter the price.');
    if (!isKobo(paidKobo)) throw new HttpError(400, 'Enter a valid amount paid.');
    if (paidKobo > input.costKobo) throw new HttpError(400, 'The amount paid is more than the price.');
    return { kind: 'SALE', description, costKobo: input.costKobo, paidKobo };
  }

  if (input.kind === 'PAYMENT') {
    if (!isKobo(input.paidKobo) || input.paidKobo === 0) throw new HttpError(400, 'Enter the amount paid.');
    if (balanceKobo <= 0) throw new HttpError(400, 'This customer does not owe anything.');
    if (input.paidKobo > balanceKobo) {
      throw new HttpError(400, `That is more than the ${nairaFormat.format(balanceKobo / 100)} owed.`);
    }
    return { kind: 'PAYMENT', description: description || 'Payment', costKobo: 0, paidKobo: input.paidKobo };
  }

  throw new HttpError(400, 'Choose sale or payment.');
}
