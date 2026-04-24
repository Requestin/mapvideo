import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { pool } from '../db/pool';
import { findUserByUsername, type User } from './users-service';

// 30 days — matches cookie Max-Age set by the route handler.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Pre-computed bcrypt hash used when no user is found, so /auth/login takes
// roughly the same time whether the username exists or not. Prevents
// username enumeration via response-time side channel.
const DUMMY_HASH = bcrypt.hashSync('__mapvideo_dummy_password__', 12);

// Attempts to log a user in. Returns the user on success, null otherwise.
// Both branches run bcrypt.compare to keep response time flat.
export async function verifyLogin(
  username: string,
  password: string
): Promise<User | null> {
  const user = await findUserByUsername(username);
  const hash = user?.passwordHash ?? DUMMY_HASH;
  const ok = await bcrypt.compare(password, hash);
  return user && ok ? user : null;
}

export type CreatedSession = {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
};

// Creates a session row and returns the raw tokens. Only sha256(token) is
// stored in the DB — a DB leak does not let an attacker reuse live sessions.
export async function createSession(userId: string): Promise<CreatedSession> {
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
  const csrfToken = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await pool.query(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt]
  );

  return { sessionToken, csrfToken, expiresAt };
}

// Deletes the session row that corresponds to the given raw cookie value, if
// any. Silently succeeds when no match exists so logout is idempotent.
// Returns the number of rows removed.
export async function destroySessionByRawToken(rawToken: string): Promise<number> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const result = await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  return result.rowCount ?? 0;
}

// Resolves a raw session cookie to the authenticated user, filtering out
// expired sessions at the DB level (NOW() in WHERE, not a Date comparison
// in Node — keeps time source of truth on the server).
// Returns null when the cookie is unknown or the session has expired.
export async function findUserByRawSessionToken(rawToken: string): Promise<User | null> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const result = await pool.query<{
    id: string;
    username: string;
    password_hash: string;
    role: 'admin' | 'user';
    created_at: Date;
  }>(
    `SELECT u.id, u.username, u.password_hash, u.role, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()
      LIMIT 1`,
    [tokenHash]
  );

  if (result.rowCount === 0) return null;
  const r = result.rows[0];
  return {
    id: r.id,
    username: r.username,
    passwordHash: r.password_hash,
    role: r.role,
    createdAt: r.created_at,
  };
}
