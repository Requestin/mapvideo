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

- [ ] Создать структуру директорий проекта
- [ ] Написать docker-compose.yml
- [ ] Написать docker-compose.dev.yml
- [ ] Создать .env.example
- [ ] Dockerfile для бэкенда
- [ ] Dockerfile для фронтенда
- [ ] Конфиг nginx (mapvideo.gyhyry.ru.conf)
- [ ] Конфиг Martin (martin/config.yaml)
- [ ] Скрипт импорта OSM (scripts/импорт-osm.sh)
- [ ] Проверить что все сервисы поднимаются

---

## Docker Compose — все сервисы

```yaml
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
      - "5432:5432"

  martin:
    image: ghcr.io/maplibre/martin:latest
    command: --config /config/config.yaml
    volumes:
      - ./martin:/config
    ports:
      - "3002:3000"
    depends_on:
      - postgres

  photon:
    image: rhamseyswork/photon:latest
    volumes:
      - photon_data:/photon/photon_data
    ports:
      - "2322:2322"

  osrm:
    image: ghcr.io/project-osrm/osrm-backend:latest
    command: osrm-routed --algorithm mld /data/planet-latest.osrm
    volumes:
      - ./osm-data:/data
    ports:
      - "5000:5000"

  backend:
    build: ./backend
    env_file: .env
    ports:
      - "3001:3001"
    depends_on:
      - postgres

  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      - backend

volumes:
  postgres_data:
  photon_data:
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

**scripts/импорт-osm.sh:**
```bash
#!/bin/bash
set -e

OSM_FILE="./osm-data/planet-latest.osm.pbf"
OSM_URL="https://download.geofabrik.de/planet-latest.osm.pbf"

# Скачать если нет
if [ ! -f "$OSM_FILE" ]; then
  echo "Скачиваю данные всего мира (~80GB)..."
  mkdir -p ./osm-data
  wget -O "$OSM_FILE" "$OSM_URL"
fi

# Импорт в PostgreSQL
echo "Импортирую данные (несколько часов)..."
docker compose run --rm postgres bash -c "
  osm2pgsql -d ${POSTGRES_DB} \
    --create --slim -G --hstore \
    -C 16000 \
    -H postgres -U ${POSTGRES_USER} \
    /osm-data/planet-latest.osm.pbf
"

echo "Импорт завершён"
```

**Важно при импорте:**
- Флаг `--tag-transform-script` НЕ использовать — файл lua не установлен
- Параметр `-C 4000` — размер кеша в MB
- Импорт занимает 25-30 минут, это нормально
- После импорта индексы создаются автоматически

---

## Конфиг Nginx

```nginx
# nginx/mapvideo.gyhyry.ru.conf
server {
    server_name mapvideo.gyhyry.ru;

    # Фронтенд
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # API бэкенда
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Тайлы Martin
    location /tiles/ {
        proxy_pass http://localhost:3002/;
        proxy_set_header Host $host;
    }

    listen 443 ssl;
    # SSL управляется Certbot
}
```

**ВАЖНО:** добавлять конфиг в отдельный файл `/etc/nginx/sites-enabled/mapvideo.gyhyry.ru.conf`
Не редактировать существующие конфиги (там maps.gyhyry.ru — независимый проект).

---

## Проверка работоспособности

После `docker compose up -d` проверить каждый сервис:

```bash
# PostgreSQL
docker compose exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT version();"

# Martin (после импорта OSM)
curl http://localhost:3002/catalog

# Photon
curl "http://localhost:2322/api?q=Москва&limit=1"

# OSRM (после подготовки данных)
curl "http://localhost:5000/route/v1/driving/37.618,55.751;30.315,59.939"

# Бэкенд
curl http://localhost:3001/api/health

# Фронтенд
curl http://localhost:3000
```

Все запросы должны вернуть корректные ответы (не ошибки).

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
