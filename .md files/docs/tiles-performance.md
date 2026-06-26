# Ускорение загрузки тайлов карты

Заметка на будущее, сделана по результатам диагностики task4 и HAR-дампа `localhost.har`.

## Текущее состояние (что получили из HAR)

- Martin настроен с `auto_publish: true` и отдаёт сырые таблицы `planet_osm_polygon` / `planet_osm_line` без фильтрации по zoom и без упрощения геометрии.
- На первый просмотр карты уходит **149 тайлов, ~958 MB** суммарного трафика.
- Самый жирный тайл: `/tiles/planet_osm_line/4/9/5` = **96 MB** (один тайл).
- Средний тайл — 2 секунды, 32 из 149 дольше 2 с, самый медленный — 19.5 с.
- На высоких zoom-уровнях терпимо (bbox тайла маленький → таблица физически меньше), проблема критична на zoom 0–6.

**Причина:** на низких zoom Martin вытягивает все 13.5M линий / 35.7M полигонов, попадающих в bbox тайла, конвертирует в MVT и отдаёт целиком.

## Пути оптимизации (от дешёвых к фундаментальным)

### 1. SQL-функции-источники в Martin (минимальный правильный фикс)

Вместо `auto_publish` сырых таблиц — PL/pgSQL функции вида `get_roads(z, x, y)`, которые:

- фильтруют по `highway IN (...)` в зависимости от `z` (на z<6 только `motorway`/`trunk`/`primary`);
- упрощают геометрию через `ST_SimplifyPreserveTopology(way, tolerance_for_zoom(z))`;
- возвращают `ST_AsMVT(...)`.

Martin v0.14 автоматически подхватывает такие функции из БД.

**Пример скелета:**

```sql
CREATE OR REPLACE FUNCTION roads_tiles(z integer, x integer, y integer)
RETURNS bytea AS $$
  WITH bounds AS (SELECT ST_TileEnvelope(z, x, y) AS env),
  filtered AS (
    SELECT
      CASE
        WHEN z < 6 THEN highway
        WHEN z < 10 THEN highway
        ELSE highway
      END AS kind,
      ST_SimplifyPreserveTopology(way, 10000 / power(2, z)) AS geom
    FROM planet_osm_line, bounds
    WHERE way && bounds.env
      AND (
        (z < 6 AND highway IN ('motorway','trunk','primary'))
        OR (z BETWEEN 6 AND 9 AND highway IN ('motorway','trunk','primary','secondary'))
        OR (z >= 10)
      )
  ),
  mvt AS (
    SELECT ST_AsMVTGeom(geom, (SELECT env FROM bounds)) AS geom, kind
    FROM filtered
  )
  SELECT ST_AsMVT(mvt, 'roads', 4096, 'geom') FROM mvt;
$$ LANGUAGE SQL STABLE;
```

**Ожидаемый эффект:** размер тайла 50–200 KB (вместо 20–96 MB), время 20–100 мс (вместо 2–20 с). Выигрыш 50–500×.

**Плюсы:**

- Трудоёмкость ~1 день.
- Никаких новых сервисов.
- OSM-данные остаются живыми: любая правка в PostGIS → сразу в тайлах.
- Легко расширяется под кастомные слои (пользовательские точки, маршруты и т.п.).

**Минусы:**

- Нагрузка на Postgres при каждом запросе тайла (смягчается индексами + Martin cache).
- Нужно писать функции под каждый логический слой (roads, buildings, landuse, admin, water).

### 2. Предгенерация PMTiles (индустриальный стандарт)

Один раз прогоняем Россию через `tippecanoe` или `planetiler`, получаем файл `russia.pmtiles` размером 3–6 GB с готовыми zoom-слоями и упрощением. Раздаём как статический файл через nginx, MapLibre читает его HTTP Range-запросами (плагин `pmtiles`).

**Pipeline (пример):**

```bash
ogr2ogr -f GeoJSONSeq roads.geojson PG:"host=db dbname=gis" \
  -sql "SELECT osm_id, highway, way FROM planet_osm_line WHERE highway IS NOT NULL"

tippecanoe -o russia.pmtiles -zg --drop-densest-as-needed \
  --extend-zooms-if-still-dropping roads.geojson buildings.geojson landuse.geojson
```

**Ожидаемый эффект:** тайл отдаётся за 5–20 мс, БД вообще не участвует.

**Плюсы:**

- Нулевая нагрузка на БД при отдаче карты.
- Кэшируется на CDN как обычный статик.
- Переживает падение PostgreSQL.
- Детерминированный latency (нет хвостов в 2–20 с).
- Масштабируется на тысячи конкурентных клиентов без проблем.

**Минусы:**

- Отдельная инфраструктурная подсистема: tippecanoe, pipeline генерации, раздача файла с Range, плагин pmtiles в MapLibre.
- Генерация 30–60 минут, перегенерация при каждом апдейте OSM.
- Файл 3–6 GB — не в репо, нужен volume или object storage.
- Ломает сценарий «правка геометрии в БД сразу видна на карте». Динамические слои всё равно нужно держать через Martin параллельно.

### 3. OpenMapTiles schema через `pgosm-flex` / `imposm3`

Перезаливаем OSM через Lua-скрипт, создающий готовые zoom-aware таблицы (`roads_z6`, `landuse_z10` и т.п.) с предпросчитанной генерализацией. Фактически это реимплементация OpenMapTiles-схемы, под которую есть готовые красивые стили (openmaptiles.org, maptiler).

**Плюсы:**

- Красивая карта из коробки.
- Индустриально стандартная схема, много готовых инструментов.

**Минусы:**

- Полная перезаливка БД, переписывание Lua-трансформов.
- Самый большой объём работы из всех путей.

### 4. Вспомогательные хаки (дают частичный эффект)

- `**maxzoom`/`minzoom` в MapLibre style на каждый слой** — убирает лишние запросы на zoom-уровнях, где слой невидим. Быстро применимо, но тяжёлые тайлы останутся тяжёлыми на «разрешённых» zoom.
- **Partial/spatial индексы** в Postgres:
  ```sql
  CREATE INDEX idx_roads_major ON planet_osm_line USING GIST(way)
    WHERE highway IN ('motorway','trunk','primary');
  ```
  Ускорит SQL-запросы внутри Martin, но не решает проблему объёма MVT-выхода.
- **Martin tile cache** — в конфиге уже есть `cache_size_mb`, полезен при повторных запросах; первый визит всё равно медленный. Можно добавить прогрев через `curl` по популярным bbox'ам.
- **Nginx `proxy_cache` перед Martin** — кэш между пользователями. Для первого визита эффекта нет, но снимает нагрузку на БД при массовом трафике.
- **gzip/brotli на `/tiles/*`** — MVT хорошо сжимается (2–5×). Проверить, что Martin или nginx отдаёт `Content-Encoding: gzip`.

## Рекомендация

**Для v1 (task9 — полировка/деплой):** путь **#1** (SQL-функции в Martin). Дешёвый, живой, совместим со всей текущей инфраструктурой, покрывает 95% потребности по latency. Реалистичная трудоёмкость ~1 день.

**Если потом карта станет бутылочным горлышком (массовый публичный трафик):** мигрировать на **#2** (PMTiles) для базового слоя, оставив Martin для динамических пользовательских слоёв.

**Путь #3** — только если захочется фирменный визуал уровня MapTiler / Maputnik.

## Реализовано (zoom-adaptive, balanced profile)

Сделана zoom-адаптивная выдача в Martin через функции:

- `mv_roads(z, x, y)` — класс дороги + упрощение геометрии по zoom.
- `mv_water(z, x, y)` — вода + area-фильтр и упрощение по zoom.
- `mv_landuse(z, x, y)` — landuse + area-фильтр и упрощение по zoom.

Фронтенд переключён на новые источники:

- `/tiles/mv_roads/{z}/{x}/{y}`
- `/tiles/mv_water/{z}/{x}/{y}`
- `/tiles/mv_landuse/{z}/{x}/{y}`

### До/после (cold MISS, одинаковые контрольные тайлы)

#### До (сырые `planet_osm_`*)

- `/tiles/planet_osm_line/4/9/5` → `99,893,729 B`, `6.28 s`
- `/tiles/planet_osm_polygon/4/9/5` → `40,479,366 B`, `8.39 s`
- `/tiles/planet_osm_line/6/37/19` → `11,511,868 B`, `0.90 s`
- `/tiles/planet_osm_polygon/6/37/19` → `11,413,447 B`, `1.70 s`

#### После (zoom-adaptive `mv_`*)

- `/tiles/mv_roads/4/9/5` → `379,625 B`, `0.66 s`
- `/tiles/mv_water/4/9/5` → `2,124 B`, `0.97 s`
- `/tiles/mv_landuse/4/9/5` → `1,696 B`, `1.48 s`
- `/tiles/mv_roads/6/37/19` → `86,660 B`, `0.18 s`
- `/tiles/mv_water/6/37/19` → `8,601 B`, `0.33 s`
- `/tiles/mv_landuse/6/37/19` → `6,113 B`, `0.13 s`

### Итоговые метрики (после внедрения)

- Cold-ish выборка 150 тайлов (`z4-z12`, окрестность центра): `avg 0.262 s`, `p95 1.099 s`.
- После прогрева (`warm-tiles-cache.sh`) на той же выборке: `avg 0.027 s`, `p95 0.032 s`.
- По Nginx заголовку `X-Tile-Cache` тайлы стабильно переходят в `HIT`.

### Где лежит реализация

- SQL-функции и индексы: `db/sql/01-zoom-adaptive-tiles.sql`
- Применение SQL: `scripts/apply-zoom-adaptive-tiles.sh`
- Автоприменение после импорта OSM: `scripts/import-osm.sh`
- Конфиг источников Martin: `martin/config.yaml`
- Источники/пороги слоёв фронта: `frontend/src/map/map-styles.ts`
- Прогрев кэша с маппингом legacy HAR URL: `scripts/warm-tiles-cache.sh`

## Ссылки для будущего себя

- Martin functions as tile sources: [https://maplibre.org/martin/sources-pg-functions.html](https://maplibre.org/martin/sources-pg-functions.html)
- tippecanoe: [https://github.com/felt/tippecanoe](https://github.com/felt/tippecanoe)
- planetiler (альтернатива tippecanoe на Java, быстрее): [https://github.com/onthegomap/planetiler](https://github.com/onthegomap/planetiler)
- PMTiles spec: [https://github.com/protomaps/PMTiles](https://github.com/protomaps/PMTiles)
- pgosm-flex: [https://github.com/rustprooflabs/pgosm-flex](https://github.com/rustprooflabs/pgosm-flex)
- OpenMapTiles schema: [https://openmaptiles.org/schema/](https://openmaptiles.org/schema/)

