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
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const sid = /sid=([^;]*)/.exec(setCookie)?.[1];
      this.cookie = sid ? `sid=${sid}` : '';
    }
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

/** Owner creates a home and the others join via the invite link. */
export async function houseOf(server: Server, names: string[], opts: { samples?: boolean; currency?: string } = {}) {
  const clients = names.map(() => new Client(server));
  const users = [];
  for (const [i, name] of names.entries()) users.push(await clients[i]!.signup(name));
  const created = await clients[0]!.post('/api/households', { name: 'Nhà test', currency: opts.currency ?? 'VND', samples: opts.samples ?? false });
  const hid = created.data.id as string;
  const invite = await clients[0]!.post(`/api/households/${hid}/invite`);
  const token = new URL(invite.data.url).pathname.split('/').pop()!;
  for (const c of clients.slice(1)) {
    const joined = await c.post(`/api/invites/${token}/accept`);
    if (joined.status !== 200) throw new Error(`join failed: ${JSON.stringify(joined.data)}`);
  }
  return { hid, clients, users, token };
}
