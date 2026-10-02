import { serve } from '@hono/node-server';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './app.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const publicUrl = process.env.PUBLIC_URL?.replace(/\/$/, '');
const { app } = createServer({
  dataDir: process.env.DATA_DIR ?? join(root, 'data'),
  publicDir: process.env.PUBLIC_DIR ?? join(root, 'dist', 'public'),
  publicUrl,
  secureCookies: publicUrl?.startsWith('https://') ?? false,
  trustProxy: process.env.TRUST_PROXY === '1',
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '0.0.0.0' }, (info) => {
  console.log(`Homeapp Light listening on http://localhost:${info.port}`);
});
