const DAY_MS = 24 * 60 * 60 * 1000;
const ENDING_SOON_DAYS = 7;

const toUtc = (date) => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const daysBetween = (from, to) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
const addDays = (date, days) => new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);

export function subscriptionState({ paidUntil, graceDays, renewContact }, today) {
  if (!paidUntil) return { state: 'none' };
  const graceEndsOn = addDays(paidUntil, graceDays);
  const details = { paidUntil, graceEndsOn, renewContact };

  if (today <= paidUntil) {
    const daysLeft = daysBetween(today, paidUntil);
    return { state: daysLeft < ENDING_SOON_DAYS ? 'ending' : 'active', daysLeft, ...details };
  }
  if (today <= graceEndsOn) return { state: 'grace', daysLeft: daysBetween(today, graceEndsOn), ...details };
  return { state: 'locked', ...details };
}
