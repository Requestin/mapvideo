# Фаза 3 — Скелет фронтенда

**Статус:** ✅ Сделано
**Связанные файлы:** SPEC.md (UI дизайн, авторизация), cursor.md (стек фронтенда)
**Зависит от:** task2.md — API авторизации должно работать
**Следующая фаза:** task4.md (карта встраивается в редактор созданный здесь)

---

## Цель фазы
Создать работающий скелет фронтенда: страница логина, защищённые роуты,
шапка с меню пользователя, страница /admin, пустая главная страница редактора.
Карта и анимации — в следующих фазах.
---

## Skills для этой фазы

| Skill | Когда активировать |
|-------|--------------------|
| **mastering-typescript** | При написании TypeScript/React кода |
| **frontend-design** | При создании UI компонентов — страница логина, шапка, меню, панели |
| **api-contract-checker** | При подключении frontend к auth/admin API и выравнивании DTO |
| **spec-driven-workflow** | Для контроля последовательности задач и обновления заметок фазы |

### Когда skill указывать явно

- Явно указывать **api-contract-checker**, если UI зависит от изменений контрактов backend.
- Явно указывать **frontend-design**, когда есть спор по UX/визуальному решению.
- Явно указывать **spec-driven-workflow**, если фаза разбита на несколько сессий.

---

## Задачи

- [x] Инициализировать frontend проект (Vite + React + TypeScript)
- [x] Настроить роутинг (react-router-dom)
- [x] Настроить HTTP клиент (axios или fetch wrapper)
- [x] Страница логина (/login)
- [x] Хук useAuth (текущий пользователь, логин, логаут)
- [x] Защищённые роуты (редирект на /login если сессия невалидна — 401 от /api/auth/me)
- [x] Скелет главной страницы редактора (/)
- [x] Шапка с кнопкой пользователя
- [x] Выпадающее меню пользователя
- [x] Модальное окно тех. поддержки
- [x] Боковая панель "Моя история"
- [x] Страница /admin
- [x] Применить тёмную тему (CSS переменные из SPEC.md)

---

## Роутинг

```typescript
// src/routes.tsx
<Routes>
  <Route path="/login" element={<LoginPage />} />
  <Route element={<ProtectedRoute />}>
    <Route path="/" element={<EditorPage />} />
    <Route element={<AdminRoute />}>
      <Route path="/admin" element={<AdminPage />} />
    </Route>
  </Route>
</Routes>
```

```typescript
// ProtectedRoute проверяет сессию (GET /api/auth/me) и редиректит на /login при 401.
// AdminRoute проверяет role === 'admin' и редиректит на / для обычных пользователей.
// Оба — outlet-компоненты: рендерят <Outlet /> если проверка пройдена.
```

---

## Хук useAuth

Токен НЕ хранится в JS (httpOnly cookie). Флоу:

```typescript
interface AuthContext {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

// При старте приложения:
// 1. GET /api/auth/csrf — гарантировать csrf_token cookie (источник токена — cookie)
// 2. GET /api/auth/me — если 200, пользователь залогинен (session cookie валиден)
// 3. Если 401 — редирект на /login
// 4. axios настроен с withCredentials: true и интерцептором X-CSRF-Token
//    (читает csrf_token cookie и добавляет в заголовок на POST/PUT/DELETE/PATCH)
// 5. POST /api/auth/login CSRF-токена не требует (до логина его ещё нет)
```

```typescript
// src/api/http.ts
import axios from 'axios';

export const http = axios.create({ baseURL: '/api', withCredentials: true });

http.interceptors.request.use((config) => {
  const method = (config.method || 'get').toUpperCase();
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const csrf = document.cookie.split('; ').find(c => c.startsWith('csrf_token='))?.split('=')[1];
    if (csrf) config.headers['X-CSRF-Token'] = decodeURIComponent(csrf);
  }
  return config;
});
```

---

## Страница логина

По дизайну из SPEC.md (раздел "UI — Цветовая палитра"):
- Тёмный фон #0d0d0d
- Форма по центру, ширина 360px
- Логотип "Mapvideo" белым текстом
- Поля логин и пароль
- Кнопка "Войти"
- Сообщение об ошибке если неверные данные

---

## Скелет главной страницы

```typescript
// EditorPage.tsx
// Пока без карты — только layout с правильными пропорциями

export function EditorPage() {
  return (
    <div className="editor-container">
      <Header />
      <div className="editor-body">
        <ElementsList />           {/* left panel */}
        <div className="map-preview"> {/* map will be added in task4 */}
          <ResetViewButton />
        </div>
        <RightSidebar />                {/* right settings panel */}
      </div>
      <BottomToolbar />
    </div>
  );
}
```

---

## Меню пользователя

```typescript
// При клике на кнопку с именем — выпадает меню
// Клик вне меню — закрывается
// Анимация: плавное появление сверху вниз

function UserMenu() {
  return (
    <DropdownMenu>
      <MenuItem onClick={openSupportModal}>
        Тех. поддержка
      </MenuItem>
      <MenuItem onClick={openHistoryPanel}>
        Моя история
      </MenuItem>
      <MenuDivider />
      <MenuItem onClick={logout} danger>
        Выйти
      </MenuItem>
    </DropdownMenu>
  );
}
```

---

## Панель "Моя история"

- Открывается как drawer справа (слайд из-за края)
- Ширина 480px, высота 100vh
- Получает данные: GET /api/history
- Каждая запись: миниатюра + название + дата + кнопка скачать
- Если пусто: "Вы ещё не создавали видео"
- Кнопка закрытия ×

Связь с task8.md: эндпоинт GET /api/history реализуется в фазе 8,
пока можно заглушку с пустым массивом.

---

## Страница /admin

```typescript
function AdminPage() {
  // GET /api/admin/users — список пользователей
  // POST /api/admin/users — форма добавления
  // DELETE /api/admin/users/:id — с подтверждением

  return (
    <div>
      <h1>Управление пользователями</h1>
      <CreateUserForm />
      <UsersTable />
    </div>
  );
}
```

---

## CSS переменные (глобальный стиль)

Подключить в `src/index.css`:
```css
:root {
  --color-bg-page:         #0d0d0d;
  --color-bg-panel:        #1a1a1a;
  --color-bg-panel-2:      #222222;
  --color-bg-input:        #2a2a2a;
  --color-bg-hover:        #333333;
  --color-text-primary:    #f0f0f0;
  --color-text-secondary:  #888888;
  --color-accent:          #3d8bff;
  --color-accent-hover:    #5a9fff;
  --color-danger:          #ff4444;
  --color-success:         #44bb44;
  --color-border:          #333333;
  --color-border-light:    #444444;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--color-bg-page); color: var(--color-text-primary); }
```

---

## Заметка для следующей сессии

**Статус:** фаза 3 закрыта (13/13 задач). Фронтенд-скелет полностью работает с бэкендом из фазы 2.

### Стек и зависимости
- **React 18.3 + TypeScript + Vite 5** (не v19 по cursor.md — v18 стабильнее под PixiJS 7.4.2 в следующих фазах).
- `react-router-dom@6.28`, `axios@1.7`, `vitest@2.1` + `@testing-library/react@16`, `jsdom`.
- `tsconfig.json` — project references на `tsconfig.app.json` (src/tests) и `tsconfig.node.json` (vite/vitest конфиги).

### Архитектура
- `src/main.tsx` оборачивает приложение в `BrowserRouter` → `AuthProvider` → `App`.
- `AuthProvider` (`src/hooks/use-auth.tsx`) при старте: `GET /auth/csrf` (посадить cookie) → `GET /auth/me` (200 → user, 401 → null). Loading-стейт до завершения boot.
- `ProtectedRoute` показывает спиннер пока `loading`, редиректит на `/login` c `state.from` при 401. `AdminRoute` вложенный — проверяет `role === 'admin'`, иначе `/`.
- `src/api/http.ts` — axios instance с `withCredentials: true` + интерцептор: читает `csrf_token` cookie перед POST/PUT/DELETE/PATCH и кладёт в `X-CSRF-Token`. Cookie парсится свежим каждый запрос, что корректно обрабатывает ротацию CSRF после логина.
- `src/api/auth.ts` / `src/api/admin.ts` — типизированные обёртки под эндпоинты бэкенда.

### Vite proxy
- Dev-сервер на `:3000` (`host 0.0.0.0`), бэкенд на `:3001`. `/api/*` и `/assets/fonts/*` проксируются на `127.0.0.1:3001` — cookies остаются same-origin (браузер не пошлёт httpOnly cookie cross-origin даже с `withCredentials`). В проде host nginx делает то же самое.

### Страницы
- `LoginPage`: 360px карточка по центру, тема из CSS-переменных. Поля логин/пароль, показ backend-сообщения об ошибке (401 «Неверный логин или пароль», 429 про rate limit). После успеха — редирект на `state.from ?? '/'`.
- `EditorPage`: финальная сетка из SPEC.md — Header 48px, Body (grid: 1fr + 320px правая панель) с плавающей `ElementsList` 200px сверху и `ResetViewButton` в правом нижнем углу, `BottomToolbar` 56px с кнопками-плейсхолдерами. Карта — placeholder «появится в task4».
- `Header`: бренд-ссылка «Mapvideo» → `/`, админ-ссылка только при `role === 'admin'`, `UserMenu`.
- `UserMenu`: dropdown с «Тех. поддержка / Моя история / Выйти». Закрывается по клику вне и Escape. Анимация появления 120 мс.
- `SupportModal`: плавный fade-in, ссылка `t.me/Requestin`. Закрытие по overlay, Escape, крестику.
- `HistoryDrawer`: 480px slide-in справа, backdrop, заглушка «Вы ещё не создавали видео» (реальный `/api/history` из task8).
- `AdminPage`: форма создания пользователя + таблица со списком. Кнопка «Удалить» отключена для self и `username === 'admin'` (локальный guard дублирует backend, который всё равно вернёт 403). Confirm через `window.confirm`.

### Тёмная тема
- `src/index.css` содержит полный набор CSS-переменных из SPEC.md + layout-константы (header/toolbar/sidebar/drawer). `color-scheme: dark`. Базовые `.app-button / .app-button--primary / .app-button--danger` утилиты, без сторонних UI-kit.

### Тесты (Vitest + RTL, 10 тестов)
- `tests/cookies.test.ts` — читатель cookie: missing / plain / URL-encoded / prefix-collision.
- `tests/http.test.ts` — CSRF interceptor: GET без заголовка, POST/DELETE с заголовком при наличии cookie, POST без заголовка если cookie нет.
- `tests/login-page.test.tsx` — рендер формы после boot, показ сообщения об ошибке из `AxiosError.response.data.error`.
- `tests/setup.ts` — подключает `@testing-library/jest-dom/vitest`.

### Команды
- `npm run dev` — Vite dev на :3000 (прокси на backend:3001)
- `npm run build` — `tsc -b && vite build` (215 KB js / 10 KB css, gzip 72 KB)
- `npm run typecheck` — `tsc -b --noEmit`
- `npm test` — Vitest (headless jsdom)

### Live smoke (проверено)
- Vite `GET /` → SPA HTML.
- `curl /api/health` через прокси → 200 от бэкенда.
- Полный auth-flow через прокси: `GET /auth/csrf` → `POST /auth/login` (admin/ADMIN_PASSWORD из .env) → `GET /auth/me` → `POST /auth/logout` (с учётом ротации csrf_token после логина) — все 200.

### Изменения вне `frontend/`
- `docker-compose.dev.yml`: добавлены биндинги `tests/`, `tsconfig.app.json`, `tsconfig.node.json`, `vitest.config.ts` во frontend-сервис (иначе typecheck в dev-контейнере сломается).

### Пограничные моменты для task4+
- После `logout()` текущая сессия в БД отзывается; фронт чистит локальный `user` даже при сетевой ошибке (по UX — пользователь нажал «Выйти», значит нужно уйти). При возврате на страницу `fetchMe` вернёт 401 и состояние окончательно синхронизируется.
- `GET /api/history` пока не реализован на бэкенде (фаза 8). `HistoryDrawer` показывает пустое состояние без сетевого запроса — когда появится эндпоинт, достаточно добавить `useEffect` + рендер списка.
- Компоненты редактора (`ElementsList`, `RightSidebar`, `BottomToolbar`, `ResetViewButton`) — чистые скелеты; вся логика в них появится в task4 (карта) / task5 (точки) / task6 (маршруты) / task7 (настройки видео).
