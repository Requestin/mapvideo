# Фаза 2 — Авторизация (бэкенд)

**Статус:** Не начато
**Связанные файлы:** cursor.md, SPEC.md (раздел "Пользователи и авторизация")
**Зависит от:** task1.md — PostgreSQL должен быть запущен
**Следующая фаза:** task3.md (фронтенд использует API созданное здесь)

---

## Цель фазы
Реализовать полную систему авторизации на бэкенде: база данных пользователей,
JWT сессии, защищённые маршруты, API для admin панели.
---

## Skills для этой фазы

| Skill | Когда активировать |
|-------|--------------------|
| **mastering-typescript** | При написании TypeScript кода |
| **owasp-security** | При реализации авторизации, JWT, bcrypt, сессий |
| **vibesec-skill** | При любых операциях с паролями, токенами и доступом |

---

## Задачи

- [ ] Инициализировать backend проект (Node.js 20 + TypeScript + Express)
- [ ] Настроить подключение к PostgreSQL (pg pool)
- [ ] Создать миграции БД (users, sessions, render_jobs, videos)
- [ ] Настроить cookie-parser + CSRF middleware (double-submit)
- [ ] Настроить rate limiter (express-rate-limit) на /api/auth/login
- [ ] Настроить structured logger (pino)
- [ ] POST /api/auth/login (ставит httpOnly session cookie + csrf_token cookie)
- [ ] POST /api/auth/logout (удаляет cookies + запись из sessions)
- [ ] GET /api/auth/me (читает session cookie)
- [ ] GET /api/auth/csrf (возвращает текущий csrf_token, для SPA после F5)
- [ ] Middleware requireAuth (проверяет session cookie и наличие в БД)
- [ ] Middleware requireAdmin (проверяет роль admin)
- [ ] Middleware requireCsrf (сравнивает cookie и заголовок для POST/PUT/DELETE)
- [ ] GET /api/admin/users
- [ ] POST /api/admin/users
- [ ] DELETE /api/admin/users/:id
- [ ] GET /api/geocode/search?q=... (проксирование Photon, для task5)
- [ ] GET /api/health (публичный)
- [ ] Создать дефолтного пользователя admin при первом запуске
- [ ] Graceful shutdown: дождаться завершения активных рендеров на SIGTERM
- [ ] Написать тесты (Jest)

---

## Схема базы данных

Имена таблиц/колонок — английский (ORM, миграции, SQL без кавычек). Комментарии — русский.

```sql
-- Пользователи
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Сессии (хранится ТОЛЬКО хэш токена — если БД утечёт, сессии нельзя угнать)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,   -- sha256 от токена в cookie
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Задачи рендера (переживают рестарт бэкенда, нужно для восстановления прогресса)
CREATE TABLE render_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'done', 'error', 'cancelled')),
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  state_json JSONB NOT NULL,
  output_path VARCHAR(255),
  thumbnail_path VARCHAR(255),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- История видео (готовые файлы)
CREATE TABLE videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES render_jobs(id) ON DELETE SET NULL,
  filename VARCHAR(255) NOT NULL,
  thumbnail_path VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON sessions(token_hash);
CREATE INDEX ON sessions(user_id);
CREATE INDEX ON render_jobs(user_id, status);
CREATE INDEX ON videos(user_id, created_at DESC);
```

---

## API эндпоинты

### POST /api/auth/login
```typescript
// Запрос
{ username: string, password: string }

// Ответ 200 — ставит два cookie и возвращает пользователя
// Set-Cookie: session=<opaque_token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
// Set-Cookie: csrf_token=<random>; Secure; SameSite=Lax; Path=/; Max-Age=2592000
{
  user: { id: string, username: string, role: 'admin' | 'user' }
}
// Ответ 401: { ошибка: "Неверный логин или пароль" }
// Ответ 429: { ошибка: "Слишком много попыток, попробуйте через N минут" }
```

### POST /api/auth/logout
```typescript
// Использует session cookie (отправляется автоматически)
// Требует X-CSRF-Token заголовок совпадающий с csrf_token cookie
// Ответ 200: { success: true }
// Удаляет запись из sessions и очищает cookies
```

### GET /api/auth/me
```typescript
// Читает session cookie
// Ответ 200: { id, username, role }
// Ответ 401: { ошибка: "Не авторизован" }
```

### GET /api/auth/csrf
```typescript
// Публичный. Возвращает текущий csrf_token cookie (или ставит новый если нет).
// SPA зовёт при старте чтобы получить токен для заголовка X-CSRF-Token.
// Ответ 200: { csrfToken: string }
```

### GET /api/admin/users
```typescript
// Только роль admin
// Ответ 200: { users: [{ id, username, role, createdAt }] }
```

### POST /api/admin/users
```typescript
// Только роль admin, требует X-CSRF-Token
// Запрос: { username: string, password: string }
// Ответ 201: { id, username, role }
// Ответ 409: { ошибка: "Пользователь с таким логином уже существует" }
```

### DELETE /api/admin/users/:id
```typescript
// Только роль admin, требует X-CSRF-Token
// Ответ 200: { success: true }
// Ответ 403: { ошибка: "Нельзя удалить пользователя admin" }
// Ответ 404: { ошибка: "Пользователь не найден" }
```

### GET /api/health
```typescript
// Публичный эндпоинт
// Ответ 200: { status: "ok", time: "ISO8601" }
```

---

## Реализация сессий (opaque token в cookie)

JWT не используем. Вместо этого — opaque random token в httpOnly cookie + запись в `sessions`. В БД хранится только sha256-хэш токена.

```typescript
// Создание сессии при логине
import crypto from 'node:crypto';

async function createSession(userId: string): Promise<{ token: string, csrf: string }> {
  const token = crypto.randomBytes(32).toString('base64url');   // 256 бит энтропии
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const csrf = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);  // 30 дней

  await db.query(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt]
  );
  return { token, csrf };
}

// Middleware requireAuth
async function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ ошибка: 'Не авторизован' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = await findSessionByHash(tokenHash);
  if (!session || session.expires_at < new Date()) {
    return res.status(401).json({ ошибка: 'Не авторизован' });
  }
  req.user = await findUserById(session.user_id);
  next();
}

// Middleware requireCsrf (для POST/PUT/DELETE/PATCH)
function requireCsrf(req, res, next) {
  const cookie = req.cookies.csrf_token;
  const header = req.header('X-CSRF-Token');
  if (!cookie || !header || cookie !== header) {
    return res.status(403).json({ ошибка: 'CSRF проверка не пройдена' });
  }
  next();
}

// Установка cookies при логине
res.cookie('session', token, {
  httpOnly: true,
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
});
res.cookie('csrf_token', csrf, {
  httpOnly: false,   // читается из JS для заголовка
  secure: process.env.COOKIE_SECURE === 'true',
  sameSite: 'lax',
  maxAge: 30 * 24 * 60 * 60 * 1000,
});
```

## Rate limit на логин

```typescript
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,                    // 5 неудачных попыток
  skipSuccessfulRequests: true,
  message: { ошибка: 'Слишком много попыток, попробуйте через 10 минут' },
});

router.post('/auth/login', loginLimiter, /* handler */);
```

---

## Инициализация admin пользователя

При первом запуске проверить наличие пользователя admin.
Если нет — создать с паролем из переменной окружения `ADMIN_PASSWORD`.

```typescript
async function initAdmin(): Promise<void> {
  const existing = await findUserByUsername('admin');
  if (!existing) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD!, 12);
    await createUser({ username: 'admin', passwordHash: hash, role: 'admin' });
    логгер.info('Создан пользователь admin');
  }
}
// Вызывать при старте сервера
```

---

## Структура бэкенда

```
backend/src/
├── сервер.ts                    # Точка входа, Express приложение
├── маршруты/
│   ├── авторизация.ts           # /api/auth/*
│   ├── администратор.ts         # /api/admin/*
│   └── здоровье.ts              # /api/health
├── сервисы/
│   ├── авторизация.сервис.ts    # Логика логина/логаута
│   └── пользователи.сервис.ts   # CRUD пользователей
├── мидлвары/
│   ├── проверить-токен.ts       # JWT middleware
│   └── проверить-роль.ts        # Role middleware
├── база-данных/
│   ├── подключение.ts           # PostgreSQL connection pool
│   └── миграции/                # SQL миграции
└── утилиты/
    └── ошибки.ts                # Стандартные ответы с ошибками
```

---

## Важные моменты

1. **bcrypt rounds:** использовать 12 раундов хэширования
2. **JWT secret:** минимум 64 символа, хранить только в .env
3. **Сессии в БД:** это позволяет инвалидировать токен при logout
   (без этого JWT живёт до истечения срока даже после выхода)
4. **Автозапуск инициализации:** функция `инициализироватьAdmin()`
   должна вызываться при каждом старте сервера
5. **Защита /api/admin/:** двойная проверка — сначала токен, потом роль admin

---

## Заметка для следующей сессии
*(заполняется завершения задачи или перед завершением сессии)*
