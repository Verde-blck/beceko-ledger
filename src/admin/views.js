const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);

const longDate = (date) =>
  date
    ? new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '';

function ago(when, now = Date.now()) {
  if (!when) return null;
  const ms = now - Date.parse(when);
  if (!Number.isFinite(ms)) return null;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'less than an hour ago';
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

const STATES = {
  none: ['Never locks', 'neutral'],
  active: ['Paid', 'good'],
  ending: ['Ends soon', 'warn'],
  grace: ['Grace week', 'warn'],
  locked: ['Locked', 'bad'],
};

function badge(subscription) {
  if (subscription.suspended) return '<span class="badge bad">Suspended</span>';
  const [label, tone] = STATES[subscription.state] ?? ['Unknown', 'neutral'];
  const extra = subscription.state === 'ending' || subscription.state === 'grace' ? `, ${subscription.daysLeft} days left` : '';
  return `<span class="badge ${tone}">${esc(label + extra)}</span>`;
}

function page(title, body, { signedIn = false } = {}) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;600&display=swap">
<link rel="stylesheet" href="/admin.css">
<script src="/admin.js" defer></script>
</head>
<body>
<header class="top">
  <span class="mark" aria-hidden="true"></span>
  <strong>Ìwé Ọjà admin</strong>
  ${signedIn ? '<form method="post" action="/logout"><button class="link" type="submit">Sign out</button></form>' : ''}
</header>
<main>${body}</main>
</body>
</html>`;
}

export const loginPage = (error) =>
  page(
    'Sign in · Ìwé Ọjà admin',
    `<section class="narrow">
  <h1>Sign in</h1>
  <form method="post" action="/login" class="stack">
    <label class="field"><span>Admin password</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
    ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    <button class="button primary" type="submit">Sign in</button>
  </form>
</section>`,
  );

function facts(status, now) {
  const s = status.subscription;
  const rows = [
    ['Paid until', s.state === 'none' && !s.suspended ? 'Never locks' : longDate(s.paidUntil) || 'Not set'],
    ...(s.graceEndsOn && !s.suspended ? [['Locks after', longDate(s.graceEndsOn)]] : []),
    ['Set from', status.setFrom === 'dashboard' ? 'This dashboard' : status.setFrom === 'variable' ? 'PAID_UNTIL variable' : 'Nothing set'],
    ['Last backup', status.backupsOn ? ago(status.lastBackupAt, now) ?? 'None yet' : 'Backups are off'],
    ['Last entry', status.lastEntryAt ? longDate(status.lastEntryAt) : 'None yet'],
    ['Customers', status.customers],
    ['Version', status.version],
  ];
  return `<dl class="facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
}

function actions(business, status) {
  const base = `/businesses/${encodeURIComponent(business.id)}`;
  const name = status.businessName || business.id;
  const extend = [1, 3, 12]
    .map((m) => `<form method="post" action="${base}/extend"><input type="hidden" name="months" value="${m}"><button class="button" type="submit">+${m === 12 ? '1 year' : `${m} month${m === 1 ? '' : 's'}`}</button></form>`)
    .join('');
  const pause = status.subscription.suspended
    ? `<form method="post" action="${base}/resume"><button class="button" type="submit">Resume</button></form>`
    : `<form method="post" action="${base}/suspend" data-confirm="Lock ${esc(name)} now? They can still sign in and download their records."><button class="button danger" type="submit">Suspend</button></form>`;
  return `<div class="actions">
    <div class="row">${extend}</div>
    <form method="post" action="${base}/set" class="row">
      <label class="visually-hidden" for="date-${esc(business.id)}">Paid until</label>
      <input id="date-${esc(business.id)}" type="date" name="paidUntil" required value="${esc(status.subscription.paidUntil || '')}">
      <button class="button" type="submit">Set date</button>
    </form>
    <div class="row">${pause}</div>
    <details>
      <summary>More</summary>
      <form method="post" action="${base}/never" data-confirm="Make ${esc(name)} a copy that never locks?"><button class="link" type="submit">Make it never lock</button></form>
      <a href="${base}/token">Show its ADMIN_TOKEN</a>
    </details>
  </div>`;
}

function card(business, result, now) {
  const host = new URL(business.url).host;
  if (result.error) {
    return `<article class="business">
  <header><h2>${esc(business.id)}</h2><a href="${esc(business.url)}">${esc(host)}</a><span class="badge neutral">Not connected</span></header>
  <p class="error">${esc(result.error)}</p>
  <a href="/businesses/${encodeURIComponent(business.id)}/token">Show its ADMIN_TOKEN</a>
</article>`;
  }
  const status = result.status;
  return `<article class="business">
  <header><h2>${esc(status.businessName || status.appName)}</h2><a href="${esc(business.url)}">${esc(host)}</a>${badge(status.subscription)}</header>
  ${facts(status, now)}
  ${actions(business, status)}
</article>`;
}

export function dashboardPage(results, { message, error, now = Date.now() } = {}) {
  const summary = results.reduce(
    (count, r) => {
      const s = r.status?.subscription;
      if (!s) count.problems += 1;
      else if (s.state === 'locked') count.locked += 1;
      else if (s.state === 'grace' || s.state === 'ending') count.attention += 1;
      return count;
    },
    { locked: 0, attention: 0, problems: 0 },
  );
  const body = `<h1>Businesses</h1>
<p class="summary">${results.length} business${results.length === 1 ? '' : 'es'} · ${summary.attention} due for renewal · ${summary.locked} locked · ${summary.problems} not connected</p>
${message ? `<p class="notice" role="status">${esc(message)}</p>` : ''}
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
${results.length === 0 ? '<p>No businesses yet. Add them to the BUSINESSES variable, for example <code>beceko=https://beceko-ledger-production.up.railway.app</code>.</p>' : ''}
<div class="grid">${results.map(({ business, ...result }) => card(business, result, now)).join('')}</div>`;
  return page('Ìwé Ọjà admin', body, { signedIn: true });
}

export const tokenPage = (business, token) =>
  page(
    `ADMIN_TOKEN for ${business.id}`,
    `<section class="narrow stack">
  <a href="/">Back to businesses</a>
  <h1>ADMIN_TOKEN for ${esc(business.id)}</h1>
  <p>In Railway, open this business's service, go to Variables, and set:</p>
  <pre class="token">ADMIN_TOKEN=${esc(token)}</pre>
  <p>Keep it private. Anyone with it can change this business's subscription, though not see its records.</p>
</section>`,
    { signedIn: true },
  );

export const notFoundPage = () => page('Not found', '<section class="narrow"><h1>Not found</h1><a href="/">Back to businesses</a></section>', { signedIn: true });
