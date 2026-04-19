# Фаза 2 — Авторизация (бэкенд)

**Статус:** Не начато
**Связанные файлы:** CLAUDE.md, SPEC.md (раздел "Пользователи и авторизация")
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

- [ ] Инициализировать backend проект (Node.js + TypeScript + Express)
- [ ] Настроить подключение к PostgreSQL
- [ ] Создать миграции БД (таблицы users, sessions, videos)
- [ ] POST /api/auth/login
- [ ] POST /api/auth/logout
- [ ] GET /api/auth/me
- [ ] Middleware проверки авторизации
- [ ] Middleware проверки роли admin
- [ ] GET /api/admin/users
- [ ] POST /api/admin/users
- [ ] DELETE /api/admin/users/:id
- [ ] GET /api/health (для проверки работоспособности)
- [ ] Создать дефолтного пользователя admin при первом запуске
- [ ] Написать тесты (Jest)

---

## Схема базы данных

```sql
-- Пользователи
CREATE TABLE пользователи (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  логин VARCHAR(50) UNIQUE NOT NULL,
  хэш_пароля VARCHAR(255) NOT NULL,
  роль VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (роль IN ('admin', 'user')),
  создан TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Сессии (для хранения JWT и инвалидации)
CREATE TABLE сессии (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_пользователя UUID NOT NULL REFERENCES пользователи(id) ON DELETE CASCADE,
  токен VARCHAR(500) NOT NULL UNIQUE,
  истекает TIMESTAMP WITH TIME ZONE NOT NULL,
  устройство TEXT,
  создана TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- История видео
CREATE TABLE видео (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_пользователя UUID NOT NULL REFERENCES пользователи(id) ON DELETE CASCADE,
  имя_файла VARCHAR(255) NOT NULL,
  путь_миниатюры VARCHAR(255),
  создано TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX ON сессии(токен);
CREATE INDEX ON сессии(id_пользователя);
CREATE INDEX ON видео(id_пользователя);
CREATE INDEX ON видео(создано);
```

---

## API эндпоинты

### POST /api/auth/login
```typescript
// Запрос
{ логин: string, пароль: string }

// Ответ 200
{
  токен: string,          // JWT, срок 30 дней
  пользователь: {
    id: string,
    логин: string,
    роль: 'admin' | 'user'
  }
}
// Ответ 401: { ошибка: "Неверный логин или пароль" }
```

### POST /api/auth/logout
```typescript
// Заголовок: Authorization: Bearer <token>
// Ответ 200: { успех: true }
// Инвалидирует токен в таблице сессий
```

### GET /api/auth/me
```typescript
// Заголовок: Authorization: Bearer <token>
// Ответ 200: { id, логин, роль }
// Ответ 401: { ошибка: "Не авторизован" }
```

### GET /api/admin/users
```typescript
// Только роль admin
// Ответ 200: { пользователи: [{ id, логин, роль, создан }] }
```

### POST /api/admin/users
```typescript
// Только роль admin
// Запрос: { логин: string, пароль: string }
// Ответ 201: { id, логин, роль }
// Ответ 409: { ошибка: "Пользователь с таким логином уже существует" }
```

### DELETE /api/admin/users/:id
```typescript
// Только роль admin
// Ответ 200: { успех: true }
// Ответ 403: { ошибка: "Нельзя удалить пользователя admin" }
// Ответ 404: { ошибка: "Пользователь не найден" }
```

### GET /api/health
```typescript
// Публичный эндпоинт
// Ответ 200: { статус: "ok", время: "ISO8601" }
```

---

## Реализация JWT

```typescript
// Долгоживущий токен — 30 дней
// При логине токен сохраняется в таблице сессий
// При logout — удаляется из таблицы сессий
// Middleware проверяет: 1) подпись JWT, 2) наличие токена в таблице сессий

const СРОК_ТОКЕНА = '30d';

async function создатьТокен(пользователь: Пользователь): Promise<string> {
  const токен = jwt.sign(
    { id: пользователь.id, логин: пользователь.логин, роль: пользователь.роль },
    process.env.JWT_SECRET!,
    { expiresIn: СРОК_ТОКЕНА }
  );
  // Сохранить в БД
  await сохранитьСессию(пользователь.id, токен);
  return токен;
}
```

---

## Инициализация admin пользователя

При первом запуске проверить наличие пользователя admin.
Если нет — создать с паролем из переменной окружения `ADMIN_PASSWORD`.

```typescript
async function инициализироватьAdmin(): Promise<void> {
  const существует = await найтиПользователя('admin');
  if (!существует) {
    const хэш = await bcrypt.hash(process.env.ADMIN_PASSWORD!, 12);
    await создатьПользователя({ логин: 'admin', хэш_пароля: хэш, роль: 'admin' });
    console.log('Создан пользователь admin');
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
