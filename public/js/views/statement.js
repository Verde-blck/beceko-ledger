import { api } from '../api.js';
import { html, mount, showError } from '../dom.js';
import { balanceClass, naira } from '../format.js';

const SAMPLE_PDF = new File([''], 'statement.pdf', { type: 'application/pdf' });
const canShareFiles = () => typeof navigator.canShare === 'function' && navigator.canShare({ files: [SAMPLE_PDF] });

const shortDate = (date) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function summary(balanceKobo) {
  if (balanceKobo > 0) return { label: 'Balance due', value: naira(balanceKobo) };
  if (balanceKobo < 0) return { label: 'In credit', value: naira(-balanceKobo) };
  return { label: 'Balance due', value: 'Paid in full' };
}

const lineRow = (line) => html`
  <li>
    <span class="when">${shortDate(line.date)}</span>
    <span class="what">${line.description}</span>
    <span class="money">
      ${line.chargeKobo ? html`<span>Charged ${naira(line.chargeKobo)}</span>` : ''}
      ${line.paidKobo ? html`<span class="is-settled">Paid ${naira(line.paidKobo)}</span>` : ''}
    </span>
    <span class="running ${balanceClass(line.balanceKobo)}">${naira(line.balanceKobo)}</span>
  </li>`;

export async function renderStatement(main, ctx, id) {
  const statement = await api(`/customers/${id}/statement`);
  if (!ctx.current()) return;

  const pdfUrl = `/api/customers/${id}/statement.pdf`;
  const pdfFile = fetch(pdfUrl, { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.blob() : Promise.reject(new Error('The PDF could not be made.'))))
    .then((blob) => new File([blob], statement.fileName, { type: 'application/pdf' }));
  pdfFile.catch(() => {});

  const balance = summary(statement.balanceKobo);

  mount(main, html`
    <section class="stack">
      <a class="back" href="#/customers/${id}">Back to ${statement.customer.name}</a>
      <h1>Statement</h1>
      <p class="hint">Check it, then share it on WhatsApp or save it as a PDF.</p>
      <div class="button-row">
        ${canShareFiles() ? html`<button class="button primary" type="button" data-action="share">Share statement</button>` : ''}
        <a class="button ${canShareFiles() ? '' : 'primary'}" href="${pdfUrl}" download="${statement.fileName}">Download PDF</a>
      </div>
      <p class="form-error" role="alert" hidden></p>
    </section>

    <article class="statement" aria-label="Statement preview">
      <header class="statement-head">
        <img src="/icon.svg?v=2" alt="" width="40" height="40">
        <div>
          <p class="statement-business">${statement.businessName}</p>
          <p class="hint">Statement of account · ${shortDate(statement.issuedOn)}</p>
        </div>
      </header>

      <div class="statement-for">
        <p class="hint">Prepared for</p>
        <p class="statement-name">${statement.customer.name}</p>
        ${statement.customer.phone ? html`<p class="hint">${statement.customer.phone}</p>` : ''}
      </div>

      <dl class="ruled">
        <div><dt>Total charged</dt><dd>${naira(statement.chargedKobo)}</dd></div>
        <div><dt>Total paid</dt><dd>${naira(statement.paidKobo)}</dd></div>
        <div><dt>${balance.label}</dt><dd class="${balanceClass(statement.balanceKobo)}">${balance.value}</dd></div>
      </dl>

      ${statement.lines.length > 0
        ? html`<ol class="statement-lines">${statement.lines.map(lineRow)}</ol>`
        : html`<p class="empty">There are no transactions to show.</p>`}

      ${statement.note ? html`<p class="statement-note">${statement.note}</p>` : ''}
      ${statement.closing ? html`<p class="hint">${statement.closing}</p>` : ''}
    </article>`);

  const section = main.querySelector('section');
  main.querySelector('[data-action="share"]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const file = await pdfFile;
      await navigator.share({ files: [file], title: `Statement for ${statement.customer.name}` });
    } catch (error) {
      if (error.name !== 'AbortError') showError(section, error.message || 'Sharing did not work. Use Download PDF instead.');
    } finally {
      button.disabled = false;
    }
  });
}
