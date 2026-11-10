const WHOLE = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const EXACT = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function naira(kobo) {
  const value = kobo || 0;
  return (value % 100 === 0 ? WHOLE : EXACT).format(value / 100);
}

export function parseNaira(input) {
  const text = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[₦,\s]/g, '')
    .replace(/^n(?=\d)/, '');
  if (!text) return null;

  const match = /^(\d+(?:\.\d+)?)(k)?$/.exec(text);
  if (!match) return Number.NaN;

  const kobo = Number(match[1]) * (match[2] ? 1000 : 1) * 100;
  const rounded = Math.round(kobo);
  return Math.abs(kobo - rounded) < 1e-6 && Number.isSafeInteger(rounded) ? rounded : Number.NaN;
}

export function toInputValue(kobo) {
  if (kobo == null) return '';
  return kobo % 100 === 0 ? String(kobo / 100) : (kobo / 100).toFixed(2);
}

export function balanceText(kobo) {
  if (kobo > 0) return `Owes ${naira(kobo)}`;
  if (kobo < 0) return `In credit ${naira(-kobo)}`;
  return 'Paid up';
}

export function balanceClass(kobo) {
  if (kobo > 0) return 'is-owing';
  return kobo < 0 ? 'is-credit' : 'is-settled';
}

export const nameKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const pad = (number) => String(number).padStart(2, '0');
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function dayLabel(timestamp) {
  const date = timestamp.slice(0, 10);
  const now = new Date();
  if (date === isoDate(now)) return 'Today';
  if (date === isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return 'Yesterday';

  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: year === now.getFullYear() ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

export const timeLabel = (timestamp) => timestamp.slice(11, 16);

export function entrySummary(entry) {
  if (entry.kind === 'SALE') return `${entry.description}, ${naira(entry.costKobo)}`;
  if (entry.kind === 'PAYMENT') return `Paid ${naira(entry.paidKobo)}`;
  return entry.description;
}

export function entryDetail(entry) {
  if (entry.kind === 'SALE') {
    return entry.paidKobo > 0
      ? `Price ${naira(entry.costKobo)}, paid ${naira(entry.paidKobo)}`
      : `Price ${naira(entry.costKobo)}, nothing paid at the time`;
  }
  if (entry.kind === 'PAYMENT') return `Paid ${naira(entry.paidKobo)}`;

  const parts = [];
  if (entry.costKobo) parts.push(`price ${naira(-entry.costKobo)}`);
  if (entry.paidKobo) parts.push(`payment ${naira(-entry.paidKobo)}`);
  return `Reverses ${parts.join(' and ')}`;
}

export function whatsappLink(phone, message) {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = `234${digits.slice(1)}`;
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : null;
}

const COMPACT = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export const nairaCompact = (kobo) => COMPACT.format((kobo || 0) / 100);

const utcDate = (date) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day || 1));
};

export const longDate = (date) =>
  utcDate(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

export const monthTitle = (month) =>
  utcDate(month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const monthName = (month) => utcDate(month).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });

export function shiftMonth(month, by) {
  const date = utcDate(month);
  date.setUTCMonth(date.getUTCMonth() + by);
  return date.toISOString().slice(0, 7);
}
