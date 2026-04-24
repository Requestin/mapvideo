import type { Request, Response, NextFunction } from 'express';
import { findUserByRawSessionToken } from '../services/auth-service';

// Populates `req.user` from the opaque `session` cookie. Returns 401 when the
// cookie is missing, unknown, or the session has expired (checked at the DB
// level via `expires_at > NOW()`).
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const rawToken = req.cookies?.session as string | undefined;
  if (!rawToken) {
    res.status(401).json({ error: 'Не авторизован' });
    return;
  }

  const user = await findUserByRawSessionToken(rawToken);
  if (!user) {
    res.status(401).json({ error: 'Не авторизован' });
    return;
  }

  req.user = user;
  next();
}
