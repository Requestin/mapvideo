import { Router, type Request, type Response } from 'express';

const router = Router();

// Public, no auth. Matches the Docker compose healthcheck command and lets
// the host-level nginx probe liveness without creds.
router.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

export default router;
