import { api } from '../api.js';
import { html, mount, onSubmit } from '../dom.js';

export function renderLogin(main, onSignedIn) {
  const poweredBy = document.querySelector('meta[name="powered-by"]')?.content ?? '';
  mount(main, html`
    <section class="login">
      <h1>${document.title}</h1>
      <form class="stack" novalidate>
        <label class="field">
          <span>PIN</span>
          <input name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" required>
        </label>
        <p class="form-error" role="alert" hidden></p>
        <button class="button primary" type="submit">Open ledger</button>
      </form>
      ${poweredBy ? html`<p class="powered-by">Runs on ${poweredBy}</p>` : ''}
    </section>`);

  const form = main.querySelector('form');
  form.elements.pin.focus();
  onSubmit(form, async () => {
    try {
      await api('/session', { method: 'POST', body: { pin: form.elements.pin.value } });
    } catch (error) {
      form.elements.pin.select();
      throw error;
    }
    await onSignedIn();
  });
}
