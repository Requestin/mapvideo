import type { Request, Response, NextFunction } from 'express';

// Assumes requireAuth ran first and populated req.user. 403 on non-admin,
// 500 on missing user (programmer error — requireAdmin was mounted without
// requireAuth). Keeping it strict surfaces the bug early instead of silently
// letting anonymous requests through.
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(500).json({ error: 'requireAdmin используется без requireAuth' });
    return;
  }
  if (req.user.role !== 'admin') {
    res.status(403).json({ error: 'Требуются права администратора' });
    return;
  }
  next();
}
