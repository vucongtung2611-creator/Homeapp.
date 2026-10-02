// A throwaway local Postgres (PGlite over TCP) for trying the DATABASE_URL path
// without installing Postgres:  node scripts/pg-dev.mjs  →  then
//   DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres npm start
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number(process.env.PG_PORT ?? 5433);
const db = await PGlite.create(process.env.PG_DATA_DIR);
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();
console.log(`PGlite Postgres on postgres://postgres@127.0.0.1:${port}/postgres`);
const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
