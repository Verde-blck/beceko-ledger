import { html, mount } from '../dom.js';
import { fullDate } from '../format.js';

export function renderLocked(main, ctx) {
  const { subscription, appName } = ctx.session;
  mount(main, html`
    <section class="stack locked">
      <h1>Your subscription has ended</h1>
      <p>
        ${appName} was paid up to ${fullDate(subscription.paidUntil)}, and the extra week to renew ended on
        ${fullDate(subscription.graceEndsOn)}. Renew to carry on recording sales and payments.
      </p>
      ${subscription.renewContact ? html`<p class="statement-note">${subscription.renewContact}</p>` : ''}
      <p>Your records are safe and nothing has been deleted. You can still download all of them.</p>
      <a class="button primary" href="/api/export.csv">Download all records</a>
    </section>`);
}

export function noticeText(subscription, appName) {
  if (subscription?.state === 'ending') {
    const when = subscription.daysLeft === 0 ? 'today' : `on ${fullDate(subscription.paidUntil)}`;
    return { tone: 'info', text: `Your ${appName} subscription ends ${when}. Renew before then to avoid any interruption.` };
  }
  if (subscription?.state === 'grace') {
    return {
      tone: 'warning',
      text: `Your ${appName} subscription ended on ${fullDate(subscription.paidUntil)}. Renew by ${fullDate(subscription.graceEndsOn)} to keep using it.`,
    };
  }
  return null;
}
