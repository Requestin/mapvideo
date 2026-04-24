import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/db/pool';
import { cleanupTestUsers, loginAsAdmin, nextTestIp, parseSetCookie } from './helpers';

describe('/api/admin/users', () => {
  const app = createApp();

  afterEach(cleanupTestUsers);

  describe('GET /api/admin/users', () => {
    it('401 without auth', async () => {
      const res = await request(app).get('/api/admin/users');
      expect(res.status).toBe(401);
    });

    it('403 for non-admin users', async () => {
      const { csrfHeaders } = await loginAsAdmin(app);
      await request(app)
        .post('/api/admin/users')
        .set({ ...csrfHeaders, 'content-type': 'application/json' })
        .send({ username: 'testuser_reg', password: 'Regular1!' })
        .expect(201);

      const login = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextTestIp())
        .send({ username: 'testuser_reg', password: 'Regular1!' });
      const cookies = parseSetCookie(login);
      const cookieHeader = `session=${cookies.session.value}; csrf_token=${cookies.csrf_token.value}`;

      const res = await request(app).get('/api/admin/users').set('Cookie', cookieHeader);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Требуются права администратора');
    });

    it('200 returns all users without password hashes', async () => {
      const { authHeaders } = await loginAsAdmin(app);
      const res = await request(app).get('/api/admin/users').set(authHeaders);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
      const adminRow = res.body.users.find((u: { username: string }) => u.username === 'admin');
      expect(adminRow).toBeDefined();
      expect(adminRow.role).toBe('admin');
      for (const u of res.body.users) {
        expect(u).not.toHaveProperty('password_hash');
        expect(u).not.toHaveProperty('passwordHash');
        expect(u).toHaveProperty('id');
        expect(u).toHaveProperty('username');
        expect(u).toHaveProperty('role');
        expect(u).toHaveProperty('createdAt');
      }
    });
  });

  describe('POST /api/admin/users', () => {
    it('403 without CSRF', async () => {
      const { authHeaders } = await loginAsAdmin(app);
      const res = await request(app)
        .post('/api/admin/users')
        .set({ ...authHeaders, 'content-type': 'application/json' })
        .send({ username: 'testuser_nocsrf', password: 'Passw0rd!' });
      expect(res.status).toBe(403);
    });

    it('400 on weak password', async () => {
      const { csrfHeaders } = await loginAsAdmin(app);
      const res = await request(app)
        .post('/api/admin/users')
        .set({ ...csrfHeaders, 'content-type': 'application/json' })
        .send({ username: 'testuser_weak', password: 'short' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Пароль слишком простой');
    });

    it('400 on password without digits', async () => {
      const { csrfHeaders } = await loginAsAdmin(app);
      const res = await request(app)
        .post('/api/admin/users')
        .set({ ...csrfHeaders, 'content-type': 'application/json' })
        .send({ username: 'testuser_nod', password: 'longbutnoDigits' });
      expect(res.status).toBe(400);
    });

    it('400 on invalid username format', async () => {
      const { csrfHeaders } = await loginAsAdmin(app);
      const res = await request(app)
        .post('/api/admin/users')
        .set({ ...csrfHeaders, 'content-type': 'application/json' })
        .send({ username: 'has spaces', password: 'Valid1Pass' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Некорректное имя пользователя');
    });

    it('201 creates user with role=user', async () => {
      const { csrfHeaders } = await loginAsAdmin(app);
      const res = await request(app)
        .post('/api/admin/users')
        .set({ ...csrfHeaders, 'content-type': 'application/json' })
        .send({ username: 'testuser_ok', password: 'Passw0rd!' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ username: 'testuser_ok', role: 'user' });
      expect(res.body.id).toEqual(expect.any(String));

      const { rows } = await pool.query(
        "SELECT role FROM users WHERE username = 'testuser_ok'"
      );
      expect(rows[0].role).toBe('user');
    });

    it('409 on duplicate username', async () => {
      const { csrfHeaders } = await loginAsAdmin(app);
      const first = await request(app)
        .post('/api/admin/users')
        .set({ ...csrfHeaders, 'content-type': 'application/json' })
        .send({ username: 'testuser_dup', password: 'Passw0rd!' });
      expect(first.status).toBe(201);
      const second = await request(app)
        .post('/api/admin/users')
        .set({ ...csrfHeaders, 'content-type': 'application/json' })
        .send({ username: 'testuser_dup', password: 'Another1!' });
      expect(second.status).toBe(409);
      expect(second.body.error).toBe('Пользователь с таким логином уже существует');
    });
  });

  describe('DELETE /api/admin/users/:id', () => {
    it('403 without CSRF', async () => {
      const { csrfHeaders, authHeaders } = await loginAsAdmin(app);
      const create = await request(app)
        .post('/api/admin/users')
        .set({ ...csrfHeaders, 'content-type': 'application/json' })
        .send({ username: 'testuser_dnc', password: 'Passw0rd!' });
      const res = await request(app)
        .delete(`/api/admin/users/${create.body.id}`)
        .set(authHeaders);
      expect(res.status).toBe(403);
    });

    it('404 on unknown id', async () => {
      const { csrfHeaders } = await loginAsAdmin(app);
      const res = await request(app)
        .delete('/api/admin/users/00000000-0000-0000-0000-000000000000')
        .set(csrfHeaders);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Пользователь не найден');
    });

    it('403 refuses to delete user "admin"', async () => {
      const { csrfHeaders, userId } = await loginAsAdmin(app);
      const res = await request(app).delete(`/api/admin/users/${userId}`).set(csrfHeaders);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Нельзя удалить пользователя admin');
    });

    it('403 refuses to self-delete (non-admin admin role)', async () => {
      const { csrfHeaders } = await loginAsAdmin(app);
      await request(app)
        .post('/api/admin/users')
        .set({ ...csrfHeaders, 'content-type': 'application/json' })
        .send({ username: 'testuser_self', password: 'Passw0rd!' });
      await pool.query("UPDATE users SET role = 'admin' WHERE username = 'testuser_self'");

      const login = await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', nextTestIp())
        .send({ username: 'testuser_self', password: 'Passw0rd!' });
      const cookies = parseSetCookie(login);
      const selfId = login.body.user.id;
      const selfHeaders = {
        cookie: `session=${cookies.session.value}; csrf_token=${cookies.csrf_token.value}`,
        'x-csrf-token': cookies.csrf_token.value,
      };

      const res = await request(app)
        .delete(`/api/admin/users/${selfId}`)
        .set(selfHeaders);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Нельзя удалить самого себя');
    });

    it('200 actually removes the user', async () => {
      const { csrfHeaders } = await loginAsAdmin(app);
      const create = await request(app)
        .post('/api/admin/users')
        .set({ ...csrfHeaders, 'content-type': 'application/json' })
        .send({ username: 'testuser_goaway', password: 'Passw0rd!' });
      const id = create.body.id;

      const res = await request(app).delete(`/api/admin/users/${id}`).set(csrfHeaders);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });

      const { rowCount } = await pool.query('SELECT 1 FROM users WHERE id = $1', [id]);
      expect(rowCount).toBe(0);
    });
  });
});
