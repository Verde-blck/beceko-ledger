import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { createExtractor } from './extract.js';
import { openLedger } from './reset.js';
import { createStore } from './store.js';

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
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
  extract: createExtractor(config),
});

const server = app.listen(config.port, () => {
  console.log(`Beceko Ledger running on http://localhost:${config.port}`);
  if (!config.geminiApiKey) console.log('Quick entry is off. Set GEMINI_API_KEY to turn it on.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
