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
import { COLLECTIONS, RENTAL_DOCS } from '../src/modules/items.js';
import { zip } from './zip.js';
import { Auth, AuthError, RateLimiter, newInviteCode, newToken, normalizeInviteCode, sha256, type User } from './auth.js';
import { openPostgresUrl, openSqlite, type Database } from './database.js';
import { FileStore, MAX_UPLOAD_BYTES, type StoredFile } from './files.js';
import { RealtimeHub } from './realtime.js';
import { clearSamples, hasRealContent, hasSamples, seedSamples } from './seed.js';
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
/** Other accounts signed in on this browser (session tokens, dot-separated), for quick switching. */
const OTHERS_COOKIE = 'sids';
const MAX_ACCOUNTS = 5;
const INVITE_DAYS = 7;
const CODE_DAYS = 30;
const RESIDENT_ROLES: Role[] = ['owner', 'manager', 'family_member', 'tenant', 'child'];
/** Who can invite people, let them in and remove residents. */
const MANAGER_ROLES: Role[] = ['owner', 'manager'];
const GUEST_DAYS = [1, 3, 7, 14, 30, 90];
/** Built-in stickers (the app draws them; captions are translated). */
const STICKERS = ['thanks', 'love', 'haha', 'ok', 'on_my_way', 'dinner', 'cleaning', 'paid', 'sorry', 'good_night', 'party', 'coffee'] as const;

type Env = { Variables: { user?: User } };

const EXPORT_README = `MATE — export of one home
data.json   everything as JSON: the home, members, chat, library, bills and money, and the home log
files/      photos and documents from the chat and the library

Private items belonging to other people are not included.
`;

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
    joinFail: new RateLimiter(10, 15 * 60_000), // wrong links or codes, per account
    joinFailIp: new RateLimiter(30, 15 * 60_000), // … and per IP (a shared Wi‑Fi has several people)
    loginEmail: new RateLimiter(30, 15 * 60_000), // one account tried from many places
    export: new RateLimiter(10, 60 * 60_000),
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
    if (!home || !role || (await guestExpired(home, householdId, user.id))) throw new HttpError(404, 'not_found');
    touch(householdId, user.id); // any request to the home counts as activity
    return { user, householdId, home, role };
  };
  /** A guest whose time is up is taken out of the home the next time anything looks. */
  const guestExpired = async (home: HomeApp, householdId: string, userId: string) => {
    const m = home.platform.membership(householdId, userId);
    if (m?.role !== 'guest' || !m.expiresAt || m.expiresAt > new Date().toISOString()) return false;
    await store.removeMember(householdId, userId);
    hub.kick(householdId, userId);
    hub.publish(householdId, { type: 'changed', area: 'members' });
    await logEvent(householdId, 'guest_expired', 'members', { subject: { id: userId, name: home.platform.graph.getNode(userId)?.label ?? '' } });
    return true;
  };
  const guestUntil = (days: number | null | undefined) => (days ? new Date(Date.now() + days * 86_400_000).toISOString() : undefined);
  const guestDays = (v: unknown) => {
    if (v === undefined || v === null || v === '') return undefined;
    const n = Number(v);
    if (!GUEST_DAYS.includes(n)) throw bad('guestDays_invalid');
    return n;
  };
  const requireOwner = async (c: Context<Env>) => {
    const m = await requireMember(c);
    if (m.role !== 'owner') throw new HttpError(403, 'owner_only');
    return m;
  };
  // ── Home inbox: a record of what happened, also the owner's home log ──
  // 'members' events (joins, leaving, roles) are seen by everyone in the
  // home; 'managers' events (requests, invites) only by those who manage it.
  type EventAudience = 'members' | 'managers';
  let lastEventAt = 0;
  const logEvent = async (
    householdId: string,
    kind: string,
    audience: EventAudience,
    who: { actor?: User | { id: string; name: string } | null; subject?: { id: string; name: string } | null; data?: Record<string, unknown> } = {},
  ) => {
    const data = { ...who.data, actorName: who.actor?.name ?? null, subjectName: who.subject?.name ?? null };
    // Strictly increasing times keep the order exact even within one millisecond.
    lastEventAt = Math.max(Date.now(), lastEventAt + 1);
    await db.run(
      'INSERT INTO household_events (id, household_id, kind, audience, actor_id, subject_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      `ev_${randomUUID()}`, householdId, kind, audience, who.actor?.id ?? null, who.subject?.id ?? null, JSON.stringify(data), new Date(lastEventAt).toISOString(),
    );
    hub.publish(householdId, { type: 'changed', area: 'inbox' });
  };
  const cookieOpts = (c: Context, expires?: Date) => ({ httpOnly: true, secure: isHttps(c), sameSite: 'Lax' as const, path: '/', expires });
  const otherTokens = (c: Context) =>
    (getCookie(c, OTHERS_COOKIE) ?? '')
      .split('.')
      .filter((t) => /^[A-Za-z0-9_-]{20,100}$/.test(t))
      .slice(0, MAX_ACCOUNTS);
  const setOthers = (c: Context, tokens: string[]) => {
    if (tokens.length) setCookie(c, OTHERS_COOKIE, tokens.join('.'), cookieOpts(c, new Date(Date.now() + 30 * 86_400_000)));
    else deleteCookie(c, OTHERS_COOKIE, { path: '/' });
  };
  /** Accounts on this browser other than the active one; stale sessions are dropped. */
  const otherAccounts = async (c: Context, except?: string) => {
    const out: { token: string; user: User }[] = [];
    for (const token of otherTokens(c)) {
      const user = await auth.userForSession(token);
      if (user && user.id !== except && !out.some((o) => o.user.id === user.id)) out.push({ token, user });
    }
    return out;
  };
  /**
   * Sign someone in. With `keep`, whoever was signed in stays available on
   * this browser for quick switching (up to five accounts).
   */
  const startSession = async (c: Context<Env>, user: User, keep = false) => {
    const current = getCookie(c, SESSION_COOKIE);
    const currentUser = c.get('user');
    let others = keep ? await otherAccounts(c, user.id) : [];
    if (keep && current && currentUser && currentUser.id !== user.id) others = [{ token: current, user: currentUser }, ...others];
    else if (current && !keep) await auth.destroySession(current);
    if (others.length >= MAX_ACCOUNTS) throw bad('too_many_accounts');
    const { token, expiresAt } = await auth.createSession(user.id);
    setCookie(c, SESSION_COOKIE, token, cookieOpts(c, expiresAt));
    if (keep) setOthers(c, others.map((o) => o.token));
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
    // Check there's room for another account on this browser before creating one.
    if (data.add === true && c.get('user') && (await otherAccounts(c, c.get('user')!.id)).length + 1 >= MAX_ACCOUNTS) throw bad('too_many_accounts');
    const user = await auth.signup({ email: data.email, password: data.password, name: data.name, avatar: data.avatar });
    await startSession(c, user, data.add === true);
    return c.json({ user }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const data = await body(c);
    limit(limits.loginIp, ip(c));
    limit(limits.login, `${ip(c)}|${String(data.email ?? '').toLowerCase()}`);
    limit(limits.loginEmail, String(data.email ?? '').trim().toLowerCase());
    const user = await auth.login({ email: data.email, password: data.password });
    await startSession(c, user, data.add === true);
    return c.json({ user });
  });

  // ── Several accounts on one browser ──────────────────────────────────
  app.get('/api/accounts', async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ accounts: [] });
    const others = await otherAccounts(c, user.id);
    return c.json({ accounts: [{ ...user, active: true }, ...others.map((o) => ({ ...o.user, active: false }))] });
  });

  app.post('/api/accounts/switch', async (c) => {
    const current = getCookie(c, SESSION_COOKIE);
    const currentUser = requireUser(c);
    const to = String((await body(c)).userId ?? '');
    const others = await otherAccounts(c, currentUser.id);
    const target = others.find((o) => o.user.id === to);
    if (!target) throw new HttpError(404, 'not_found');
    // Swap: the chosen account becomes active, the current one waits in the list.
    setCookie(c, SESSION_COOKIE, target.token, cookieOpts(c, new Date(Date.now() + 30 * 86_400_000)));
    setOthers(c, [current!, ...others.filter((o) => o !== target).map((o) => o.token)]);
    return c.json({ user: target.user });
  });

  /** Sign one account out of this browser without touching the active one. */
  app.delete('/api/accounts/:uid', async (c) => {
    const currentUser = requireUser(c);
    const others = await otherAccounts(c, currentUser.id);
    const target = others.find((o) => o.user.id === c.req.param('uid'));
    if (!target) throw new HttpError(404, 'not_found');
    await auth.destroySession(target.token);
    setOthers(c, others.filter((o) => o !== target).map((o) => o.token));
    return c.json({ ok: true });
  });

  /** Sign out the active account; another account on this browser, if any, takes over. */
  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await auth.destroySession(token);
    const others = await otherAccounts(c, c.get('user')?.id);
    const [next, ...rest] = others;
    if (next) {
      setCookie(c, SESSION_COOKIE, next.token, cookieOpts(c, new Date(Date.now() + 30 * 86_400_000)));
      setOthers(c, rest.map((o) => o.token));
      return c.json({ ok: true, switchedTo: next.user });
    }
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    deleteCookie(c, OTHERS_COOKIE, { path: '/' });
    return c.json({ ok: true, switchedTo: null });
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
    if (!user) return c.json({ user: null, households: [], requests: [], config });
    const households = [];
    for (const h of await store.householdsOf(user.id)) {
      const home = h.role === 'guest' ? await store.get(h.id) : undefined;
      if (home && (await guestExpired(home, h.id, user.id))) continue;
      households.push(h);
    }
    return c.json({ user, households, requests: await myRequests(user.id), config });
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
      me: { id: user.id, role, expiresAt: home.platform.membership(householdId, user.id)?.expiresAt ?? null },
      roles: role === 'owner' ? memberRoles(home, householdId) : [],
      guestDays: GUEST_DAYS,
      members: await members(home, householdId, auth),
      hasSamples: hasSamples(home, householdId),
      canInvite: MANAGER_ROLES.includes(role),
      approveJoins: node.props.approveJoins !== false,
      chatName: (node.props.chatName as string | undefined) ?? null,
      canDelete: role === 'owner' && (await deletable(home, householdId)),
      unreadInbox: await unreadCount(user.id, householdId, role),
      pendingRequests:
        MANAGER_ROLES.includes(role)
          ? Number((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM join_requests WHERE household_id = ? AND status = 'pending'", householdId))?.n ?? 0)
          : 0,
    });
  });

  /**
   * A home can be deleted by its owner only while it is theirs alone and
   * holds nothing real — e.g. a home made by mistake before joining a friend's.
   */
  const deletable = async (home: HomeApp, householdId: string) => {
    if (home.platform.acl.members(householdId).length !== 1 || hasRealContent(home, householdId)) return false;
    const messages = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE household_id = ? AND user_id IS NOT NULL', householdId);
    const uploads = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM files WHERE household_id = ?', householdId);
    return Number(messages?.n) === 0 && Number(uploads?.n) === 0;
  };

  app.delete('/api/households/:hid', async (c) => {
    const { householdId, home } = await requireOwner(c);
    await store.withLock(householdId, async () => {
      if (!(await deletable(home, householdId))) throw bad('home_not_empty');
      await store.remove(householdId);
    });
    return c.json({ ok: true });
  });

  /** Owners and managers name the group chat (empty = the home's name). */
  app.patch('/api/households/:hid/chat', async (c) => {
    const { user, householdId, home } = await requireManager(c);
    const name = str((await body(c)).name, { max: 60, field: 'name' }) ?? null;
    const before = (home.platform.graph.requireNode(householdId).props.chatName as string | undefined) ?? null;
    if (name === before) return c.json({ chatName: name });
    await store.mutate(householdId, (h) => h.platform.graph.updateNode(householdId, { chatName: name ?? undefined }));
    hub.publish(householdId, { type: 'changed', area: 'household' });
    await insertSystem(householdId, { key: 'chatRenamed', params: { actor: user.name, name: name ?? nameOfHome(home, householdId) } });
    await logEvent(householdId, 'chat_renamed', 'members', { actor: user, data: { label: name } });
    return c.json({ chatName: name });
  });

  app.patch('/api/households/:hid', async (c) => {
    const { user, householdId } = await requireOwner(c);
    const data = await body(c);
    if (data.approveJoins !== undefined) {
      const approveJoins = bool(data.approveJoins, true);
      await store.mutate(householdId, (h) => h.platform.graph.updateNode(householdId, { approveJoins }));
      await logEvent(householdId, approveJoins ? 'approval_on' : 'approval_off', 'managers', { actor: user });
    }
    hub.publish(householdId, { type: 'changed', area: 'household' });
    return c.json({ ok: true });
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
    const { user, householdId, role, home } = await requireMember(c);
    const target = c.req.param('uid');
    const targetRole = await store.roleOf(householdId, target);
    if (!targetRole) throw new HttpError(404, 'not_found');
    // The last owner can't leave: they hand the home over first (or delete an empty one).
    if (targetRole === 'owner' && owners(home, householdId).length === 1) throw bad(target === user.id ? 'owner_cannot_leave' : 'last_owner');
    // Owners remove anyone; managers remove residents and guests, not other managers or owners.
    if (target !== user.id && !(role === 'owner' || (role === 'manager' && !MANAGER_ROLES.includes(targetRole)))) {
      throw new HttpError(403, 'owner_only');
    }
    const subject = { id: target, name: (await auth.getUser(target))?.name ?? '' };
    await store.removeMember(householdId, target);
    hub.kick(householdId, target);
    hub.publish(householdId, { type: 'changed', area: 'members' });
    if (target === user.id) await logEvent(householdId, 'member_left', 'members', { subject });
    else await logEvent(householdId, 'member_removed', 'members', { actor: user, subject });
    return c.json({ ok: true });
  });

  // ── Roles ────────────────────────────────────────────────────────────
  const owners = (home: HomeApp, householdId: string) => home.platform.acl.members(householdId).filter((m) => m.role === 'owner');
  /** Every role an owner can give someone already in the home. */
  const memberRoles = (home: HomeApp, householdId: string): Role[] => ['owner', ...joinRoles(home, householdId, 'owner')];

  app.patch('/api/households/:hid/members/:uid', async (c) => {
    const { user, householdId, home } = await requireOwner(c);
    const target = c.req.param('uid');
    const from = home.platform.acl.roleOf(target, householdId);
    if (!from) throw new HttpError(404, 'not_found');
    const data = await body(c);
    const to = data.role === undefined ? from : (data.role as Role);
    if (!memberRoles(home, householdId).includes(to)) throw bad('role_invalid');
    // A home always keeps at least one owner.
    if (from === 'owner' && to !== 'owner' && owners(home, householdId).length === 1) throw bad('last_owner');
    const days = to === 'guest' ? (guestDays(data.guestDays) ?? 7) : undefined;
    await store.setRole(householdId, target, to, guestUntil(days));
    hub.publish(householdId, { type: 'changed', area: 'members' });
    const subject = { id: target, name: home.platform.graph.getNode(target)?.label ?? '' };
    if (from !== to || days) await logEvent(householdId, 'role_changed', 'members', { actor: user, subject, data: { from, role: to, days: days ?? null } });
    return c.json({ ok: true });
  });

  /** Hand the home over: the other person becomes owner, you become a manager. */
  app.post('/api/households/:hid/transfer', async (c) => {
    const { user, householdId, home } = await requireOwner(c);
    const to = String((await body(c)).to ?? '');
    const role = home.platform.acl.roleOf(to, householdId);
    if (!role || to === user.id) throw bad('to_invalid');
    if (role === 'guest') throw bad('guest_cannot_own');
    await store.setRole(householdId, to, 'owner');
    await store.setRole(householdId, user.id, 'manager');
    hub.publish(householdId, { type: 'changed', area: 'members' });
    await logEvent(householdId, 'owner_transferred', 'members', { actor: user, subject: { id: to, name: home.platform.graph.getNode(to)?.label ?? '' } });
    return c.json({ ok: true });
  });

  /** The owner's home log: everything that happened, newest first. */
  app.get('/api/households/:hid/log', async (c) => {
    const { user, householdId } = await requireOwner(c);
    const rows = await db.all<EventRow>('SELECT * FROM household_events WHERE household_id = ? ORDER BY created_at DESC LIMIT 500', householdId);
    return c.json({ events: rows.map((r) => eventDto(r, user.id, '\uffff')) });
  });

  // ── Invites and join requests ────────────────────────────────────────
  // Nobody can find a home they weren't given (there is no search by name).
  //  - Personal invite links: one per person, single use, with a role and an
  //    expiry, cancellable. While the home asks for approval (the default),
  //    using a link files a request; otherwise it joins straight away.
  //  - One shared short code per home: easy to read out, so it only ever asks
  //    to join, and wrong guesses lock out after a few tries.
  type InviteRow = {
    id: string | null; kind: string; household_id: string; created_by: string; created_at: string; expires_at: string;
    revoked: number; role: string | null; label: string | null; token: string | null; code: string | null; used_by: string | null; used_at: string | null;
    guest_days?: number | null;
  };
  const now = () => new Date().toISOString();
  const inviteStatus = (row: InviteRow) =>
    row.used_by ? 'used' : Number(row.revoked) ? 'revoked' : row.expires_at < now() ? 'expired' : 'pending';
  /** Roles a newcomer can be given. */
  /** Roles someone can be given; only an owner hands out the manager role. */
  const joinRoles = (home: HomeApp, householdId: string, actorRole: Role = 'owner'): Role[] => [
    ...((home.platform.graph.requireNode(householdId).props.kind === 'family' ? ['family_member', 'child'] : ['tenant']) as Role[]),
    ...(actorRole === 'owner' ? (['manager'] as Role[]) : []),
    'guest',
  ];
  const pickRole = (home: HomeApp, householdId: string, wanted: unknown, actorRole: Role = 'owner'): Role => {
    const roles = joinRoles(home, householdId, actorRole);
    if (wanted === undefined || wanted === null || wanted === '') return roles[0]!;
    if (!roles.includes(wanted as Role)) throw bad('role_invalid');
    return wanted as Role;
  };
  const requireManager = async (c: Context<Env>) => {
    const m = await requireMember(c);
    if (!MANAGER_ROLES.includes(m.role)) throw new HttpError(403, 'owner_only');
    return m;
  };
  const needsApproval = (home: HomeApp, householdId: string) => home.platform.graph.requireNode(householdId).props.approveJoins !== false;
  const nameOfHome = (home: HomeApp, householdId: string) => home.platform.graph.requireNode(householdId).label;
  const nameOf = (home: HomeApp, id: string | null) => (id ? (home.platform.graph.getNode(id)?.label ?? '') : '');
  const codeDto = (row: InviteRow) => ({ code: `${row.code!.slice(0, 4)}-${row.code!.slice(4)}`, expiresAt: row.expires_at });
  const linkDto = (c: Context, home: HomeApp, row: InviteRow, requests?: Map<string, string>, names?: Map<string, string>) => {
    const status = inviteStatus(row);
    // A used link: did that person get in, are they still waiting, or were they turned down?
    const request = row.used_by ? requests?.get(row.used_by) : undefined;
    const outcome =
      status !== 'used' ? null : home.platform.acl.roleOf(row.used_by!, row.household_id) ? 'accepted' : request === 'pending' ? 'waiting' : request === 'declined' ? 'declined' : 'left';
    return {
      outcome,
      id: row.id,
      label: row.label ?? '',
      role: row.role,
      guestDays: row.guest_days ?? null,
      status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      invitedBy: nameOf(home, row.created_by),
      usedBy: row.used_by ? nameOf(home, row.used_by) || names?.get(row.used_by) || null : null,
      usedAt: row.used_at,
      url: status === 'pending' && row.token ? `${origin(c)}/join/${row.token}` : null,
    };
  };

  app.get('/api/households/:hid/invites', async (c) => {
    const { householdId, home, role: actorRole } = await requireManager(c);
    const rows = await db.all<InviteRow>('SELECT * FROM invites WHERE household_id = ? AND id IS NOT NULL ORDER BY created_at DESC LIMIT 50', householdId);
    const code = rows.find((r) => r.kind === 'code' && inviteStatus(r) === 'pending');
    const requests = new Map<string, string>();
    for (const r of await db.all<{ user_id: string; status: string }>('SELECT user_id, status FROM join_requests WHERE household_id = ? ORDER BY created_at', householdId)) {
      requests.set(r.user_id, r.status);
    }
    // People who used a link but aren't (or are no longer) members still have a name.
    const names = new Map<string, string>();
    for (const r of await db.all<{ id: string; name: string }>(
      "SELECT u.id, u.name FROM users u JOIN invites i ON i.used_by = u.id WHERE i.household_id = ? AND i.kind = 'link'",
      householdId,
    )) {
      names.set(r.id, r.name);
    }
    return c.json({
      code: code ? codeDto(code) : null,
      links: rows.filter((r) => r.kind === 'link').map((r) => linkDto(c, home, r, requests, names)),
      roles: joinRoles(home, householdId, actorRole),
      guestDays: GUEST_DAYS,
      approveJoins: needsApproval(home, householdId),
    });
  });

  app.post('/api/households/:hid/invites', async (c) => {
    const { user, householdId, home, role: actorRole } = await requireManager(c);
    limit(limits.write, user.id);
    const data = await body(c);
    const role = pickRole(home, householdId, data.role, actorRole);
    const days = role === 'guest' ? (guestDays(data.guestDays) ?? 7) : null;
    const label = str(data.label, { max: 60, field: 'label' }) ?? null;
    const pending = await db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM invites WHERE household_id = ? AND kind = 'link' AND revoked = 0 AND used_by IS NULL AND expires_at > ?",
      householdId,
      now(),
    );
    if (Number(pending?.n) >= 30) throw bad('too_many_invites');
    const token = newToken();
    const row: InviteRow = {
      id: `inv_${randomUUID()}`, kind: 'link', household_id: householdId, created_by: user.id, created_at: now(),
      expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(), revoked: 0, role, label, token, code: null, used_by: null, used_at: null,
    };
    await db.run(
      'INSERT INTO invites (token_hash, id, kind, household_id, created_by, created_at, expires_at, role, label, token, guest_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      sha256(token), row.id, 'link', householdId, user.id, row.created_at, row.expires_at, role, label, token, days,
    );
    await logEvent(householdId, 'invite_created', 'managers', { actor: user, data: { label, role } });
    return c.json(linkDto(c, home, row), 201);
  });

  app.delete('/api/households/:hid/invites/:id', async (c) => {
    const { user, householdId } = await requireManager(c);
    const r = await db.run('UPDATE invites SET revoked = 1, token = NULL WHERE household_id = ? AND id = ? AND used_by IS NULL', householdId, c.req.param('id'));
    if (!r.changes) throw new HttpError(404, 'not_found');
    const label = (await db.get<{ label: string | null }>('SELECT label FROM invites WHERE id = ?', c.req.param('id')))?.label ?? null;
    await logEvent(householdId, 'invite_revoked', 'managers', { actor: user, data: { label } });
    return c.json({ ok: true });
  });

  /** Make (or remake) the shared code; the previous one stops working. */
  app.post('/api/households/:hid/code', async (c) => {
    const { user, householdId } = await requireManager(c);
    limit(limits.write, user.id);
    const code = newInviteCode();
    const row = { created_at: now(), expires_at: new Date(Date.now() + CODE_DAYS * 86_400_000).toISOString() };
    await db.transaction(async (tx) => {
      await tx.run("UPDATE invites SET revoked = 1, code = NULL WHERE household_id = ? AND kind = 'code'", householdId);
      await tx.run(
        'INSERT INTO invites (token_hash, id, kind, household_id, created_by, created_at, expires_at, code, code_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        sha256(`code:${newToken()}`), `inv_${randomUUID()}`, 'code', householdId, user.id, row.created_at, row.expires_at, code, sha256(code),
      );
    });
    await logEvent(householdId, 'code_created', 'managers', { actor: user });
    return c.json({ code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: row.expires_at }, 201);
  });

  app.delete('/api/households/:hid/code', async (c) => {
    const { user, householdId } = await requireManager(c);
    await db.run("UPDATE invites SET revoked = 1, code = NULL WHERE household_id = ? AND kind = 'code'", householdId);
    await logEvent(householdId, 'code_revoked', 'managers', { actor: user });
    return c.json({ ok: true });
  });

  // Wrong links and codes are counted per account and per IP; after too many
  // the door stays shut for a while, so codes can't be guessed by trying.
  const guard = (c: Context<Env>) => {
    const user = c.get('user');
    const checks: [RateLimiter, string][] = [[limits.joinFailIp, ip(c)], ...(user ? [[limits.joinFail, user.id] as [RateLimiter, string]] : [])];
    if (checks.some(([l, k]) => l.blocked(k))) throw new HttpError(429, 'too_many_attempts');
    return { fail: () => checks.forEach(([l, k]) => l.take(k)) };
  };
  /** Look up a link or code. Used links are returned (the person who used it may come back). */
  const findInvite = async (c: Context<Env>, by: { token?: string; code?: string }) => {
    const g = guard(c);
    let row: InviteRow | undefined;
    if (by.token && /^[A-Za-z0-9_-]{20,100}$/.test(by.token)) {
      row = await db.get<InviteRow>("SELECT * FROM invites WHERE token_hash = ? AND kind = 'link'", sha256(by.token));
    } else if (by.code) {
      row = await db.get<InviteRow>("SELECT * FROM invites WHERE code_hash = ? AND kind = 'code' AND revoked = 0", sha256(by.code));
    }
    const status = row && inviteStatus(row);
    const home = row && (await store.get(row.household_id));
    if (!row || !home || status === 'revoked' || status === 'expired' || !row.id) {
      g.fail();
      throw new HttpError(404, row && row.id ? 'invite_expired' : 'invite_invalid');
    }
    return { invite: row, home, status: status! };
  };

  const joinNow = async (user: User, householdId: string, home: HomeApp, role: Role, approvedBy?: User, days?: number | null) => {
    if (home.platform.acl.members(householdId).length >= 20) throw bad('household_full');
    await store.addMember(householdId, user, role, role === 'guest' ? guestUntil(days ?? 7) : undefined);
    await insertSystem(householdId, { key: 'joined', params: { name: user.name } });
    hub.publish(householdId, { type: 'changed', area: 'members' });
    await logEvent(householdId, 'member_joined', 'members', { actor: approvedBy ?? null, subject: user, data: { role, days: role === 'guest' ? (days ?? 7) : null } });
  };
  const latestRequest = (householdId: string, userId: string) =>
    db.get<{ id: string; status: string; decided_at: string | null }>(
      'SELECT id, status, decided_at FROM join_requests WHERE household_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1',
      householdId,
      userId,
    );
  const fileRequest = async (user: User, householdId: string, role: Role, via: string, label: string | null = null, days: number | null = null) => {
    const existing = await latestRequest(householdId, user.id);
    if (existing?.status === 'pending') return;
    if (existing?.status === 'declined' && existing.decided_at && Date.now() - Date.parse(existing.decided_at) < 86_400_000) {
      throw new HttpError(403, 'request_declined');
    }
    const pending = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM join_requests WHERE household_id = ? AND status = 'pending'", householdId);
    if (Number(pending?.n) >= 20) throw bad('too_many_requests');
    await db.run(
      'INSERT INTO join_requests (id, household_id, user_id, role, via, status, created_at, guest_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      `jr_${randomUUID()}`, householdId, user.id, role, via, 'pending', now(), days,
    );
    hub.publish(householdId, { type: 'changed', area: 'requests' });
    await logEvent(householdId, 'join_requested', 'managers', { subject: user, data: { via: via === 'code' ? 'code' : 'link', role, label } });
  };

  type JoinResult = { status: 'member' | 'joined' | 'pending'; householdId?: string; householdName: string };
  /** Use a link or code. */
  const useInvite = async (user: User, found: Awaited<ReturnType<typeof findInvite>>, c: Context<Env>): Promise<JoinResult> => {
    const { invite, home } = found;
    const householdId = invite.household_id;
    const householdName = nameOfHome(home, householdId);
    if (home.platform.acl.roleOf(user.id, householdId)) return { status: 'member', householdId, householdName };
    if (invite.kind === 'code') {
      await fileRequest(user, householdId, joinRoles(home, householdId)[0]!, 'code');
      return { status: 'pending', householdName };
    }
    if (found.status === 'used') {
      // Single use: only the person who used it gets anywhere with it again.
      if (invite.used_by === user.id && (await latestRequest(householdId, user.id))?.status === 'pending') return { status: 'pending', householdName };
      guard(c).fail();
      throw new HttpError(410, 'invite_used');
    }
    const role = (invite.role as Role | null) ?? joinRoles(home, householdId)[0]!;
    const approval = needsApproval(home, householdId);
    if (approval) await fileRequest(user, householdId, role, `link:${invite.id}`, invite.label, invite.guest_days ?? null);
    // Claim the link; if someone else claimed it a moment earlier, it's used.
    const claimed = await db.run('UPDATE invites SET used_by = ?, used_at = ?, token = NULL WHERE id = ? AND used_by IS NULL', user.id, now(), invite.id);
    if (!claimed.changes) throw new HttpError(410, 'invite_used');
    if (approval) return { status: 'pending', householdName };
    await joinNow(user, householdId, home, role, undefined, invite.guest_days);
    return { status: 'joined', householdId, householdName };
  };

  app.get('/api/invites/:token', async (c) => {
    limit(limits.invite, ip(c));
    const { invite, home, status } = await findInvite(c, { token: c.req.param('token') });
    const user = c.get('user');
    const member = Boolean(user && home.platform.acl.roleOf(user.id, invite.household_id));
    const mine = Boolean(user && invite.used_by === user.id);
    if (status === 'used' && !member && !mine) throw new HttpError(410, 'invite_used');
    // Only what someone holding the link needs to decide: no member list, no data.
    return c.json({
      householdName: nameOfHome(home, invite.household_id),
      inviterName: nameOf(home, invite.created_by),
      label: invite.label ?? '',
      needsApproval: needsApproval(home, invite.household_id),
      alreadyMember: member,
      householdId: member ? invite.household_id : undefined,
    });
  });

  app.post('/api/invites/:token/accept', async (c) => {
    const user = requireUser(c);
    limit(limits.invite, ip(c));
    return c.json(await useInvite(user, await findInvite(c, { token: c.req.param('token') }), c));
  });

  /** "Join with a link or code": one box that takes either. */
  app.post('/api/join', async (c) => {
    const user = requireUser(c);
    limit(limits.invite, ip(c));
    const raw = String((await body(c)).invite ?? '').trim().slice(0, 300);
    const token = /\/join\/([A-Za-z0-9_-]{20,100})/.exec(raw)?.[1] ?? (/^[A-Za-z0-9_-]{20,100}$/.test(raw) ? raw : undefined);
    const code = token ? undefined : normalizeInviteCode(raw);
    if (!token && !code) {
      guard(c).fail();
      throw bad('invite_invalid');
    }
    return c.json(await useInvite(user, await findInvite(c, { token, code }), c));
  });

  app.get('/api/households/:hid/requests', async (c) => {
    const { householdId, home, role: actorRole } = await requireManager(c);
    const rows = await db.all<{ id: string; user_id: string; role: string; via: string; created_at: string; name: string; email: string; avatar: string | null; guest_days: number | null }>(
      `SELECT r.id, r.user_id, r.role, r.via, r.created_at, r.guest_days, u.name, u.email, u.avatar FROM join_requests r JOIN users u ON u.id = r.user_id
       WHERE r.household_id = ? AND r.status = 'pending' ORDER BY r.created_at`,
      householdId,
    );
    const labels = new Map(
      (await db.all<{ id: string; label: string | null }>("SELECT id, label FROM invites WHERE household_id = ? AND kind = 'link'", householdId)).map((r) => [r.id, r.label]),
    );
    return c.json({
      roles: joinRoles(home, householdId, actorRole),
      guestDays: GUEST_DAYS,
      requests: rows.map((r) => ({
        guestDays: r.guest_days ?? null,
        id: r.id,
        name: r.name,
        email: r.email,
        avatar: r.avatar,
        role: r.role,
        via: r.via === 'code' ? 'code' : 'link',
        inviteLabel: r.via.startsWith('link:') ? (labels.get(r.via.slice(5)) ?? '') : '',
        createdAt: r.created_at,
      })),
    });
  });

  app.post('/api/households/:hid/requests/:rid/:decision', async (c) => {
    const { user, householdId, home, role: actorRole } = await requireManager(c);
    const decision = c.req.param('decision');
    if (decision !== 'approve' && decision !== 'decline') throw new HttpError(404, 'not_found');
    const data = await body(c).catch(() => ({}) as Record<string, unknown>);
    const row = await db.get<{ id: string; user_id: string; status: string; role: string; guest_days: number | null }>(
      'SELECT id, user_id, status, role, guest_days FROM join_requests WHERE id = ? AND household_id = ?',
      c.req.param('rid'),
      householdId,
    );
    if (!row || row.status !== 'pending') throw new HttpError(404, 'not_found');
    if (decision === 'approve') {
      const allowed = joinRoles(home, householdId, actorRole);
      const role = data.role === undefined ? (allowed.includes(row.role as Role) ? (row.role as Role) : allowed[0]!) : pickRole(home, householdId, data.role, actorRole);
      const days = role === 'guest' ? (guestDays(data.guestDays) ?? row.guest_days ?? 7) : null;
      const newcomer = await auth.getUser(row.user_id);
      if (!newcomer) throw new HttpError(404, 'not_found');
      if (!home.platform.acl.roleOf(newcomer.id, householdId)) await joinNow(newcomer, householdId, home, role, user, days);
    } else {
      await logEvent(householdId, 'request_declined', 'managers', { actor: user, subject: { id: row.user_id, name: (await auth.getUser(row.user_id))?.name ?? '' } });
    }
    await db.run(
      'UPDATE join_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?',
      decision === 'approve' ? 'approved' : 'declined',
      now(),
      user.id,
      row.id,
    );
    hub.publish(householdId, { type: 'changed', area: 'requests' });
    return c.json({ ok: true });
  });

  /**
   * The requester's own requests: waiting ones, and decisions they haven't
   * seen yet (so they're told when they're let in or turned down).
   */
  const myRequests = async (userId: string) => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const rows = await db.all<{ id: string; household_id: string; status: string; created_at: string; name: string }>(
      `SELECT r.id, r.household_id, r.status, r.created_at, h.name FROM join_requests r JOIN households h ON h.id = r.household_id
       WHERE r.user_id = ? AND (r.status = 'pending' OR (r.seen_at IS NULL AND r.decided_at > ?)) ORDER BY r.created_at DESC`,
      userId,
      weekAgo,
    );
    return rows.map((r) => ({
      id: r.id,
      householdName: r.name,
      householdId: r.status === 'approved' ? r.household_id : undefined,
      status: r.status as 'pending' | 'approved' | 'declined',
      createdAt: r.created_at,
    }));
  };

  /** Cancel a waiting request, or mark a decision as seen. */
  app.delete('/api/join-requests/:id', async (c) => {
    const user = requireUser(c);
    const row = await db.get<{ household_id: string; status: string }>('SELECT household_id, status FROM join_requests WHERE id = ? AND user_id = ?', c.req.param('id'), user.id);
    if (!row) throw new HttpError(404, 'not_found');
    if (row.status === 'pending') {
      await db.run('DELETE FROM join_requests WHERE id = ?', c.req.param('id'));
      hub.publish(row.household_id, { type: 'changed', area: 'requests' });
      await logEvent(row.household_id, 'request_cancelled', 'managers', { subject: user });
    } else {
      // A declined request stays on record (it blocks asking again for a day); it is just marked seen.
      await db.run('UPDATE join_requests SET seen_at = ? WHERE id = ?', now(), c.req.param('id'));
    }
    return c.json({ ok: true });
  });

  // ── Inbox ────────────────────────────────────────────────────────────
  type EventRow = { id: string; kind: string; audience: string; actor_id: string | null; subject_id: string | null; data: string; created_at: string };
  const eventDto = (r: EventRow, userId: string, since: string) => {
    const data = JSON.parse(r.data) as Record<string, unknown>;
    const mine = r.actor_id === userId || r.subject_id === userId;
    return {
      id: r.id,
      kind: r.kind,
      actorName: (data.actorName as string | null) ?? null,
      subjectName: (data.subjectName as string | null) ?? null,
      actorIsMe: r.actor_id === userId,
      subjectIsMe: r.subject_id === userId,
      label: (data.label as string | null) ?? null,
      role: (data.role as string | null) ?? null,
      from: (data.from as string | null) ?? null,
      days: (data.days as number | null) ?? null,
      via: (data.via as string | null) ?? null,
      createdAt: r.created_at,
      unread: !mine && r.created_at > since,
    };
  };
  const visibleEvents = (role: Role) => (MANAGER_ROLES.includes(role) ? ['members', 'managers'] : ['members']);
  const readAt = async (userId: string, householdId: string) =>
    (await db.get<{ read_at: string }>('SELECT read_at FROM inbox_reads WHERE user_id = ? AND household_id = ?', userId, householdId))?.read_at ?? '';
  const unreadCount = async (userId: string, householdId: string, role: Role) => {
    const audiences = visibleEvents(role);
    const row = await db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM household_events WHERE household_id = ? AND created_at > ? AND (actor_id IS NULL OR actor_id <> ?)
       AND (subject_id IS NULL OR subject_id <> ?) AND audience IN (${audiences.map(() => '?').join(', ')})`,
      householdId, await readAt(userId, householdId), userId, userId, ...audiences,
    );
    return Number(row?.n ?? 0);
  };

  app.get('/api/households/:hid/inbox', async (c) => {
    const { user, householdId, role } = await requireMember(c);
    const audiences = visibleEvents(role);
    const since = await readAt(user.id, householdId);
    const rows = await db.all<EventRow>(
      `SELECT * FROM household_events WHERE household_id = ? AND audience IN (${audiences.map(() => '?').join(', ')}) ORDER BY created_at DESC LIMIT 100`,
      householdId, ...audiences,
    );
    return c.json({
      readAt: since || null,
      events: rows.map((r) => eventDto(r, user.id, since)),
    });
  });

  app.post('/api/households/:hid/inbox/read', async (c) => {
    const { user, householdId } = await requireMember(c);
    const at = now();
    await db.run(
      'INSERT INTO inbox_reads (user_id, household_id, read_at) VALUES (?, ?, ?) ON CONFLICT (user_id, household_id) DO UPDATE SET read_at = excluded.read_at',
      user.id, householdId, at,
    );
    return c.json({ ok: true });
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

  // ── Export ───────────────────────────────────────────────────────────
  /**
   * Everything in the home the owner can see, as a ZIP (data.json + files) or
   * plain JSON. Other people's private items are never included.
   */
  app.get('/api/households/:hid/export', async (c) => {
    const { user, householdId, home } = await requireOwner(c);
    limit(limits.export, user.id);
    const node = home.platform.graph.requireNode(householdId);
    const rows = await db.all<MessageRow>('SELECT * FROM messages WHERE household_id = ? ORDER BY seq', householdId);
    const items = home.items.list(user.id, householdId);
    const fileIds = new Set<string>([
      ...rows.map((r) => r.file_id).filter((id): id is string => Boolean(id)),
      ...items.flatMap((i) => i.props.attachments.map((a) => a.fileId)),
    ]);
    const included: { id: string; path: string; file: StoredFile }[] = [];
    for (const id of fileIds) {
      const file = await files.get(id);
      if (!file || !(await canReadFile(user.id, file))) continue;
      included.push({ id, path: `files/${id.slice(0, 8)}-${file.name.replace(/[\\/:*?"<>|]/g, '_')}`, file });
    }
    const pathOf = (id: string | null | undefined) => (id ? (included.find((f) => f.id === id)?.path ?? null) : null);
    const log = await db.all<EventRow>('SELECT * FROM household_events WHERE household_id = ? ORDER BY created_at', householdId);
    const data = {
      app: 'MATE',
      format: 1,
      exportedAt: new Date().toISOString(),
      exportedBy: user.name,
      household: { id: householdId, name: node.label, currency: node.props.currency, kind: node.props.kind, approveJoins: node.props.approveJoins !== false },
      members: (await members(home, householdId, auth)).map((m) => ({ name: m.name, role: m.role, guestUntil: m.expiresAt })),
      messages: rows.map((r) => ({
        at: r.created_at,
        from: r.user_id ? (home.platform.graph.getNode(r.user_id)?.label ?? null) : null,
        text: r.text,
        system: r.meta ? JSON.parse(r.meta) : null,
        file: pathOf(r.file_id),
      })),
      library: items.map((i) => ({
        title: i.label,
        kind: i.props.kind,
        body: i.props.body ?? '',
        tags: i.props.tags,
        ...i.props.attributes,
        private: i.visibility === 'private',
        by: i.ownerId ? (home.platform.graph.getNode(i.ownerId)?.label ?? null) : null,
        createdAt: i.createdAt.toISOString(),
        updatedAt: i.updatedAt.toISOString(),
        files: i.props.attachments.map((a) => pathOf(a.fileId)).filter(Boolean),
      })),
      money: await moneyView(home, user.id, householdId),
      log: log.map((r) => ({ at: r.created_at, ...eventDto(r, user.id, '\uffff'), id: undefined, unread: undefined, actorIsMe: undefined, subjectIsMe: undefined })),
    };
    const stamp = new Date().toISOString().slice(0, 10);
    const slug =
      node.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'home';
    if (c.req.query('format') === 'json') {
      return new Response(JSON.stringify(data, null, 2), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="mate-${slug}-${stamp}.json"` },
      });
    }
    const entries: { name: string; data: Uint8Array }[] = [{ name: 'data.json', data: new TextEncoder().encode(JSON.stringify(data, null, 2)) }];
    for (const f of included) entries.push({ name: f.path, data: await files.read(f.file) });
    entries.push({ name: 'README.txt', data: new TextEncoder().encode(EXPORT_README) });
    const body = zip(entries);
    return new Response(body as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(body.byteLength),
        'Content-Disposition': `attachment; filename="mate-${slug}-${stamp}.zip"`,
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
    key: 'welcome' | 'joined' | 'billAdded' | 'billPaid' | 'settled' | 'chatRenamed';
    params?: Record<string, string | number | undefined>;
  }
  const insertSystem = (householdId: string, system: SystemMessage) => insertMessage(householdId, null, '', undefined, system);

  /** Numbers each household's messages 1, 2, 3… — serialised so two senders never get the same number. */
  /** `meta`: a system message's key and params, or a person's sticker ({ sticker }). */
  async function insertMessage(householdId: string, userId: string | null, text: string, fileId?: string, system?: SystemMessage | { sticker: string }) {
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
      system: row.meta && !row.user_id ? (JSON.parse(row.meta) as SystemMessage) : null,
      sticker: row.meta && row.user_id ? ((JSON.parse(row.meta) as { sticker?: string }).sticker ?? null) : null,
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
    const sticker = data.sticker === undefined ? undefined : oneOf(data.sticker, STICKERS, 'sticker');
    if (!text && !fileId && !sticker) throw bad('message_empty');
    if (fileId && !(await ownUploads(user.id, householdId, [fileId]))[0]!.mime.startsWith('image/')) throw bad('chat_images_only');
    return c.json(await insertMessage(householdId, user.id, sticker ? '' : text, sticker ? undefined : fileId, sticker ? { sticker } : undefined), 201);
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
  /** Collection and record details from a request; `existing` keeps what isn't sent. */
  const itemAttributes = (data: Record<string, unknown>, existing: Record<string, unknown> = {}) => {
    const out: Record<string, unknown> = { ...existing };
    const set = (key: string, value: unknown) => (value === undefined ? undefined : value === null || value === '' ? delete out[key] : (out[key] = value));
    if (data.collection !== undefined) set('collection', data.collection === null || data.collection === '' ? null : oneOf(data.collection, COLLECTIONS, 'collection'));
    if (data.docType !== undefined) set('docType', data.docType === null || data.docType === '' ? null : oneOf(data.docType, RENTAL_DOCS, 'docType'));
    if (data.date !== undefined) set('date', data.date === null || data.date === '' ? null : isoDate(data.date, 'date'));
    if (data.expiresOn !== undefined) set('expiresOn', data.expiresOn === null || data.expiresOn === '' ? null : isoDate(data.expiresOn, 'expiresOn'));
    if (data.amount !== undefined) set('amount', data.amount === null || data.amount === '' ? null : amount(data.amount));
    // Record details only make sense on rental records.
    if (out.collection !== 'rental') {
      delete out.docType;
      delete out.amount;
    }
    return out;
  };

  function itemDto(home: HomeApp, userId: string, householdId: string, item: GraphNode<HouseItemProps>) {
    const owner = home.platform.acl.roleOf(userId, householdId) === 'owner';
    const a = item.props.attributes ?? {};
    return {
      collection: (a.collection as string | undefined) ?? null,
      docType: (a.docType as string | undefined) ?? null,
      date: (a.date as string | undefined) ?? null,
      expiresOn: (a.expiresOn as string | undefined) ?? null,
      amount: (a.amount as number | undefined) ?? null,
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
    const collection = c.req.query('collection');
    const list = home.items.list(user.id, householdId, {
      q,
      tag,
      kind: kind ? oneOf(kind, ['note', 'document', 'photo', 'link'] as const, 'kind') : undefined,
      collection: collection ? oneOf(collection, COLLECTIONS, 'collection') : undefined,
    });
    const today = c.req.query('today') && /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('today')!) ? c.req.query('today')! : new Date().toISOString().slice(0, 10);
    return c.json({
      items: list.map((i) => itemDto(home, user.id, householdId, i)),
      tags: home.items.tags(user.id, householdId),
      collections: home.items.collections(user.id, householdId),
      expiring: home.items.expiring(user.id, householdId, today).map((i) => itemDto(home, user.id, householdId, i)),
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
        attributes: itemAttributes(data),
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
        attributes: ['collection', 'docType', 'date', 'expiresOn', 'amount'].some((k) => data[k] !== undefined) ? itemAttributes(data, existing.props.attributes) : undefined,
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
    const { user, householdId, home, role } = await requireMember(c);
    // Money is for the people who live here; guests don't see it.
    if (!RESIDENT_ROLES.includes(role)) throw new HttpError(403, 'forbidden');
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
    expiresAt: home.platform.membership(householdId, m.userId)?.expiresAt ?? null,
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
