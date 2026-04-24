# Фаза 1 — Инфраструктура и окружение

**Статус:** ✅ Сделано
**Связанные файлы:** cursor.md (стек, порты), SPEC.md (список сервисов)
**Следующая фаза:** task2.md (бэкенд использует PostgreSQL поднятый здесь)

---

## Цель фазы

## Поднять все сервисы через Docker Compose так чтобы одна команда

`docker compose up -d` запускала всё необходимое для разработки.

## Skills для этой фазы


| Skill                    | Когда активировать                                         |
| ------------------------ | ---------------------------------------------------------- |
| **spec-driven-workflow** | В начале фазы и при каждом переходе между шагами checklist |
| **systematic-debugging** | При отладке проблем с Docker, Martin, PostgreSQL или OSRM  |


### Когда skill указывать явно

- Явно указывать **systematic-debugging**, если сервис не стартует, unhealthy или есть flaky-поведение.
- Явно указывать **spec-driven-workflow**, если задача длинная и есть риск отклониться от `task1.md`.

---

## Задачи

- Создать папку `~/mapvideo` на сервере и структуру директорий проекта
- Установить Docker + Docker Compose plugin на сервере (если ещё не стоит)
- Убедиться что `russia-260419.osm.pbf` уже лежит в `osm-data/` (файл на сервере)
- Написать docker-compose.yml (сервисы биндятся на 127.0.0.1)
- Написать docker-compose.dev.yml (dev оверрайд — `command: npm run dev`)
- Создать .env.example (все ключи из cursor.md)
- Dockerfile для бэкенда (node:20-slim + Chromium/nss/freetype/harfbuzz/fonts + ffmpeg + dumb-init)
- Dockerfile для фронтенда (node:20-alpine для билда, runtime контейнер только для фронта; это не reverse proxy)
- Конфиг для **хостового** nginx (`/etc/nginx/sites-available/mapvideo.gyhyry.ru.conf`)
- Конфиг Martin (martin/config.yaml) — подключение к БД `gis`, не к `mapvideo`
- Init-скрипт PostgreSQL (`db/init/01-create-gis.sql`) — создаёт БД `gis` с PostGIS/hstore
- Скрипт импорта OSM (scripts/import-osm.sh) — использует OSM_PBF_FILE, делает symlink в region.osm.pbf для OSRM
- Healthcheck у каждого сервиса (postgres, martin, osrm, backend, frontend)
- Проверить что все сервисы поднимаются:
  - до импорта OSM допускается `martin` в `unhealthy`,
  - после `./scripts/import-osm.sh` и перезапуска — `docker compose ps` показывает все `healthy`

---

## ⚠️ КРИТИЧНО: не сломать maps.gyhyry.ru

На этом же сервере уже работает независимый проект **maps.gyhyry.ru** с собственным хостовым nginx, SSL и сервисами. Его трогать **нельзя ни при каких обстоятельствах**.

Правила:

- Не редактировать существующие файлы в `/etc/nginx/sites-enabled/` и `/etc/nginx/sites-available/`. Создавать только **новый** файл `mapvideo.gyhyry.ru.conf`.
- Никакие сервисы mapvideo не должны слушать `0.0.0.0:80`, `0.0.0.0:443`. Все порты — только `127.0.0.1:PORT`.
- Перед каждым `systemctl reload nginx` запускать `sudo nginx -t` и читать вывод.
- Если `nginx -t` падает из-за mapvideo — откатить **только** свой конфиг, не трогать чужие.
- Не трогать `/etc/letsencrypt/` существующие сертификаты — certbot для mapvideo выпустит отдельный.

---

## Docker Compose — все сервисы

**КРИТИЧНО:** `nginx` как Docker-сервис не использовать и не добавлять в `docker-compose*.yml`. Для mapvideo используется только хостовой `nginx`.

**Принцип:** все сервисы биндятся на `127.0.0.1:PORT` хоста — снаружи их не видно. Хостовой nginx сервера проксирует домен `mapvideo.gyhyry.ru` (HTTPS 443) на эти локальные порты. Nginx как docker-сервис **не поднимаем** — он уже есть на хосте и обслуживает maps.gyhyry.ru. Photon тоже не поднимаем — геокодер работает через публичный [https://photon.komoot.io/api](https://photon.komoot.io/api), вызов идёт с бэкенда.

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/init:/docker-entrypoint-initdb.d:ro   # SQL-скрипт создаёт БД gis
    ports:
      - "127.0.0.1:5432:5432"
    networks: [mapvideo_net]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

  martin:
    image: ghcr.io/maplibre/martin:v0.14.2
    command: --config /config/config.yaml
    volumes:
      - ./martin:/config
    ports:
      - "127.0.0.1:3002:3000"
    networks: [mapvideo_net]
    depends_on:
      postgres: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000/health"]
      interval: 15s
      timeout: 5s
      retries: 5

  osrm:
    image: ghcr.io/project-osrm/osrm-backend:v5.27.1
    command: osrm-routed --algorithm mld ${OSRM_DATA_PATH}
    volumes:
      - ./osm-data:/data
    ports:
      - "127.0.0.1:5000:5000"
    networks: [mapvideo_net]
    healthcheck:
      # OSRM-routed не имеет /health — проверяем живучесть известным маршрутом Москва→СПб
      test: ["CMD-SHELL", "wget -qO- 'http://localhost:5000/route/v1/driving/37.618,55.751;30.315,59.939' >/dev/null || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  backend:
    build: ./backend
    env_file: .env
    ports:
      - "127.0.0.1:3001:3001"
    networks: [mapvideo_net]
    depends_on:
      postgres: { condition: service_healthy }
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3001/api/health"]
      interval: 15s
      retries: 3
    volumes:
      - ./data/videos:/data/videos
      - ./assets:/app/assets:ro

  frontend:
    build: ./frontend
    ports:
      - "127.0.0.1:3000:3000"
    networks: [mapvideo_net]
    depends_on: [backend]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:3000"]
      interval: 30s
      timeout: 5s
      retries: 3

networks:
  mapvideo_net:
    driver: bridge

volumes:
  postgres_data:
```

Отдельная БД `gis` создаётся init-скриптом PostgreSQL. Положить файл в `./db/init/01-create-gis.sql` (volume подключён в docker-compose выше → PostgreSQL выполнит его при первом старте контейнера):

```sql
-- db/init/01-create-gis.sql
CREATE DATABASE gis;
\c gis
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS hstore;
```

**docker-compose.dev.yml** — dev override. Порты уже открыты на localhost (см. выше). Монтируем исходники, чтобы работал hot-reload (`tsx watch` для бэкенда, Vite dev server для фронта):

```yaml
services:
  backend:
    command: npm run dev
    volumes:
      - ./backend/src:/app/src
      - ./backend/package.json:/app/package.json
      - ./backend/tsconfig.json:/app/tsconfig.json
    environment:
      NODE_ENV: development
  frontend:
    command: npm run dev -- --host 0.0.0.0
    volumes:
      - ./frontend/src:/app/src
      - ./frontend/index.html:/app/index.html
      - ./frontend/package.json:/app/package.json
      - ./frontend/tsconfig.json:/app/tsconfig.json
      - ./frontend/vite.config.ts:/app/vite.config.ts
    environment:
      NODE_ENV: development
```

Запуск dev: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`

### Dockerfile бэкенда (Puppeteer-совместимый)

Alpine не подходит — Puppeteer не собирает Chromium под musl. Используем `node:20-slim` + системный Chromium и скажем Puppeteer не качать свой:

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation fonts-dejavu fonts-noto-color-emoji \
    libnss3 libfreetype6 libharfbuzz0b \
    ffmpeg \
    dumb-init wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN npm run build
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
```

---

## Конфиг Martin

**ВАЖНО:** Martin подключается к БД `gis` (там лежат импортированные OSM-таблицы
`planet_osm_`*), а **не** к основной `mapvideo`. Строка подключения — стандартная
`postgresql://user:password@host:port/db`, никаких правок `pg_hba.conf` / `trust`
не требуется: образ `postgis/postgis` из коробки работает с парольной аутентификацией.

```yaml
# martin/config.yaml
postgres:
  connection_string: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_GIS_DB}?sslmode=disable
  auto_publish: true

cache:
  size_mb: 1024
```

Генерировать конфиг автоматически после первого запуска можно так:

```bash
docker compose run --rm martin \
  --save-config /config/config.yaml \
  postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_GIS_DB}?sslmode=disable
```

---

## Импорт OSM данных

**scripts/import-osm.sh:**

```bash
#!/bin/bash
set -e

# Используется переменная OSM_PBF_FILE из .env (по умолчанию russia-260419.osm.pbf)
source .env
OSM_FILE="./osm-data/${OSM_PBF_FILE}"

# Если файла нет — скачать (в нашем случае файл уже лежит на сервере, это fallback)
if [ ! -f "$OSM_FILE" ]; then
  echo "Файл ${OSM_PBF_FILE} не найден, качаю с geofabrik..."
  mkdir -p ./osm-data
  wget -O "$OSM_FILE" "https://download.geofabrik.de/russia-latest.osm.pbf"
fi

# Размер кеша — половина свободной RAM, но не больше 8 ГБ для дев машины
CACHE_MB=$([ "$(uname -m)" = "x86_64" ] && echo 4000 || echo 2000)

# Импорт в PostgreSQL (osm2pgsql запускается в отдельном контейнере)
# Используем официальный образ osm2pgsql
echo "Импортирую OSM данные в PostgreSQL..."
docker run --rm --network mapvideo_mapvideo_net \
  -v $(pwd)/osm-data:/osm-data \
  -e PGPASSWORD=${POSTGRES_PASSWORD} \
  openstreetmap/osm2pgsql:latest osm2pgsql \
    --create --slim -G --hstore \
    -C ${CACHE_MB} \
    -H postgres -U ${POSTGRES_USER} -d ${POSTGRES_GIS_DB} \
    /osm-data/${OSM_PBF_FILE}

# ВАЖНО: osrm-extract создаёт файл <basename>.osrm рядом с входным .pbf.
# Compose-сервис osrm ожидает /data/region.osrm — делаем symlink чтобы имя совпало
# независимо от того, Россия это или planet.
echo "Делаю symlink для OSRM: region.osm.pbf -> ${OSM_PBF_FILE}"
ln -sf "${OSM_PBF_FILE}" "./osm-data/region.osm.pbf"

# Подготовка OSRM (файл теперь называется region.osm.pbf → на выходе region.osrm.*)
echo "Подготавливаю OSRM (extract → partition → customize)..."
docker run --rm -v $(pwd)/osm-data:/data ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-extract -p /opt/car.lua /data/region.osm.pbf
docker run --rm -v $(pwd)/osm-data:/data ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-partition /data/region.osrm
docker run --rm -v $(pwd)/osm-data:/data ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-customize /data/region.osrm

echo "Импорт завершён"
```

**Важно при импорте:**

- Для России: 20-40 мин. Для planet: несколько часов
- Флаг `--tag-transform-script` НЕ использовать — файл lua не установлен
- Параметр `-C` — размер кеша в MB, подбирается по доступной RAM (половина, но не меньше 2000)
- OSRM preprocessing создаёт `region.osrm.`* через symlink `region.osm.pbf` — имя выходного файла всегда стабильное
- После импорта индексы создаются автоматически
- Photon в compose не поднимается (используем публичный сервис через бэкенд-прокси)

---

## Конфиг Nginx (только хостовой)

Nginx **в docker compose нет**. Наружу 80/443 слушает хостовой nginx сервера (тот же, что обслуживает maps.gyhyry.ru). Создаём отдельный файл только для нашего домена — существующие конфиги не трогаем.

**КРИТИЧНО:** второй `nginx` в Docker запрещён.

```nginx
# /etc/nginx/sites-available/mapvideo.gyhyry.ru.conf
# Симлинк: /etc/nginx/sites-enabled/mapvideo.gyhyry.ru.conf
server {
    listen 80;
    server_name mapvideo.gyhyry.ru;
    # certbot --nginx сам добавит редирект на 443 + блок SSL после выпуска сертификата
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mapvideo.gyhyry.ru;

    # SSL-строки добавит certbot (ssl_certificate / ssl_certificate_key)
    # Существующие сертификаты maps.gyhyry.ru не трогать!

    client_max_body_size 50M;

    # Фронтенд
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    # API бэкенда
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }

    # Ассеты (иконки/шрифты) — раздаёт бэкенд из /app/assets
    # Важно для PixiJS и @font-face: /assets/icons/* и /assets/fonts/*
    location /assets/ {
        proxy_pass http://127.0.0.1:3001/assets/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # Тайлы Martin
    location /tiles/ {
        proxy_pass http://127.0.0.1:3002/;
        proxy_set_header Host $host;
        add_header Cache-Control "public, max-age=86400";
    }
}
```

Применение:

```bash
sudo ln -s /etc/nginx/sites-available/mapvideo.gyhyry.ru.conf /etc/nginx/sites-enabled/
sudo nginx -t                          # обязательно проверить перед reload!
sudo systemctl reload nginx
sudo certbot --nginx -d mapvideo.gyhyry.ru
```

**КРИТИЧНО:** не редактировать существующие конфиги maps.gyhyry.ru. Не использовать `certbot --expand` на чужом сертификате. Если `nginx -t` падает — откатить только свой конфиг.

---

## Проверка работоспособности

Разработка и dev-режим — на том же сервере. Все сервисы биндятся на `127.0.0.1:PORT`, проверяем их из SSH-сессии.

```bash
# Запуск
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# PostgreSQL
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_GIS_DB -c "SELECT version();"

# Martin (после импорта OSM)
curl http://127.0.0.1:3002/catalog

# Публичный Photon (геокодер — в compose не поднят)
curl "https://photon.komoot.io/api?q=Москва&limit=1"

# OSRM (после подготовки данных)
curl "http://127.0.0.1:5000/route/v1/driving/37.618,55.751;30.315,59.939"

# Бэкенд
curl http://127.0.0.1:3001/api/health

# Фронтенд
curl http://127.0.0.1:3000

# Сквозной через хостовой nginx
curl https://mapvideo.gyhyry.ru/api/health
```

Из внешнего мира видны только 80/443 хостового nginx. Порты 3000/3001/3002/5000/5432 доступны только с самого сервера (bind на 127.0.0.1).

---

## Известные проблемы и решения

**Martin не стартует:**

- Проверить что PostgreSQL уже запущен (`docker compose ps`)
- Проверить строку подключения — только `postgresql://`, не `postgis://`
- Порт 3000 внутри контейнера, снаружи 3002 — не путать

**osm2pgsql не находит базу:**

- Проверить, что контейнер `postgres` healthy и переменные `POSTGRES_`* совпадают с `.env`
- Использовать флаг `-H postgres` (имя контейнера) вместо `localhost`
- Убедиться, что импорт идёт в `${POSTGRES_GIS_DB}`, а не в `${POSTGRES_DB}`

**Martin unhealthy сразу после `docker compose up`:**

- До импорта OSM это ожидаемо: в БД `gis` ещё нет `planet_osm_`* таблиц
- После `./scripts/import-osm.sh` и перезапуска `martin` healthcheck должен позеленеть

**OSRM не запускается:**

- Данные нужно предварительно обработать через `./scripts/import-osm.sh`
- Если запускаете руками, используйте стабильное имя через symlink:
  ```bash
  ln -sf russia-260419.osm.pbf ./osm-data/region.osm.pbf
  docker run --rm -v $(pwd)/osm-data:/data ghcr.io/project-osrm/osrm-backend:v5.27.1 \
    osrm-extract -p /opt/car.lua /data/region.osm.pbf
  docker run --rm -v $(pwd)/osm-data:/data ghcr.io/project-osrm/osrm-backend:v5.27.1 \
    osrm-partition /data/region.osrm
  docker run --rm -v $(pwd)/osm-data:/data ghcr.io/project-osrm/osrm-backend:v5.27.1 \
    osrm-customize /data/region.osrm
  ```
  Для России обычно 20-40 минут.

---

## Заметка для следующей сессии

Создана структура директорий проекта: `backend/src/{routes,services,middleware,db,utils}`, `frontend/src/{components,hooks,pages,api,utils}`, `nginx/`, `martin/`, `scripts/`, `db/init/`, `data/videos/`. В пустых папках лежат `.gitkeep` (кроме `data/videos/` — он в `.gitignore`, `.gitkeep` положен на уровень `data/`).

Docker 29.4.0 + Docker Compose v5.1.3 проверены (daemon запущен, overlayfs), задача закрыта.
`osm-data/russia-260419.osm.pbf` проверен: 3.8 GB (4 074 584 472 байт), валидный OSM PBF — задача закрыта.
`docker-compose.yml` написан 1-в-1 по шаблону task1.md; валидирован через `docker compose config` (с временным `.env` из `.env.example`).

`docker-compose.dev.yml` написан 1-в-1 по шаблону task1.md (оверрайд backend/frontend: `command: npm run dev`, bind-mount src и конфигов, `NODE_ENV=development`); валидирован через `docker compose -f ... -f ... config`.

`.env.example` выровнен 1-в-1 с разделом "Переменные окружения (.env)" из cursor.md (добавлены блочные комментарии PostgreSQL/Админ/Cookies/OSM/Геокодер/Пути/Окружение; все ключи присутствуют; плейсхолдер `change-me` оставлен для копирования; `.env` не создавался).

`backend/Dockerfile` написан 1-в-1 по шаблону task1.md L197-215 (node:20-slim + chromium + шрифты + libnss/freetype/harfbuzz + ffmpeg + dumb-init + wget + ca-certificates; `PUPPETEER_SKIP_DOWNLOAD=true`, `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`; `npm ci --omit=dev` → `npm run build` → `CMD ["node","dist/index.js"]`). `docker build` НЕ запускался — `backend/package.json` ещё не создан (это задача task2).

Важно: финальная задача task1 «все сервисы healthy» полностью замкнётся только после task2, который добавит `backend/package.json`, `tsconfig.json` и минимальный `src/index.ts` с `/api/health`. До этого момента `docker compose build backend` и healthcheck бэкенда провалятся — это ожидаемо. При подходе к финальной проверке в task1 — пропустить backend/frontend healthcheck до начала task2, либо подтянуть stub из task2.

`frontend/Dockerfile` написан как multi-stage: builder `node:20-alpine` (`npm ci` → `npm run build` → `/app/dist`) + runtime `node:20-alpine` с `serve@14.2.4` (pinned) глобально и wget для healthcheck; `EXPOSE 3000`, `CMD ["serve","-s","dist","-l","3000"]`. Nginx в рантайме нет — соответствует условию «runtime контейнер только для фронта». `docker build` не запускался (`frontend/package.json` появится в task3). Dev-режим через `docker-compose.dev.yml` перекрывает CMD на `npm run dev -- --host 0.0.0.0`; если в task3 окажется, что dev нужен полный node_modules с devDeps — может потребоваться отдельная target-стадия, но это уже задача task3.

`nginx/mapvideo.gyhyry.ru.conf` написан 1-в-1 по шаблону task1.md L312-369: 80→443 redirect + 443 ssl http2, `client_max_body_size 50M`, `/` → `127.0.0.1:3000` с WS апгрейдом, `/api/` → `127.0.0.1:3001`, `/assets/` → `127.0.0.1:3001/assets/` с immutable-кэшем, `/tiles/` → `127.0.0.1:3002/`; SSL-строки добавит `certbot --nginx`. Синтаксис валиден (офлайн через `nginx -t`, SSL временно заменял на 8443 для обхода отсутствия сертификата). На хост НЕ копировался.

Деплой на хост (следующая сессия или отдельное разрешение):

```
sudo ln -s $(pwd)/nginx/mapvideo.gyhyry.ru.conf /etc/nginx/sites-available/mapvideo.gyhyry.ru.conf
sudo ln -s /etc/nginx/sites-available/mapvideo.gyhyry.ru.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d mapvideo.gyhyry.ru
```

`martin/config.yaml` написан 1-в-1 по шаблону task1.md L226-234: `connection_string: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_GIS_DB}?sslmode=disable`, `auto_publish: true`, `cache.size_mb: 1024`. YAML валиден (через `yq`).

Важно (перенесено из более раннего замечания): в compose у сервиса `martin` нет `env_file`, поэтому `${POSTGRES_*}` в `martin/config.yaml` не резолвятся из процесса `martin` автоматически. Варианты на этапе «все healthy»:

- (a) сгенерировать конфиг с уже подставленными значениями через `docker compose run --rm martin --save-config /config/config.yaml postgresql://...` (этот путь упомянут в task1.md L237-241), либо
- (b) добавить `env_file: .env` сервису `martin` в `docker-compose.yml` (минимальная правка, не меняет соль шаблона).
Решение принять при первом запуске martin с реальным БД.

`db/init/01-create-gis.sql` написан 1-в-1 по шаблону task1.md L159-165: `CREATE DATABASE gis; \c gis; CREATE EXTENSION postgis; hstore;`. Заглушка `db/init/.gitkeep` удалена (папка теперь не пустая). Файл монтируется в `postgres` контейнере в `/docker-entrypoint-initdb.d/` — запустится автоматически при ПЕРВОМ старте БД (на пустом volume `postgres_data`).

`scripts/import-osm.sh` написан 1-в-1 по шаблону task1.md L247-294: `source .env`, fallback-скачивание с geofabrik, osm2pgsql через `openstreetmap/osm2pgsql:latest` в сеть `mapvideo_mapvideo_net` (имя `mapvideo_` — префикс compose-проекта по имени директории), `symlink region.osm.pbf → ${OSM_PBF_FILE}`, osrm-extract/partition/customize через `ghcr.io/project-osrm/osrm-backend:v5.27.1`. Chmod +x поставлен, `bash -n` — синтаксис OK. `scripts/.gitkeep` удалён (папка теперь не пустая). Реальный запуск не выполнялся (требует поднятый postgres и ~20-40 мин для России).

Все 5 healthcheck'ов подтверждены в `docker-compose.yml`:

- postgres: `pg_isready -U ${POSTGRES_USER}`
- martin: `wget http://localhost:3000/health`
- osrm: `wget http://localhost:5000/route/v1/driving/37.618,55.751;30.315,59.939`
- backend: `wget http://localhost:3001/api/health`
- frontend: `wget http://localhost:3000`

ФАЗА 1 ЗАВЕРШЕНА (усечённая финальная проверка — backend/frontend полноценно проверятся в task2/task3):

Что выполнено:

- Создан реальный `.env` со случайными паролями (32 символа, chmod 600, в `.gitignore`).
- Подняты postgres + martin + osrm. postgres init-скрипт `01-create-gis.sql` отработал: БД `gis` + расширения `postgis`, `hstore`, `plpgsql` на месте.
- Запущен `./scripts/import-osm.sh`: полный импорт Россия → PostgreSQL (31m 38s) + OSRM preprocessing (~7 мин). Итог: `planet_osm_point=8.1M`, `planet_osm_line=13.5M`, `planet_osm_polygon=35.7M`, `planet_osm_roads=797k`. OSRM файлы `region.osrm.*` созданы. Общее время: ~39 мин.
- `docker compose ps`: все 3 запущенных сервиса `(healthy)`. Martin возвращает каталог, OSRM роутит Москва↔СПб за 12ms.

Правки, потребовавшиеся по ходу дела (зафиксировать для следующих сессий):

1. `docker-compose.yml` martin: добавлен `env_file: .env` — иначе `${POSTGRES_*}` в `martin/config.yaml` не резолвятся martin'ом.
2. `docker-compose.yml` martin healthcheck: `localhost` → `127.0.0.1` — в martin/distroless-образе `localhost` резолвится первым в `::1` (IPv6), а martin слушает только IPv4.
3. `docker-compose.yml` osrm healthcheck: заменён `wget` на `bash /dev/tcp` — в osrm-backend образе нет ни `wget`, ни `curl`. Причём `/bin/sh` там dash, `/dev/tcp` — bashism, поэтому используется форма `["CMD", "bash", "-c", ...]`.
4. `scripts/import-osm.sh`: образ `openstreetmap/osm2pgsql:latest` не существует (шаблон в task1.md содержал несуществующий image) → заменён на работающий community-образ `iboates/osm2pgsql:latest` (osm2pgsql v2.2.0).

Backend/frontend сервисы сознательно не поднимались: их Dockerfile требует `package.json` + сорсы, которые создаются в task2/task3. После task3 нужно будет вернуться и убедиться, что `docker compose ps` показывает все 5 healthy — это внешний «регрессионный» чек, а не новая задача.

Открытые TODO вне скоупа task1 (согласовано с пользователем):

- Перед стартом task6 переименовать `assets/icons/airplane.png` → `plane.png`.
- Удалить лишний `assets/icons/fire.png` (с явным разрешением).

Следующая фаза: task2 — Авторизация (бэкенд).

Замечания на будущее (не для следующей задачи):

- Martin читает `./martin/config.yaml` с `${POSTGRES_USER}` / `${POSTGRES_PASSWORD}` / `${POSTGRES_GIS_DB}`. В compose у martin env_file не задан (по шаблону) — при создании конфига через `docker compose run --rm martin --save-config ...` подстановка произойдёт в самой строке подключения. Проверить на этапе задачи "Конфиг Martin".

Открытые TODO вне скоупа task1 (согласовано с пользователем):

- Перед стартом task6 переименовать `assets/icons/airplane.png` → `plane.png`.
- Удалить лишний `assets/icons/fire.png` (с явным разрешением).

