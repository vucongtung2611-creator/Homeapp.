import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * One SQLite file holds everything for the Light beta:
 * accounts, sessions, invites, chat messages, file metadata, and one JSON
 * snapshot of the Household Graph per household.
 */
export type Db = DatabaseSync;

const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE households (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     graph TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE memberships (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     joined_at TEXT NOT NULL,
     PRIMARY KEY (user_id, household_id)
   );
   CREATE TABLE invites (
     token_hash TEXT PRIMARY KEY,
     household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     created_by TEXT NOT NULL,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     revoked INTEGER NOT NULL DEFAULT 0
   );
   CREATE INDEX invites_household ON invites(household_id);
   CREATE TABLE messages (
     id TEXT PRIMARY KEY,
     household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     user_id TEXT,
     text TEXT NOT NULL DEFAULT '',
     file_id TEXT,
     created_at TEXT NOT NULL,
     seq INTEGER NOT NULL
   );
   CREATE INDEX messages_household ON messages(household_id, seq);
   CREATE TABLE files (
     id TEXT PRIMARY KEY,
     household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     uploader_id TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     name TEXT NOT NULL,
     created_at TEXT NOT NULL
   );`,
];

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]!);
      version++;
      db.prepare('UPDATE schema_version SET version = ?').run(version);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}
