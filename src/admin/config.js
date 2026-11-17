const ID = /^[a-z0-9-]{1,40}$/;

function parseBusinesses(text, problems) {
  const businesses = [];
  for (const item of String(text ?? '').split(/[\n,]+/).map((part) => part.trim()).filter(Boolean)) {
    const [id, url] = item.split('=').map((part) => part?.trim());
    let address = null;
    try {
      address = new URL(url);
    } catch {}
    if (!ID.test(id ?? '') || !address || !/^https?:$/.test(address.protocol)) {
      problems.push(`BUSINESSES entry "${item}" should look like mama-tola=https://mama-tola.example.com`);
      continue;
    }
    if (businesses.some((b) => b.id === id)) {
      problems.push(`BUSINESSES lists "${id}" twice.`);
      continue;
    }
    businesses.push({ id, url: address.origin });
  }
  return businesses;
}

export function loadAdminConfig(env = process.env) {
  const problems = [];
  if ((env.ADMIN_PASSWORD ?? '').length < 10) problems.push('ADMIN_PASSWORD must be at least 10 characters.');
  if ((env.SESSION_SECRET ?? '').length < 32) problems.push('SESSION_SECRET must be at least 32 characters.');
  if ((env.OPERATOR_SECRET ?? '').length < 32) problems.push('OPERATOR_SECRET must be at least 32 characters.');
  const timeZone = env.ADMIN_TIME_ZONE || 'Africa/Lagos';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
  } catch {
    problems.push(`ADMIN_TIME_ZONE "${timeZone}" is not a valid time zone.`);
  }
  const businesses = parseBusinesses(env.BUSINESSES, problems);
  if (problems.length > 0) throw new Error(`Cannot start the admin dashboard:\n${problems.join('\n')}`);

  return {
    port: Number(env.PORT) || 3100,
    password: env.ADMIN_PASSWORD,
    sessionSecret: env.SESSION_SECRET,
    operatorSecret: env.OPERATOR_SECRET,
    secureCookies: env.COOKIE_SECURE === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
    timeZone,
    businesses,
  };
}
