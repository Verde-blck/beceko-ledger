import { html } from '../dom.js';
import { balanceClass, balanceText, dayLabel } from '../format.js';

function lastEntry(timestamp) {
  if (!timestamp) return 'No entries yet';
  const day = dayLabel(timestamp);
  return `Last entry ${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day}`;
}

export const personRow = (customer) => html`
  <li data-search="${`${customer.name} ${customer.phone}`.toLowerCase()}">
    <a href="#/customers/${customer.id}">
      <span class="name">${customer.name}</span>
      <span class="balance ${balanceClass(customer.balanceKobo)}">${balanceText(customer.balanceKobo)}</span>
      <span class="meta">${lastEntry(customer.lastEntryAt)}</span>
    </a>
  </li>`;
