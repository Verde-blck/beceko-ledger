import { rmSync } from 'node:fs';
import { openDatabase } from './db.js';
import { localTimestamp } from './time.js';

const readToken = (db) => db.prepare("SELECT value FROM meta WHERE key = 'reset_token'").get()?.value;

export function openLedger(file, { resetToken, timeZone }) {
  const db = openDatabase(file);
  if (!resetToken) return { db, reset: null };
  if (readToken(db) === resetToken) return { db, reset: { done: false } };

  const stamp = localTimestamp(timeZone).replace(/[^0-9]/g, '').slice(0, 12);
  const backup = file.replace(/(\.db)?$/, `-before-reset-${stamp}.db`);
  db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
  db.close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true });

  const fresh = openDatabase(file);
  fresh.prepare("INSERT INTO meta (key, value) VALUES ('reset_token', ?)").run(resetToken);
  return { db: fresh, reset: { done: true, backup } };
}
