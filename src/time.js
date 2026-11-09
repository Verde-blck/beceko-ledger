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
