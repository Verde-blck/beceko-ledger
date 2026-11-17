import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { restoreIfAsked, scheduleBackups } from './backup.js';
import { loadConfig } from './config.js';
import { createExtractor, providerLabel } from './extract.js';
import { openLedger } from './reset.js';
import { createStore } from './store.js';

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

try {
  const restored = config.backup.problems.length > 0 ? null : await restoreIfAsked(config.databaseFile, config.backup, config.timeZone);
  if (restored?.done) {
    console.log(`RESTORE_BACKUP: the ledger was replaced with ${config.backup.restore}.`);
    if (restored.saved) console.log(`The ledger as it was before the restore was saved to ${restored.saved}.`);
    console.log('Remove RESTORE_BACKUP from the variables now. Leaving it set does nothing further.');
  }
} catch (error) {
  console.error(`Restore failed, so the app is running on its existing records: ${error.message}`);
}

const { db, reset } = openLedger(config.databaseFile, config);

if (reset?.done) {
  console.log(`RESET_LEDGER: all customers and entries were cleared. The old ledger was saved to ${reset.backup}.`);
  console.log('Remove RESET_LEDGER from the variables now. Leaving it set does nothing further.');
} else if (reset) {
  console.log('RESET_LEDGER is still set, but that reset has already been done. Remove the variable.');
}

const app = createApp({
  config,
  store: createStore(db, config),
  auth: createAuth(config),
  extract: createExtractor(config.ai),
});

const backups = scheduleBackups(db, config.backup, config.timeZone);

const server = app.listen(config.port, () => {
  console.log(`${config.brand.appName} running on http://localhost:${config.port} (brand: ${config.brand.id})`);
  if (config.subscription.paidUntil) {
    console.log(`Subscription paid until ${config.subscription.paidUntil}, with ${config.subscription.graceDays} days' grace.`);
  }
  for (const warning of config.ai.warnings) console.warn(warning);
  console.log(
    config.ai.provider
      ? `Quick entry uses ${providerLabel(config.ai)}.`
      : 'Quick entry is off. Set ANTHROPIC_API_KEY (Claude) or GEMINI_API_KEY to turn it on.',
  );
  if (config.adminTokenProblem) console.error(config.adminTokenProblem);
  else if (config.adminToken) console.log('The admin dashboard can connect to this copy.');
  for (const problem of config.backup.problems) console.error(`Backup settings: ${problem}`);
  console.log(
    config.backup.enabled
      ? `Nightly backups go to ${config.backup.bucket}/${config.backup.prefix}/ at ${String(config.backup.hour).padStart(2, '0')}:00.`
      : config.backup.problems.length > 0
        ? 'Backups are OFF until the settings above are fixed. The ledger itself is running normally.'
        : 'Backups are off. Set the BACKUP_ variables to turn them on.',
  );
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    backups.stop();
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
