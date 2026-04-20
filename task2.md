# Фаза 2 — Авторизация (бэкенд)

**Статус:** Не начато
**Связанные файлы:** cursor.md, SPEC.md (раздел "Пользователи и авторизация")
**Зависит от:** task1.md — PostgreSQL должен быть запущен
**Следующая фаза:** task3.md (фронтенд использует API созданное здесь)

---

## Цель фазы
Реализовать полную систему авторизации на бэкенде: база данных пользователей,
cookie-based сессии (opaque token), защищённые маршруты, API для admin панели.
---

## Skills для этой фазы

| Skill | Когда активировать |
|-------|--------------------|
| **mastering-typescript** | При написании TypeScript кода |
| **owasp-security** | При реализации авторизации, bcrypt, session cookie и CSRF |
| **vibesec-skill** | При security-аудите auth/session flow и проверке уязвимостей |
| **api-contract-checker** | При изменении `/api/auth/*`, `/api/admin/*`, `/api/geocode/*` контрактов |
| **spec-driven-workflow** | Для контроля выполнения шагов и синхронизации с `SPEC.md`/`task2.md` |

### Когда skill указывать явно

- Явно указывать **owasp-security**/**vibesec-skill** при любой работе с auth, сессиями и доступами.
- Явно указывать **api-contract-checker**, если меняются request/response DTO, status codes или error format.
- Явно указывать **spec-driven-workflow**, если параллельно правятся код и task-документация.

---

## Задачи

- [ ] Инициализировать backend проект (Node.js 20 + TypeScript + Express)
- [ ] Настроить подключение к PostgreSQL (pg pool)
- [ ] Создать миграции БД (users, sessions, render_jobs, render_tokens)
- [ ] Настроить cookie-parser + CSRF middleware (double-submit)
- [ ] Настроить rate limiter (express-rate-limit) на /api/auth/login
- [ ] Настроить structured logger (pino)
- [ ] POST /api/auth/login (ставит httpOnly session cookie + csrf_token cookie; CSRF не требуется, см. ниже)
- [ ] POST /api/auth/logout (удаляет cookies + запись из sessions; требует X-CSRF-Token)
- [ ] GET /api/auth/me (читает session cookie)
- [ ] GET /api/auth/csrf (ставит csrf_token cookie при отсутствии; для SPA после F5)
- [ ] Middleware requireAuth (проверяет session cookie и наличие в БД)
- [ ] Middleware requireAdmin (проверяет роль admin)
- [ ] Middleware requireCsrf (сравнивает cookie и заголовок для POST/PUT/DELETE/PATCH)
- [ ] GET /api/admin/users
- [ ] POST /api/admin/users
- [ ] DELETE /api/admin/users/:id (запрещено удалять username='admin' и самого себя)
- [ ] GET /api/geocode/search?q=... (проксирование Photon + rate-limit, для task5)
- [ ] GET /api/fonts (список файлов из assets/fonts/ для task5)
- [ ] GET /api/health (публичный)
- [ ] Создать дефолтного пользователя admin при первом запуске
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

-- Задачи рендера и история видео в одной таблице.
-- История "Моя история" = SELECT * FROM render_jobs WHERE status='done' ORDER BY updated_at DESC.
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

CREATE INDEX ON sessions(token_hash);
CREATE INDEX ON sessions(user_id);
CREATE INDEX ON render_jobs(user_id, status);
CREATE INDEX ON render_jobs(user_id, updated_at DESC) WHERE status = 'done';

-- Внутренние одноразовые токены для /api/render/state/:jobId (Puppeteer)
CREATE TABLE render_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES render_jobs(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON render_tokens(job_id);
CREATE INDEX ON render_tokens(expires_at);
```

---

## API эндпоинты

### POST /api/auth/login
```typescript
// Запрос
{ username: string, password: string }

// CSRF НЕ требуется (до успешного логина у клиента нет csrf_token cookie).
// Защита от cross-site логина обеспечивается:
//  - SameSite=Lax на будущих cookies
//  - rate-limit: 5 неудачных попыток с IP за 10 минут
//  - форма логина на том же origin

// Ответ 200 — ставит два cookie и возвращает пользователя
// Set-Cookie: session=<opaque_token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
// Set-Cookie: csrf_token=<random>; Secure; SameSite=Lax; Path=/; Max-Age=2592000
{
  user: { id: string, username: string, role: 'admin' | 'user' }
}
// Ответ 401: { error: "Неверный логин или пароль" }
// Ответ 429: { error: "Слишком много попыток, попробуйте через N минут" }
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
// Ответ 401: { error: "Не авторизован" }
```

### GET /api/auth/csrf
```typescript
// Публичный. Гарантирует наличие csrf_token cookie (ставит новый если cookie нет).
// SPA зовёт при старте, затем читает csrf_token из document.cookie для X-CSRF-Token.
// Ответ 200: { success: true }   // тело опционально, источник истины — cookie
// Важно: жёсткий rate-limit сюда не ставим, иначе ломается нормальный F5/refresh flow.
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
// Ответ 409: { error: "Пользователь с таким логином уже существует" }
// Ответ 400: { error: "Пароль слишком простой" } // минимум длина + цифра + буква
```

### DELETE /api/admin/users/:id
```typescript
// Только роль admin, требует X-CSRF-Token
// Запрещено удалять пользователя с username='admin' и самого себя
// Ответ 200: { success: true }
// Ответ 403: { error: "Нельзя удалить пользователя admin" }
// Ответ 403: { error: "Нельзя удалить самого себя" }
// Ответ 404: { error: "Пользователь не найден" }
```

### GET /api/fonts
```typescript
// Только авторизованные
// Возвращает список файлов из assets/fonts/ (кешируется в памяти на старте)
// Ответ 200: { fonts: [{ family: string, fileName: string, url: string }] }
// url = "/assets/fonts/<fileName>" — фронт подключает через @font-face
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
// Create session on login
import crypto from 'node:crypto';

async function createSession(userId: string): Promise<{ token: string, csrf: string }> {
  const token = crypto.randomBytes(32).toString('base64url');   // 256-bit entropy
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const csrf = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);  // 30 days

  await db.query(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt]
  );
  return { token, csrf };
}

// requireAuth middleware
async function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Не авторизован' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const session = await findSessionByHash(tokenHash);
  if (!session || session.expires_at < new Date()) {
    return res.status(401).json({ error: 'Не авторизован' });
  }
  req.user = await findUserById(session.user_id);
  next();
}

// requireCsrf middleware (POST/PUT/DELETE/PATCH)
function requireCsrf(req, res, next) {
  const cookie = req.cookies.csrf_token;
  const header = req.header('X-CSRF-Token');
  if (!cookie || !header || cookie !== header) {
    return res.status(403).json({ error: 'CSRF проверка не пройдена' });
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
  httpOnly: false,   // read by SPA to send X-CSRF-Token
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
  max: 5,                    // 5 failed attempts
  skipSuccessfulRequests: true,
  message: { error: 'Слишком много попыток, попробуйте через 10 минут' },
});

router.post('/auth/login', loginLimiter, /* handler */);
```

`GET /api/auth/csrf` можно оставить без rate-limit или с мягким лимитом (например, 120 req/min),
но не с "security-лимитом" логина.

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
    logger.info('Создан пользователь admin');
    return;
  }

  // Опционально: принудительная ротация пароля admin при старте.
  // Использовать только осознанно (например, при инциденте), чтобы не ломать обычный flow.
  if (process.env.ADMIN_PASSWORD_ROTATE_ON_BOOT === 'true') {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD!, 12);
    await db.query('UPDATE users SET password_hash = $1 WHERE username = $2', [hash, 'admin']);
    logger.warn('Пароль admin обновлён из ADMIN_PASSWORD (режим rotate_on_boot)');
  }
}
// Вызывать при старте сервера
```

---

## Структура бэкенда

Все имена файлов и папок — английский (правило проекта).

```
backend/src/
├── server.ts                    # Точка входа, Express приложение
├── routes/
│   ├── auth.ts                  # /api/auth/*
│   ├── admin.ts                 # /api/admin/*
│   ├── geocode.ts               # /api/geocode/*  (см. task5)
│   ├── fonts.ts                 # /api/fonts
│   └── health.ts                # /api/health
├── services/
│   ├── auth-service.ts          # Логика логина/логаута, создание сессий
│   └── users-service.ts         # CRUD пользователей
├── middleware/
│   ├── require-auth.ts          # Session middleware
│   ├── require-admin.ts         # Role middleware
│   ├── require-csrf.ts          # CSRF double-submit
│   └── rate-limit.ts            # Rate-limit для /auth/*
├── db/
│   ├── pool.ts                  # PostgreSQL connection pool
│   └── migrations/              # SQL миграции
└── utils/
    ├── errors.ts                # Стандартные ответы с ошибками (формат { error })
    └── logger.ts                # pino logger
```

---

## Важные моменты

1. **bcrypt rounds:** использовать 12 раундов хэширования
2. **Сессии в БД:** opaque-токен генерируется через `crypto.randomBytes(32)`, в БД
   хранится только его `sha256`-хэш. При logout запись удаляется — токен сразу
   недействителен (в отличие от stateless JWT)
3. **Автозапуск инициализации:** функция `initAdmin()`
   должна вызываться при каждом старте сервера
4. **Защита /api/admin/:** двойная проверка — сначала `requireAuth`, потом `requireAdmin`
5. **Защита от self-delete:** в обработчике `DELETE /api/admin/users/:id`
   запретить удаление `username='admin'` **и** удаление `req.user.id === :id`
6. **Graceful shutdown рендера:** относится к очереди рендера и реализуется в `task8.md`,
   а не в фазе авторизации

---

## Заметка для следующей сессии
*(заполняется завершения задачи или перед завершением сессии)*
