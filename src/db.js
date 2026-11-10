import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SQLITE_CONSTRAINT_UNIQUE = 2067;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    kind TEXT NOT NULL CHECK (kind IN ('SALE', 'PAYMENT', 'VOID')),
    description TEXT NOT NULL,
    cost_kobo INTEGER NOT NULL,
    paid_kobo INTEGER NOT NULL,
    voids_entry_id INTEGER UNIQUE REFERENCES entries(id),
    source_text TEXT,
    created_at TEXT NOT NULL,
    CHECK (kind = 'VOID' OR (cost_kobo >= 0 AND paid_kobo >= 0)),
    CHECK ((kind = 'VOID') = (voids_entry_id IS NOT NULL))
  );

  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS entries_by_customer ON entries (customer_id, id);
  CREATE INDEX IF NOT EXISTS entries_by_date ON entries (created_at);

  CREATE TRIGGER IF NOT EXISTS entries_no_update BEFORE UPDATE ON entries
  BEGIN SELECT RAISE(ABORT, 'Ledger entries cannot be changed'); END;

  CREATE TRIGGER IF NOT EXISTS entries_no_delete BEFORE DELETE ON entries
  BEGIN SELECT RAISE(ABORT, 'Ledger entries cannot be deleted'); END;
`;

export function openDatabase(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function transaction(db, fn) {
  return (...args) => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
}

export const isUniqueViolation = (error) => error?.errcode === SQLITE_CONSTRAINT_UNIQUE;
