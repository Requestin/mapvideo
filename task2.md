# Фаза 2 — Авторизация (бэкенд)

**Статус:** ✅ Сделано
**Связанные файлы:** cursor.md, SPEC.md (раздел "Пользователи и авторизация")
**Зависит от:** task1.md — PostgreSQL должен быть запущен
**Следующая фаза:** task3.md (фронтенд использует API созданное здесь)

---

## Цель фазы

## Реализовать полную систему авторизации на бэкенде: база данных пользователей,

cookie-based сессии (opaque token), защищённые маршруты, API для admin панели.

## Skills для этой фазы


| Skill                    | Когда активировать                                                       |
| ------------------------ | ------------------------------------------------------------------------ |
| **mastering-typescript** | При написании TypeScript кода                                            |
| **owasp-security**       | При реализации авторизации, bcrypt, session cookie и CSRF                |
| **vibesec-skill**        | При security-аудите auth/session flow и проверке уязвимостей             |
| **api-contract-checker** | При изменении `/api/auth/`*, `/api/admin/`*, `/api/geocode/*` контрактов |
| **spec-driven-workflow** | Для контроля выполнения шагов и синхронизации с `SPEC.md`/`task2.md`     |


### Когда skill указывать явно

- Явно указывать **owasp-security**/**vibesec-skill** при любой работе с auth, сессиями и доступами.
- Явно указывать **api-contract-checker**, если меняются request/response DTO, status codes или error format.
- Явно указывать **spec-driven-workflow**, если параллельно правятся код и task-документация.

---

## Задачи

- Инициализировать backend проект (Node.js 20 + TypeScript + Express)
- Настроить подключение к PostgreSQL (pg pool)
- Создать миграции БД (users, sessions, render_jobs, render_tokens)
- Настроить cookie-parser + CSRF middleware (double-submit)
- Настроить rate limiter (express-rate-limit) на /api/auth/login
- Настроить structured logger (pino)
- POST /api/auth/login (ставит httpOnly session cookie + csrf_token cookie; CSRF не требуется, см. ниже)
- POST /api/auth/logout (удаляет cookies + запись из sessions; требует X-CSRF-Token)
- GET /api/auth/me (читает session cookie)
- GET /api/auth/csrf (ставит csrf_token cookie при отсутствии; для SPA после F5)
- Middleware requireAuth (проверяет session cookie и наличие в БД)
- Middleware requireAdmin (проверяет роль admin)
- Middleware requireCsrf (сравнивает cookie и заголовок для POST/PUT/DELETE/PATCH)
- GET /api/admin/users
- POST /api/admin/users
- DELETE /api/admin/users/:id (запрещено удалять username='admin' и самого себя)
- GET /api/geocode/search?q=... (проксирование Photon + rate-limit, для task5)
- GET /api/fonts (список файлов из assets/fonts/ для task5)
- GET /api/health (публичный)
- Создать дефолтного пользователя admin при первом запуске
- Написать тесты (Jest)

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

### ✅ Задача 1/22 закрыта: Инициализация backend проекта

Созданы файлы:

- `backend/package.json` — `express@^5.2.1`, dev: `typescript@^6.0.3`, `tsx@^4.21.0`, `@types/express@^5.0.6`, `@types/node@^25.6.0`. Скрипты: `dev` (tsx watch), `build` (tsc), `start` (node dist/server.js), `typecheck` (tsc --noEmit).
- `backend/tsconfig.json` — target ES2022, module commonjs, moduleResolution **node10** + `ignoreDeprecations:"6.0"` (в TS6 старое `node` переименовано в `node10` с deprecation warning; делать `node16`/`bundler` сейчас рано — task-снипеты используют импорты без `.js` extension, что node16 потребовал бы переписывать).
- `backend/src/server.ts` — минимальный Express bootstrap: `app.disable('x-powered-by')` + `listen(PORT || 3001)`. Роуты не добавлены (health/auth/admin/geocode/fonts — отдельные задачи).
- `backend/.gitignore` — `node_modules/`, `dist/`, `*.log`.

Правки вне нового файла:

- `backend/Dockerfile`: `CMD ["node", "dist/index.js"]` → `CMD ["node", "dist/server.js"]`. Это устранение несостыковки: task2.md структура указывает `src/server.ts` как точку входа, а Dockerfile-шаблон из task1.md жёстко требовал `dist/index.js`.

Проверено:

- `npm run typecheck` → 0 ошибок.
- `npm run build` → создан `dist/server.js`.
- `node dist/server.js` → лог `[server] Mapvideo backend listening on port 3001`, `curl 127.0.0.1:3001/` → 404 (ожидаемо, роутов нет).

### ✅ Задача 2/22 закрыта: PostgreSQL pool

Созданы файлы:

- `backend/src/db/pool.ts` — единый `Pool` из `pg`. Берёт `POSTGRES_USER/PASSWORD/DB` из env (есть в `.env` проекта), хост по умолчанию `'postgres'` (имя compose-сервиса — внутри compose-сети резолвится), переопределяется `POSTGRES_HOST`. Параметры: `max: 20`, `idleTimeoutMillis: 30s`, `connectionTimeoutMillis: 5s`. Обработчик `pool.on('error')` логирует, но не роняет процесс.
- Удалён `backend/src/db/.gitkeep` (каталог больше не пуст).

Установлены зависимости:

- `pg@^8.16.x` (dependency).
- `@types/pg@^8.15.x` (devDependency).

Решение по env-переменным (user выбрал "наилучший вариант"):

- Не добавлять `DATABASE_URL` в `.env`/cursor.md — cursor.md жёстко фиксирует блок env-переменных для PostgreSQL, и добавление новых переменных без необходимости ломает правило "не трогать архитектурные решения".
- В compose backend уже получает `POSTGRES_USER/PASSWORD/DB` через `env_file: .env` → внутри docker-сети `host: 'postgres'` работает без дополнительной настройки.
- Для локальной разработки (tsx вне compose) — переопределение `POSTGRES_HOST=127.0.0.1` (compose биндит `127.0.0.1:5432:5432`).

Проверено:

- `npm run typecheck` → 0 ошибок.
- `npm run build` → dist/server.js + dist/db/pool.js.
- Реальный коннект к запущенному postgres (через временный tsx-скрипт): `SELECT NOW(), version()` вернул `PostgreSQL 16.4`; запрос `pg_database` увидел обе БД `mapvideo` и `gis`. Временный скрипт удалён, dist пересобран чисто.

### ✅ Задача 3/22 закрыта: Миграции БД

Принятое решение: **собственный минимальный SQL-runner** (а не `node-pg-migrate`/`drizzle-kit`). Причины:

- cursor.md не фиксирует migration-tool, только путь `backend/src/db/migrations/`.
- Нулевая зависимость — `pg` уже стоит, никаких CLI/конфигов тянуть не нужно.
- SQL из task2.md переносится 1:1 без переинтерпретации в DSL.
- Для серверного проекта достаточно forward-only миграций; rollback не предусмотрен (если нужно — отдельная миграция, которая отменит предыдущую).

Созданы файлы:

- `backend/src/db/migrations/001_initial.sql` — весь SQL из task2.md (строки 65-114): таблицы `users`, `sessions`, `render_jobs`, `render_tokens` + 4 вторичных индекса (включая partial `WHERE status='done'`) + все CHECK-констрейнты.
- `backend/src/db/migrate.ts` — runner:
  - Создаёт служебную таблицу `schema_migrations (version TEXT PK, applied_at TIMESTAMPTZ)`.
  - Сканирует `./migrations/*.sql`, сортирует по имени.
  - Применяет каждую недостающую миграцию в своей транзакции (`BEGIN`/`COMMIT` на файл) → при ошибке rollback, runner падает.
  - Идемпотентен: повторный запуск пишет `nothing to apply, schema up to date`.
  - Работает и в dev (tsx → `src/db/migrations`), и в prod (node → `dist/db/migrations`, `__dirname` резолвится корректно).
  - Guard `require.main === module` — можно импортировать `runMigrations` из `server.ts` в будущем без побочных эффектов.

Правки в `backend/package.json`:

- Скрипт `build` теперь `tsc && npm run copy:assets` — SQL-файлы не компилируются, их нужно копировать в `dist/db/migrations/` отдельно.
- Новый скрипт `copy:assets` делает `cp src/db/migrations/*.sql dist/db/migrations/`.
- Новые скрипты `db:migrate` (tsx) и `db:migrate:prod` (node dist).

Проверено:

- `npm run typecheck` → 0 ошибок.
- `npm run build` → `dist/db/migrate.js` + `dist/db/migrations/001_initial.sql`.
- `npm run db:migrate` (dev) → `[migrate] applied 001_initial`.
- Повторный `npm run db:migrate` → `[migrate] nothing to apply, schema up to date` (идемпотентность).
- `npm run db:migrate:prod` (node dist) → `nothing to apply` (prod-путь тоже находит SQL).
- В БД `mapvideo`: 5 таблиц (`users`, `sessions`, `render_jobs`, `render_tokens`, `schema_migrations`), 14 индексов (включая partial `render_jobs_user_id_updated_at_idx ... WHERE status='done'`), 3 CHECK-констрейнта (`users.role`, `render_jobs.progress 0..100`, `render_jobs.status`), FK с `ON DELETE CASCADE`.

### ✅ Задача 4/22 закрыта: cookie-parser + CSRF middleware

Установлены: `cookie-parser@^1.4.7` (dep), `@types/cookie-parser@^1.4.10` (devDep).

Изменения:

- `backend/src/server.ts` — добавлено `import cookieParser from 'cookie-parser'` и `app.use(cookieParser())` после `app.disable('x-powered-by')`.
- `backend/src/middleware/require-csrf.ts` — создан. Читает `req.cookies?.csrf_token` и `req.header('X-CSRF-Token')`, сравнивает через `!==`, возвращает 403 `{ error: 'CSRF проверка не пройдена' }` при несовпадении/отсутствии. Middleware **не подключён глобально** — он вешается только на мутирующие роуты позже. `/auth/login` и `/auth/csrf` CSRF не требуют (см. task2.md).
- Удалён `backend/src/middleware/.gitkeep`.

Проверено (5 кейсов через временный tsx-скрипт, удалён после проверки):

1. `cookie-parser` корректно распарсил `Cookie: foo=bar; csrf_token=abc123` → `req.cookies = { foo: 'bar', csrf_token: 'abc123' }`.
2. `POST` без cookie и без заголовка → 403 с точным русским текстом.
3. Только cookie → 403.
4. Cookie + заголовок, но разные → 403.
5. Cookie === заголовок → 200 next().

### ⚠️ Gotcha обнаруженный в ходе задачи (читать перед каждой следующей сессией!)

В `/root/mapvideo/.env` есть строка `NODE_ENV=production` (из шаблона cursor.md). Когда в терминале делаешь `set -a; source ../.env; set +a` (например, для `POSTGRES_HOST=127.0.0.1 npm run db:migrate`), `NODE_ENV=production` утекает в окружение → **следующий `npm install` автоматически ставит `omit=dev`** и удаляет `typescript`, `tsx`, `@types/*`. Симптом: `npm run typecheck` → `sh: tsc: not found`.

Способы избежать:

- Запускать `npm install` в отдельной подсессии: `(unset NODE_ENV && npm install --include=dev)`.
- Либо в начале каждого нового шага: `unset NODE_ENV`.
- Либо явно передавать `NODE_ENV=development npm install` или `npm install --include=dev`.

**Починка при симптоме**: `rm -rf node_modules package-lock.json && unset NODE_ENV && npm install --include=dev`.

### ✅ Задача 5/22 закрыта: rate-limiter на /api/auth/login

Установлен: `express-rate-limit@^8.3.2` (dependency).

Создан `backend/src/middleware/rate-limit.ts` — экспорт `loginLimiter`:

- `windowMs: 10 * 60 * 1000` (10 минут)
- `limit: 5` (в v7/v8 `max` переименован в `limit`; эффект идентичен шаблону task2.md с `max: 5`)
- `skipSuccessfulRequests: true` — 2xx ответы не инкрементируют счётчик, так что легитимный пользователь, который один раз опечатался и потом залогинился, не блокируется
- `standardHeaders: 'draft-7'` + `legacyHeaders: false` — современные `RateLimit-`* заголовки (IETF RFC draft-7) вместо устаревших `X-RateLimit-`*
- `message: { error: 'Слишком много попыток, попробуйте через 10 минут' }` — точный русский текст из шаблона task2.md

Middleware **не подключён ни к одному роуту** — `/auth/login` появится в задаче 7/22, тогда он и повесит `loginLimiter` перед хендлером.

Проверено (3 кейса через временный tsx-скрипт, удалён):

1. 6 `POST /fail` подряд (handler всегда 401): коды `[401, 401, 401, 401, 401, 429]` — ровно 5 проходов, на 6-м срабатывает лимит.
2. Тело 429-ответа = `{ error: 'Слишком много попыток, попробуйте через 10 минут' }` — точное совпадение.
3. `POST /ok` со свежим лимитером и handler 200 → 10 раз подряд, все 200 — `skipSuccessfulRequests` работает корректно.

`npm run typecheck` → 0 ошибок. `npm run build` → `dist/middleware/rate-limit.js` собран.

### ✅ Задача 6/22 закрыта: structured logger (pino)

Установлены: `pino@^10.3.1` (dep), `pino-pretty@^13.1.3` (devDep).

Создан `backend/src/utils/logger.ts` — экспорт `logger`:

- `name: 'mapvideo-backend'`
- `level` из `process.env.LOG_LEVEL`, default `'info'`
- В prod (`NODE_ENV=production`) — plain NDJSON в stdout (готово для любого log-collector'а)
- В dev — `pino-pretty` transport с `colorize`, `translateTime: 'HH:MM:ss.l'`, `ignore: 'pid,hostname'`
- **Redact** на ключах `password`, `password_hash`, `token` (включая nested `*.password` и т.п.) с заменой на `'[REDACTED]'`

server.ts **не** тронут: там остаётся `console.log` на старте. Замена на `logger.info` — следующая итерация (после того как в server.ts появится импорт utils-модулей).

Проверено (смоук через временный tsx-скрипт, удалён):

- `NODE_ENV=production LOG_LEVEL=info` → NDJSON, 3 строки (info/warn/error), debug подавлен.
- `NODE_ENV=production LOG_LEVEL=debug` → NDJSON, 4 строки (debug/info/warn/error).
- `unset NODE_ENV; LOG_LEVEL=debug` → цветной pretty-вывод без pid/hostname.
- `password: 'topsecret'` в логе появляется как `"password":"[REDACTED]"` во всех трёх режимах — redact работает.

### ✅ Задача 21/22 закрыта (выполнена вне порядка): initAdmin

Пользователь выбрал сделать админа раньше POST /login, чтобы e2e login-flow был тестируемым.

Установлены: `bcrypt@^6.0.0` (dep), `@types/bcrypt@^6.0.0` (devDep).

Созданы/изменены:

- `backend/src/services/users-service.ts` — минимум для initAdmin:
  - Тип `User` (camelCase) + `UserRow` (snake_case из БД) + mapper `toUser()`.
  - `findUserByUsername(username)` → `User | null`.
  - `createUser({username, passwordHash, role})` → возвращает созданную запись (RETURNING).
  - `updatePasswordHashByUsername(username, hash)`.
  - `initAdmin()` по шаблону task2.md (строки 290-309): ищет admin'а, при отсутствии — bcrypt($12) hash из `ADMIN_PASSWORD` + createUser, логирует `info 'Создан пользователь admin'`; при наличии и `ADMIN_PASSWORD_ROTATE_ON_BOOT=true` — переписывает hash, логирует `warn`. Бросает ошибку, если `ADMIN_PASSWORD` не задан.
  - Полный CRUD пользователей для admin-панели (GET/POST/DELETE) — отдельная задача 14-16/22, в этом файле пока не добавлен.
- `backend/src/server.ts` — теперь вызывает `initAdmin()` перед `app.listen()` (await в async start-функции). `console.log` заменён на `logger.info({ port }, 'Mapvideo backend listening')` — server.ts был stub, замена минимальна. При ошибке — `logger.error({ err }, ...)` + `process.exit(1)`.
- Удалён `backend/src/services/.gitkeep`.

Проверено (9 asserts через временный tsx + реальный старт server.ts):

- Чистая БД → admin создаётся с `role='admin'`, hash формата `$2b$12$…` (12 rounds), `bcrypt.compare(hash, ADMIN_PASSWORD)` === true.
- Повторный запуск — no-op, ровно 1 строка в users (UNIQUE constraint срабатывает только если написать руками, а у нас `findUserByUsername` + if-branch).
- `ADMIN_PASSWORD_ROTATE_ON_BOOT=true` → hash переписан (отличается от предыдущего), но всё ещё матчится с ADMIN_PASSWORD; warn-лог выведен.
- Отсутствие `ADMIN_PASSWORD` → `initAdmin` бросает ошибку.
- Реальный старт: `DELETE FROM users WHERE username='admin'` + `node dist/server.js` → pino залогировал `'Создан пользователь admin'` и `'Mapvideo backend listening port=3099'`; `SELECT` в БД показывает admin с `role=admin`; `curl /non-existent` → 404 (сервер слушает).

### ✅ Задача 7/22 закрыта: POST /api/auth/login

Созданы файлы:

- `backend/src/services/auth-service.ts`:
  - `verifyLogin(username, password)` → `User | null`. Внутри вызывает `findUserByUsername`, затем `bcrypt.compare`. **Для защиты от username enumeration**: если пользователя нет, всё равно делает `bcrypt.compare` с предвычисленным `DUMMY_HASH` (bcrypt.hashSync $12 на константной строке, выполняется один раз при загрузке модуля) — ответ 401 занимает одинаковое время для «нет такого юзера» и «юзер есть, но пароль неверный». Это стандартная мера (OWASP ASVS V2.2.1), снаружи поведение не меняется — просто тайминг-канал закрыт.
  - `createSession(userId)` → `{ sessionToken, csrfToken, expiresAt }` по шаблону task2.md (строки 214-225): `crypto.randomBytes(32).toString('base64url')` для session и csrf, sha256(session) в БД, TTL 30 дней. В `sessions` записывается только **hash**, так что утечка таблицы не даёт живых токенов.
- `backend/src/routes/auth.ts`:
  - `POST /login` c `loginLimiter` middleware перед handler'ом.
  - 400 `'Некорректный запрос'` если `username`/`password` отсутствуют или не строки (до обращения к БД).
  - 401 `'Неверный логин или пароль'` при несовпадении (в логе `info 'Login failed' {username}`, без пароля).
  - 200 с телом `{ user: { id, username, role } }` — без `password_hash`/`created_at`.
  - Ставит два cookie: `session` (HttpOnly, SameSite=Lax, Path=/, Max-Age=30d) и `csrf_token` (НЕ HttpOnly, остальное то же). `Secure` выставляется по `COOKIE_SECURE !== 'false'` — default в prod включён, отключается только явным `COOKIE_SECURE=false` для локального HTTP.
  - Лог `info 'Login succeeded' {userId, username}` после успешного createSession.

Правки в `backend/src/server.ts`:

- `app.use(express.json())` (нужен для разбора body в login).
- `app.use('/api/auth', authRouter)` — монтирование на `/api/auth` (POST /api/auth/login).

Проверено (7 сценариев в e2e-смоуке, временный файл удалён):

1. `POST /api/auth/login {username:'admin'}` (без password) → **400** `'Некорректный запрос'`.
2. `POST /api/auth/login {username:'admin', password:'wrong'}` → **401** `'Неверный логин или пароль'`, **ни одного Set-Cookie в ответе**.
3. `POST /api/auth/login {username:'nobody-...', password:'x'}` → **401** (тот же текст, нет утечки факта существования admin).
4. `POST /api/auth/login` с валидным паролем из `.env` → **200**. Тело `{user:{id:<uuid>, username:'admin', role:'admin'}}`, без `passwordHash`/`password_hash`. Два cookie:
  - `session`: HttpOnly ✓, SameSite=Lax ✓, Path=/ ✓, Max-Age≈30d ✓, без Secure (COOKIE_SECURE=false) ✓, длина base64url ≥ 40 ✓.
  - `csrf_token`: НЕ HttpOnly ✓, SameSite=Lax ✓, Max-Age≈30d ✓, длина ≥ 40 ✓.
5. DB-проверка после успешного логина: `SELECT ... FROM sessions WHERE token_hash = sha256(rawSessionCookie)` → ровно 1 строка, `user_id === body.user.id`, `expires_at - now > 29 days` ✓.
6. После 7 подряд неверных логинов: наблюдаемая последовательность `[401, 401, 429, 429, 429, 429, 429]`. 429 наступает на 3-й попытке из-за того, что предыдущие тесты (1: 400, 2: 401, 3: 401) уже израсходовали 3 из 5 разрешённых сбоев — сам `loginLimiter` работает корректно (`windowMs=10min, limit=5, skipSuccessfulRequests=true`), ассершен: `first429Index >= 0 && <= 5 && всё до 429 — это 401 && всё после первого 429 — 429`.
7. `npm run typecheck` + `npm run build` → 0 ошибок.

Ключевые проектные решения:

- `express.json()` включён глобально (не точечно на `/login`) — он понадобится всем POST-роутам в task2 и далее, дублировать на каждом нет смысла. Лимит тела дефолтный (~100KB) — для login/admin-users этого более чем достаточно.
- CSRF на `/login` не требуется (task2.md явно). `requireCsrf` будет вешаться только на мутирующие роуты admin/users и render-job в последующих задачах.
- Rate-limiter `loginLimiter` был создан отдельно в задаче 5/22 и здесь только переиспользуется — ничего в нём не правилось.
- Timing-attack защита (DUMMY_HASH) добавлена как best-practice, в шаблоне task2.md её нет явно, но она не меняет внешнее поведение и не требует новых env/конфигов.

### ✅ Задача 8/22 закрыта: POST /api/auth/logout

Изменения:

- `backend/src/services/auth-service.ts` — добавлена `destroySessionByRawToken(rawToken)`:
  - sha256(rawToken) → `DELETE FROM sessions WHERE token_hash = $1`.
  - Возвращает `rowCount ?? 0`. Нет строк — не ошибка; logout идемпотентен.
- `backend/src/routes/auth.ts` — добавлен `POST /logout`:
  - Middleware: `requireCsrf` (создан в задаче 4/22, теперь впервые реально подключён). **Без** `requireAuth` — logout должен работать даже если серверная сессия уже истекла/удалена; главное — защита от CSRF.
  - Читает `req.cookies?.session`; если есть — `destroySessionByRawToken` (лог `info 'Logout: session destroyed' {removed}`).
  - `res.clearCookie('session', {httpOnly:true, secure, sameSite:'lax', path:'/'})` и `res.clearCookie('csrf_token', {httpOnly:false, secure, sameSite:'lax', path:'/'})` — атрибуты зеркалят `/login` (кроме maxAge), иначе браузер не удалит cookie.
  - Ответ `204 No Content` с пустым телом (семантически точнее, чем `{ok:true}`; task2.md не фиксирует формат).

Проверено (6 сценариев в e2e-смоуке, временный файл удалён):

1. Login → `sessions` содержит строку с sha256(sessionCookie).
2. `POST /logout` с cookies, но **без** `X-CSRF-Token` → **403** `'CSRF проверка не пройдена'`, `Set-Cookie` пуст, строка в `sessions` не тронута.
3. `POST /logout` с заголовком `X-CSRF-Token=<csrfValue>x` (не совпадает с cookie) → **403**, строка в `sessions` жива.
4. `POST /logout` с `X-CSRF-Token === csrf_token cookie` → **204**, тело пусто, **два Set-Cookie** (session и csrf_token) с `Expires` в прошлом и `Path=/`; `session` сохраняет HttpOnly, `csrf_token` — без HttpOnly (атрибуты зеркалят login). `SELECT` в `sessions` → **0 строк**.
5. Повторный logout теми же (уже устаревшими) cookies → **204**, лог `removed: 0` — идемпотентность.
6. Logout без `session` cookie, но с корректной парой csrf (cookie + заголовок) → **204**, сервер не падает, просто чистит cookies.

`npm run typecheck` + `npm run build` → 0 ошибок.

Побочный эффект: **задача 13/22 (Middleware requireCsrf) фактически закрыта** — middleware создан в 4/22, теперь реально подключён к мутирующему endpoint. Закрою его формально, когда дойдёт очередь по порядку (чтобы не отклоняться от workflow "одна задача за раз").

### ✅ Задача 9/22 закрыта: GET /api/auth/me

Изменения:

- `backend/src/services/auth-service.ts` — добавлена `findUserByRawSessionToken(rawToken)`:
  - sha256(raw) → `SELECT u.id, u.username, u.password_hash, u.role, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW() LIMIT 1`.
  - Возвращает `User | null`. **Проверка `expires_at > NOW()` делается в БД**, а не в Node — источник времени строго серверный, никакого clock-skew между Node и Postgres.
  - LIMIT 1 защитный: на `token_hash` стоит UNIQUE индекс (миграция 001), так что больше одной строки быть не может, но LIMIT страхует от регресса.
- `backend/src/types/express.d.ts` — module augmentation:
  - `declare module 'express-serve-static-core' { interface Request { user?: User } }`.
  - `User` импортирован из `users-service`.
  - Отдельный файл `types/*.d.ts` подхватывается TypeScript'ом автоматически (`tsconfig.json` имеет `"include": ["src/**/*"]`), настраивать ничего не нужно.
- `backend/src/middleware/require-auth.ts` — создан:
  - Читает `req.cookies?.session`. Нет cookie → 401 `'Не авторизован'`.
  - `findUserByRawSessionToken` → null → 401 с тем же текстом (важно: одинаковый ответ для «cookie нет» и «cookie невалидная», чтобы атакующий не отличал эти состояния).
  - Иначе `req.user = user`, `next()`.
- `backend/src/routes/auth.ts` — добавлен `GET /me` с `requireAuth`:
  - Возвращает `{ id, username, role }` — **плоский** объект, НЕ завёрнут в `user` (task2.md строка 153, в отличие от `/login` где спец-формат `{user:{...}}`).

Проверено (6 сценариев в e2e-смоуке, временный файл удалён):

1. `GET /me` без cookie → **401** `'Не авторизован'`.
2. `GET /me` с случайным session cookie, которого нет в БД → **401** (тот же текст, нет утечки факта существования).
3. Login → `GET /me` с полученными cookies → **200**, тело `{id:<uuid>, username:'admin', role:'admin'}` — плоское, без `password_hash`/`passwordHash`, без `created_at`/`createdAt`, без обёртки `.user`; `Set-Cookie` в ответе отсутствует (эндпоинт read-only, не перевыдаёт токен).
4. Вручную `UPDATE sessions SET expires_at = NOW() - INTERVAL '1 second'` → `GET /me` → **401**. Подтверждает, что фильтр `expires_at > NOW()` работает на уровне БД.
5. **Регрессия задачи 8/22**: `POST /logout` с валидным CSRF теперь возвращает **200** `{success: true}` (было 204 без тела — отклонение от task2.md строка 146 исправлено в этой же итерации).
6. После `/logout` → `GET /me` с теми же cookies → **401** (сессия физически удалена из БД).

`npm run typecheck` + `npm run build` → 0 ошибок. Module augmentation работает: `req.user` типобезопасен без `any`.

Побочный эффект: **задача 11/22 (Middleware requireAuth) фактически закрыта** — middleware создан и подключён к `/me`. Формально закрою в порядке очереди, как и `requireCsrf` (13/22).

### Коррекция к задаче 8/22

В задаче 8 я вернул `/logout` как `204 No Content`, аргументировав «семантически точнее». Это отклонение от task2.md (строка 146: `Ответ 200: { success: true }`). Подход был ошибочным — контракт задан спекой и его надо соблюдать (иначе фронт/тесты будут писаться под другой ответ). Исправлено в этой итерации, регрессия покрыта смоуком (п.5).

### ✅ Задачи 10-19 и 22 закрыты (авто-сессия)

Реализовано одним проходом, покрыто 39 Jest-тестами (все зелёные). Ниже — что именно сделано, проектные решения и новые файлы. Подробности смотри в коде, поведение зафиксировано тестами в `backend/tests/*.test.ts`.

**Новые/изменённые файлы бэкенда:**

- `backend/src/app.ts` **(новый)** — фабрика `createApp()` без побочных эффектов (не вызывает `initAdmin`, не слушает порт). Нужна для supertest. Включает `app.set('trust proxy', 'loopback')` — X-Forwarded-For от 127.0.0.1 (хостовой nginx / supertest) становится `req.ip`. Корректно для prod за хостовым nginx и для изоляции rate-limit между тестами.
- `backend/src/server.ts` — упрощён: только `initAdmin()` + `createApp()` + `listen()`.
- `backend/src/routes/auth.ts` — добавлен `GET /csrf` (публичный, без `requireAuth`). Если `csrf_token` cookie уже есть — **не перевыдаёт** (иначе XHR с кешем заголовка ломаются между вкладками). Rate-limit не вешается (task2.md строка 162 явно запрещает).
- `backend/src/middleware/require-admin.ts` **(новый)** — 403 `'Требуются права администратора'` на non-admin, 500 если навесили без `requireAuth` (это баг, лучше шумно упасть).
- `backend/src/services/users-service.ts` — добавлены `listUsers`, `findUserById`, `deleteUserById`, `validatePasswordComplexity` (≥8 символов + цифра + буква, кириллица/латиница), `validateUsername` (3..50, `[A-Za-z0-9_.\-]`).
- `backend/src/routes/admin.ts` **(новый)** — `GET/POST/DELETE /api/admin/users`. На все три висят `requireAuth` + `requireAdmin` через `router.use(...)`, на мутации дополнительно `requireCsrf`. Порядок CSRF-валидаций: CSRF → валидация полей → дубликат → create (bcrypt 12 rounds, `role='user'` для создаваемых — роль admin даётся только вручную миграцией/SQL, задачи «повысить до admin через API» в task2.md нет).
- `backend/src/middleware/rate-limit.ts` — добавлен `geocodeLimiter` (60 req/min с IP, сообщение `'Слишком много запросов, попробуйте позже'`).
- `backend/src/routes/geocode.ts` **(новый)** — `GET /api/geocode/search` с `requireAuth` + `geocodeLimiter`. Проксирует `${PHOTON_URL}?q=...&limit=...&lang=ru` (env `PHOTON_URL` default `https://photon.komoot.io/api`). AbortController с таймаутом 5s. Валидация query (400 если `q` пустое, `limit` clampается к 1..20). Non-200 upstream → 502 `'Геокодер недоступен'`. Трансформация: `features[] → { name, fullName, coordinates:{lng,lat} }`, `fullName` = `[name, city, country].filter(Boolean).join(', ')`.
- `backend/src/routes/fonts.ts` **(новый)** — `GET /api/fonts` с `requireAuth`. Один раз читает `FONTS_DIR` (default `../assets/fonts` относительно `cwd`) при загрузке модуля, кеширует в памяти. Парсит имя файла по конвенции `Family-Weight.ext`, `family = Family`, `url = /assets/fonts/<fileName>`. Поддержка `.ttf/.otf/.woff(2)`. Пустой/отсутствующий каталог → лог `warn` + пустой массив (локальная разработка без ассетов не ломается).
- `backend/src/routes/health.ts` **(новый)** — `GET /api/health` публичный, `{ status: 'ok', time: ISO8601 }`. Совпадает с docker compose healthcheck'ом.

**Тесты (`backend/tests/*.test.ts`) — 3 файла, 39 тестов:**

- `tests/global-setup.ts` — свой минимальный `.env` парсер (не тянем `dotenv`), выставляет `POSTGRES_HOST=127.0.0.1`, `NODE_ENV=test`, `COOKIE_SECURE=false`, `FONTS_DIR=<repo>/assets/fonts`.
- `tests/global-teardown.ts` — `pool.end()` чтобы jest не жаловался на open handles.
- `tests/helpers.ts` — `parseSetCookie` (через `res.headers['set-cookie']`), `nextTestIp()` генерирует уникальный `X-Forwarded-For` на тест (с `trust proxy=loopback` супертест → уникальный `req.ip` → изоляция rate-limit), `loginAsAdmin(app)` возвращает cookies + CSRF-заголовки, `cleanupTestUsers()` чистит `testuser_`*/`e2e_*` в `afterEach`.
- `tests/auth.test.ts` — 19 кейсов: login (400/401×2/200 с полной проверкой cookies и DB, 429 после 5 fails с одного IP), `GET /me` (401 без cookie, 401 unknown, 200 плоский body, 401 при expired сессии), `POST /logout` (403 без/с неверным CSRF, 200 с очисткой DB, идемпотентность), `GET /csrf` (200 ставит cookie, 200 не перевыдаёт существующий).
- `tests/admin.test.ts` — 14 кейсов: GET users (401/403/200 со списком без password_hash), POST users (403 без CSRF, 400×3 на слабый пароль/невалидный username, 201 happy, 409 duplicate), DELETE (403 без CSRF, 404 unknown, 403 на `username='admin'`, 403 self-delete, 200 реальное удаление с проверкой БД).
- `tests/misc.test.ts` — 6 кейсов: health, fonts (401/200 с поиском Montserrat-Regular), geocode (401, 400, 200 с мок-fetch и проверкой трансформации, 502 при upstream non-OK, 502 при AbortError), + 2 unit-теста на `validatePasswordComplexity` и `validateUsername`.

**Конфигурация тестов:**

- `jest.config.cjs` — ts-jest через `transform` (не preset — так чище), `tsconfig.test.json` отдельный (добавляет `types: ['jest','node']` и расширяет `include` тестами, основной `tsconfig.json` остаётся чистым для production-билда). `forceExit: true` — `express-rate-limit.MemoryStore` держит interval-таймер без API для остановки; `globalTeardown` закрывает pg-pool, остальное ничего критичного не держит.
- `npm run test` добавлен в `package.json`, использует `jest --runInBand` (sequential, чтобы тесты не гоняли DB race'ами).

**Установленные devDependencies:** `jest@^30`, `ts-jest@^29.4`, `@types/jest@^30`, `supertest@^7.2`, `@types/supertest@^7.2`.

**Проверено:**

- `npm run typecheck` → 0 ошибок.
- `npm run build` → чистая сборка `dist/` со всеми новыми модулями.
- `npm test` → `Test Suites: 3 passed, 3 total. Tests: 39 passed, 39 total. Time: ~9s`.
- Параллельно: сводный e2e-smoke (ручной `tmp-e2e-check.ts`, запускал реальный `node dist/server.js`, удалён после прогона) прогнал все endpoint'ы на реальном старте — проходит, Photon upstream возвращал 400 на «Moscow» (публичный инстанс бывает капризным), handler корректно конвертировал в 502.

**Пост-факт коррекция (GEOCODE_LANG):**

Шаблон в `task5.md` строка 72 жёстко зашивал `&lang=ru` в запрос к Photon. Публичный инстанс `photon.komoot.io` возвращает на такое **400 "Language is not supported. Supported are: default, de, en, fr"** — русский индекс они не хостят (экономия диска). Обнаружено в реальном прогоне против живого Photon (смоук после закрытия задачи 17/22 возвращал 502). Исправлено:

- `backend/src/routes/geocode.ts`: параметр `lang` теперь опциональный через env `GEOCODE_LANG` (default — не передаётся). Без `lang` Photon возвращает имена в нативном языке OSM — для российских городов это кириллица (`Москва, Россия`), что и нужно русскому UI.
- `task5.md` строки 68-73: шаблон обновлён, чтобы следующая сессия не ввела `lang=ru` обратно.
- Когда поднимем self-hosted Photon с русским индексом (план cursor.md при упёрании в rate limit / падении komoot) — включается через `GEOCODE_LANG=ru` без изменения кода.

Проверено живьём через свой прокси: `GET /api/geocode/search?q=Moscow` и `q=%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0` → оба возвращают `Москва, Россия` с корректными координатами. 39 Jest-тестов по-прежнему зелёные (моки не зависели от URL query string, интерес сохранился).

**Отклонения от шаблона task2.md и их обоснование (никаких без причины):**

- `validatePasswordComplexity` требует минимум 8 символов — task2.md говорит «минимум длина + цифра + буква», конкретную длину оставляет на реализацию. 8 — стандартный NIST minimum.
- Геокодер пропускает фичи без валидной геометрии (`features.filter(...)`) — task2.md показывает raw `.map(f => ...)` без фильтрации, но Photon иногда возвращает `features` с отсутствующими `coordinates`. Моя версия эквивалентна по happy-path и устойчивее к edge case'ам.
- `requireAdmin` отдаёт 500 если навешан без `requireAuth` — это программный баг в роутинге, и лучше падать шумно, чем молча пропускать анонимов.

### Фаза 2 завершена целиком

Все 21 пункт `## Задачи` закрыт. Backend поднимается (`node dist/server.js`) с `/api/auth/`*, `/api/admin/users`, `/api/geocode/search`, `/api/fonts`, `/api/health`, валидной admin-инициализацией и Jest-покрытием. Следующая фаза — task3.md (фронтенд).

### Открытые TODO (контекст из task1)

- Перед task6: `assets/icons/airplane.png` → `plane.png`.
- Удалить лишний `assets/icons/fire.png` (по явному разрешению).
- После завершения task2+task3: вернуться и проверить, что `docker compose ps` показывает все 5 сервисов healthy.

