import crypto from 'node:crypto';
import { pool } from '../db/pool';

const TOKEN_TTL_MS = 10 * 60 * 1000;

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Returns the raw token (send to browser once) and stores a hash in DB. */
export async function issueRenderToken(jobId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha256Hex(raw);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await pool.query(
    `INSERT INTO render_tokens (job_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [jobId, tokenHash, expiresAt.toISOString()]
  );
  return raw;
}

/** Validates one-time token; marks `used_at` on success. */
export async function consumeRenderToken(jobId: string, rawToken: string | undefined): Promise<boolean> {
  if (!rawToken || typeof rawToken !== 'string') return false;
  const tokenHash = sha256Hex(rawToken);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM render_tokens
       WHERE job_id = $1 AND token_hash = $2
         AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`,
      [jobId, tokenHash]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(`UPDATE render_tokens SET used_at = NOW() WHERE id = $1`, [rows[0].id]);
    await client.query('COMMIT');
    return true;
  } catch {
    await client.query('ROLLBACK');
    return false;
  } finally {
    client.release();
  }
}
