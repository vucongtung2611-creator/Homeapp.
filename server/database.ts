import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * One small async database interface with two backends:
 *  - SQLite (node:sqlite, a single file) — local development and tests;
 *  - Postgres (any `pg`-compatible client: Neon, Supabase, or PGlite in tests)
 *    — hosting where the server's disk is wiped on every restart.
 *
 * SQL is written once with `?` placeholders in the common subset of both
 * dialects; the Postgres backend rewrites them to `$1, $2…`.
 */
export type Dialect = 'sqlite' | 'postgres';
export type Param = string | number | null | Uint8Array;

export interface Database {
  readonly dialect: Dialect;
  get<T>(sql: string, ...params: Param[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: Param[]): Promise<T[]>;
  run(sql: string, ...params: Param[]): Promise<{ changes: number }>;
  /** Several statements, no parameters (migrations). */
  exec(sql: string): Promise<void>;
  /** Run `fn` atomically. Calls inside must use the `tx` handle. */
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// ── SQLite ────────────────────────────────────────────────────────────
class SqliteDatabase implements Database {
  readonly dialect = 'sqlite';
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: DatabaseSync) {}

  async get<T>(sql: string, ...params: Param[]) {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  async all<T>(sql: string, ...params: Param[]) {
    return this.db.prepare(sql).all(...params) as T[];
  }
  async run(sql: string, ...params: Param[]) {
    return { changes: Number(this.db.prepare(sql).run(...params).changes) };
  }
  async exec(sql: string) {
    this.db.exec(sql);
  }
  /** SQLite has one connection, so transactions are queued one after another. */
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    const run = async () => {
      this.db.exec('BEGIN');
      try {
        const result = await fn(this);
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
  async close() {
    this.db.close();
  }
}

// ── Postgres ──────────────────────────────────────────────────────────
/** The bits of a Postgres client we use; `pg.Pool` and PGlite both fit. */
export interface PgQueryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount?: number | null; affectedRows?: number }>;
}
export interface PgDriver extends PgQueryable {
  /** Run `fn` on one connection inside BEGIN/COMMIT. */
  withTransaction<T>(fn: (q: PgQueryable) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

const toPg = (sql: string) => {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
};

class PostgresDatabase implements Database {
  readonly dialect = 'postgres';

  constructor(
    private readonly q: PgQueryable,
    private readonly driver?: PgDriver,
  ) {}

  async get<T>(sql: string, ...params: Param[]) {
    return (await this.q.query(toPg(sql), params)).rows[0] as T | undefined;
  }
  async all<T>(sql: string, ...params: Param[]) {
    return (await this.q.query(toPg(sql), params)).rows as T[];
  }
  async run(sql: string, ...params: Param[]) {
    const r = await this.q.query(toPg(sql), params);
    return { changes: r.rowCount ?? r.affectedRows ?? 0 };
  }
  async exec(sql: string) {
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await this.q.query(statement);
  }
  transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
    if (!this.driver) return fn(this); // already inside one
    return this.driver.withTransaction((q) => fn(new PostgresDatabase(q)));
  }
  async close() {
    await this.driver?.end();
  }
}

// ── Schema ────────────────────────────────────────────────────────────
/** Each migration runs once, in order, inside a transaction. */
const MIGRATIONS: ((d: Dialect) => string)[] = [
  () => `CREATE TABLE users (
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
   )`,
  // 2: language-neutral system messages + the character each person picked.
  () => `ALTER TABLE messages ADD COLUMN meta TEXT;
   ALTER TABLE users ADD COLUMN avatar TEXT`,
  // 3: file bytes live in the database, so the server needs no persistent disk.
  (d) => `CREATE TABLE file_data (
     id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
     data ${d === 'postgres' ? 'BYTEA' : 'BLOB'} NOT NULL
   );
   CREATE UNIQUE INDEX messages_household_seq ON messages(household_id, seq)`,
  // 4: personal single-use invite links with a role, one shared code that only
  //    asks to join, and join requests the owner approves. Old shared links retire.
  () => `UPDATE invites SET revoked = 1;
   ALTER TABLE invites ADD COLUMN id TEXT;
   ALTER TABLE invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'link';
   ALTER TABLE invites ADD COLUMN role TEXT;
   ALTER TABLE invites ADD COLUMN label TEXT;
   ALTER TABLE invites ADD COLUMN token TEXT;
   ALTER TABLE invites ADD COLUMN code TEXT;
   ALTER TABLE invites ADD COLUMN code_hash TEXT;
   ALTER TABLE invites ADD COLUMN used_by TEXT;
   ALTER TABLE invites ADD COLUMN used_at TEXT;
   CREATE INDEX invites_code ON invites(code_hash);
   CREATE TABLE join_requests (
     id TEXT PRIMARY KEY,
     household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     role TEXT NOT NULL,
     via TEXT NOT NULL,
     status TEXT NOT NULL,
     created_at TEXT NOT NULL,
     decided_at TEXT,
     decided_by TEXT
   );
   CREATE INDEX join_requests_household ON join_requests(household_id, status);
   CREATE INDEX join_requests_user ON join_requests(user_id)`,
  // 5: the home inbox — what happened (joins, requests, invites, leaving) and
  //    how far each person has read; requesters are told when they're decided.
  () => `CREATE TABLE household_events (
     id TEXT PRIMARY KEY,
     household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     kind TEXT NOT NULL,
     audience TEXT NOT NULL,
     actor_id TEXT,
     subject_id TEXT,
     data TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE INDEX household_events_household ON household_events(household_id, created_at);
   CREATE TABLE inbox_reads (
     user_id TEXT NOT NULL,
     household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
     read_at TEXT NOT NULL,
     PRIMARY KEY (user_id, household_id)
   );
   ALTER TABLE join_requests ADD COLUMN seen_at TEXT;
   UPDATE join_requests SET seen_at = decided_at, status = 'declined' WHERE status = 'dismissed'`,
  // 6: guests stay for a set number of days.
  () => `ALTER TABLE invites ADD COLUMN guest_days INTEGER;
   ALTER TABLE join_requests ADD COLUMN guest_days INTEGER`,
];

async function migrate(db: Database): Promise<void> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  await db.transaction(async (tx) => {
    const row = await tx.get<{ version: number | string }>('SELECT version FROM schema_version');
    let version = Number(row?.version ?? 0);
    if (!row) await tx.run('INSERT INTO schema_version (version) VALUES (0)');
    while (version < MIGRATIONS.length) {
      await tx.exec(MIGRATIONS[version]!(db.dialect));
      version++;
      await tx.run('UPDATE schema_version SET version = ?', version);
    }
  });
}

// ── Opening ───────────────────────────────────────────────────────────
export async function openSqlite(path: string): Promise<Database> {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const db = new SqliteDatabase(raw);
  await migrate(db);
  return db;
}

export async function openPostgres(driver: PgDriver): Promise<Database> {
  const db = new PostgresDatabase(driver, driver);
  await migrate(db);
  return db;
}

/** Errors that mean "the connection went away" — e.g. Neon suspending an idle database. */
export const isConnectionLost = (err: unknown) => {
  const e = err as { code?: string; message?: string };
  return (
    ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '57P02', '57P03', '08006', '08003'].includes(e?.code ?? '') ||
    /Connection terminated|Client has encountered a connection error|connection timeout/i.test(e?.message ?? '')
  );
};

/** A `pg` pool from DATABASE_URL (Neon, Supabase…). TLS is required for remote hosts. */
export async function openPostgresUrl(url: string, options: { max?: number } = {}): Promise<Database> {
  const { default: pg } = await import('pg');
  // Return BIGINT/NUMERIC (e.g. SUM, COUNT) as JS numbers — our values are small.
  pg.types.setTypeParser(20, (v: string) => Number(v));
  pg.types.setTypeParser(1700, (v: string) => Number(v));
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 5,
    ssl: local ? undefined : { rejectUnauthorized: true },
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000, // a sleeping Neon database takes a moment to wake
  });
  // An idle connection dropped by the server must not crash the process.
  pool.on('error', (err) => console.warn('postgres: idle connection lost —', err.message));
  // Single statements are retried once on a fresh connection if the old one died.
  const query = async (text: string, params?: unknown[]) => {
    try {
      return await pool.query(text, params);
    } catch (err) {
      if (!isConnectionLost(err)) throw err;
      return pool.query(text, params);
    }
  };
  return openPostgres({
    query,
    async withTransaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (text, params) => client.query(text, params as unknown[]) });
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  });
}
