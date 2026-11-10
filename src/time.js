const formatters = new Map();

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return formatters.get(timeZone);
}

export function localTimestamp(timeZone, date = new Date()) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

const pad = (number) => String(number).padStart(2, '0');

export const isValidMonth = (value) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function nextDay(date) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

export function nextMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthNumber === 12 ? `${year + 1}-01` : `${year}-${pad(monthNumber + 1)}`;
}

export function periodStarts(timeZone, date = new Date()) {
  const today = localTimestamp(timeZone, date).slice(0, 10);
  const [year, month, day] = today.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const monday = new Date(Date.UTC(year, month - 1, day - ((weekday + 6) % 7)));

  return {
    today,
    week: monday.toISOString().slice(0, 10),
    month: `${today.slice(0, 7)}-01`,
  };
}
