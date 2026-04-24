import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { loginLimiter } from '../middleware/rate-limit';
import { requireCsrf } from '../middleware/require-csrf';
import { requireAuth } from '../middleware/require-auth';
import { verifyLogin, createSession, destroySessionByRawToken } from '../services/auth-service';
import { logger } from '../utils/logger';

const router = Router();

// 30 days, must match SESSION_TTL_MS in auth-service.
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// COOKIE_SECURE=false is required when hitting the API over plain HTTP
// (local dev, smoke tests). In production nginx terminates TLS and injects
// X-Forwarded-Proto=https, so setting secure=true is safe behind the proxy.
function cookieSecure(): boolean {
  return process.env.COOKIE_SECURE !== 'false';
}

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  const { username, password } = (req.body ?? {}) as {
    username?: unknown;
    password?: unknown;
  };

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(400).json({ error: 'Некорректный запрос' });
    return;
  }

  const user = await verifyLogin(username, password);
  if (!user) {
    logger.info({ username }, 'Login failed');
    res.status(401).json({ error: 'Неверный логин или пароль' });
    return;
  }

  const { sessionToken, csrfToken } = await createSession(user.id);
  const secure = cookieSecure();

  res.cookie('session', sessionToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
  res.cookie('csrf_token', csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });

  logger.info({ userId: user.id, username: user.username }, 'Login succeeded');
  res.json({
    user: { id: user.id, username: user.username, role: user.role },
  });
});

router.post('/logout', requireCsrf, async (req: Request, res: Response) => {
  const rawSession = req.cookies?.session as string | undefined;
  if (rawSession) {
    const removed = await destroySessionByRawToken(rawSession);
    logger.info({ removed }, 'Logout: session destroyed');
  }

  // clearCookie must mirror the attributes used on Set-Cookie or the browser
  // will not remove the cookie. Match what /login sets exactly (minus maxAge).
  const secure = cookieSecure();
  res.clearCookie('session', { httpOnly: true, secure, sameSite: 'lax', path: '/' });
  res.clearCookie('csrf_token', { httpOnly: false, secure, sameSite: 'lax', path: '/' });

  res.status(200).json({ success: true });
});

router.get('/me', requireAuth, (req: Request, res: Response) => {
  // requireAuth guarantees req.user is set.
  const { id, username, role } = req.user!;
  res.json({ id, username, role });
});

// Public. SPA calls this on boot to guarantee a csrf_token cookie exists.
// If the cookie is already set we do NOT rotate it, so in-flight XHR with a
// cached header keep working across tabs/refreshes. No rate-limit here (per
// task2.md — hard limit would break the F5/refresh flow).
router.get('/csrf', (req: Request, res: Response) => {
  const existing = req.cookies?.csrf_token as string | undefined;
  if (!existing) {
    const csrfToken = crypto.randomBytes(32).toString('base64url');
    res.cookie('csrf_token', csrfToken, {
      httpOnly: false,
      secure: cookieSecure(),
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
  }
  res.json({ success: true });
});

export default router;
