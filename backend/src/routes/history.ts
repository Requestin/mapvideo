import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { pool } from '../db/pool';
import { requireAuth } from '../middleware/require-auth';
import { requireJobOwner } from '../middleware/require-job-owner';
import { logger } from '../utils/logger';

const VIDEOS_ROOT = (process.env.VIDEOS_DIR || '/data/videos').replace(/\/$/, '');

const router = Router();

router.get('/', requireAuth, async (req: Request, res: Response) => {
  const { rows } = await pool.query(
    `SELECT id, status, progress, created_at, updated_at, output_path, thumbnail_path, error_message
     FROM render_jobs
     WHERE user_id = $1 AND status = 'done'
     ORDER BY updated_at DESC
     LIMIT 100`,
    [req.user!.id]
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      downloadUrl: `/api/history/${r.id}/download`,
      thumbnailUrl: `/api/history/${r.id}/thumbnail`,
    })),
  });
});

function isPathUnderUserDir(userId: string, filePath: string): boolean {
  const prefix = path.join(VIDEOS_ROOT, userId) + path.sep;
  return path.normalize(filePath).startsWith(prefix);
}

router.get('/:id/download', requireAuth, requireJobOwner, (req: Request, res: Response) => {
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
    if (err) logger.error({ err }, 'history download');
  });
});

router.get('/:id/thumbnail', requireAuth, requireJobOwner, (req: Request, res: Response) => {
  const j = req.renderJob!;
  if (!j.thumbnail_path) {
    res.status(404).json({ error: 'Нет миниатюры' });
    return;
  }
  if (!isPathUnderUserDir(req.user!.id, j.thumbnail_path)) {
    res.status(500).json({ error: 'Некорректный путь' });
    return;
  }
  res.type('jpg');
  res.sendFile(j.thumbnail_path, (err) => {
    if (err) logger.error({ err }, 'history thumbnail');
  });
});

export default router;
