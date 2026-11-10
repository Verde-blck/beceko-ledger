import { api } from '../api.js';
import { clearError, html, mount, onSubmit, showError } from '../dom.js';
import { nameKey, parseNaira, toInputValue } from '../format.js';
import { combineResults, speechRecognitionClass } from '../speech.js';

const Recognition = speechRecognitionClass();
const SILENCE_MS = 3000;
const WAIT_FOR_SPEECH_MS = 8000;

const SPEECH_ERRORS = {
  'not-allowed': 'Allow microphone access for this site to speak entries.',
  'service-not-allowed': 'Allow microphone access for this site to speak entries.',
  'no-speech': 'Nothing was heard. Tap Speak and try again.',
  'audio-capture': 'No microphone was found. Type the entry instead.',
  network: 'Speaking needs an internet connection. Check the connection or type the entry.',
};

export const quickEntry = () => html`
  <section class="quick-entry stack">
    <form class="panel" novalidate>
      <label class="field">
        <span>Record a sale or payment</span>
        <textarea name="text" rows="3" maxlength="1000" placeholder="Mama Chidi paid 5k towards her lace"></textarea>
      </label>
      <p class="voice-status" role="status" hidden>Listening. Say who, what and how much, then tap Stop.</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="button-row">
        ${Recognition ? html`<button class="button" type="button" data-action="speak">Speak</button>` : ''}
        <button class="button primary" type="submit">Check details</button>
      </div>
    </form>
    <div class="drafts" aria-live="polite"></div>
  </section>`;

const kindOption = (index, value, label, current) => html`
  <label>
    <input type="radio" name="kind-${index}" value="${value}" ${value === current ? html`checked` : ''}>${label}
  </label>`;

const draftCard = (draft, index, known) => html`
  <fieldset class="draft" data-index="${index}" data-kind="${draft.kind}">
    <legend class="visually-hidden">Entry ${index + 1}</legend>
    ${draft.note ? html`<p class="draft-note">${draft.note}</p>` : ''}
    <div class="kind-toggle">
      ${kindOption(index, 'SALE', 'Sale', draft.kind)}
      ${kindOption(index, 'PAYMENT', 'Payment', draft.kind)}
    </div>
    <label class="field">
      <span>Customer</span>
      <input data-field="customerName" list="customer-names" autocomplete="off" value="${draft.customerName}">
    </label>
    <p class="hint" data-new-customer ${!draft.customerName || known.has(nameKey(draft.customerName)) ? html`hidden` : ''}>
      New customer. They will be added when you save.
    </p>
    <label class="field sale-only">
      <span>What for</span>
      <input data-field="description" autocomplete="off" value="${draft.kind === 'SALE' ? draft.description : ''}">
    </label>
    <label class="field sale-only">
      <span>Price</span>
      <input data-field="cost" inputmode="decimal" autocomplete="off" value="${toInputValue(draft.costKobo)}">
    </label>
    <label class="field">
      <span>Amount paid</span>
      <input data-field="paid" inputmode="decimal" autocomplete="off" value="${toInputValue(draft.paidKobo)}">
    </label>
  </fieldset>`;

const otherCard = (draft) => html`
  <div class="draft">
    <p class="draft-note">${draft.note || 'This needs to be recorded by hand.'}</p>
    <p class="hint">Not saved. Record it on ${draft.customerName || 'the customer'}’s page.</p>
  </div>`;

function collectEntries(form, drafts) {
  const cards = [...form.querySelectorAll('.draft[data-index]')];

  return cards.map((card, position) => {
    const prefix = cards.length > 1 ? `Entry ${position + 1}: ` : '';
    const value = (field) => card.querySelector(`[data-field="${field}"]`).value;
    const kind = card.dataset.kind;
    const cost = parseNaira(value('cost'));
    const paid = parseNaira(value('paid'));

    if (!value('customerName').trim()) throw new Error(`${prefix}Enter the customer's name.`);
    if (kind === 'SALE' && !value('description').trim()) throw new Error(`${prefix}Say what the sale was for.`);
    if (kind === 'SALE' && !(cost > 0)) throw new Error(`${prefix}Enter the price as a number, like 15000 or 15k.`);
    if (Number.isNaN(paid) || (kind === 'PAYMENT' && !(paid > 0))) {
      throw new Error(`${prefix}Enter the amount paid as a number, like 5000 or 5k.`);
    }

    return {
      customerName: value('customerName'),
      kind,
      description: kind === 'SALE' ? value('description') : '',
      costKobo: kind === 'SALE' ? cost : 0,
      paidKobo: paid ?? 0,
      sourceText: drafts[Number(card.dataset.index)].sourceText,
    };
  });
}

function showDrafts(container, { drafts, customers }, ctx, reset) {
  if (drafts.length === 0) {
    mount(container, html`<p class="empty">No sale or payment found in that. Say who, what and how much.</p>`);
    return;
  }

  const known = new Set(customers.map(nameKey));
  const saveable = drafts.filter((draft) => draft.kind !== 'OTHER').length;

  mount(container, html`
    <datalist id="customer-names">${customers.map((name) => html`<option value="${name}"></option>`)}</datalist>
    <form class="stack" novalidate>
      ${drafts.map((draft, index) => (draft.kind === 'OTHER' ? otherCard(draft) : draftCard(draft, index, known)))}
      <p class="form-error" role="alert" hidden></p>
      <div class="button-row">
        <button class="button quiet" type="button" data-action="discard">Discard</button>
        ${saveable > 0
          ? html`<button class="button primary" type="submit">${saveable === 1 ? 'Save entry' : `Save ${saveable} entries`}</button>`
          : ''}
      </div>
    </form>`);

  const form = container.querySelector('form');
  form.querySelector('[data-action="discard"]').addEventListener('click', reset);

  form.addEventListener('change', (event) => {
    if (event.target.type === 'radio') event.target.closest('.draft').dataset.kind = event.target.value;
  });

  form.addEventListener('input', (event) => {
    if (event.target.dataset.field !== 'customerName') return;
    const key = nameKey(event.target.value);
    event.target.closest('.draft').querySelector('[data-new-customer]').hidden = !key || known.has(key);
  });

  if (saveable > 0) {
    onSubmit(form, async () => {
      const entries = collectEntries(form, drafts);
      await api('/entries', { method: 'POST', body: { entries } });
      ctx.toast(entries.length === 1 ? 'Entry saved' : `${entries.length} entries saved`);
      await ctx.refresh();
    });
  }
}

function createVoiceInput({ button, form, status, onHeard }) {
  const textarea = form.elements.text;
  let session = null;

  function setListening(listening) {
    button.textContent = listening ? 'Stop' : 'Speak';
    button.classList.toggle('listening', listening);
    status.hidden = !listening;
  }

  const finish = () => session?.recognition.stop();

  function cancel() {
    if (!session) return;
    session.check = false;
    session.recognition.abort();
  }

  function start() {
    clearError(form);
    const recognition = new Recognition();
    recognition.lang = 'en-NG';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    const current = { recognition, base: textarea.value.trim(), heard: '', interim: '', check: true, failed: false, timer: 0 };
    const stopAfter = (ms) => {
      clearTimeout(current.timer);
      current.timer = setTimeout(finish, ms);
    };

    recognition.addEventListener('result', (event) => {
      Object.assign(current, combineResults(event.results));
      textarea.value = [current.base, current.heard, current.interim].filter(Boolean).join(' ');
      stopAfter(SILENCE_MS);
    });

    recognition.addEventListener('error', (event) => {
      if (event.error === 'aborted') return;
      current.failed = true;
      showError(form, SPEECH_ERRORS[event.error] ?? 'Could not hear that clearly. Try again or type it.');
    });

    recognition.addEventListener('end', () => {
      clearTimeout(current.timer);
      if (session === current) session = null;
      setListening(false);

      const said = [current.heard, current.interim].filter(Boolean).join(' ');
      textarea.value = [current.base, said].filter(Boolean).join(' ');
      if (!current.check) return;
      if (said) onHeard();
      else if (!current.failed) showError(form, SPEECH_ERRORS['no-speech']);
    });

    try {
      recognition.start();
    } catch {
      showError(form, 'The microphone is busy. Wait a moment and tap Speak again.');
      return;
    }
    session = current;
    setListening(true);
    stopAfter(WAIT_FOR_SPEECH_MS);
  }

  button.addEventListener('click', () => (session ? finish() : start()));
  return { cancel };
}

export function bindQuickEntry(section, ctx) {
  const form = section.querySelector('form');
  const drafts = section.querySelector('.drafts');
  const speak = form.querySelector('[data-action="speak"]');
  const reset = () => {
    form.reset();
    drafts.replaceChildren();
  };

  const voice = speak
    ? createVoiceInput({
        button: speak,
        form,
        status: form.querySelector('.voice-status'),
        onHeard: () => form.requestSubmit(),
      })
    : null;

  onSubmit(form, async () => {
    voice?.cancel();
    const text = form.elements.text.value.trim();
    if (!text) throw new Error('Type or say what happened first.');

    const submit = form.querySelector('[type="submit"]');
    submit.textContent = 'Checking';
    try {
      const result = await api('/parse', { method: 'POST', body: { text } });
      showDrafts(drafts, result, ctx, reset);
    } finally {
      submit.textContent = 'Check details';
    }
  });
}
