import { serve } from '@hono/node-server';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './app.js';
import { DEMO_PASSWORD, seedDemo, type DemoLang } from './demo.js';

// Try MATE on your own computer with a ready-made home — nothing goes online.
//   npm run try              Vietnamese demo data
//   npm run try -- --en      English demo data
//   npm run try -- --keep    keep what you did last time instead of starting fresh
// Data lives in ./demo-data and is wiped on each fresh start.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const lang: DemoLang = args.includes('--en') ? 'en' : 'vi';
const keep = args.includes('--keep');
const dataDir = join(root, 'demo-data');
const idleMinutes = Number(process.env.CHAT_IDLE_MINUTES) || 30; // long enough to film

if (!keep) rmSync(dataDir, { recursive: true, force: true });
const { app, db } = await createServer({
  dataDir,
  publicDir: join(root, 'dist', 'public'),
  chatIdleMs: idleMinutes * 60_000,
});

async function listen(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => resolve(info.port));
    server.on('error', (err: NodeJS.ErrnoException) => (err.code === 'EADDRINUSE' && port < 3010 ? resolve(listen(port + 1)) : reject(err)));
  });
}
const port = await listen(Number(process.env.PORT) || 3000);
const local = `http://localhost:${port}`;

let demo: Awaited<ReturnType<typeof seedDemo>> | undefined;
if (!keep || !(await db.get('SELECT 1 AS ok FROM users LIMIT 1'))) demo = await seedDemo(local, lang);

const lan = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

const vi = lang === 'vi';
console.log(`
  MATE ${vi ? 'đang chạy trên máy bạn' : 'is running on your computer'}
  ─────────────────────────────────────────────
  ${vi ? 'Mở' : 'Open'}:      ${local}
  ${lan ? `${vi ? 'Điện thoại cùng Wi‑Fi' : 'Phone on same Wi‑Fi'}: http://${lan}:${port}\n` : ''}`);
if (demo) {
  console.log(`  ${vi ? 'Nhà' : 'Home'}: ${demo.home}   ${vi ? 'Mật khẩu chung' : 'Password for all'}: ${DEMO_PASSWORD}`);
  for (const p of demo.people) console.log(`   • ${p.name.padEnd(6)} ${p.email}`);
} else {
  console.log(`  ${vi ? 'Giữ dữ liệu lần trước' : 'Kept your previous data'} — ${vi ? 'mật khẩu' : 'password'}: ${DEMO_PASSWORD}`);
}
console.log(`
  ${vi ? `Chat tự tạm ngắt sau ${idleMinutes} phút không thao tác.` : `Chat pauses after ${idleMinutes} min without activity.`}
  ${vi ? 'Tắt: bấm Ctrl + C.' : 'Stop: press Ctrl + C.'}
`);

if (!process.env.NO_OPEN) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : undefined;
  if (opener) spawn(opener, [`${local}/login`], { stdio: 'ignore', detached: true }).unref();
}

const shutdown = () => void db.close().finally(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
