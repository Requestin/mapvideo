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
  iboates/osm2pgsql:latest osm2pgsql \
    --create --slim -G --hstore \
    -C ${CACHE_MB} \
    -H postgres -U ${POSTGRES_USER} -d ${POSTGRES_GIS_DB} \
    /osm-data/${OSM_PBF_FILE}

# Rebuild zoom-adaptive tile sources after each fresh osm2pgsql import.
echo "Применяю zoom-адаптивные SQL-источники тайлов..."
./scripts/apply-zoom-adaptive-tiles.sh

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
