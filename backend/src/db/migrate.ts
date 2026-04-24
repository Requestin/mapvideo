import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from './pool';

// Migration files live next to this runner: ./migrations/NNN_*.sql.
// In dev (tsx src/db/migrate.ts) __dirname → src/db.
// In prod (node dist/db/migrate.js) __dirname → dist/db (SQL is copied there by postbuild).
const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function ensureSchemaMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function listAppliedVersions(): Promise<Set<string>> {
  const { rows } = await pool.query<{ version: string }>(
    'SELECT version FROM schema_migrations'
  );
  return new Set(rows.map((r) => r.version));
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function applyMigration(file: string): Promise<void> {
  const version = file.replace(/\.sql$/, '');
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (version) VALUES ($1)',
      [version]
    );
    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log(`[migrate] applied ${version}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrations(): Promise<void> {
  await ensureSchemaMigrationsTable();
  const applied = await listAppliedVersions();
  const files = listMigrationFiles();

  let pending = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    pending += 1;
    await applyMigration(file);
  }

  if (pending === 0) {
    // eslint-disable-next-line no-console
    console.log('[migrate] nothing to apply, schema up to date');
  } else {
    // eslint-disable-next-line no-console
    console.log(`[migrate] applied ${pending} migration(s)`);
  }
}

// When executed directly (`tsx src/db/migrate.ts` or `node dist/db/migrate.js`):
// run migrations and close the pool. When imported — do nothing here.
if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[migrate] FAIL:', err);
      void pool.end();
      process.exit(1);
    });
}
