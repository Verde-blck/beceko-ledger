import { api, ApiError } from './api.js';
import { html, mount } from './dom.js';
import { renderCalendar } from './views/calendar.js';
import { renderCustomer } from './views/customer.js';
import { renderCustomers } from './views/customers.js';
import { renderHome } from './views/home.js';
import { noticeText, renderLocked } from './views/locked.js';
import { renderLogin } from './views/login.js';
import { renderStatement } from './views/statement.js';

const main = document.getElementById('view');
const toastBox = document.getElementById('toast');
const noticeBox = document.getElementById('notice');

const routes = [
  { pattern: /^#\/customers\/(\d+)$/, view: renderCustomer, tab: 'customers' },
  { pattern: /^#\/customers\/(\d+)\/statement$/, view: renderStatement, tab: 'customers' },
  { pattern: /^#\/customers$/, view: renderCustomers, tab: 'customers' },
  { pattern: /^#\/calendar(?:\/(\d{4}-\d{2})(?:-(\d{2}))?)?$/, view: renderCalendar, tab: 'calendar' },
  { pattern: /^(#\/?)?$/, view: renderHome, tab: 'home' },
];

let session = { authenticated: false };
let renderId = 0;
let toastTimer;
let sameSection = false;
let lastHash = location.hash;

const sectionOf = (hash) => hash.match(/^#\/(\w+)/)?.[1] ?? 'home';

function toast(message) {
  toastBox.textContent = message;
  toastBox.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastBox.classList.remove('visible'), 3000);
}

function showNotice() {
  const notice = session.authenticated ? noticeText(session.subscription, session.appName) : null;
  noticeBox.hidden = !notice;
  noticeBox.textContent = notice?.text ?? '';
  noticeBox.dataset.tone = notice?.tone ?? '';
}

function showLogin() {
  renderId += 1;
  session = { ...session, authenticated: false };
  document.body.classList.add('signed-out');
  document.body.classList.remove('locked');
  showNotice();
  renderLogin(main, async () => {
    session = await api('/session');
    document.body.classList.remove('signed-out');
    await route();
  });
}

async function route() {
  if (!session.authenticated) return showLogin();

  const id = ++renderId;
  const locked = session.subscription?.state === 'locked';
  document.body.classList.toggle('locked', locked);
  showNotice();
  if (locked) return renderLocked(main, { session });

  const match = routes.find(({ pattern }) => pattern.test(location.hash));
  if (!match) {
    location.replace('#/');
    return;
  }

  for (const link of document.querySelectorAll('.tabs a')) {
    if (link.dataset.tab === match.tab) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  const ctx = { session, toast, sameSection, refresh: route, current: () => id === renderId };
  try {
    await match.view(main, ctx, ...location.hash.match(match.pattern).slice(1));
  } catch (error) {
    if (!ctx.current()) return;
    if (error instanceof ApiError && error.status === 401) return showLogin();
    if (error instanceof ApiError && error.status === 402) {
      session = await api('/session').catch(() => session);
      if (session.subscription?.state === 'locked') return route();
    }
    mount(main, html`
      <section class="stack">
        <p class="form-error">${error.message}</p>
        <button class="button" type="button">Try again</button>
      </section>`);
    main.querySelector('button').addEventListener('click', route);
  }
}

document.getElementById('sign-out').addEventListener('click', async () => {
  await api('/session', { method: 'DELETE' }).catch(() => {});
  showLogin();
});

window.addEventListener('hashchange', () => {
  sameSection = sectionOf(location.hash) === 'calendar' && sectionOf(lastHash) === 'calendar';
  lastHash = location.hash;
  if (!sameSection) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
  }
  route();
});

try {
  session = await api('/session');
} catch {
  session = { authenticated: false };
}
document.body.classList.toggle('signed-out', !session.authenticated);
route();
