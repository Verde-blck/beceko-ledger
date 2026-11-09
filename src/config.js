export function loadConfig(env = process.env) {
  const problems = [];
  const timeZone = env.LEDGER_TIME_ZONE || 'Africa/Lagos';

  if (!/^\d{4,8}$/.test(env.LEDGER_PIN ?? '')) {
    problems.push('LEDGER_PIN must be 4 to 8 digits.');
  }
  if ((env.SESSION_SECRET ?? '').length < 32) {
    problems.push('SESSION_SECRET must be at least 32 characters.');
  }
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
  } catch {
    problems.push(`LEDGER_TIME_ZONE "${timeZone}" is not a valid time zone.`);
  }
  if (problems.length > 0) {
    throw new Error(`Cannot start Beceko Ledger:\n${problems.join('\n')}`);
  }

  return {
    port: Number(env.PORT) || 3000,
    pin: env.LEDGER_PIN,
    sessionSecret: env.SESSION_SECRET,
    secureCookies: env.COOKIE_SECURE === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
    databaseFile: env.DATABASE_FILE || 'data/ledger.db',
    timeZone,
    businessName: env.BUSINESS_NAME || 'Beceko',
    geminiApiKey: env.GEMINI_API_KEY || '',
    geminiModel: env.GEMINI_MODEL || 'gemini-flash-latest',
  };
}
