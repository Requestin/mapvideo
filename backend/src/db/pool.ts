import { Pool } from 'pg';

// Inside docker-compose network the Postgres container is reachable as `postgres`
// (service name). For local dev outside compose, override with POSTGRES_HOST=127.0.0.1.
const host = process.env.POSTGRES_HOST || 'postgres';
const port = Number(process.env.POSTGRES_PORT) || 5432;
const user = process.env.POSTGRES_USER;
const password = process.env.POSTGRES_PASSWORD;
const database = process.env.POSTGRES_DB;

if (!user || !password || !database) {
  throw new Error(
    '[db] POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB must be set in environment'
  );
}

export const pool = new Pool({
  host,
  port,
  user,
  password,
  database,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  // Log and keep running — the pool will try to create a new client on next query.
  // eslint-disable-next-line no-console
  console.error('[db] Unexpected error on idle client:', err);
});
