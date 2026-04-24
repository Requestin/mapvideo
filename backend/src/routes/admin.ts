import bcrypt from 'bcrypt';
import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/require-auth';
import { requireAdmin } from '../middleware/require-admin';
import { requireCsrf } from '../middleware/require-csrf';
import {
  listUsers,
  createUser,
  findUserByUsername,
  findUserById,
  deleteUserById,
  validatePasswordComplexity,
  validateUsername,
} from '../services/users-service';
import { logger } from '../utils/logger';

const router = Router();

// Same bcrypt cost as initAdmin — keep it in one place mentally (12 rounds).
const BCRYPT_ROUNDS = 12;

// All /api/admin/* requires auth + admin role. Mutating routes additionally
// require CSRF double-submit. Mounted in strict order: auth → admin → csrf.
router.use(requireAuth, requireAdmin);

router.get('/users', async (_req: Request, res: Response) => {
  const users = await listUsers();
  res.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
    })),
  });
});

router.post('/users', requireCsrf, async (req: Request, res: Response) => {
  const { username, password } = (req.body ?? {}) as {
    username?: unknown;
    password?: unknown;
  };

  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Некорректный запрос' });
    return;
  }
  if (!validateUsername(username)) {
    res.status(400).json({ error: 'Некорректное имя пользователя' });
    return;
  }
  if (!validatePasswordComplexity(password)) {
    res.status(400).json({ error: 'Пароль слишком простой' });
    return;
  }

  const existing = await findUserByUsername(username);
  if (existing) {
    res.status(409).json({ error: 'Пользователь с таким логином уже существует' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const created = await createUser({ username, passwordHash, role: 'user' });

  logger.info({ userId: created.id, username: created.username }, 'Admin created user');
  res.status(201).json({ id: created.id, username: created.username, role: created.role });
});

router.delete('/users/:id', requireCsrf, async (req: Request, res: Response) => {
  const rawId = req.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const actor = req.user!;

  const target = await findUserById(id);
  if (!target) {
    res.status(404).json({ error: 'Пользователь не найден' });
    return;
  }

  // Order matters: check username='admin' before self-check so the admin
  // account is always untouchable even if someone logs in as admin.
  if (target.username === 'admin') {
    res.status(403).json({ error: 'Нельзя удалить пользователя admin' });
    return;
  }
  if (target.id === actor.id) {
    res.status(403).json({ error: 'Нельзя удалить самого себя' });
    return;
  }

  await deleteUserById(id);
  logger.info(
    { actorId: actor.id, targetId: target.id, targetUsername: target.username },
    'Admin deleted user'
  );
  res.json({ success: true });
});

export default router;
