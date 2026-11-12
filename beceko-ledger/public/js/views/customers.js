import { api } from '../api.js';
import { html, mount, onSubmit } from '../dom.js';
import { personRow } from './shared.js';

export async function renderCustomers(main, ctx) {
  const { customers } = await api('/customers');
  if (!ctx.current()) return;

  mount(main, html`
    <section class="stack">
      <div class="heading-row">
        <h1>Customers</h1>
        <button class="button" type="button" data-action="add">Add customer</button>
      </div>

      <form class="panel" data-panel="add" novalidate hidden>
        <label class="field">
          <span>Name</span>
          <input name="name" autocomplete="off" maxlength="80" required>
        </label>
        <label class="field">
          <span>Phone number</span>
          <input name="phone" type="tel" autocomplete="off" maxlength="30">
        </label>
        <p class="form-error" role="alert" hidden></p>
        <div class="button-row">
          <button class="button quiet" type="button" data-action="close">Cancel</button>
          <button class="button primary" type="submit">Save customer</button>
        </div>
      </form>

      ${customers.length > 0
        ? html`
          <input type="search" placeholder="Search by name or phone" aria-label="Search customers">
          <ul class="people">${customers.map(personRow)}</ul>
          <p class="empty" data-no-match hidden>No customer matches that search.</p>`
        : html`<p class="empty">No customers yet. Add the first one to start recording sales and payments.</p>`}
    </section>`);

  const form = main.querySelector('[data-panel="add"]');
  const addButton = main.querySelector('[data-action="add"]');

  addButton.addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) form.elements.name.focus();
  });
  form.querySelector('[data-action="close"]').addEventListener('click', () => {
    form.reset();
    form.hidden = true;
    addButton.focus();
  });

  onSubmit(form, async () => {
    const customer = await api('/customers', {
      method: 'POST',
      body: { name: form.elements.name.value, phone: form.elements.phone.value },
    });
    ctx.toast(`${customer.name} added`);
    location.hash = `#/customers/${customer.id}`;
  });

  const search = main.querySelector('input[type="search"]');
  search?.addEventListener('input', () => {
    const query = search.value.trim().toLowerCase();
    let visible = 0;
    for (const row of main.querySelectorAll('.people li')) {
      row.hidden = !row.dataset.search.includes(query);
      if (!row.hidden) visible += 1;
    }
    main.querySelector('[data-no-match]').hidden = visible > 0;
  });
}
