import { api } from '../api.js';
import { html, mount, onSubmit } from '../dom.js';
import {
  balanceClass,
  balanceText,
  dayLabel,
  entryDetail,
  naira,
  parseNaira,
  timeLabel,
  toInputValue,
  whatsappLink,
} from '../format.js';

const bookLine = (entry) => {
  const voided = entry.voidedById != null;
  const canCancel = entry.kind !== 'VOID' && !voided;

  return html`
    <li class="line ${entry.kind.toLowerCase()} ${voided ? 'voided' : ''}">
      <div class="margin">
        <span>${dayLabel(entry.createdAt)}</span>
        <span>${timeLabel(entry.createdAt)}</span>
      </div>
      <div class="entry">
        <p class="what">${entry.description}</p>
        <p class="detail">${entryDetail(entry)}${voided ? ' (cancelled)' : ''}</p>
        ${entry.sourceText ? html`<p class="said">“${entry.sourceText}”</p>` : ''}
        ${canCancel ? html`<button class="text-button" type="button" data-void="${entry.id}">Cancel entry</button>` : ''}
      </div>
      <div class="running ${balanceClass(entry.balanceKobo)}">${naira(entry.balanceKobo)}</div>
    </li>`;
};

export async function renderCustomer(main, ctx, id) {
  const { customer, entries } = await api(`/customers/${id}`);
  if (!ctx.current()) return;

  const balance = customer.balanceKobo;
  const reminder =
    balance > 0 && customer.phone
      ? whatsappLink(
          customer.phone,
          `Good day ${customer.name}, this is a reminder from ${ctx.session.businessName} that your balance is ${naira(balance)}. Thank you.`,
        )
      : null;

  mount(main, html`
    <section class="stack">
      <div class="customer-head">
        <a class="back" href="#/customers">All customers</a>
        <h1>${customer.name}</h1>
        ${customer.phone ? html`<a class="phone" href="tel:${customer.phone}">${customer.phone}</a>` : ''}
        <p class="balance-line ${balanceClass(balance)}">${balanceText(balance)}</p>
      </div>

      <div class="actions">
        <button class="button primary" type="button" data-open="sale">Record sale</button>
        <button class="button primary" type="button" data-open="payment" ${balance > 0 ? '' : html`disabled`}>Record payment</button>
        ${reminder ? html`<a class="button" href="${reminder}" target="_blank" rel="noopener">Send reminder</a>` : ''}
        <button class="button quiet" type="button" data-open="edit">Edit details</button>
        ${entries.length > 0 ? html`<a class="button quiet" href="/api/customers/${customer.id}/export.csv" download>Download records</a>` : ''}
      </div>

      <form class="panel" data-panel="sale" novalidate hidden>
        <label class="field">
          <span>What for</span>
          <input name="description" autocomplete="off" maxlength="200" placeholder="Lace sewing">
        </label>
        <label class="field">
          <span>Price</span>
          <input name="cost" inputmode="decimal" autocomplete="off" placeholder="15000">
        </label>
        <label class="field">
          <span>Paid now</span>
          <input name="paid" inputmode="decimal" autocomplete="off" placeholder="0">
        </label>
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button quiet" type="button" data-action="close">Cancel</button>
          <button class="button primary" type="submit">Save sale</button>
        </div>
      </form>

      <form class="panel" data-panel="payment" novalidate hidden>
        <label class="field">
          <span>Amount paid</span>
          <input name="paid" inputmode="decimal" autocomplete="off">
        </label>
        <button class="text-button" type="button" data-action="full">Paid the full ${naira(Math.max(balance, 0))}</button>
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button quiet" type="button" data-action="close">Cancel</button>
          <button class="button primary" type="submit">Save payment</button>
        </div>
      </form>

      <form class="panel" data-panel="edit" novalidate hidden>
        <label class="field">
          <span>Name</span>
          <input name="name" autocomplete="off" maxlength="80" value="${customer.name}">
        </label>
        <label class="field">
          <span>Phone number</span>
          <input name="phone" type="tel" autocomplete="off" maxlength="30" value="${customer.phone}">
        </label>
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button quiet" type="button" data-action="close">Cancel</button>
          <button class="button primary" type="submit">Save details</button>
        </div>
      </form>
    </section>

    <section>
      <h2>History</h2>
      ${entries.length > 0
        ? html`
          <div class="line head" aria-hidden="true">
            <div class="margin">Date</div>
            <div>Entry</div>
            <div class="running">Balance</div>
          </div>
          <ol class="book">${[...entries].reverse().map(bookLine)}</ol>`
        : html`<p class="empty">Nothing recorded for ${customer.name} yet.</p>`}
    </section>`);

  const panels = [...main.querySelectorAll('[data-panel]')];

  main.querySelector('.actions').addEventListener('click', (event) => {
    const name = event.target.closest('[data-open]')?.dataset.open;
    if (!name) return;
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel === name ? !panel.hidden : true;
      if (!panel.hidden) panel.querySelector('input').focus();
    }
  });

  for (const panel of panels) {
    panel.querySelector('[data-action="close"]').addEventListener('click', () => {
      panel.reset();
      panel.hidden = true;
    });
  }

  const [saleForm, paymentForm, editForm] = panels;

  onSubmit(saleForm, async ({ elements }) => {
    const description = elements.description.value.trim();
    const cost = parseNaira(elements.cost.value);
    const paid = parseNaira(elements.paid.value) ?? 0;
    if (!description) throw new Error('Say what the sale was for.');
    if (!(cost > 0)) throw new Error('Enter the price as a number, like 15000 or 15k.');
    if (Number.isNaN(paid)) throw new Error('Enter the amount paid as a number, like 5000 or 5k.');
    if (paid > cost) throw new Error('The amount paid is more than the price.');

    await api('/entries', {
      method: 'POST',
      body: { entries: [{ customerId: customer.id, kind: 'SALE', description, costKobo: cost, paidKobo: paid }] },
    });
    ctx.toast('Sale saved');
    await ctx.refresh();
  });

  paymentForm.querySelector('[data-action="full"]').addEventListener('click', () => {
    paymentForm.elements.paid.value = toInputValue(balance);
  });

  onSubmit(paymentForm, async ({ elements }) => {
    const paid = parseNaira(elements.paid.value);
    if (!(paid > 0)) throw new Error('Enter the amount paid as a number, like 5000 or 5k.');
    if (paid > balance) throw new Error(`That is more than the ${naira(balance)} owed.`);

    await api('/entries', {
      method: 'POST',
      body: { entries: [{ customerId: customer.id, kind: 'PAYMENT', paidKobo: paid }] },
    });
    ctx.toast('Payment saved');
    await ctx.refresh();
  });

  onSubmit(editForm, async ({ elements }) => {
    await api(`/customers/${customer.id}`, {
      method: 'PATCH',
      body: { name: elements.name.value, phone: elements.phone.value },
    });
    ctx.toast('Details saved');
    await ctx.refresh();
  });

  main.querySelector('.book')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-void]');
    if (!button) return;
    if (!confirm('Cancel this entry? It stays in the history crossed out, and the balance is corrected.')) return;

    button.disabled = true;
    try {
      await api(`/entries/${button.dataset.void}/void`, { method: 'POST' });
      ctx.toast('Entry cancelled');
      await ctx.refresh();
    } catch (error) {
      button.disabled = false;
      ctx.toast(error.message);
    }
  });
}
