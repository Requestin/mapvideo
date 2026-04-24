import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/require-auth';
import { requireCsrf } from '../middleware/require-csrf';
import { requireJobOwner } from '../middleware/require-job-owner';
import type { MapStateV1 } from '../render/map-state';
import { isMapStateV1 } from '../render/map-state';
import { enqueueRender } from '../render/render-queue';
import { consumeRenderToken } from '../render/render-tokens';
import { logger } from '../utils/logger';

const VIDEOS_ROOT = (process.env.VIDEOS_DIR || '/data/videos').replace(/\/$/, '');

const router = Router();

router.post('/', requireAuth, requireCsrf, async (req: Request, res: Response) => {
  const body = req.body as { state?: unknown };
  const state = body?.state;
  if (!isMapStateV1(state)) {
    res.status(400).json({ error: 'Некорректное состояние карты' });
    return;
  }
  try {
    const jobId = await enqueueRender(req.user!.id, state as MapStateV1);
    res.status(202).json({ jobId });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    if (err.status === 429) {
      res.status(429).json({ error: err.message ?? 'Слишком много запросов' });
      return;
    }
    logger.error({ err: e }, 'enqueue render failed');
    res.status(500).json({ error: 'Не удалось поставить рендер в очередь' });
  }
});

router.get('/active', requireAuth, async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT id, status, progress, error_message, created_at, updated_at
     FROM render_jobs
     WHERE user_id = $1 AND status IN ('queued','running')
     ORDER BY created_at DESC LIMIT 1`,
    [req.user!.id]
  );
  if (rows.length === 0) {
    res.json({ active: null });
    return;
  }
  const j = rows[0];
  res.json({
    active: {
      id: j.id,
      status: j.status,
      progress: j.progress,
      errorMessage: j.error_message,
      createdAt: j.created_at,
      updatedAt: j.updated_at,
    },
  });
});

router.get('/status/:jobId', requireAuth, requireJobOwner, (req: Request, res: Response) => {
  const j = req.renderJob!;
  const base = {
    status: j.status,
    progress: j.progress,
    message: j.status === 'running' ? 'Рендер выполняется…' : null,
    error: j.error_message,
  };
  if (j.status === 'done' && j.output_path) {
    res.json({
      ...base,
      downloadUrl: `/api/render/download/${j.id}`,
    });
    return;
  }
  res.json(base);
});

function isPathUnderUserDir(userId: string, filePath: string): boolean {
  const prefix = path.join(VIDEOS_ROOT, userId) + path.sep;
  const norm = path.normalize(filePath);
  return norm.startsWith(prefix);
}

router.get('/download/:jobId', requireAuth, requireJobOwner, (req: Request, res: Response) => {
  const j = req.renderJob!;
  if (j.status !== 'done' || !j.output_path) {
    res.status(404).json({ error: 'Файл недоступен' });
    return;
  }
  if (!isPathUnderUserDir(req.user!.id, j.output_path)) {
    res.status(500).json({ error: 'Некорректный путь' });
    return;
  }
  const ext = path.extname(j.output_path) || '.mp4';
  res.download(j.output_path, `${j.id}${ext}`, (err) => {
    if (err) logger.error({ err }, 'download render');
  });
});

/** Public to Puppeteer via one-time `render_token` OR owner session. */
router.get('/state/:jobId', async (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  if (!jobId) {
    res.status(400).json({ error: 'Некорректный id' });
    return;
  }
  const token = req.query.render_token;
  if (typeof token === 'string' && token.length > 0) {
    const ok = await consumeRenderToken(jobId, token);
    if (!ok) {
      res.status(401).json({ error: 'Недействительный токен' });
      return;
    }
    const { rows } = await pool.query(`SELECT state_json FROM render_jobs WHERE id = $1`, [jobId]);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Не найдено' });
      return;
    }
    res.json(rows[0].state_json);
    return;
  }
  const rawToken = req.cookies?.session as string | undefined;
  if (!rawToken) {
    res.status(401).json({ error: 'Не авторизован' });
    return;
  }
  const { findUserByRawSessionToken } = await import('../services/auth-service');
  const user = await findUserByRawSessionToken(rawToken);
  if (!user) {
    res.status(401).json({ error: 'Не авторизован' });
    return;
  }
  const { rows } = await pool.query(
    `SELECT state_json FROM render_jobs WHERE id = $1 AND user_id = $2`,
    [jobId, user.id]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  res.json(rows[0].state_json);
});

export default router;
