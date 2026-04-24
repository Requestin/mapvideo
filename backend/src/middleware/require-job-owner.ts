import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';
import type { RenderJobRow } from '../types/render-job';

/**
 * 404 if no row or wrong owner — no existence leak (SPEC / task8).
 * Expects `req.params.jobId` or `req.params.id` depending on route mount.
 */
export async function requireJobOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Не авторизован' });
    return;
  }
  const jobId = (req.params.jobId ?? req.params.id) as string | undefined;
  if (!jobId) {
    res.status(400).json({ error: 'Некорректный запрос' });
    return;
  }
  const { rows } = await pool.query<RenderJobRow>(
    `SELECT * FROM render_jobs WHERE id = $1 AND user_id = $2`,
    [jobId, userId]
  );
  if (rows.length === 0) {
    res.status(404).json({ error: 'Не найдено' });
    return;
  }
  req.renderJob = rows[0];
  next();
}
