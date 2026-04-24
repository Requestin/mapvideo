import type { Request, Response, NextFunction } from 'express';

// Double-submit CSRF: client reads csrf_token cookie (httpOnly=false) and sends
// its value in the X-CSRF-Token header on mutating requests. Values must match.
// The cookie itself is set by /api/auth/login and /api/auth/csrf.
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  const cookie = req.cookies?.csrf_token as string | undefined;
  const header = req.header('X-CSRF-Token');

  if (!cookie || !header || cookie !== header) {
    res.status(403).json({ error: 'CSRF проверка не пройдена' });
    return;
  }

  next();
}
