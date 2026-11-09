const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

class Markup {
  constructor(value) {
    this.value = value;
  }
}

function render(value) {
  if (value instanceof Markup) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (value == null || value === false) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

export const html = (strings, ...values) =>
  new Markup(strings.reduce((out, string, index) => out + render(values[index - 1]) + string));

export function mount(element, markup) {
  element.innerHTML = render(markup);
}

export function showError(form, message) {
  const box = form.querySelector(':scope > .form-error');
  box.textContent = message;
  box.hidden = false;
}

export function clearError(form) {
  form.querySelector(':scope > .form-error').hidden = true;
}

export function onSubmit(form, handler) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError(form);
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await handler(form);
    } catch (error) {
      showError(form, error.message);
    } finally {
      button.disabled = false;
    }
  });
}
