# Фаза 1 — Инфраструктура и окружение

**Статус:** Не начато
**Связанные файлы:** cursor.md (стек, порты), SPEC.md (список сервисов)
**Следующая фаза:** task2.md (бэкенд использует PostgreSQL поднятый здесь)

---

## Цель фазы
Поднять все сервисы через Docker Compose так чтобы одна команда
`docker compose up -d` запускала всё необходимое для разработки.
---

## Skills для этой фазы

| Skill | Когда активировать |
|-------|--------------------|
| **systematic-debugging** | При отладке проблем с Docker, Martin, PostgreSQL или OSRM |

---

## Задачи

- [ ] Создать папку `~/mapvideo` на сервере и структуру директорий проекта
- [ ] Установить Docker + Docker Compose plugin на сервере (если ещё не стоит)
- [ ] Убедиться что `russia-260419.osm.pbf` уже лежит в `osm-data/` (файл на сервере)
- [ ] Написать docker-compose.yml (сервисы биндятся на 127.0.0.1)
- [ ] Написать docker-compose.dev.yml (dev оверрайд — `command: npm run dev`)
- [ ] Создать .env.example (все ключи из cursor.md)
- [ ] Dockerfile для бэкенда (node:20-slim + Chromium/nss/freetype/harfbuzz/fonts + ffmpeg + dumb-init)
- [ ] Dockerfile для фронтенда (node:20-alpine для билда, nginx:alpine для статики в prod)
- [ ] Конфиг для **хостового** nginx (`/etc/nginx/sites-available/mapvideo.gyhyry.ru.conf`)
- [ ] Конфиг Martin (martin/config.yaml)
- [ ] Скрипт импорта OSM (scripts/import-osm.sh) — использует OSM_PBF_FILE, делает symlink в region.osm.pbf для OSRM
- [ ] Healthcheck у каждого сервиса
- [ ] Проверить что все сервисы поднимаются (`docker compose ps` → все healthy)

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

**Принцип:** все сервисы биндятся на `127.0.0.1:PORT` хоста — снаружи их не видно. Хостовой nginx сервера проксирует домен `mapvideo.gyhyry.ru` (HTTPS 443) на эти локальные порты. Nginx как docker-сервис **не поднимаем** — он уже есть на хосте и обслуживает maps.gyhyry.ru. Photon тоже не поднимаем — геокодер работает через публичный https://photon.komoot.io/api, вызов идёт с бэкенда.

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

  osrm:
    image: ghcr.io/project-osrm/osrm-backend:v5.27.1
    command: osrm-routed --algorithm mld /data/region.osrm
    volumes:
      - ./osm-data:/data
    ports:
      - "127.0.0.1:5000:5000"
    networks: [mapvideo_net]

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

networks:
  mapvideo_net:
    driver: bridge

volumes:
  postgres_data:
```

**docker-compose.dev.yml** — dev оверрайд. Порты уже открыты наружу на localhost (см. выше), тут только `command`:

```yaml
services:
  backend:
    command: npm run dev
  frontend:
    command: npm run dev
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

**ВАЖНО:** Martin использует `postgresql://`, не `postgis://`
Подключение через Unix сокет не работает в Docker — использовать TCP,
но предварительно добавить пользователя в pg_hba.conf с методом `trust`:

```yaml
# martin/config.yaml
postgres:
  connection_string: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?sslmode=disable
  auto_publish: true

cache:
  size_mb: 1024
```

Генерировать конфиг автоматически после первого запуска:
```bash
docker compose run --rm martin \
  postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?sslmode=disable \
  --save-config /config/config.yaml --auto-bounds skip
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
echo "Импортирую OSM данные в PostgreSQL..."
docker run --rm --network mapvideo_mapvideo_net \
  -v $(pwd)/osm-data:/osm-data \
  -e PGPASSWORD=${POSTGRES_PASSWORD} \
  iboates/osm2pgsql:latest osm2pgsql \
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
- OSRM preprocessing переименовывает pbf в `region.osrm.*` — файл имени не зависит от того Россия это или planet
- После импорта индексы создаются автоматически
- Для Photon нужен отдельный pre-built индекс (см. задачу ниже)

---

## Конфиг Nginx (только хостовой)

Nginx **в docker compose нет**. Наружу 80/443 слушает хостовой nginx сервера (тот же, что обслуживает maps.gyhyry.ru). Создаём отдельный файл только для нашего домена — существующие конфиги не трогаем.

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
- PostgreSQL должен принимать подключения — проверить `pg_hba.conf`
- Использовать флаг `-H postgres` (имя контейнера) вместо `localhost`

**OSRM не запускается:**
- Данные нужно предварительно обработать:
  ```bash
  docker run -v ./osm-data:/data ghcr.io/project-osrm/osrm-backend \
    osrm-extract -p /opt/car.lua /data/planet-latest.osm.pbf
  docker run -v ./osm-data:/data ghcr.io/project-osrm/osrm-backend \
    osrm-partition /data/planet-latest.osrm
  docker run -v ./osm-data:/data ghcr.io/project-osrm/osrm-backend \
    osrm-customize /data/planet-latest.osrm
  ```
  Это занимает 15-30 минут.

---

## Заметка для следующей сессии
*(заполняется после завершения задачи или перед завершением сессии)*
