import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from '../server/app.js';
import { openPostgres, type Database } from '../server/database.js';

/** TEST_DB=pglite runs the same server tests against real Postgres (PGlite, in-process). */
export async function testDatabase(): Promise<Database | undefined> {
  if (process.env.TEST_DB !== 'pglite') return undefined;
  const pg = new PGlite();
  return openPostgres({
    query: (text, params) => pg.query(text, params as unknown[]),
    withTransaction: (fn) => pg.transaction((tx) => fn({ query: (text, params) => tx.query(text, params as unknown[]) })),
    end: () => pg.close(),
  });
}

export async function testServer(options: { trustProxy?: boolean; dataDir?: string; db?: Database; chatIdleMs?: number } = {}) {
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'homeapp-test-'));
  const db = options.db ?? (await testDatabase());
  return { ...(await createServer({ dataDir, db, trustProxy: options.trustProxy, chatIdleMs: options.chatIdleMs })), dataDir };
}

export type Server = Awaited<ReturnType<typeof testServer>>;

/** A browser-like client: keeps its session cookie and sends the CSRF header. */
export class Client {
  cookie = '';
  readonly jar = new Map<string, string>();
  constructor(private readonly server: Server) {}

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const init: RequestInit = {
      method,
      headers: {
        'X-Requested-With': 'homeapp',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(body !== undefined && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : body instanceof Uint8Array ? (body as unknown as BodyInit) : JSON.stringify(body),
    };
    const res = await this.server.app.request(`http://localhost${path}`, init);
    // A tiny cookie jar: keeps every cookie the server sets, drops cleared ones.
    const set = res.headers.getSetCookie();
    for (const line of set) {
      const [pair, ...attrs] = line.split(';');
      const [name, ...v] = pair!.split('=');
      const value = v.join('=');
      const expired = !value || attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim()));
      if (expired) this.jar.delete(name!.trim());
      else this.jar.set(name!.trim(), value);
    }
    if (set.length) this.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const type = res.headers.get('content-type') ?? '';
    const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
    return { status: res.status, data: data as any, headers: res.headers };
  }

  get = (path: string) => this.req('GET', path);
  post = (path: string, body?: unknown) => this.req('POST', path, body ?? {});
  patch = (path: string, body: unknown) => this.req('PATCH', path, body);
  del = (path: string) => this.req('DELETE', path);

  async signup(name: string, email = `${name.toLowerCase()}@example.com`, password = 'correct horse battery') {
    const res = await this.post('/api/auth/signup', { name, email, password });
    if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.data)}`);
    return res.data.user as { id: string; name: string };
  }
}

export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

/** Owner creates a home; each other person gets a personal invite link and the owner lets them in. */
export async function houseOf(server: Server, names: string[], opts: { samples?: boolean; currency?: string } = {}) {
  const clients = names.map(() => new Client(server));
  const users = [];
  for (const [i, name] of names.entries()) users.push(await clients[i]!.signup(name));
  const owner = clients[0]!;
  const created = await owner.post('/api/households', { name: 'Nhà test', currency: opts.currency ?? 'VND', samples: opts.samples ?? false });
  const hid = created.data.id as string;
  for (const [i, c] of clients.slice(1).entries()) {
    const invite = await owner.post(`/api/households/${hid}/invites`, { label: names[i + 1] });
    const token = new URL(invite.data.url).pathname.split('/').pop()!;
    const used = await c.post(`/api/invites/${token}/accept`);
    if (used.data.status !== 'pending') throw new Error(`join failed: ${JSON.stringify(used.data)}`);
    const requests = (await owner.get(`/api/households/${hid}/requests`)).data.requests as { id: string }[];
    const approved = await owner.post(`/api/households/${hid}/requests/${requests[0]!.id}/approve`);
    if (approved.status !== 200) throw new Error(`approve failed: ${JSON.stringify(approved.data)}`);
  }
  return { hid, clients, users };
}

/** A fresh personal invite link (token only). */
export async function inviteToken(owner: Client, hid: string, body: Record<string, unknown> = {}) {
  const res = await owner.post(`/api/households/${hid}/invites`, body);
  if (res.status !== 201) throw new Error(`invite failed: ${JSON.stringify(res.data)}`);
  return { token: new URL(res.data.url).pathname.split('/').pop()!, url: res.data.url as string, id: res.data.id as string };
}
