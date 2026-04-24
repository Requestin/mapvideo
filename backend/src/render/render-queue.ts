import { pool } from '../db/pool';
import { logger } from '../utils/logger';
import type { MapStateV1 } from './map-state';
import { isMapStateV1 } from './map-state';
import { renderVideoJob } from './render-video';

const MAX_QUEUE = 5;

let processing = false;
let activeJobId: string | null = null;
let started = false;

/** Reset in-memory state for tests — call between test cases. */
export function _resetQueueState(): void {
  processing = false;
  activeJobId = null;
}

export function startRenderWorker(): void {
  if (started) return;
  started = true;
  void recoverStaleRunning()
    .then(() => processNextJob())
    .catch((err) => logger.error({ err }, 'render queue start failed'));
}

async function recoverStaleRunning(): Promise<void> {
  const r = await pool.query(
    `UPDATE render_jobs SET status = 'error', error_message = 'Рендер прерван рестартом сервера', updated_at = NOW()
     WHERE status = 'running'`
  );
  if (r.rowCount && r.rowCount > 0) {
    logger.warn({ n: r.rowCount }, 'Помечены устаревшие running render_jobs');
  }
}

export async function enqueueRender(userId: string, state: MapStateV1): Promise<string> {
  if (!isMapStateV1(state)) {
    throw new Error('Invalid map state');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mine = await client.query(
      `SELECT id FROM render_jobs WHERE user_id = $1 AND status IN ('queued','running') LIMIT 1 FOR UPDATE`,
      [userId]
    );
    if (mine.rows.length > 0) {
      await client.query('ROLLBACK');
      const err: Error & { status?: number } = new Error('У вас уже есть активный рендер') as Error & {
        status: number;
      };
      err.status = 429;
      throw err;
    }

    const queued = await client.query(
      `SELECT count(*)::int AS n FROM render_jobs WHERE status IN ('queued','running')`
    );
    if (queued.rows[0].n >= MAX_QUEUE) {
      await client.query('ROLLBACK');
      const err: Error & { status?: number } = new Error(
        'Очередь рендеров переполнена, попробуйте позже'
      ) as Error & { status: number };
      err.status = 429;
      throw err;
    }

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO render_jobs (user_id, status, progress, state_json) VALUES ($1, 'queued', 0, $2::jsonb) RETURNING id`,
      [userId, JSON.stringify(state)]
    );
    await client.query('COMMIT');

    const id = rows[0].id;
    setImmediate(() => {
      void processNextJob();
    });
    return id;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function processNextJob(): Promise<void> {
  if (processing) return;
  processing = true;
  let didWork = false;
  try {
    const { rows } = await pool.query<{
      id: string;
      user_id: string;
      state_json: MapStateV1;
    }>(
      `WITH n AS (
         SELECT id FROM render_jobs
         WHERE status = 'queued'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE render_jobs r
       SET status = 'running', updated_at = NOW()
       FROM n
       WHERE r.id = n.id
       RETURNING r.id, r.user_id, r.state_json`
    );
    if (rows.length === 0) {
      return;
    }
    didWork = true;
    const job = rows[0];
    activeJobId = job.id;
    try {
      const state = job.state_json;
      if (!isMapStateV1(state)) {
        throw new Error('state_json невалиден');
      }
      let lastProgress = -1;
      const { outputPath, thumbnailPath } = await renderVideoJob(
        job.id,
        job.user_id,
        state,
        async (p) => {
          const next = Math.max(0, Math.min(100, Math.round(p)));
          if (next <= lastProgress) return;
          // Avoid excessive DB churn on high-FPS renders.
          if (next < 100 && next - lastProgress < 2) return;
          lastProgress = next;
          await pool.query('UPDATE render_jobs SET progress = $1, updated_at = NOW() WHERE id = $2', [next, job.id]);
        }
      );
      await pool.query(
        `UPDATE render_jobs SET status = 'done', progress = 100, output_path = $1, thumbnail_path = $2, updated_at = NOW() WHERE id = $3`,
        [outputPath, thumbnailPath, job.id]
      );
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'Рендер завершился с ошибкой');
      const msg = err instanceof Error ? err.message : String(err);
      await pool.query(
        `UPDATE render_jobs SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [msg, job.id]
      );
    } finally {
      activeJobId = null;
    }
  } finally {
    processing = false;
    if (didWork) {
      setImmediate(() => {
        void processNextJob();
      });
    }
  }
}
