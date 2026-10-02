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
import { openDb, type Db } from './db.js';
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
  dataDir: string;
  /** Built web app. Omit in API-only tests. */
  publicDir?: string;
  /** Mark cookies Secure (true behind HTTPS). */
  secureCookies?: boolean;
  /** Canonical origin for invite links, e.g. https://homeapp.fly.dev */
  publicUrl?: string;
  /** Trust X-Forwarded-For for client IPs (set when behind a proxy). */
  trustProxy?: boolean;
  db?: Db;
}

const SESSION_COOKIE = 'sid';
const HOUSEHOLD_QUOTA_BYTES = 500 * 1024 * 1024;
const INVITE_DAYS = 7;
const RESIDENT_ROLES: Role[] = ['owner', 'family_member', 'tenant', 'child'];
const INVITER_ROLES: Role[] = ['owner', 'family_member', 'tenant'];

type Env = { Variables: { user?: User } };

export function createServer(options: ServerOptions) {
  const db = options.db ?? openDb(join(options.dataDir, 'homeapp.db'));
  const auth = new Auth(db);
  const store = new HouseholdStore(db);
  const files = new FileStore(db, options.dataDir);
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
    if (options.secureCookies) c.header('Strict-Transport-Security', 'max-age=31536000');
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
    const user = auth.userForSession(token);
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
  const requireMember = (c: Context<Env>) => {
    const user = requireUser(c);
    const householdId = c.req.param('hid') ?? '';
    const home = store.get(householdId);
    const role = home?.platform.acl.roleOf(user.id, householdId);
    if (!home || !role) throw new HttpError(404, 'not_found');
    return { user, householdId, home, role };
  };
  const startSession = (c: Context, user: User) => {
    const { token, expiresAt } = auth.createSession(user.id);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isHttps(c),
      sameSite: 'Lax',
      path: '/',
      expires: expiresAt,
    });
  };
  const origin = (c: Context) => options.publicUrl ?? `${isHttps(c) ? 'https' : 'http'}://${requestHost(c)}`;

  // ── Auth ─────────────────────────────────────────────────────────────
  app.post('/api/auth/signup', async (c) => {
    limit(limits.signup, ip(c));
    const data = await body(c);
    const user = await auth.signup({ email: data.email, password: data.password, name: data.name, avatar: data.avatar });
    startSession(c, user);
    return c.json({ user }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const data = await body(c);
    limit(limits.loginIp, ip(c));
    limit(limits.login, `${ip(c)}|${String(data.email ?? '').toLowerCase()}`);
    const user = await auth.login({ email: data.email, password: data.password });
    startSession(c, user);
    return c.json({ user });
  });

  app.post('/api/auth/logout', (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) auth.destroySession(token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.patch('/api/me', async (c) => {
    const user = requireUser(c);
    const data = await body(c);
    if (data.avatar !== undefined) auth.setAvatar(user.id, data.avatar);
    for (const h of store.householdsOf(user.id)) hub.publish(h.id, { type: 'changed', area: 'members' });
    return c.json({ user: auth.getUser(user.id) });
  });

  app.get('/api/me', (c) => {
    const user = c.get('user');
    if (!user) return c.json({ user: null, households: [] });
    return c.json({ user, households: store.householdsOf(user.id) });
  });

  // ── Households ───────────────────────────────────────────────────────
  app.post('/api/households', async (c) => {
    const user = requireUser(c);
    limit(limits.write, user.id);
    const data = await body(c);
    if (store.householdsOf(user.id).length >= 10) throw bad('too_many_households');
    const name = str(data.name, { max: 60, required: true, field: 'name' })!;
    const currency = oneOf(data.currency, CURRENCIES, 'currency', 'VND');
    const kind = oneOf(data.kind, ['share_house', 'family'] as const, 'kind', 'share_house');
    const home = store.create(user, { name, currency, kind });
    const householdId = home.platform.graph.find((n) => n.type === 'home')[0]!.id;
    let welcome: string | undefined;
    if (bool(data.samples, true)) {
      const locale = typeof data.locale === 'string' ? data.locale : 'en';
      store.mutate(householdId, (h) => seedSamples(h, householdId, user.id, new Date(), locale));
      welcome = 'welcome';
    }
    if (welcome) insertSystem(householdId, { key: 'welcome' });
    return c.json({ id: householdId }, 201);
  });

  app.get('/api/households/:hid', (c) => {
    const { user, householdId, home, role } = requireMember(c);
    const node = home.platform.graph.requireNode(householdId);
    return c.json({
      id: householdId,
      name: node.label,
      currency: node.props.currency,
      kind: node.props.kind,
      me: { id: user.id, role },
      members: members(home, householdId, auth),
      hasSamples: hasSamples(home, householdId),
      canInvite: INVITER_ROLES.includes(role),
    });
  });

  app.delete('/api/households/:hid/samples', (c) => {
    const { householdId, role } = requireMember(c);
    if (role !== 'owner') throw new HttpError(403, 'owner_only');
    const removed = store.mutate(householdId, (h) => clearSamples(h, householdId));
    db.prepare(`DELETE FROM messages WHERE household_id = ? AND user_id IS NULL AND meta LIKE '%"key":"welcome"%'`).run(householdId);
    hub.publish(householdId, { type: 'changed', area: 'household' });
    return c.json({ removed });
  });

  app.delete('/api/households/:hid/members/:uid', (c) => {
    const { user, householdId, role } = requireMember(c);
    const target = c.req.param('uid');
    const targetRole = store.roleOf(householdId, target);
    if (!targetRole) throw new HttpError(404, 'not_found');
    if (target === user.id && role === 'owner') throw bad('owner_cannot_leave');
    if (target !== user.id && role !== 'owner') throw new HttpError(403, 'owner_only');
    store.removeMember(householdId, target);
    hub.kick(householdId, target);
    hub.publish(householdId, { type: 'changed', area: 'members' });
    return c.json({ ok: true });
  });

  // ── Invites ──────────────────────────────────────────────────────────
  app.post('/api/households/:hid/invite', (c) => {
    const { user, householdId, role } = requireMember(c);
    if (!INVITER_ROLES.includes(role)) throw new HttpError(403, 'forbidden');
    limit(limits.write, user.id);
    const token = newToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_DAYS * 86_400_000);
    db.exec('BEGIN');
    try {
      // One live link per household: making a new one retires the old ones.
      db.prepare('UPDATE invites SET revoked = 1 WHERE household_id = ?').run(householdId);
      db.prepare('INSERT INTO invites (token_hash, household_id, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
        sha256(token),
        householdId,
        user.id,
        now.toISOString(),
        expiresAt.toISOString(),
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return c.json({ url: `${origin(c)}/join/${token}`, expiresAt: expiresAt.toISOString() });
  });

  app.delete('/api/households/:hid/invite', (c) => {
    const { householdId, role } = requireMember(c);
    if (!INVITER_ROLES.includes(role)) throw new HttpError(403, 'forbidden');
    db.prepare('UPDATE invites SET revoked = 1 WHERE household_id = ?').run(householdId);
    return c.json({ ok: true });
  });

  const findInvite = (token: string) => {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return undefined;
    const row = db
      .prepare('SELECT household_id, created_by, expires_at, revoked FROM invites WHERE token_hash = ?')
      .get(sha256(token)) as { household_id: string; created_by: string; expires_at: string; revoked: number } | undefined;
    if (!row || row.revoked || row.expires_at < new Date().toISOString()) return undefined;
    return row;
  };

  app.get('/api/invites/:token', (c) => {
    limit(limits.invite, ip(c));
    const invite = findInvite(c.req.param('token'));
    if (!invite) throw new HttpError(404, 'invite_invalid');
    const home = store.get(invite.household_id);
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

  app.post('/api/invites/:token/accept', (c) => {
    const user = requireUser(c);
    limit(limits.invite, ip(c));
    const invite = findInvite(c.req.param('token'));
    if (!invite) throw new HttpError(404, 'invite_invalid');
    const home = store.get(invite.household_id)!;
    if (!home.platform.acl.roleOf(user.id, invite.household_id)) {
      if (home.platform.acl.members(invite.household_id).length >= 20) throw bad('household_full');
      const kind = home.platform.graph.requireNode(invite.household_id).props.kind;
      store.addMember(invite.household_id, user, kind === 'family' ? 'family_member' : 'tenant');
      insertSystem(invite.household_id, { key: 'joined', params: { name: user.name } });
      hub.publish(invite.household_id, { type: 'changed', area: 'members' });
    }
    return c.json({ householdId: invite.household_id });
  });

  // ── Files ────────────────────────────────────────────────────────────
  app.post('/api/households/:hid/files', async (c) => {
    const { user, householdId } = requireMember(c);
    limit(limits.upload, user.id);
    const declared = Number(c.req.header('Content-Length') ?? 0);
    if (declared > MAX_UPLOAD_BYTES) throw new HttpError(413, 'file_too_large');
    const used = (db.prepare('SELECT COALESCE(SUM(size), 0) AS s FROM files WHERE household_id = ?').get(householdId) as { s: number }).s;
    if (used + declared > HOUSEHOLD_QUOTA_BYTES) throw new HttpError(413, 'storage_full');
    const bytes = new Uint8Array(await readLimited(c.req.raw, MAX_UPLOAD_BYTES));
    if (used + bytes.byteLength > HOUSEHOLD_QUOTA_BYTES) throw new HttpError(413, 'storage_full');
    const saved = files.save({ householdId, uploaderId: user.id, bytes, name: c.req.header('X-File-Name') });
    if ('error' in saved) {
      throw new HttpError(saved.error === 'file_too_large' ? 413 : saved.error === 'unsupported_file_type' ? 415 : 400, saved.error);
    }
    return c.json(fileDto(saved), 201);
  });

  app.get('/api/files/:id', (c) => {
    const user = requireUser(c);
    const file = files.get(c.req.param('id'));
    if (!file || !canReadFile(user.id, file)) throw new HttpError(404, 'not_found');
    const isImage = file.mime.startsWith('image/');
    const disposition = `${isImage && c.req.query('download') === undefined ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`;
    return new Response(new Uint8Array(files.read(file)), {
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
  function canReadFile(userId: string, file: StoredFile): boolean {
    const home = store.get(file.household_id);
    if (!home?.platform.acl.roleOf(userId, file.household_id)) return false;
    if (file.uploader_id === userId) return true;
    if (db.prepare('SELECT 1 FROM messages WHERE household_id = ? AND file_id = ?').get(file.household_id, file.id)) return true;
    return home.items.referencing(file.household_id, file.id).some((item) => home.platform.acl.canRead(userId, item));
  }

  /** Attachments must be the actor's own uploads in this household — no borrowing someone else's private file. */
  function ownUploads(userId: string, householdId: string, fileIds: string[], alreadyAttached: string[] = []) {
    return fileIds.map((id) => {
      const file = files.get(id);
      const ok = file && file.household_id === householdId && (file.uploader_id === userId || alreadyAttached.includes(id));
      if (!ok) throw bad('attachment_invalid');
      return { fileId: file.id, name: file.name, mime: file.mime, size: file.size };
    });
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

  function insertMessage(householdId: string, userId: string | null, text: string, fileId?: string, system?: SystemMessage) {
    const seq =
      ((db.prepare('SELECT MAX(seq) AS s FROM messages WHERE household_id = ?').get(householdId) as { s: number | null }).s ?? 0) + 1;
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
    db.prepare('INSERT INTO messages (id, household_id, user_id, text, file_id, created_at, seq, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      row.id,
      row.household_id,
      row.user_id,
      row.text,
      row.file_id,
      row.created_at,
      row.seq,
      row.meta,
    );
    const dto = messageDto(row);
    hub.publish(householdId, { type: 'message', message: dto });
    return dto;
  }

  function messageDto(row: MessageRow) {
    const home = store.get(row.household_id);
    const file = row.file_id ? files.get(row.file_id) : undefined;
    return {
      id: row.id,
      seq: row.seq,
      userId: row.user_id,
      userName: row.user_id ? (home?.platform.graph.getNode(row.user_id)?.label ?? '?') : null,
      text: row.text,
      system: row.meta ? (JSON.parse(row.meta) as SystemMessage) : null,
      file: file ? fileDto(file) : null,
      createdAt: row.created_at,
    };
  }

  app.get('/api/households/:hid/messages', (c) => {
    const { householdId } = requireMember(c);
    const before = Number(c.req.query('before') ?? Number.MAX_SAFE_INTEGER);
    const after = Number(c.req.query('after') ?? 0);
    const rows = db
      .prepare(
        `SELECT * FROM messages WHERE household_id = ? AND seq < ? AND seq > ? ORDER BY seq DESC LIMIT 50`,
      )
      .all(householdId, Number.isFinite(before) ? before : Number.MAX_SAFE_INTEGER, Number.isFinite(after) ? after : 0) as unknown as MessageRow[];
    return c.json({ messages: rows.reverse().map(messageDto), hasMore: rows.length === 50 });
  });

  app.post('/api/households/:hid/messages', async (c) => {
    const { user, householdId } = requireMember(c);
    limit(limits.message, user.id);
    const data = await body(c);
    const text = str(data.text, { max: 4000, field: 'text' }) ?? '';
    const fileId = str(data.fileId, { max: 100, field: 'fileId' });
    if (!text && !fileId) throw bad('message_empty');
    if (fileId && !ownUploads(user.id, householdId, [fileId])[0]!.mime.startsWith('image/')) throw bad('chat_images_only');
    return c.json(insertMessage(householdId, user.id, text, fileId), 201);
  });

  app.delete('/api/households/:hid/messages/:mid', (c) => {
    const { user, householdId } = requireMember(c);
    const row = db.prepare('SELECT * FROM messages WHERE id = ? AND household_id = ?').get(c.req.param('mid'), householdId) as
      | MessageRow
      | undefined;
    if (!row) throw new HttpError(404, 'not_found');
    if (row.user_id !== user.id) throw new HttpError(403, 'forbidden');
    db.prepare('DELETE FROM messages WHERE id = ?').run(row.id);
    hub.publish(householdId, { type: 'message_deleted', id: row.id });
    return c.json({ ok: true });
  });

  app.get('/api/households/:hid/events', (c) => {
    const { user, householdId } = requireMember(c);
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
      await stream.writeSSE({ event: 'ready', data: '{}', retry: 3000 });
      while (open && !stream.aborted) {
        await stream.sleep(20_000);
        // Membership can be revoked while the stream is open.
        if (!store.roleOf(householdId, user.id)) break;
        if (open) await stream.writeSSE({ event: 'ping', data: '' });
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

  app.get('/api/households/:hid/items', (c) => {
    const { user, householdId, home } = requireMember(c);
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
    const { user, householdId, home } = requireMember(c);
    limit(limits.write, user.id);
    const data = await body(c);
    const attachments = ownUploads(user.id, householdId, ids(data.attachmentIds, 'attachmentIds'));
    const title = str(data.title, { max: 200, field: 'title' }) ?? attachments[0]?.name;
    if (!title) throw bad('title_required');
    const kind = oneOf(
      data.kind,
      ['note', 'document', 'photo', 'link'] as const,
      'kind',
      attachments.length ? (attachments.every((a) => a.mime.startsWith('image/')) ? 'photo' : 'document') : 'note',
    );
    const item = store.mutate(householdId, (h) =>
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
    const { user, householdId, home } = requireMember(c);
    limit(limits.write, user.id);
    const data = await body(c);
    const existing = home.items.get(user.id, c.req.param('id'));
    if (existing.householdId !== householdId) throw new HttpError(404, 'not_found');
    const attachments =
      data.attachmentIds === undefined
        ? undefined
        : ownUploads(user.id, householdId, ids(data.attachmentIds, 'attachmentIds'), existing.props.attachments.map((a) => a.fileId));
    if (data.private !== undefined && existing.ownerId !== user.id) throw new HttpError(403, 'forbidden');
    const item = store.mutate(householdId, (h) =>
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

  app.delete('/api/households/:hid/items/:id', (c) => {
    const { user, householdId, home } = requireMember(c);
    const existing = home.items.get(user.id, c.req.param('id'));
    if (existing.householdId !== householdId) throw new HttpError(404, 'not_found');
    const removed = store.mutate(householdId, (h) => h.items.remove(user.id, existing.id));
    for (const a of removed.props.attachments) {
      const stillUsed =
        home.items.referencing(householdId, a.fileId).length > 0 ||
        db.prepare('SELECT 1 FROM messages WHERE file_id = ?').get(a.fileId);
      if (!stillUsed) files.remove(a.fileId);
    }
    hub.publish(householdId, { type: 'changed', area: 'library' });
    return c.json({ ok: true });
  });

  // ── Bills & money ────────────────────────────────────────────────────
  function moneyView(home: HomeApp, userId: string, householdId: string) {
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
      members: members(home, householdId, auth),
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

  app.get('/api/households/:hid/money', (c) => {
    const { user, householdId, home } = requireMember(c);
    return c.json(moneyView(home, user.id, householdId));
  });

  app.post('/api/households/:hid/bills', async (c) => {
    const { user, householdId, home } = requireMember(c);
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
    const bill = store.mutate(householdId, (h) => h.finance.recordBill(user.id, householdId, input));
    moneyChanged(householdId);
    if (bill.props.shared) {
      insertSystem(householdId, {
        key: 'billAdded',
        params: { name: user.name, label: bill.label, amount: bill.props.amount, currency: bill.props.currency, date: bill.props.dueDate },
      });
    }
    return c.json(moneyView(store.get(householdId)!, user.id, householdId), 201);
  });

  app.post('/api/households/:hid/bills/:id/pay', async (c) => {
    const { user, householdId, home } = requireMember(c);
    const data = await body(c).catch(() => ({}) as Record<string, unknown>);
    const bill = home.platform.graph.getNode<BillProps>(c.req.param('id'));
    if (!bill || bill.type !== 'bill' || bill.householdId !== householdId || !home.platform.acl.canRead(user.id, bill)) {
      throw new HttpError(404, 'not_found');
    }
    const payerId = data.payerId === undefined ? user.id : memberSubset(home, householdId, [data.payerId], 'payerId')![0]!;
    store.mutate(householdId, (h) => h.finance.payBill(user.id, bill.id, payerId));
    moneyChanged(householdId);
    if (bill.props.shared) {
      const payer = payerId === user.id ? user.name : (home.platform.graph.getNode(payerId)?.label ?? '?');
      insertSystem(householdId, {
        key: 'billPaid',
        params: { actor: user.name, payer, label: bill.label, amount: bill.props.amount, currency: bill.props.currency },
      });
    }
    return c.json(moneyView(home, user.id, householdId));
  });

  app.post('/api/households/:hid/bills/:id/unpay', (c) => {
    const { user, householdId, home } = requireMember(c);
    const bill = home.platform.graph.getNode<BillProps>(c.req.param('id'));
    if (!bill || bill.type !== 'bill' || bill.householdId !== householdId || !home.platform.acl.canRead(user.id, bill)) {
      throw new HttpError(404, 'not_found');
    }
    store.mutate(householdId, (h) => h.finance.unpayBill(user.id, bill.id));
    moneyChanged(householdId);
    return c.json(moneyView(home, user.id, householdId));
  });

  app.post('/api/households/:hid/expenses', async (c) => {
    const { user, householdId, home } = requireMember(c);
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
    store.mutate(householdId, (h) => h.finance.recordExpense(user.id, householdId, input));
    if (shared) moneyChanged(householdId);
    return c.json(moneyView(home, user.id, householdId), 201);
  });

  app.post('/api/households/:hid/settlements', async (c) => {
    const { user, householdId, home } = requireMember(c);
    limit(limits.write, user.id);
    const data = await body(c);
    const [from] = memberSubset(home, householdId, [data.from], 'from')!;
    const [to] = memberSubset(home, householdId, [data.to], 'to')!;
    if (from === to) throw bad('to_invalid');
    const value = amount(data.amount);
    store.mutate(householdId, (h) => h.finance.recordSettlement(user.id, householdId, { from: from!, to: to!, amount: value }));
    moneyChanged(householdId);
    const nameOf = (id: string) => home.platform.graph.getNode(id)?.label ?? '?';
    const currency = String(home.platform.graph.requireNode(householdId).props.currency);
    insertSystem(householdId, { key: 'settled', params: { actor: user.name, from: nameOf(from!), to: nameOf(to!), amount: value, currency } });
    return c.json(moneyView(home, user.id, householdId), 201);
  });

  app.delete('/api/households/:hid/money/:id', (c) => {
    const { user, householdId, home } = requireMember(c);
    const node = home.platform.graph.getNode(c.req.param('id'));
    if (!node || node.householdId !== householdId || !home.platform.acl.canRead(user.id, node)) throw new HttpError(404, 'not_found');
    store.mutate(householdId, (h) => h.finance.remove(user.id, node.id));
    moneyChanged(householdId);
    return c.json(moneyView(home, user.id, householdId));
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

function members(home: HomeApp, householdId: string, auth: Auth) {
  const list = home.platform.acl.members(householdId);
  const avatars = auth.avatars(list.map((m) => m.userId));
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
