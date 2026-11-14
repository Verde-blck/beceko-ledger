import { loadConfig } from '../src/config.js';
import { backupNow, listBackups } from '../src/backup.js';
import { openDatabase } from '../src/db.js';

const command = process.argv[2];
let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

if (!config.backup.enabled) {
  console.error('Backups are off. Set BACKUP_ENDPOINT, BACKUP_REGION, BACKUP_BUCKET, BACKUP_ACCESS_KEY_ID and BACKUP_SECRET_ACCESS_KEY first.');
  process.exit(1);
}

try {
  if (command === 'now') {
    const db = openDatabase(config.databaseFile);
    const { key, bytes } = await backupNow(db, config.backup, config.timeZone);
    db.close();
    console.log(`Backup saved: ${key} (${Math.ceil(bytes / 1024)} KB)`);
  } else {
    const backups = await listBackups(config.backup);
    if (backups.length === 0) console.log(`No backups yet under ${config.backup.bucket}/${config.backup.prefix}/.`);
    for (const backup of backups) console.log(`${backup.key}  ${Math.ceil(backup.size / 1024)} KB  ${backup.modified}`);
  }
} catch (error) {
  console.error(`That did not work: ${error.message}`);
  process.exit(1);
}
