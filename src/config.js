const PROVIDERS = ['claude', 'gemini'];

export function aiSettings(env = process.env) {
  const anthropicApiKey = env.ANTHROPIC_API_KEY || '';
  const geminiApiKey = env.GEMINI_API_KEY || '';
  const chosen = (env.AI_PROVIDER || '').trim().toLowerCase();
  const warnings = [];
  let provider = chosen || (anthropicApiKey ? 'claude' : geminiApiKey ? 'gemini' : '');

  if (chosen && !PROVIDERS.includes(chosen)) {
    warnings.push(`AI_PROVIDER "${env.AI_PROVIDER}" is not recognised. Use claude or gemini.`);
    provider = '';
  } else if (provider === 'claude' && !anthropicApiKey) {
    warnings.push('AI_PROVIDER is claude but ANTHROPIC_API_KEY is empty.');
    provider = '';
  } else if (provider === 'gemini' && !geminiApiKey) {
    warnings.push('AI_PROVIDER is gemini but GEMINI_API_KEY is empty.');
    provider = '';
  }

  return {
    provider,
    anthropicApiKey,
    anthropicModel: env.ANTHROPIC_MODEL || 'claude-haiku-5-5',
    geminiApiKey,
    geminiModel: env.GEMINI_MODEL || 'gemini-flash-latest',
    warnings,
  };
}

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
  if (env.RESET_LEDGER && !/^[A-Za-z0-9-]{8,64}$/.test(env.RESET_LEDGER)) {
    problems.push('RESET_LEDGER must be 8 to 64 letters, digits or hyphens, for example fresh-start-1.');
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
    resetToken: env.RESET_LEDGER || '',
    statementNote: (env.STATEMENT_NOTE || '').trim(),
    statementClosing: (env.STATEMENT_CLOSING || '').trim() || 'Thank you for your patronage.',
    ai: aiSettings(env),
  };
}
