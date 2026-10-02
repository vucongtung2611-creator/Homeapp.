import { serve } from '@hono/node-server';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './app.js';
import { openPostgresUrl } from './database.js';

// All configuration comes from the environment — no secrets live in the code.
//   DATABASE_URL   Postgres (e.g. Neon). Without it, a local SQLite file in DATA_DIR is used.
//   PUBLIC_URL     optional canonical https URL for invite links
//   TRUST_PROXY=1  behind a hosting proxy (Render, Koyeb, Fly…)
//   HOUSEHOLD_QUOTA_MB  upload space per home
//   PG_POOL_MAX    max Postgres connections (default 5)
//   CHAT_IDLE_MINUTES  hang up live chat after this much inactivity (default 3; e.g. 30 while filming)
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, '') || undefined;
const quotaMb = Number(process.env.HOUSEHOLD_QUOTA_MB);
const idleMinutes = Number(process.env.CHAT_IDLE_MINUTES);

const databaseUrl = process.env.DATABASE_URL || undefined;
const poolMax = Number(process.env.PG_POOL_MAX);
// Free hosts (Render sets RENDER, Cloud Run K_SERVICE) wipe the disk on every
// restart: without Postgres every account and message would silently
// disappear, so refuse to start instead.
const ephemeralHost = Boolean(process.env.RENDER || process.env.K_SERVICE);
if (ephemeralHost && !databaseUrl && process.env.ALLOW_EPHEMERAL_DATA !== '1') {
  console.error('DATABASE_URL is not set. This host has no lasting disk — add the Neon connection string first (see docs/DEPLOY.md).');
  process.exit(1);
}
const { app, db } = await createServer({
  dataDir: process.env.DATA_DIR ?? join(root, 'data'),
  db: databaseUrl ? await openPostgresUrl(databaseUrl, { max: poolMax > 0 ? poolMax : undefined }) : undefined,
  publicDir: process.env.PUBLIC_DIR ?? join(root, 'dist', 'public'),
  publicUrl,
  secureCookies: publicUrl?.startsWith('https://') ? true : undefined,
  trustProxy: process.env.TRUST_PROXY === '1',
  householdQuotaBytes: quotaMb > 0 ? quotaMb * 1024 * 1024 : undefined,
  chatIdleMs: idleMinutes > 0 ? idleMinutes * 60_000 : undefined,
});

const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '0.0.0.0' }, (info) => {
  console.log(`MATE listening on http://localhost:${info.port} (${db.dialect})`);
});

const shutdown = () => {
  server.close();
  void db.close().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
