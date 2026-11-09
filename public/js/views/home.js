import { api } from '../api.js';
import { html, mount } from '../dom.js';
import { dayLabel, entrySummary, naira, timeLabel } from '../format.js';
import { bindQuickEntry, quickEntry } from './quick-entry.js';
import { personRow } from './shared.js';

function owingDetail(count) {
  if (count === 0) return 'Everyone is paid up.';
  return count === 1 ? 'from 1 customer' : `from ${count} customers`;
}

const totalRow = (label, kobo) => html`<div><dt>${label}</dt><dd>${naira(kobo)}</dd></div>`;

const activityRow = (entry) => html`
  <li>
    <a href="#/customers/${entry.customerId}">
      <span class="who">${entry.customerName}</span>
      <span class="when">${dayLabel(entry.createdAt)}, ${timeLabel(entry.createdAt)}</span>
      <span class="what">${entrySummary(entry)}</span>
    </a>
  </li>`;

export async function renderHome(main, ctx) {
  const summary = await api('/summary');
  if (!ctx.current()) return;

  mount(main, html`
    ${ctx.session.aiEnabled ? quickEntry() : ''}

    <section class="owed">
      <p class="owed-label">People owe you</p>
      <p class="owed-amount ${summary.owedKobo > 0 ? 'is-owing' : ''}">${naira(summary.owedKobo)}</p>
      <p class="owed-detail">${owingDetail(summary.owingCount)}</p>
    </section>

    <dl class="ruled">
      ${totalRow('Received today', summary.receivedTodayKobo)}
      ${totalRow('Received this week', summary.receivedWeekKobo)}
      ${totalRow('Received this month', summary.receivedMonthKobo)}
      ${totalRow('Sales this month', summary.salesMonthKobo)}
    </dl>

    <section>
      <h2>Owing the most</h2>
      ${summary.topOwing.length > 0
        ? html`<ul class="people">${summary.topOwing.map(personRow)}</ul>`
        : html`<p class="empty">No one owes you anything right now.</p>`}
    </section>

    <section>
      <h2>Latest entries</h2>
      ${summary.recent.length > 0
        ? html`<ul class="activity">${summary.recent.map(activityRow)}</ul>`
        : html`<p class="empty">Nothing recorded yet. <a href="#/customers">Add your first customer</a> to start.</p>`}
    </section>

    <p class="export"><a href="/api/export.csv">Download all records as a spreadsheet</a></p>`);

  if (ctx.session.aiEnabled) bindQuickEntry(main.querySelector('.quick-entry'), ctx);
}
