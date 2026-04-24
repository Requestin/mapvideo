import bcrypt from 'bcrypt';
import { pool } from '../db/pool';
import { logger } from '../utils/logger';

export type UserRole = 'admin' | 'user';

export type User = {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: Date;
};

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
  };
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, username, password_hash, role, created_at FROM users WHERE username = $1',
    [username]
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function createUser(input: {
  username: string;
  passwordHash: string;
  role: UserRole;
}): Promise<User> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (username, password_hash, role)
     VALUES ($1, $2, $3)
     RETURNING id, username, password_hash, role, created_at`,
    [input.username, input.passwordHash, input.role]
  );
  return toUser(rows[0]);
}

export async function updatePasswordHashByUsername(
  username: string,
  passwordHash: string
): Promise<void> {
  await pool.query('UPDATE users SET password_hash = $1 WHERE username = $2', [
    passwordHash,
    username,
  ]);
}

export async function listUsers(): Promise<User[]> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, username, password_hash, role, created_at FROM users ORDER BY created_at ASC'
  );
  return rows.map(toUser);
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, username, password_hash, role, created_at FROM users WHERE id = $1',
    [id]
  );
  return rows[0] ? toUser(rows[0]) : null;
}

export async function deleteUserById(id: string): Promise<boolean> {
  const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}

// task14: персональная палитра. Возвращает пустой массив, если у юзера ещё
// ничего не сохранено (миграция ставит DEFAULT '{}', но `NULL` всё равно
// нормализуем — подстраховка против обновлений «на горячую»).
export async function getUserCustomColors(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ custom_colors: string[] | null }>(
    'SELECT custom_colors FROM users WHERE id = $1',
    [userId]
  );
  if (rows.length === 0) return [];
  return rows[0].custom_colors ?? [];
}

// Полностью перезаписывает палитру. Вызывающая сторона отвечает за валидацию
// формата и длины — в сервисе хранится только запись в БД.
export async function setUserCustomColors(
  userId: string,
  colors: string[]
): Promise<void> {
  await pool.query('UPDATE users SET custom_colors = $1 WHERE id = $2', [colors, userId]);
}

// Matches task2.md contract: "минимум длина + цифра + буква".
// 8 chars is the conventional NIST minimum; stricter than nothing, looser
// than arbitrary complexity rules that push users toward reuse.
export function validatePasswordComplexity(password: string): boolean {
  if (typeof password !== 'string' || password.length < 8) return false;
  return /[A-Za-zА-Яа-яЁё]/.test(password) && /\d/.test(password);
}

// Usernames: 3-50 chars, alphanumeric + underscore/dash/dot. Matches the
// VARCHAR(50) limit in the schema and is lax enough for internal users.
export function validateUsername(username: string): boolean {
  if (typeof username !== 'string') return false;
  if (username.length < 3 || username.length > 50) return false;
  return /^[A-Za-z0-9_.\-]+$/.test(username);
}

// bcrypt rounds: 12 per task2.md "Важные моменты".
const BCRYPT_ROUNDS = 12;

// Ensures that a user `admin` exists. On first startup (empty DB) it creates one
// using ADMIN_PASSWORD from the environment. On subsequent starts it is a no-op,
// unless ADMIN_PASSWORD_ROTATE_ON_BOOT=true, in which case the hash is rewritten
// (use only for explicit rotation, e.g. after a credential leak).
export async function initAdmin(): Promise<void> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('[initAdmin] ADMIN_PASSWORD must be set in environment');
  }

  const existing = await findUserByUsername('admin');

  if (!existing) {
    const hash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);
    await createUser({ username: 'admin', passwordHash: hash, role: 'admin' });
    logger.info('Создан пользователь admin');
    return;
  }

  if (process.env.ADMIN_PASSWORD_ROTATE_ON_BOOT === 'true') {
    const hash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);
    await updatePasswordHashByUsername('admin', hash);
    logger.warn('Пароль admin обновлён из ADMIN_PASSWORD (режим rotate_on_boot)');
  }
}
