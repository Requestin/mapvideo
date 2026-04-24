import fs from 'node:fs';
import path from 'node:path';

// Tests require backend env pre-loaded because the pool reads POSTGRES_*
// from process.env on first import. Loading a minimal .env parser here
// avoids a new dependency on `dotenv`.
export default async function globalSetup(): Promise<void> {
  const envPath = path.resolve(__dirname, '..', '..', '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(`[tests] .env not found at ${envPath}`);
  }
  const raw = fs.readFileSync(envPath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    // Strip inline comments so `KEY=val  # note` parses to `val`.
    const hashIdx = value.indexOf('#');
    if (hashIdx >= 0) value = value.slice(0, hashIdx).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }

  // Pool was configured to default to `postgres` (compose network); tests run
  // on the host, so force loopback. Also drop NODE_ENV=production from .env
  // so pino-pretty can help when debugging failures.
  process.env.POSTGRES_HOST = process.env.POSTGRES_HOST ?? '127.0.0.1';
  process.env.NODE_ENV = 'test';
  process.env.COOKIE_SECURE = 'false';
  process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
  // Use a dedicated fonts directory so the test doesn't depend on layout.
  process.env.FONTS_DIR = path.resolve(__dirname, '..', '..', 'assets', 'fonts');

  // Headless render tests mock Puppeteer but still write outputs like the real worker.
  const videosDir = path.resolve(__dirname, 'tmp-videos');
  fs.mkdirSync(videosDir, { recursive: true });
  process.env.VIDEOS_DIR = videosDir;
}
