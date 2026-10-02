import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getConnInfo } from '@hono/node-server/conninfo';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { bodyLimit } from 'hono/body-limit';
import {
  NotFoundError,
  PermissionDeniedError,
  type BillProps,
  type GraphNode,
  type HomeApp,
  type HouseItemProps,
  type PersonProps,
  type Role,
  type TransactionProps,
} from '../src/index.js';
import { DEFAULT_CHARACTER } from '../src/characters.js';
import { Auth, AuthError, RateLimiter, newToken, sha256, type User } from './auth.js';
import { openPostgresUrl, openSqlite, type Database } from './database.js';
import { FileStore, MAX_UPLOAD_BYTES, type StoredFile } from './files.js';
import { RealtimeHub } from './realtime.js';
import { clearSamples, hasSamples, seedSamples } from './seed.js';
import { HouseholdStore } from './store.js';
import {
  BILL_CATEGORIES,
  CURRENCIES,
  HttpError,
  amount,
  bad,
  bool,
  ids,
  isoDate,
  oneOf,
  str,
  tags,
} from './validate.js';

export interface ServerOptions {
  /** Where the SQLite file lives when no DATABASE_URL is given. */
  dataDir: string;
  /** Postgres connection string (e.g. Neon). When set, nothing is stored on local disk. */
  databaseUrl?: string;
  /** Storage allowed per household for uploads, in bytes. */
  householdQuotaBytes?: number;
  /**
   * Close a member's live chat connection after this long without activity
   * (any request to the home, or a presence ping). Keeps a scale-to-zero host
   * like Render from being held awake by an idle tab. Default 3 minutes.
   */
  chatIdleMs?: number;
  /** Built web app. Omit in API-only tests. */
  publicDir?: string;
  /** Mark cookies Secure (true behind HTTPS). */
  secureCookies?: boolean;
  /** Canonical origin for invite links, e.g. https://homeapp.fly.dev */
  publicUrl?: string;
  /** Trust X-Forwarded-For for client IPs (set when behind a proxy). */
  trustProxy?: boolean;
  db?: Database;
}

const SESSION_COOKIE = 'sid';
const INVITE_DAYS = 7;
const RESIDENT_ROLES: Role[] = ['owner', 'family_member', 'tenant', 'child'];
const INVITER_ROLES: Role[] = ['owner', 'family_member', 'tenant'];

type Env = { Variables: { user?: User } };

export async function createServer(options: ServerOptions) {
  const db =
    options.db ?? (options.databaseUrl ? await openPostgresUrl(options.databaseUrl) : await openSqlite(join(options.dataDir, 'homeapp.db')));
  // Free Postgres tiers are small (Neon: 0.5 GB), so homes get less room there by default.
  const chatIdleMs = options.chatIdleMs ?? 3 * 60_000;
  /** Last time each member showed signs of life in each home: `${householdId}:${userId}` → ms. */
  const lastActive = new Map<string, number>();
  const touch = (householdId: string, userId: string) => lastActive.set(`${householdId}:${userId}`, Date.now());
  const quota = options.householdQuotaBytes ?? (db.dialect === 'postgres' ? 100 : 500) * 1024 * 1024;
  const auth = new Auth(db);
  const store = new HouseholdStore(db);
  const files = new FileStore(db, db.dialect === 'sqlite' ? options.dataDir : undefined);
  const hub = new RealtimeHub();
  const limits = {
    login: new RateLimiter(10, 15 * 60_000),
    loginIp: new RateLimiter(50, 15 * 60_000),
    signup: new RateLimiter(20, 60 * 60_000),
    invite: new RateLimiter(30, 60_000),
    message: new RateLimiter(30, 10_000),
    upload: new RateLimiter(40, 10 * 60_000),
    write: new RateLimiter(120, 60_000),
  };

  const app = new Hono<Env>();

  // ── Errors ───────────────────────────────────────────────────────────
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.code }, err.status);
    if (err instanceof AuthError) return c.json({ error: err.message }, err.status);
    if (err instanceof PermissionDeniedError) return c.json({ error: 'forbidden' }, 403);
    if (err instanceof NotFoundError) return c.json({ error: 'not_found' }, 404);
    if (err instanceof SyntaxError) return c.json({ error: 'invalid_json' }, 400);
    console.error(err);
    return c.json({ error: 'server_error' }, 500);
  });

  // ── Security headers ─────────────────────────────────────────────────
  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer'); // invite tokens live in URLs
    c.header('X-Frame-Options', 'DENY');
    c.header('Permissions-Policy', 'geolocation=(), microphone=()');
    if (isHttps(c)) c.header('Strict-Transport-Security', 'max-age=31536000');
    if (!c.res.headers.get('Content-Security-Policy')) {
      c.header(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          "script-src 'self' 'wasm-unsafe-eval'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' blob: data:",
          "worker-src 'self' blob:",
          "connect-src 'self'",
          "frame-ancestors 'none'",
          "base-uri 'none'",
          "form-action 'self'",
          "object-src 'none'",
        ].join('; '),
      );
    }
  });

  // ── CSRF: state-changing API calls must come from our own JS ─────────
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      if (c.req.header('X-Requested-With') !== 'homeapp') throw new HttpError(403, 'csrf');
      const origin = c.req.header('Origin');
      if (origin && origin !== options.publicUrl && !sameHost(origin, requestHost(c))) {
        throw new HttpError(403, 'csrf');
      }
    }
    c.header('Cache-Control', 'no-store');
    const token = getCookie(c, SESSION_COOKIE);
    const user = await auth.userForSession(token);
    if (user) c.set('user', user);
    await next();
  });

  const requestHost = (c: Context) =>
    (options.trustProxy ? c.req.header('X-Forwarded-Host') : undefined) ?? c.req.header('Host') ?? new URL(c.req.url).host;
  const isHttps = (c: Context) =>
    options.secureCookies ?? (new URL(c.req.url).protocol === 'https:' || (options.trustProxy === true && c.req.header('X-Forwarded-Proto') === 'https'));
  app.use('/api/*', async (c, next) => {
    if (c.req.path.endsWith('/files')) return next();
    return bodyLimit({ maxSize: 256 * 1024, onError: (cx) => cx.json({ error: 'body_too_large' }, 413) })(c, next);
  });

  const ip = (c: Context) => {
    if (options.trustProxy) {
      // Clients can prepend anything to X-Forwarded-For; the entry our own
      // proxy appended is the last one. Fly.io also sends Fly-Client-IP.
      const fly = c.req.header('Fly-Client-IP');
      if (fly) return fly;
      const fwd = c.req.header('X-Forwarded-For')?.split(',').at(-1)?.trim();
      if (fwd) return fwd;
    }
    try {
      return getConnInfo(c).remote.address ?? 'local';
    } catch {
      return 'local';
    }
  };
  const limit = (limiter: RateLimiter, key: string) => {
    if (!limiter.take(key)) throw new HttpError(429, 'rate_limited');
  };
  const body = async (c: Context): Promise<Record<string, unknown>> => {
    const data = (await c.req.json()) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('invalid_body');
    return data as Record<string, unknown>;
  };
  const requireUser = (c: Context<Env>): User => {
    const user = c.get('user');
    if (!user) throw new HttpError(403, 'not_signed_in');
    return user;
  };
  /** Non-members get a 404, so household ids can't be probed. */
  const requireMember = async (c: Context<Env>) => {
    const user = requireUser(c);
    const householdId = c.req.param('hid') ?? '';
    const home = await store.get(householdId);
    const role = home?.platform.acl.roleOf(user.id, householdId);
    if (!home || !role) throw new HttpError(404, 'not_found');
    touch(householdId, user.id); // any request to the home counts as activity
    return { user, householdId, home, role };
  };
  const startSession = async (c: Context, user: User) => {
    const { token, expiresAt } = await auth.createSession(user.id);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isHttps(c),
      sameSite: 'Lax',
      path: '/',
      expires: expiresAt,
    });
  };
  const origin = (c: Context) => options.publicUrl ?? `${isHttps(c) ? 'https' : 'http'}://${requestHost(c)}`;

  // ── Health (for the host's checks and keep-awake pings; no data) ──────
  app.get('/api/health', async (c) => {
    await db.get('SELECT 1 AS ok');
    return c.json({ ok: true });
  });

  // ── Auth ─────────────────────────────────────────────────────────────
  app.post('/api/auth/signup', async (c) => {
    limit(limits.signup, ip(c));
    const data = await body(c);
    const user = await auth.signup({ email: data.email, password: data.password, name: data.name, avatar: data.avatar });
    await startSession(c, user);
    return c.json({ user }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const data = await body(c);
    limit(limits.loginIp, ip(c));
    limit(limits.login, `${ip(c)}|${String(data.email ?? '').toLowerCase()}`);
    const user = await auth.login({ email: data.email, password: data.password });
    await startSession(c, user);
    return c.json({ user });
  });

  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await auth.destroySession(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.patch('/api/me', async (c) => {
    const user = requireUser(c);
    const data = await body(c);
    if (data.avatar !== undefined) await auth.setAvatar(user.id, data.avatar);
    for (const h of await store.householdsOf(user.id)) hub.publish(h.id, { type: 'changed', area: 'members' });
    return c.json({ user: await auth.getUser(user.id) });
  });

  app.get('/api/me', async (c) => {
    const user = c.get('user');
    const config = { chatIdleMinutes: chatIdleMs / 60_000 };
    if (!user) return c.json({ user: null, households: [], config });
    return c.json({ user, households: await store.householdsOf(user.id), config });
  });

  // ── Households ───────────────────────────────────────────────────────
  app.post('/api/households', async (c) => {
    const user = requireUser(c);
    limit(limits.write, user.id);
    const data = await body(c);
    if ((await store.householdsOf(user.id)).length >= 10) throw bad('too_many_households');
    const name = str(data.name, { max: 60, required: true, field: 'name' })!;
    const currency = oneOf(data.currency, CURRENCIES, 'currency', 'VND');
    const kind = oneOf(data.kind, ['share_house', 'family'] as const, 'kind', 'share_house');
    const householdId = await store.create(user, { name, currency, kind });
    if (bool(data.samples, true)) {
      const locale = typeof data.locale === 'string' ? data.locale.slice(0, 10) : 'en';
      await store.mutate(householdId, (h) => seedSamples(h, householdId, user.id, new Date(), locale));
      await insertSystem(householdId, { key: 'welcome' });
    }
    return c.json({ id: householdId }, 201);
  });

  app.get('/api/households/:hid', async (c) => {
    const { user, householdId, home, role } = await requireMember(c);
    const node = home.platform.graph.requireNode(householdId);
    return c.json({
      id: householdId,
      name: node.label,
      currency: node.props.currency,
      kind: node.props.kind,
      me: { id: user.id, role },
      members: await members(home, householdId, auth),
      hasSamples: hasSamples(home, householdId),
      canInvite: INVITER_ROLES.includes(role),
    });
  });

  app.delete('/api/households/:hid/samples', async (c) => {
    const { householdId, role } = await requireMember(c);
    if (role !== 'owner') throw new HttpError(403, 'owner_only');
    const removed = await store.mutate(householdId, (h) => clearSamples(h, householdId));
    await db.run(`DELETE FROM messages WHERE household_id = ? AND user_id IS NULL AND meta LIKE '%"key":"welcome"%'`, householdId);
    hub.publish(householdId, { type: 'changed', area: 'household' });
    return c.json({ removed });
  });

  app.delete('/api/households/:hid/members/:uid', async (c) => {
    const { user, householdId, role } = await requireMember(c);
    const target = c.req.param('uid');
    const targetRole = await store.roleOf(householdId, target);
    if (!targetRole) throw new HttpError(404, 'not_found');
    if (target === user.id && role === 'owner') throw bad('owner_cannot_leave');
    if (target !== user.id && role !== 'owner') throw new HttpError(403, 'owner_only');
    await store.removeMember(householdId, target);
    hub.kick(householdId, target);
    hub.publish(householdId, { type: 'changed', area: 'members' });
    return c.json({ ok: true });
  });

  // ── Invites ──────────────────────────────────────────────────────────
  app.post('/api/households/:hid/invite', async (c) => {
    const { user, householdId, role } = await requireMember(c);
    if (!INVITER_ROLES.includes(role)) throw new HttpError(403, 'forbidden');
    limit(limits.write, user.id);
    const token = newToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000);
    await db.transaction(async (tx) => {
      // One live link per household: making a new one retires the old ones.
      await tx.run('UPDATE invites SET revoked = 1 WHERE household_id = ?', householdId);
      await tx.run(
        'INSERT INTO invites (token_hash, household_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        sha256(token),
        householdId,
        user.id,
        now.toISOString(),
        expiresAt.toISOString(),
      );
    });
    return c.json({ url: `${origin(c)}/join/${token}`, expiresAt: expiresAt.toISOString() });
  });

  app.delete('/api/households/:hid/invite', async (c) => {
    const { householdId, role } = await requireMember(c);
    if (!INVITER_ROLES.includes(role)) throw new HttpError(403, 'forbidden');
    await db.run('UPDATE invites SET revoked = 1 WHERE household_id = ?', householdId);
    return c.json({ ok: true });
  });

  const findInvite = async (token: string) => {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
    const row = await db.get<{ household_id: string; created_by: string; expires_at: string; revoked: number }>(
      'SELECT household_id, created_by, expires_at, revoked FROM invites WHERE token_hash = ?',
      sha256(token),
    );
    if (!row || Number(row.revoked) || row.expires_at < new Date().toISOString()) return undefined;
    return row;
  };

  app.get('/api/invites/:token', async (c) => {
    limit(limits.invite, ip(c));
    const invite = await findInvite(c.req.param('token'));
    if (!invite) throw new HttpError(404, 'invite_invalid');
    const home = await store.get(invite.household_id);
    if (!home) throw new HttpError(404, 'invite_invalid');
    const user = c.get('user');
    // Only what someone holding the link needs to decide: no member list, no data.
    return c.json({
      householdName: home.platform.graph.requireNode(invite.household_id).label,
      inviterName: home.platform.graph.getNode(invite.created_by)?.label ?? '',
      alreadyMember: Boolean(user && home.platform.acl.roleOf(user.id, invite.household_id)),
      householdId: user && home.platform.acl.roleOf(user.id, invite.household_id) ? invite.household_id : undefined,
    });
  });

  app.post('/api/invites/:token/accept', async (c) => {
    const user = requireUser(c);
    limit(limits.invite, ip(c));
    const invite = await findInvite(c.req.param('token'));
    if (!invite) throw new HttpError(404, 'invite_invalid');
    const home = (await store.get(invite.household_id))!;
    if (!home.platform.acl.roleOf(user.id, invite.household_id)) {
      if (home.platform.acl.members(invite.household_id).length >= 20) throw bad('household_full');
      const kind = home.platform.graph.requireNode(invite.household_id).props.kind;
      await store.addMember(invite.household_id, user, kind === 'family' ? 'family_member' : 'tenant');
      await insertSystem(invite.household_id, { key: 'joined', params: { name: user.name } });
      hub.publish(invite.household_id, { type: 'changed', area: 'members' });
    }
    return c.json({ householdId: invite.household_id });
  });

  // ── Files ────────────────────────────────────────────────────────────
  app.post('/api/households/:hid/files', async (c) => {
    const { user, householdId } = await requireMember(c);
    limit(limits.upload, user.id);
    const declared = Number(c.req.header('Content-Length') ?? 0);
    if (declared > MAX_UPLOAD_BYTES) throw new HttpError(413, 'file_too_large');
    const used = await files.usage(householdId);
    if (used + declared > quota) throw new HttpError(413, 'storage_full');
    const bytes = new Uint8Array(await readLimited(c.req.raw, MAX_UPLOAD_BYTES));
    if (used + bytes.byteLength > quota) throw new HttpError(413, 'storage_full');
    const saved = await files.save({ householdId, uploaderId: user.id, bytes, name: c.req.header('X-File-Name') });
    if ('error' in saved) {
      throw new HttpError(saved.error === 'file_too_large' ? 413 : saved.error === 'unsupported_file_type' ? 415 : 400, saved.error);
    }
    return c.json(fileDto(saved), 201);
  });

  app.get('/api/files/:id', async (c) => {
    const user = requireUser(c);
    const file = await files.get(c.req.param('id'));
    if (!file || !(await canReadFile(user.id, file))) throw new HttpError(404, 'not_found');
    const isImage = file.mime.startsWith('image/');
    const disposition = `${isImage && c.req.query('download') === undefined ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`;
    return new Response(new Uint8Array(await files.read(file)), {
      headers: {
        'Content-Type': file.mime,
        'Content-Length': String(file.size),
        'Content-Disposition': disposition,
        'Cache-Control': 'private, max-age=86400',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  /**
   * A member can download a file if they uploaded it, it is in the
   * household chat, or it is attached to a library item they can read.
   */
  async function canReadFile(userId: string, file: StoredFile): Promise<boolean> {
    const home = await store.get(file.household_id);
    if (!home?.platform.acl.roleOf(userId, file.household_id)) return false;
    if (file.uploader_id === userId) return true;
    if (await db.get('SELECT 1 AS x FROM messages WHERE household_id = ? AND file_id = ?', file.household_id, file.id)) return true;
    return home.items.referencing(file.household_id, file.id).some((item) => home.platform.acl.canRead(userId, item));
  }

  /** Attachments must be the actor's own uploads in this household — no borrowing someone else's private file. */
  async function ownUploads(userId: string, householdId: string, fileIds: string[], alreadyAttached: string[] = []) {
    const out = [];
    for (const id of fileIds) {
      const file = await files.get(id);
      const ok = file && file.household_id === householdId && (file.uploader_id === userId || alreadyAttached.includes(id));
      if (!ok) throw bad('attachment_invalid');
      out.push({ fileId: file.id, name: file.name, mime: file.mime, size: file.size });
    }
    return out;
  }

  // ── Chat ─────────────────────────────────────────────────────────────
  interface MessageRow {
    id: string;
    household_id: string;
    user_id: string | null;
    text: string;
    file_id: string | null;
    created_at: string;
    seq: number;
    meta: string | null;
  }

  /**
   * System messages are stored as a key + parameters, never as text, so each
   * member reads them in their own language. (People's own messages are kept
   * exactly as typed and never translated.)
   */
  interface SystemMessage {
    key: 'welcome' | 'joined' | 'billAdded' | 'billPaid' | 'settled';
    params?: Record<string, string | number | undefined>;
  }
  const insertSystem = (householdId: string, system: SystemMessage) => insertMessage(householdId, null, '', undefined, system);

  /** Numbers each household's messages 1, 2, 3… — serialised so two senders never get the same number. */
  async function insertMessage(householdId: string, userId: string | null, text: string, fileId?: string, system?: SystemMessage) {
    const row = await store.withLock(`messages:${householdId}`, async () => {
      const last = await db.get<{ s: number | string | null }>('SELECT MAX(seq) AS s FROM messages WHERE household_id = ?', householdId);
      const seq = Number(last?.s ?? 0) + 1;
      const row: MessageRow = {
      id: `m_${randomUUID()}`,
      household_id: householdId,
      user_id: userId,
      text,
      file_id: fileId ?? null,
      created_at: new Date().toISOString(),
      seq,
      meta: system ? JSON.stringify(system) : null,
      };
      await db.run(
        'INSERT INTO messages (id, household_id, user_id, text, file_id, created_at, seq, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        row.id,
        row.household_id,
        row.user_id,
        row.text,
        row.file_id,
        row.created_at,
        row.seq,
        row.meta,
      );
      return row;
    });
    const dto = await messageDto(row);
    hub.publish(householdId, { type: 'message', message: dto });
    return dto;
  }

  async function messageDto(row: MessageRow) {
    const home = await store.get(row.household_id);
    const file = row.file_id ? await files.get(row.file_id) : undefined;
    return {
      id: row.id,
      seq: Number(row.seq),
      userId: row.user_id,
      userName: row.user_id ? (home?.platform.graph.getNode(row.user_id)?.label ?? '?') : null,
      text: row.text,
      system: row.meta ? (JSON.parse(row.meta) as SystemMessage) : null,
      file: file ? fileDto(file) : null,
      createdAt: row.created_at,
    };
  }

  app.get('/api/households/:hid/messages', async (c) => {
    const { householdId } = await requireMember(c);
    // seq is a 32-bit INTEGER in Postgres, so clamp the bounds into range.
    const clamp = (v: number, fallback: number) => (Number.isFinite(v) ? Math.max(0, Math.min(Math.trunc(v), 2_000_000_000)) : fallback);
    const before = clamp(Number(c.req.query('before') ?? NaN), 2_000_000_000);
    const after = clamp(Number(c.req.query('after') ?? 0), 0);
    const rows = await db.all<MessageRow>(
      'SELECT * FROM messages WHERE household_id = ? AND seq < ? AND seq > ? ORDER BY seq DESC LIMIT 50',
      householdId,
      before,
      after,
    );
    return c.json({ messages: await Promise.all(rows.reverse().map(messageDto)), hasMore: rows.length === 50 });
  });

  app.post('/api/households/:hid/messages', async (c) => {
    const { user, householdId } = await requireMember(c);
    limit(limits.message, user.id);
    const data = await body(c);
    const text = str(data.text, { max: 4000, field: 'text' }) ?? '';
    const fileId = str(data.fileId, { max: 100, field: 'fileId' });
    if (!text && !fileId) throw bad('message_empty');
    if (fileId && !(await ownUploads(user.id, householdId, [fileId]))[0]!.mime.startsWith('image/')) throw bad('chat_images_only');
    return c.json(await insertMessage(householdId, user.id, text, fileId), 201);
  });

  app.delete('/api/households/:hid/messages/:mid', async (c) => {
    const { user, householdId } = await requireMember(c);
    const row = await db.get<MessageRow>('SELECT * FROM messages WHERE id = ? AND household_id = ?', c.req.param('mid'), householdId);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.user_id !== user.id) throw new HttpError(403, 'forbidden');
    await db.run('DELETE FROM messages WHERE id = ?', row.id);
    hub.publish(householdId, { type: 'message_deleted', id: row.id });
    return c.json({ ok: true });
  });

  /** "I'm still here" from an app that is open and being used, but not making other requests. */
  app.post('/api/households/:hid/presence', async (c) => {
    await requireMember(c);
    return c.json({ ok: true });
  });

  app.get('/api/households/:hid/events', async (c) => {
    const { user, householdId } = await requireMember(c);
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      let open = true;
      const unsubscribe = hub.subscribe(householdId, {
        userId: user.id,
        send: (event) => void stream.writeSSE({ event: event.type, data: JSON.stringify(event) }),
        close: () => {
          open = false;
          stream.abort();
        },
      });
      stream.onAbort(() => {
        open = false;
        unsubscribe();
      });
      await stream.writeSSE({ event: 'ready', data: JSON.stringify({ idleMs: chatIdleMs }), retry: 3000 });
      const key = `${householdId}:${user.id}`;
      const tick = Math.max(50, Math.min(20_000, Math.floor(chatIdleMs / 4)));
      let lastPing = Date.now();
      while (open && !stream.aborted) {
        await stream.sleep(tick);
        if (!open || stream.aborted) break;
        // Membership can be revoked while the stream is open.
        if (!(await store.roleOf(householdId, user.id))) break;
        // Idle (or the tab was frozen): tell the app to stop reconnecting, then hang up.
        if (Date.now() - (lastActive.get(key) ?? 0) > chatIdleMs) {
          await stream.writeSSE({ event: 'idle', data: '{}' });
          break;
        }
        if (Date.now() - lastPing >= 20_000) {
          lastPing = Date.now();
          await stream.writeSSE({ event: 'ping', data: '' });
        }
      }
      unsubscribe();
    });
  });

  // ── Library ──────────────────────────────────────────────────────────
  function itemDto(home: HomeApp, userId: string, householdId: string, item: GraphNode<HouseItemProps>) {
    const owner = home.platform.acl.roleOf(userId, householdId) === 'owner';
    return {
      id: item.id,
      kind: item.props.kind,
      title: item.label,
      body: item.props.body ?? '',
      tags: item.props.tags,
      attachments: item.props.attachments.map((a) => ({ ...a, url: `/api/files/${a.fileId}` })),
      private: item.visibility === 'private',
      ownerId: item.ownerId,
      ownerName: item.ownerId ? (home.platform.graph.getNode(item.ownerId)?.label ?? '') : '',
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      canEdit: home.platform.acl.canWrite(userId, item),
      canDelete: item.ownerId === userId || (owner && item.visibility === 'household'),
      canChangePrivacy: item.ownerId === userId,
      sample: Boolean(item.props.sample),
    };
  }

  app.get('/api/households/:hid/items', async (c) => {
    const { user, householdId, home } = await requireMember(c);
    const q = c.req.query('q')?.slice(0, 200);
    const tag = c.req.query('tag')?.slice(0, 40);
    const kind = c.req.query('kind');
    const list = home.items.list(user.id, householdId, {
      q,
      tag,
      kind: kind ? oneOf(kind, ['note', 'document', 'photo', 'link'] as const, 'kind') : undefined,
    });
    return c.json({
      items: list.map((i) => itemDto(home, user.id, householdId, i)),
      tags: home.items.tags(user.id, householdId),
    });
  });

  app.post('/api/households/:hid/items', async (c) => {
    const { user, householdId, home } = await requireMember(c);
    limit(limits.write, user.id);
    const data = await body(c);
    const attachments = await ownUploads(user.id, householdId, ids(data.attachmentIds, 'attachmentIds'));
    const title = str(data.title, { max: 200, field: 'title' }) ?? attachments[0]?.name;
    if (!title) throw bad('title_required');
    const kind = oneOf(
      data.kind,
      ['note', 'document', 'photo', 'link'] as const,
      'kind',
      attachments.length ? (attachments.every((a) => a.mime.startsWith('image/')) ? 'photo' : 'document') : 'note',
    );
    const item = await store.mutate(householdId, (h) =>
      h.items.create(user.id, householdId, {
        kind,
        title,
        body: str(data.body, { max: 20_000, field: 'body' }),
        tags: tags(data.tags),
        attachments,
        private: bool(data.private, false),
      }),
    );
    hub.publish(householdId, { type: 'changed', area: 'library' });
    return c.json(itemDto(home, user.id, householdId, item), 201);
  });

  app.patch('/api/households/:hid/items/:id', async (c) => {
    const { user, householdId, home } = await requireMember(c);
    limit(limits.write, user.id);
    const data = await body(c);
    const existing = home.items.get(user.id, c.req.param('id'));
    if (existing.householdId !== householdId) throw new HttpError(404, 'not_found');
    const attachments =
      data.attachmentIds === undefined
        ? undefined
        : await ownUploads(user.id, householdId, ids(data.attachmentIds, 'attachmentIds'), existing.props.attachments.map((a) => a.fileId));
    if (data.private !== undefined && existing.ownerId !== user.id) throw new HttpError(403, 'forbidden');
    const item = await store.mutate(householdId, (h) =>
      h.items.update(user.id, existing.id, {
        title: str(data.title, { max: 200, field: 'title' }),
        body: data.body === undefined ? undefined : (str(data.body, { max: 20_000, field: 'body' }) ?? ''),
        tags: data.tags === undefined ? undefined : tags(data.tags),
        attachments,
        private: data.private === undefined ? undefined : bool(data.private, false),
      }),
    );
    hub.publish(householdId, { type: 'changed', area: 'library' });
    return c.json(itemDto(home, user.id, householdId, item));
  });

  app.delete('/api/households/:hid/items/:id', async (c) => {
    const { user, householdId, home } = await requireMember(c);
    const existing = home.items.get(user.id, c.req.param('id'));
    if (existing.householdId !== householdId) throw new HttpError(404, 'not_found');
    const removed = await store.mutate(householdId, (h) => h.items.remove(user.id, existing.id));
    for (const a of removed.props.attachments) {
      const stillUsed =
        home.items.referencing(householdId, a.fileId).length > 0 || (await db.get('SELECT 1 AS x FROM messages WHERE file_id = ?', a.fileId));
      if (!stillUsed) await files.remove(a.fileId);
    }
    hub.publish(householdId, { type: 'changed', area: 'library' });
    return c.json({ ok: true });
  });

  // ── Bills & money ────────────────────────────────────────────────────
  async function moneyView(home: HomeApp, userId: string, householdId: string) {
    const f = home.finance;
    const isOwner = home.platform.acl.roleOf(userId, householdId) === 'owner';
    const bills = home.platform.acl
      .visible<BillProps>(userId, householdId, 'bill')
      .sort((a, b) => (statusRank(a) - statusRank(b)) || (a.props.dueDate ?? '9999').localeCompare(b.props.dueDate ?? '9999'))
      .map((b) => ({
        id: b.id,
        label: b.label,
        category: b.props.category,
        amount: b.props.amount,
        currency: b.props.currency,
        provider: b.props.provider,
        dueDate: b.props.dueDate,
        periodStart: b.props.periodStart,
        periodEnd: b.props.periodEnd,
        shared: b.props.shared,
        shares: b.props.shares,
        status: b.props.status,
        payerId: b.props.payerId,
        paidAt: b.props.paidAt,
        ownerId: b.ownerId,
        canDelete: b.ownerId === userId || (isOwner && b.visibility === 'household'),
        sample: Boolean(b.props.sample),
        createdAt: b.createdAt.toISOString(),
      }));
    const expenses = home.platform.acl
      .visible<TransactionProps>(userId, householdId, 'transaction')
      .sort((a, b) => b.props.date.localeCompare(a.props.date) || b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 100)
      .map((t) => ({
        id: t.id,
        label: t.label,
        kind: t.props.kind,
        amount: t.props.amount,
        category: t.props.category,
        date: t.props.date,
        paidBy: t.props.paidBy,
        participants: t.props.participants,
        shared: t.props.shared,
        ownerId: t.ownerId,
        canDelete: t.ownerId === userId || (isOwner && t.visibility === 'household'),
      }));
    return {
      currency: String(home.platform.graph.requireNode(householdId).props.currency),
      members: await members(home, householdId, auth),
      bills,
      expenses,
      balances: f.balances(userId, householdId),
      transfers: f.settleUp(userId, householdId),
      reminders: f.reminders(userId, householdId),
    };
  }

  const statusRank = (b: GraphNode<BillProps>) => (b.props.status === 'unpaid' ? 0 : 1);

  const residentIds = (home: HomeApp, householdId: string) =>
    home.platform.acl.members(householdId).filter((m) => RESIDENT_ROLES.includes(m.role)).map((m) => m.userId);

  const memberSubset = (home: HomeApp, householdId: string, v: unknown, field: string) => {
    if (v === undefined || v === null) return undefined;
    const list = ids(v, field, 20);
    const residents = residentIds(home, householdId);
    if (list.length === 0 || list.some((id) => !residents.includes(id))) throw bad(`${field}_invalid`);
    return list;
  };

  const moneyChanged = (householdId: string) => hub.publish(householdId, { type: 'changed', area: 'bills' });

  app.get('/api/households/:hid/money', async (c) => {
    const { user, householdId, home } = await requireMember(c);
    return c.json(await moneyView(home, user.id, householdId));
  });

  app.post('/api/households/:hid/bills', async (c) => {
    const { user, householdId, home } = await requireMember(c);
    limit(limits.write, user.id);
    const data = await body(c);
    const category = oneOf(data.category, BILL_CATEGORIES, 'category', 'other');
    const input = {
      category,
      amount: amount(data.amount),
      label: str(data.label, { max: 80, field: 'label' }),
      provider: str(data.provider, { max: 80, field: 'provider' }),
      dueDate: isoDate(data.dueDate, 'dueDate'),
      periodStart: isoDate(data.periodStart, 'periodStart'),
      periodEnd: isoDate(data.periodEnd, 'periodEnd'),
      shared: bool(data.shared, true),
      responsible: memberSubset(home, householdId, data.responsible, 'responsible'),
    };
    if (input.periodStart && input.periodEnd && input.periodStart > input.periodEnd) throw bad('period_invalid');
    const bill = await store.mutate(householdId, (h) => h.finance.recordBill(user.id, householdId, input));
    moneyChanged(householdId);
    if (bill.props.shared) {
      await insertSystem(householdId, {
        key: 'billAdded',
        params: { name: user.name, label: bill.label, amount: bill.props.amount, currency: bill.props.currency, date: bill.props.dueDate },
      });
    }
    return c.json(await moneyView(home, user.id, householdId), 201);
  });

  app.post('/api/households/:hid/bills/:id/pay', async (c) => {
    const { user, householdId, home } = await requireMember(c);
    const data = await body(c).catch(() => ({}) as Record<string, unknown>);
    const bill = home.platform.graph.getNode<BillProps>(c.req.param('id'));
    if (!bill || bill.type !== 'bill' || bill.householdId !== householdId || !home.platform.acl.canRead(user.id, bill)) {
      throw new HttpError(404, 'not_found');
    }
    const payerId = data.payerId === undefined ? user.id : memberSubset(home, householdId, [data.payerId], 'payerId')![0]!;
    await store.mutate(householdId, (h) => h.finance.payBill(user.id, bill.id, payerId));
    moneyChanged(householdId);
    if (bill.props.shared) {
      const payer = payerId === user.id ? user.name : (home.platform.graph.getNode(payerId)?.label ?? '?');
      await insertSystem(householdId, {
        key: 'billPaid',
        params: { actor: user.name, payer, label: bill.label, amount: bill.props.amount, currency: bill.props.currency },
      });
    }
    return c.json(await moneyView(home, user.id, householdId));
  });

  app.post('/api/households/:hid/bills/:id/unpay', async (c) => {
    const { user, householdId, home } = await requireMember(c);
    const bill = home.platform.graph.getNode<BillProps>(c.req.param('id'));
    if (!bill || bill.type !== 'bill' || bill.householdId !== householdId || !home.platform.acl.canRead(user.id, bill)) {
      throw new HttpError(404, 'not_found');
    }
    await store.mutate(householdId, (h) => h.finance.unpayBill(user.id, bill.id));
    moneyChanged(householdId);
    return c.json(await moneyView(home, user.id, householdId));
  });

  app.post('/api/households/:hid/expenses', async (c) => {
    const { user, householdId, home } = await requireMember(c);
    limit(limits.write, user.id);
    const data = await body(c);
    const shared = bool(data.shared, false);
    const paidBy = data.paidBy === undefined ? user.id : memberSubset(home, householdId, [data.paidBy], 'paidBy')![0]!;
    if (!shared && paidBy !== user.id) throw bad('paidBy_invalid');
    const input = {
      description: str(data.description, { max: 120, required: true, field: 'description' })!,
      amount: amount(data.amount),
      category: str(data.category, { max: 40, field: 'category' }) ?? 'other',
      date: isoDate(data.date, 'date'),
      shared,
      paidBy,
      participants: shared ? memberSubset(home, householdId, data.participants, 'participants') : undefined,
    };
    await store.mutate(householdId, (h) => h.finance.recordExpense(user.id, householdId, input));
    if (shared) moneyChanged(householdId);
    return c.json(await moneyView(home, user.id, householdId), 201);
  });

  app.post('/api/households/:hid/settlements', async (c) => {
    const { user, householdId, home } = await requireMember(c);
    limit(limits.write, user.id);
    const data = await body(c);
    const [from] = memberSubset(home, householdId, [data.from], 'from')!;
    const [to] = memberSubset(home, householdId, [data.to], 'to')!;
    if (from === to) throw bad('to_invalid');
    const value = amount(data.amount);
    await store.mutate(householdId, (h) => h.finance.recordSettlement(user.id, householdId, { from: from!, to: to!, amount: value }));
    moneyChanged(householdId);
    const nameOf = (id: string) => home.platform.graph.getNode(id)?.label ?? '?';
    const currency = String(home.platform.graph.requireNode(householdId).props.currency);
    await insertSystem(householdId, { key: 'settled', params: { actor: user.name, from: nameOf(from!), to: nameOf(to!), amount: value, currency } });
    return c.json(await moneyView(home, user.id, householdId), 201);
  });

  app.delete('/api/households/:hid/money/:id', async (c) => {
    const { user, householdId, home } = await requireMember(c);
    const node = home.platform.graph.getNode(c.req.param('id'));
    if (!node || node.householdId !== householdId || !home.platform.acl.canRead(user.id, node)) throw new HttpError(404, 'not_found');
    await store.mutate(householdId, (h) => h.finance.remove(user.id, node.id));
    moneyChanged(householdId);
    return c.json(await moneyView(home, user.id, householdId));
  });

  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

  // ── Web app ──────────────────────────────────────────────────────────
  if (options.publicDir && existsSync(options.publicDir)) {
    const publicDir = options.publicDir;
    const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf8');
    app.use(
      '/assets/*',
      async (c, next) => {
        await next();
        c.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
      serveStatic({ root: publicDir }),
    );
    app.use(
      '/ocr/*',
      async (c, next) => {
        await next();
        c.header('Cache-Control', 'public, max-age=2592000');
      },
      serveStatic({ root: publicDir }),
    );
    app.get('*', serveStatic({ root: publicDir }));
    // Client-side routes (/join/:token, /h/...) all load the app shell.
    app.get('*', (c) => {
      c.header('Cache-Control', 'no-cache');
      return c.html(indexHtml);
    });
  }

  return { app, db, store, hub };
}

async function members(home: HomeApp, householdId: string, auth: Auth) {
  const list = home.platform.acl.members(householdId);
  const avatars = await auth.avatars(list.map((m) => m.userId));
  return list.map((m) => ({
    id: m.userId,
    name: home.platform.graph.getNode<PersonProps>(m.userId)?.label ?? '?',
    role: m.role,
    avatar: avatars[m.userId] ?? DEFAULT_CHARACTER,
  }));
}

function fileDto(file: StoredFile) {
  return { id: file.id, name: file.name, mime: file.mime, size: file.size, url: `/api/files/${file.id}` };
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}


async function readLimited(req: Request, max: number): Promise<ArrayBuffer> {
  if (!req.body) return new ArrayBuffer(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, 'file_too_large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
