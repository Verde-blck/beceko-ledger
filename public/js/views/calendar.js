import { api } from '../api.js';
import { html, mount } from '../dom.js';
import { longDate, monthName, monthTitle, naira, nairaCompact, shiftMonth, timeLabel } from '../format.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function dayCells(month, days, today, selected) {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const [year, monthNumber] = month.split('-').map(Number);
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const length = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  const cells = Array.from({ length: firstWeekday }, () => html`<span class="day-blank" aria-hidden="true"></span>`);
  for (let number = 1; number <= length; number += 1) {
    const date = `${month}-${String(number).padStart(2, '0')}`;
    const totals = byDate.get(date);
    const received = totals?.receivedKobo ?? 0;
    const label = received ? `${longDate(date)}, received ${naira(received)}` : longDate(date);
    cells.push(html`
      <a class="day ${date === today ? 'today' : ''}" href="#/calendar/${date}" aria-label="${label}" ${date === selected ? html`aria-current="date"` : ''}>
        <span class="num">${number}</span>
        ${received ? html`<span class="amt">${nairaCompact(received)}</span>` : totals ? html`<span class="dot" aria-hidden="true"></span>` : ''}
      </a>`);
  }
  return cells;
}

function entryLine(entry) {
  if (entry.kind === 'PAYMENT') return `Paid ${naira(entry.paidKobo)}`;
  if (entry.kind === 'VOID') return entry.description;
  return entry.paidKobo > 0
    ? `${entry.description}: price ${naira(entry.costKobo)}, paid ${naira(entry.paidKobo)}`
    : `${entry.description}: price ${naira(entry.costKobo)}, nothing paid`;
}

const entryRow = (entry) => html`
  <li class="${entry.voidedById != null ? 'voided' : ''}">
    <a href="#/customers/${entry.customerId}">
      <span class="who">${entry.customerName}</span>
      <span class="when">${timeLabel(entry.createdAt)}</span>
      <span class="what">${entryLine(entry)}</span>
    </a>
  </li>`;

function dayDetail(day) {
  if (!day) return html`<p class="empty">Tap a day to see who paid and what was sold.</p>`;
  return html`
    <section class="stack day-detail" aria-live="polite">
      <h2>${longDate(day.date)}</h2>
      ${day.entries.length > 0
        ? html`
          <dl class="ruled">
            <div><dt>Received</dt><dd>${naira(day.receivedKobo)}</dd></div>
            <div><dt>Sales</dt><dd>${naira(day.salesKobo)}</dd></div>
          </dl>
          <ul class="activity">${day.entries.map(entryRow)}</ul>`
        : html`<p class="empty">Nothing was recorded on this day.</p>`}
    </section>`;
}

export async function renderCalendar(main, ctx, monthParam, dayParam) {
  const calendar = await api(monthParam ? `/calendar/${monthParam}` : '/calendar');
  const isCurrentMonth = calendar.today.startsWith(calendar.month);
  const selected = dayParam ? `${calendar.month}-${dayParam}` : !monthParam && isCurrentMonth ? calendar.today : null;
  const day = selected ? await api(`/days/${selected}`) : null;
  if (!ctx.current()) return;

  mount(main, html`
    <section class="stack">
      <div class="month-head">
        <h1>${monthTitle(calendar.month)}</h1>
        <nav class="month-nav" aria-label="Change month">
          <a class="button quiet" href="#/calendar/${shiftMonth(calendar.month, -1)}">Previous</a>
          ${isCurrentMonth ? '' : html`<a class="button quiet" href="#/calendar">Today</a>`}
          <a class="button quiet" href="#/calendar/${shiftMonth(calendar.month, 1)}">Next</a>
        </nav>
      </div>

      <div class="month-grid">
        ${WEEKDAYS.map((name) => html`<span class="weekday" aria-hidden="true">${name}</span>`)}
        ${dayCells(calendar.month, calendar.days, calendar.today, selected)}
      </div>

      <dl class="ruled">
        <div><dt>Received in ${monthName(calendar.month)}</dt><dd>${naira(calendar.receivedKobo)}</dd></div>
        <div><dt>Sales in ${monthName(calendar.month)}</dt><dd>${naira(calendar.salesKobo)}</dd></div>
      </dl>
    </section>

    ${dayDetail(day)}`);

  if (dayParam && ctx.sameSection) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    main.querySelector('.day-detail')?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }
}
