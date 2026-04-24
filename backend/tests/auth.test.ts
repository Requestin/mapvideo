import crypto from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/db/pool';
import { cleanupTestUsers, loginAsAdmin, nextTestIp, parseSetCookie } from './helpers';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

describe('Auth routes', () => {
  const app = createApp();

  beforeAll(async () => {
    // Sanity: admin must exist (created by initAdmin on real server boot).
    // In the test process we run app without initAdmin, so the admin has to
    // already exist from previous real-server startup OR we create it here.
    const { rows } = await pool.query<{ c: string }>(
      "SELECT COUNT(*)::text AS c FROM users WHERE username = 'admin'"
    );
    if (rows[0].c === '0') {
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD!, 12);
      await pool.query("INSERT INTO users (username, password_hash, role) VALUES ('admin', $1, 'admin')", [hash]);
    }
  });

  afterEach(cleanupTestUsers);

  describe('POST /api/auth/login', () => {
    it('400 on missing password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextTestIp())
        .send({ username: 'admin' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Некорректный запрос');
    });

    it('401 on wrong password, no cookies', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextTestIp())
        .send({ username: 'admin', password: 'definitely-wrong' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Неверный логин или пароль');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('401 for unknown username (no enumeration)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextTestIp())
        .send({ username: 'nobody-' + Date.now(), password: 'anything' });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Неверный логин или пароль');
    });

    it('200 on correct credentials — sets both cookies, persists session, body has no password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextTestIp())
        .send({ username: 'admin', password: process.env.ADMIN_PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.user).toMatchObject({ username: 'admin', role: 'admin' });
      expect(res.body.user.id).toEqual(expect.any(String));
      expect(res.body.user).not.toHaveProperty('password_hash');
      expect(res.body.user).not.toHaveProperty('passwordHash');

      const cookies = parseSetCookie(res);
      expect(cookies.session.attrs.httponly).toBe(true);
      expect(String(cookies.session.attrs.samesite).toLowerCase()).toBe('lax');
      expect(cookies.session.attrs.path).toBe('/');
      expect(Number(cookies.session.attrs['max-age'])).toBeGreaterThan(29 * 86400);
      expect(cookies.csrf_token.attrs.httponly).toBeUndefined();

      const q = await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [
        sha256(cookies.session.value),
      ]);
      expect(q.rowCount).toBe(1);
    });

    it('429 after 5 failed attempts from the same IP', async () => {
      const ip = nextTestIp();
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) {
        const r = await request(app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ username: 'admin', password: `bad-${i}` });
        codes.push(r.status);
      }
      // First 5 → 401, 6th+ → 429. Because skipSuccessfulRequests only excludes
      // 2xx responses, 401 does count toward the limit.
      expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(codes[5]).toBe(429);
      expect(codes[6]).toBe(429);
    });
  });

  describe('GET /api/auth/me', () => {
    it('401 with no cookie', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Не авторизован');
    });

    it('401 with unknown session cookie', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', ['session=totally-not-a-real-token']);
      expect(res.status).toBe(401);
    });

    it('200 flat body after login — { id, username, role }', async () => {
      const { authHeaders, userId } = await loginAsAdmin(app);
      const res = await request(app).get('/api/auth/me').set(authHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: userId, username: 'admin', role: 'admin' });
      expect(res.body).not.toHaveProperty('createdAt');
      expect(res.body).not.toHaveProperty('password_hash');
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('401 when session is expired in DB (NOW() check runs server-side)', async () => {
      const { authHeaders, cookieHeader } = await loginAsAdmin(app);
      const sessionValue = cookieHeader.split('session=')[1].split(';')[0];
      await pool.query(
        "UPDATE sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE token_hash = $1",
        [sha256(sessionValue)]
      );
      const res = await request(app).get('/api/auth/me').set(authHeaders);
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('403 without X-CSRF-Token', async () => {
      const { authHeaders } = await loginAsAdmin(app);
      const res = await request(app).post('/api/auth/logout').set(authHeaders);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('CSRF проверка не пройдена');
    });

    it('403 when X-CSRF-Token does not match the cookie', async () => {
      const { authHeaders, csrfValue } = await loginAsAdmin(app);
      const res = await request(app)
        .post('/api/auth/logout')
        .set({ ...authHeaders, 'x-csrf-token': csrfValue + 'x' });
      expect(res.status).toBe(403);
    });

    it('200 { success: true } on valid CSRF — clears cookies and removes session row', async () => {
      const { csrfHeaders, cookieHeader } = await loginAsAdmin(app);
      const sessionValue = cookieHeader.split('session=')[1].split(';')[0];
      const res = await request(app).post('/api/auth/logout').set(csrfHeaders);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const cleared = parseSetCookie(res);
      expect(cleared.session).toBeDefined();
      expect(cleared.csrf_token).toBeDefined();
      const q = await pool.query('SELECT 1 FROM sessions WHERE token_hash = $1', [
        sha256(sessionValue),
      ]);
      expect(q.rowCount).toBe(0);
    });

    it('idempotent — second logout with stale cookies still returns 200', async () => {
      const { csrfHeaders } = await loginAsAdmin(app);
      const first = await request(app).post('/api/auth/logout').set(csrfHeaders);
      expect(first.status).toBe(200);
      const second = await request(app).post('/api/auth/logout').set(csrfHeaders);
      expect(second.status).toBe(200);
    });
  });

  describe('GET /api/auth/csrf', () => {
    it('200 sets csrf_token cookie on first call', async () => {
      const res = await request(app).get('/api/auth/csrf');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const cookies = parseSetCookie(res);
      expect(cookies.csrf_token).toBeDefined();
      expect(cookies.csrf_token.value.length).toBeGreaterThanOrEqual(40);
      expect(cookies.csrf_token.attrs.httponly).toBeUndefined();
    });

    it('does NOT rotate csrf_token if already present', async () => {
      const first = await request(app).get('/api/auth/csrf');
      const existingValue = parseSetCookie(first).csrf_token.value;
      const second = await request(app)
        .get('/api/auth/csrf')
        .set('Cookie', [`csrf_token=${existingValue}`]);
      expect(second.status).toBe(200);
      expect(second.headers['set-cookie']).toBeUndefined();
    });
  });
});
