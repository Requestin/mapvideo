# Фаза 3 — Скелет фронтенда

**Статус:** Не начато
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

- [ ] Инициализировать frontend проект (Vite + React + TypeScript)
- [ ] Настроить роутинг (react-router-dom)
- [ ] Настроить HTTP клиент (axios или fetch wrapper)
- [ ] Страница логина (/login)
- [ ] Хук useAuth (текущий пользователь, логин, логаут)
- [ ] Защищённые роуты (редирект на /login если сессия невалидна — 401 от /api/auth/me)
- [ ] Скелет главной страницы редактора (/)
- [ ] Шапка с кнопкой пользователя
- [ ] Выпадающее меню пользователя
- [ ] Модальное окно тех. поддержки
- [ ] Боковая панель "Моя история"
- [ ] Страница /admin
- [ ] Применить тёмную тему (CSS переменные из SPEC.md)

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
*(заполняется завершения задачи или перед завершением сессии)*
