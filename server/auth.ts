import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DEFAULT_CHARACTER, isCharacter, normaliseCharacter } from '../src/characters.js';
import type { Database } from './database.js';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_DAYS = 30;

export interface User {
  id: string;
  email: string;
  name: string;
  /** Character id from src/characters.ts. */
  avatar: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 409 | 429 = 400,
  ) {
    super(message);
  }
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return timingSafeEqual(actual, expected);
}

// Used so a login for an unknown email costs the same as a real one.
let dummyHash: Promise<string> | undefined;

export function validateEmail(raw: unknown): string {
  const email = String(raw ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError('invalid_email');
  return email;
}

export function validatePassword(raw: unknown): string {
  const password = String(raw ?? '');
  if (password.length < 8) throw new AuthError('password_too_short');
  if (password.length > 200) throw new AuthError('password_too_long');
  return password;
}

export function validateName(raw: unknown): string {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 60) throw new AuthError('invalid_name');
  return name;
}

export class Auth {
  constructor(private readonly db: Database) {}

  async signup(input: { email: unknown; password: unknown; name: unknown; avatar?: unknown }): Promise<User> {
    const email = validateEmail(input.email);
    const password = validatePassword(input.password);
    const name = validateName(input.name);
    if (input.avatar !== undefined && !isCharacter(input.avatar)) throw new AuthError('avatar_invalid');
    const avatar = (input.avatar as string | undefined) ?? DEFAULT_CHARACTER;
    if (await this.db.get('SELECT 1 AS x FROM users WHERE email = ?', email)) throw new AuthError('email_taken', 409);
    const user: User = { id: `u_${randomUUID()}`, email, name, avatar };
    const hash = await hashPassword(password);
    try {
      await this.db.run(
        'INSERT INTO users (id, email, name, password_hash, created_at, avatar) VALUES (?, ?, ?, ?, ?, ?)',
        user.id,
        email,
        name,
        hash,
        new Date().toISOString(),
        avatar,
      );
    } catch {
      throw new AuthError('email_taken', 409); // lost a race on the unique index
    }
    return user;
  }

  async login(input: { email: unknown; password: unknown }): Promise<User> {
    const email = String(input.email ?? '').trim().toLowerCase();
    const password = String(input.password ?? '');
    const row = await this.db.get<User & { password_hash: string }>(
      'SELECT id, email, name, avatar, password_hash FROM users WHERE email = ?',
      email,
    );
    if (!row) {
      dummyHash ??= hashPassword('not-a-real-password');
      await verifyPassword(password, await dummyHash);
      throw new AuthError('invalid_credentials', 401);
    }
    if (!(await verifyPassword(password, row.password_hash))) throw new AuthError('invalid_credentials', 401);
    return toUser(row);
  }

  async createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await this.db.run(
      'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      sha256(token),
      userId,
      new Date().toISOString(),
      expiresAt.toISOString(),
    );
    return { token, expiresAt };
  }

  async userForSession(token: string | undefined): Promise<User | undefined> {
    if (!token || token.length > 100) return undefined;
    const row = await this.db.get<User & { expires_at: string }>(
      'SELECT u.id, u.email, u.name, u.avatar, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
      sha256(token),
    );
    if (!row) return undefined;
    if (row.expires_at < new Date().toISOString()) {
      await this.destroySession(token);
      return undefined;
    }
    return toUser(row);
  }

  async destroySession(token: string): Promise<void> {
    await this.db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  }

  async getUser(id: string): Promise<User | undefined> {
    const row = await this.db.get<User>('SELECT id, email, name, avatar FROM users WHERE id = ?', id);
    return row && toUser(row);
  }

  async setAvatar(userId: string, avatar: unknown): Promise<void> {
    if (!isCharacter(avatar)) throw new AuthError('avatar_invalid');
    await this.db.run('UPDATE users SET avatar = ? WHERE id = ?', avatar, userId);
  }

  /** Characters for a set of users (missing → default). */
  async avatars(ids: string[]): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    const rows = await this.db.all<{ id: string; avatar: string | null }>(
      `SELECT id, avatar FROM users WHERE id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    );
    return Object.fromEntries(rows.map((r) => [r.id, normaliseCharacter(r.avatar)]));
  }
}

function toUser(row: { id: string; email: string; name: string; avatar?: string | null }): User {
  return { id: row.id, email: row.email, name: row.name, avatar: normaliseCharacter(row.avatar) };
}

/** Fixed-window in-memory limiter: plenty for a single-instance beta. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns false when the key is over its limit. */
  take(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.sweep(now);
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
