import type { Response } from 'supertest';
import request from 'supertest';
import type { Express } from 'express';
import { pool } from '../src/db/pool';

// Lightweight Set-Cookie parser — supertest returns raw lines in res.headers.
export type ParsedCookie = { value: string; attrs: Record<string, string | true> };
export function parseSetCookie(res: Response): Record<string, ParsedCookie> {
  const rawHeader = res.headers['set-cookie'];
  const raw = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  const out: Record<string, ParsedCookie> = {};
  for (const line of raw) {
    const parts = (line as string).split(';').map((s: string) => s.trim());
    const kv = parts[0];
    const eq = kv.indexOf('=');
    const name = kv.slice(0, eq);
    const value = kv.slice(eq + 1);
    const attrs: Record<string, string | true> = {};
    for (const a of parts.slice(1)) {
      const i = a.indexOf('=');
      if (i === -1) attrs[a.toLowerCase()] = true;
      else attrs[a.slice(0, i).toLowerCase()] = a.slice(i + 1);
    }
    out[name] = { value, attrs };
  }
  return out;
}

// Per-test forwarded IP so rate-limiters don't leak state between tests. The
// app is configured with `trust proxy = 'loopback'`, supertest connects on
// 127.0.0.1 → X-Forwarded-For is trusted and becomes req.ip.
let ipCounter = 0;
export function nextTestIp(): string {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 0xff}.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
}

// Logs in as `admin` and returns the cookies + csrf header ready to attach
// to mutating admin requests. Uses a fresh forwarded IP so the login limiter
// doesn't interfere with later tests.
export async function loginAsAdmin(app: Express): Promise<{
  userId: string;
  cookieHeader: string;
  csrfValue: string;
  authHeaders: Record<string, string>;
  csrfHeaders: Record<string, string>;
}> {
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass) throw new Error('ADMIN_PASSWORD must be set for tests');

  const res = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', nextTestIp())
    .send({ username: 'admin', password: adminPass });

  if (res.status !== 200) {
    throw new Error(`Test admin login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const cookies = parseSetCookie(res);
  const sessionValue = cookies.session.value;
  const csrfValue = cookies.csrf_token.value;
  const cookieHeader = `session=${sessionValue}; csrf_token=${csrfValue}`;

  return {
    userId: res.body.user.id,
    cookieHeader,
    csrfValue,
    authHeaders: { cookie: cookieHeader },
    csrfHeaders: { cookie: cookieHeader, 'x-csrf-token': csrfValue },
  };
}

// Best-effort cleanup of test-created rows. Never deletes admin or real users.
export async function cleanupTestUsers(): Promise<void> {
  await pool.query("DELETE FROM users WHERE username LIKE 'testuser_%' OR username LIKE 'e2e_%'");
}
