import fs from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/db/pool';
import type { MapStateV1 } from '../src/render/map-state';
import { issueRenderToken } from '../src/render/render-tokens';
import { _resetQueueState } from '../src/render/render-queue';
import { cleanupTestUsers, loginAsAdmin } from './helpers';

jest.mock('../src/render/render-video', () => ({
  renderVideoJob: jest.fn(
    async (
      jobId: string,
      userId: string,
      _state: unknown,
      onProgress: (p: number) => Promise<void>
    ) => {
      const root = (process.env.VIDEOS_DIR || '/tmp').replace(/\/$/, '');
      const userDir = path.join(root, userId);
      await fs.mkdir(userDir, { recursive: true });
      const outputPath = path.join(userDir, `${jobId}.mp4`);
      const thumbnailPath = path.join(userDir, `${jobId}.jpg`);
      await onProgress(40);
      await fs.writeFile(outputPath, Buffer.from('fake-mp4'));
      await fs.writeFile(thumbnailPath, Buffer.from('fake-jpg'));
      await onProgress(100);
      return { outputPath, thumbnailPath };
    }
  ),
}));

function validState(): MapStateV1 {
  return {
    version: '1.0',
    map: { center: { lng: 37.6, lat: 55.75 }, zoom: 10, theme: 'dark' },
    video: {
      resolution: '1920x1080',
      fps: 25,
      format: 'mp4',
      duration: 3,
      theme: 'dark',
      cameraBreathing: 0,
    },
    render: {
      engineVersion: 'v2',
      previewFrame: { widthPx: 1600, heightPx: 900 },
      devicePixelRatio: 1,
      pageZoom: 1,
    },
    elements: [],
  };
}

async function cleanupAdminRenderData(): Promise<void> {
  await pool.query(
    `DELETE FROM render_tokens WHERE job_id IN (
       SELECT id FROM render_jobs WHERE user_id = (SELECT id FROM users WHERE username = 'admin')
     )`
  );
  await pool.query(
    `DELETE FROM render_jobs WHERE user_id = (SELECT id FROM users WHERE username = 'admin')`
  );
}

async function waitForRenderStatus(
  app: ReturnType<typeof createApp>,
  authHeaders: Record<string, string>,
  jobId: string,
  want: string,
  maxMs = 12_000
): Promise<{ status: string; progress?: number; downloadUrl?: string }> {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const r = await request(app).get(`/api/render/status/${jobId}`).set(authHeaders);
    expect(r.status).toBe(200);
    if (r.body.status === want) return r.body;
    await new Promise((res) => setTimeout(res, 40));
  }
  throw new Error(`timeout waiting for status ${want}`);
}

describe('Render API (task8)', () => {
  const app = createApp();

  beforeEach(() => {
    _resetQueueState();
  });
  afterEach(async () => {
    _resetQueueState();
    await cleanupAdminRenderData();
  });
  afterEach(cleanupTestUsers);

  it('POST /api/render — 401 без сессии', async () => {
    const res = await request(app).post('/api/render').send({ state: validState() });
    expect(res.status).toBe(401);
  });

  it('POST /api/render — 403 без CSRF при наличии сессии', async () => {
    const { cookieHeader } = await loginAsAdmin(app);
    const res = await request(app)
      .post('/api/render')
      .set({ cookie: cookieHeader })
      .send({ state: validState() });
    expect(res.status).toBe(403);
  });

  it('POST /api/render — 400 при невалидном state', async () => {
    const { csrfHeaders } = await loginAsAdmin(app);
    const res = await request(app)
      .post('/api/render')
      .set(csrfHeaders)
      .send({ state: { version: '2.0', map: {}, video: {}, elements: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Некорректное состояние карты');
  });

  it('POST /api/render — 202 и воркер доводит job до done (мок без Puppeteer)', async () => {
    const { csrfHeaders, authHeaders } = await loginAsAdmin(app);
    const post = await request(app).post('/api/render').set(csrfHeaders).send({ state: validState() });
    expect(post.status).toBe(202);
    const jobId = post.body.jobId as string;
    expect(jobId).toEqual(expect.any(String));

    const final = await waitForRenderStatus(app, authHeaders, jobId, 'done');
    expect(final.progress).toBe(100);
    expect(final.downloadUrl).toBe(`/api/render/download/${jobId}`);

    const st = await request(app).get(`/api/render/status/${jobId}`).set(authHeaders);
    expect(st.body.status).toBe('done');
    expect(st.body.downloadUrl).toBe(`/api/render/download/${jobId}`);
  });

  it('GET /api/render/status/:jobId — 404 для чужого uuid', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    const res = await request(app)
      .get('/api/render/status/00000000-0000-0000-0000-000000000001')
      .set(authHeaders);
    expect(res.status).toBe(404);
  });

  it('POST /api/render — 429 если у пользователя уже есть активный job', async () => {
    const { rows: u } = await pool.query<{ id: string }>("SELECT id FROM users WHERE username = 'admin'");
    const userId = u[0].id;
    await pool.query(
      `INSERT INTO render_jobs (user_id, status, progress, state_json) VALUES ($1, 'running', 10, $2::jsonb)`,
      [userId, JSON.stringify(validState())]
    );

    const { csrfHeaders } = await loginAsAdmin(app);
    const res = await request(app).post('/api/render').set(csrfHeaders).send({ state: validState() });
    expect(res.status).toBe(429);
  });

  it('GET /api/render/active — null без активных', async () => {
    const { authHeaders } = await loginAsAdmin(app);
    const res = await request(app).get('/api/render/active').set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.active).toBeNull();
  });

  it('GET /api/render/state/:jobId с render_token — 200, повтор — 401', async () => {
    const { rows: u } = await pool.query<{ id: string }>("SELECT id FROM users WHERE username = 'admin'");
    const userId = u[0].id;
    const { rows: j } = await pool.query<{ id: string }>(
      `INSERT INTO render_jobs (user_id, status, progress, state_json) VALUES ($1, 'queued', 0, $2::jsonb) RETURNING id`,
      [userId, JSON.stringify(validState())]
    );
    const jobId = j[0].id;
    const raw = await issueRenderToken(jobId);

    const ok = await request(app)
      .get(`/api/render/state/${jobId}`)
      .query({ render_token: raw });
    expect(ok.status).toBe(200);
    expect((ok.body as MapStateV1).version).toBe('1.0');

    const second = await request(app)
      .get(`/api/render/state/${jobId}`)
      .query({ render_token: raw });
    expect(second.status).toBe(401);
  });

  it('GET /api/history — список после завершённого рендера + скачивание', async () => {
    const { csrfHeaders, authHeaders } = await loginAsAdmin(app);
    const post = await request(app).post('/api/render').set(csrfHeaders).send({ state: validState() });
    const jobId = post.body.jobId as string;
    await waitForRenderStatus(app, authHeaders, jobId, 'done');

    const hist = await request(app).get('/api/history').set(authHeaders);
    expect(hist.status).toBe(200);
    expect(hist.body.items.length).toBeGreaterThanOrEqual(1);
    const row = hist.body.items.find((x: { id: string }) => x.id === jobId);
    expect(row).toBeDefined();
    expect(row.downloadUrl).toBe(`/api/history/${jobId}/download`);

    const dl = await request(app).get(`/api/history/${jobId}/download`).set(authHeaders).buffer(true);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toMatch(/attachment/);

    const th = await request(app).get(`/api/history/${jobId}/thumbnail`).set(authHeaders).buffer(true);
    expect(th.status).toBe(200);
  });
});
