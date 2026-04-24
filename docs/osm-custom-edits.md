# Кастомные правки OSM с сохранением при переимпорте PBF

Заметка на будущее. Основной сценарий: мы хотим ручные правки (например, поправить границу региона, добавить несуществующий в OSM объект, удалить устаревший), и чтобы эти правки **не терялись при обновлении `russia-latest.osm.pbf`**.

## Исходные ограничения

- Таблицы `planet_osm_polygon`, `planet_osm_line`, `planet_osm_point`, `planet_osm_roads` — это **выходные артефакты `osm2pgsql`**. Любой `osm2pgsql --append` или полный переимпорт пересоздаёт их из PBF. Ручные UPDATE'ы в этих таблицах **гарантированно потеряются**.
- OSM-граница региона — это `type=relation`, собранная из десятков-сотен `way`'ев, которые шарятся с соседями. Один UPDATE полигона даёт визуально рассогласованную картинку (линия границы не сдвинулась, соседний регион не подвинулся).
- Вывод: правки всегда хранить **в отдельных таблицах**, OSM-таблицы считать read-only выгрузкой.

## Шаблон 1. Override-таблица + merge в SQL-функции Martin (прагматичный)

Правки живут в собственной таблице, слияние с OSM происходит **во время генерации тайла**. Переимпорт `planet_osm_`* на правки не влияет.

### Схема

```sql
CREATE TABLE admin_overrides (
  id          SERIAL PRIMARY KEY,
  osm_id      BIGINT,              -- id исходной relation, NULL для чисто новых объектов
  action      TEXT NOT NULL        -- 'replace' | 'add' | 'delete'
              CHECK (action IN ('replace','add','delete')),
  name        TEXT,
  admin_level INT,
  way         GEOMETRY(MULTIPOLYGON, 3857),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  author      TEXT
);

CREATE INDEX admin_overrides_osm_id_idx ON admin_overrides(osm_id);
CREATE INDEX admin_overrides_way_gist   ON admin_overrides USING GIST(way);
```

### SQL-функция-источник для Martin

```sql
CREATE OR REPLACE FUNCTION admin_tiles(z integer, x integer, y integer)
RETURNS bytea AS $$
  WITH bounds AS (SELECT ST_TileEnvelope(z, x, y) AS env),
  base AS (
    SELECT p.osm_id, p.name, (p.tags->>'admin_level')::int AS admin_level, p.way
    FROM planet_osm_polygon p, bounds
    WHERE p.boundary = 'administrative'
      AND p.way && bounds.env
      AND NOT EXISTS (
        SELECT 1 FROM admin_overrides o
        WHERE o.osm_id = p.osm_id AND o.action IN ('replace','delete')
      )
  ),
  overrides AS (
    SELECT NULL::bigint AS osm_id, o.name, o.admin_level, o.way
    FROM admin_overrides o, bounds
    WHERE o.action IN ('replace','add')
      AND o.way && bounds.env
  ),
  merged AS (SELECT * FROM base UNION ALL SELECT * FROM overrides),
  mvt AS (
    SELECT ST_AsMVTGeom(way, (SELECT env FROM bounds)) AS geom, name, admin_level
    FROM merged
  )
  SELECT ST_AsMVT(mvt, 'admin', 4096, 'geom') FROM mvt;
$$ LANGUAGE SQL STABLE;
```

### Плюсы

- Переимпорт OSM полностью независим от правок.
- Откат тривиален: `DELETE FROM admin_overrides WHERE id=...` → через секунды OSM-версия восстановилась.
- Управление правками через обычные INSERT/UPDATE, легко обернуть в API бэка или admin UI.
- Вся история правок в одной таблице (плюс author, updated_at для аудита).

### Минусы

- JOIN на каждый запрос тайла. При 10⁴+ правок может замедлить Martin → смягчается индексами и кэшем.
- Замещение только на уровне итогового полигона: соседние объекты OSM остаются в «оригинальной» геометрии. Если правка — именно граница между двумя регионами, нужно override'ить оба.

## Шаблон 2. Post-import hook + идемпотентный SQL-скрипт

`planet_osm_*` физически содержит обновлённую геометрию. После каждого `osm2pgsql` запускается скрипт, переприменяющий правки из override-таблицы к основным OSM-таблицам.

### Скрипт-раннер

```bash
#!/bin/bash
# scripts/reimport-osm.sh
set -euo pipefail

osm2pgsql \
  --database=gis --slim --drop --hstore \
  --style=/opt/osm2pgsql/openstreetmap-carto.style \
  /data/russia-latest.osm.pbf

psql -d gis -f /app/migrations/apply-overrides.sql
docker restart mapvideo-martin-1   # сброс Martin tile cache
```

### `apply-overrides.sql` (идемпотентно)

```sql
BEGIN;

-- replace: подмена геометрии существующих OSM-relation
UPDATE planet_osm_polygon p
SET way = o.way
FROM admin_overrides o
WHERE o.action = 'replace'
  AND p.osm_id = o.osm_id;

-- delete: удаление объекта из OSM-таблицы
DELETE FROM planet_osm_polygon p
USING admin_overrides o
WHERE o.action = 'delete' AND p.osm_id = o.osm_id;

-- add: добавление синтетических объектов с отрицательным osm_id
INSERT INTO planet_osm_polygon (osm_id, name, boundary, way, tags)
SELECT -o.id, o.name, 'administrative', o.way,
       hstore('admin_level', o.admin_level::text)
FROM admin_overrides o
WHERE o.action = 'add'
ON CONFLICT (osm_id) DO UPDATE SET way = EXCLUDED.way;

COMMIT;
```

### Плюсы

- Рантайм такой же быстрый, как для чистого OSM: никаких JOIN при запросе тайла.
- Правки применяются один раз, не каждый запрос.
- Все зависимые Martin-слои (roads, landuse) видят согласованную БД.

### Минусы

- Между `osm2pgsql` и запуском скрипта БД в «чистом OSM» состоянии → нужно всегда завершать полный цикл.
- Идемпотентность скрипта — на разработчике (осторожно с `INSERT`, `ON CONFLICT`).
- Правку можно сделать только переприменив весь override — нельзя править «горячо» на живой БД без переимпорта.

## Шаблон 3. `osm2pgsql --flex` + Lua-трансформ (индустриальный)

Современный `osm2pgsql` умеет Flex output: Lua-скрипт получает каждый OSM-объект из PBF и решает, что записать в БД. В Lua можно подгрузить override-таблицу и подменить геометрию/теги или пропустить объект.

### Скелет `overrides.lua`

```lua
local overrides = {}
for line in io.lines('/data/admin_overrides.csv') do
  local osm_id, action, wkt = line:match('(%-?%d+),(%a+),"(.+)"')
  overrides[tonumber(osm_id)] = { action = action, wkt = wkt }
end

local admin = osm2pgsql.define_area_table('admin_boundaries', {
  { column = 'name', type = 'text' },
  { column = 'admin_level', type = 'int' },
  { column = 'geom', type = 'multipolygon', projection = 3857 },
})

function osm2pgsql.process_relation(object)
  if object.tags.boundary ~= 'administrative' then return end
  local ov = overrides[object.id]
  if ov and ov.action == 'delete' then return end
  if ov and ov.action == 'replace' then
    admin:insert({
      name = object.tags.name,
      admin_level = tonumber(object.tags.admin_level),
      geom = { wkt = ov.wkt },
    })
  else
    admin:insert({
      name = object.tags.name,
      admin_level = tonumber(object.tags.admin_level),
      geom = object:as_multipolygon(),
    })
  end
end
```

### Плюсы

- Правки применяются **на этапе импорта** — в БД сразу «правильная» версия.
- Никаких JOIN на runtime.
- Переимпорт автоматически = переприменение правок (Lua читает ту же CSV/таблицу).
- Полная совместимость со всеми инструментами, работающими с OSM-таблицами.

### Минусы

- Самый увесистый путь: Lua-скрипт живёт в репо, его нужно версионировать и тестировать.
- Правка = git-коммит + полный переимпорт (часы). Неприменимо для «горячих» правок от пользователей.
- Совместимость с новыми версиями osm2pgsql приходится поддерживать.

## Шаблон 4. Патч PBF через `osmium` до импорта

Держим набор `patches/*.osc` (OSM change files в XML), перед импортом склеиваем их с исходным PBF:

```bash
osmium apply-changes russia-latest.osm.pbf patches/*.osc \
  -o russia-patched.pbf
osm2pgsql ... russia-patched.pbf
```

### Плюсы

- Абсолютная согласованность: relations, way'и, теги — всё в едином OSM-формате.
- Upstream-инструменты (JOSM, iD, Overpass) смогут работать с пропатченным файлом.

### Минусы

- OSC-файлы — это XML со списком добавленных/удалённых/изменённых нод, way и relations. Руками их писать нетривиально.
- Обычно применяется, только если уже есть свой OSM-редактор (iD, JOSM) для генерации OSC.

## Ключевая разница: когда происходит merge


| Шаблон                               | Merge происходит        | Trade-off                                                       |
| ------------------------------------ | ----------------------- | --------------------------------------------------------------- |
| **1** Override-таблица + SQL-функция | На каждом запросе тайла | Простота + гибкость + живые правки, но JOIN runtime cost        |
| **2** Post-import script             | Один раз после импорта  | Быстрый runtime, но правки жёстко привязаны к циклу переимпорта |
| **3** osm2pgsql flex Lua             | Во время импорта        | Индустриально, но тяжело поддерживать и нельзя править «горячо» |
| **4** osmium patch                   | До импорта              | Полная OSM-семантика, но сложно создавать OSC                   |


## Рекомендации по выбору


| Сценарий                                                 | Шаблон |
| -------------------------------------------------------- | ------ |
| Разовые правки регионов админом, редко                   | **1**  |
| Десятки правок, важна runtime-скорость тайлов            | **2**  |
| Сотни правок — часть бизнес-логики карты                 | **3**  |
| Нужна полная OSM-семантика (relations, роли, multilevel) | **4**  |


Для нашего проекта **шаблон 1** ближе всего: минимум инфраструктуры, мгновенный эффект, тривиальный откат. Если правок накопится много и JOIN начнёт просаживать тайлы — апгрейдиться до **шаблона 2**.

## Рабочий процесс правки (на основе шаблона 1)

1. Админ открывает UI редактирования.
2. Выбирает объект OSM (клик по карте → определяем `osm_id` через `queryRenderedFeatures`).
3. Рисует/правит геометрию.
4. Бэк делает `INSERT INTO admin_overrides (osm_id, action, way, ...)` или `UPDATE ... WHERE id=...`.
5. Сбрасываем Martin tile cache для затронутой зоны (`POST /martin/purge` или рестарт).
6. В браузере правка видна через секунды.

Откат — `DELETE FROM admin_overrides WHERE id=...` + сброс кэша.

## Ссылки

- osm2pgsql Flex output: [https://osm2pgsql.org/doc/manual.html#the-flex-output](https://osm2pgsql.org/doc/manual.html#the-flex-output)
- osmium apply-changes: [https://docs.osmcode.org/osmium/latest/osmium-apply-changes.html](https://docs.osmcode.org/osmium/latest/osmium-apply-changes.html)
- PostGIS ST_AsMVT: [https://postgis.net/docs/ST_AsMVT.html](https://postgis.net/docs/ST_AsMVT.html)
- OSM changeset format: [https://wiki.openstreetmap.org/wiki/OsmChange](https://wiki.openstreetmap.org/wiki/OsmChange)

