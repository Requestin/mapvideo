import fs from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';
import { pool } from '../db/pool';
import { logger } from '../utils/logger';

const VIDEOS_ROOT = (process.env.VIDEOS_DIR || '/data/videos').replace(/\/$/, '');

function isSafePath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(VIDEOS_ROOT + path.sep);
}

export function scheduleRenderCleanup(): void {
  cron.schedule('0 3 * * *', () => {
    void runRenderCleanup();
  });
}

export async function runRenderCleanup(): Promise<void> {
  try {
    const { rows } = await pool.query<{
      id: string;
      output_path: string | null;
      thumbnail_path: string | null;
    }>(
      `SELECT id, output_path, thumbnail_path FROM render_jobs
       WHERE status IN ('done','error','cancelled')
         AND updated_at < NOW() - INTERVAL '10 days'`
    );
    for (const job of rows) {
      if (job.output_path && isSafePath(job.output_path)) {
        await fs.unlink(job.output_path).catch(() => undefined);
      }
      if (job.thumbnail_path && isSafePath(job.thumbnail_path)) {
        await fs.unlink(job.thumbnail_path).catch(() => undefined);
      }
      await pool.query('DELETE FROM render_jobs WHERE id = $1', [job.id]);
    }
    const tok = await pool.query(
      `DELETE FROM render_tokens
       WHERE used_at IS NOT NULL
          OR expires_at < NOW() - INTERVAL '1 day'
          OR created_at < NOW() - INTERVAL '1 day'`
    );
    logger.info(
      { jobs: rows.length, tokensRemoved: tok.rowCount ?? 0 },
      'render cleanup cron'
    );
  } catch (err) {
    logger.error({ err }, 'render cleanup failed');
  }
}
