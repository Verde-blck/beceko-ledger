import { createAdminApp } from './app.js';
import { loadAdminConfig } from './config.js';

let config;
try {
  config = loadAdminConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const server = createAdminApp({ config }).listen(config.port, () => {
  console.log(`Ìwé Ọjà admin running on http://localhost:${config.port}, watching ${config.businesses.length} business(es): ${config.businesses.map((b) => b.id).join(', ') || 'none yet'}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
