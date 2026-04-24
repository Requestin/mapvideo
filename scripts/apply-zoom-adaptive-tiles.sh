#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_FILE="${ROOT_DIR}/db/sql/01-zoom-adaptive-tiles.sql"

if [[ ! -f "${ROOT_DIR}/.env" ]]; then
  echo ".env not found at ${ROOT_DIR}/.env" >&2
  exit 1
fi

source "${ROOT_DIR}/.env"

if [[ ! -f "${SQL_FILE}" ]]; then
  echo "SQL file not found: ${SQL_FILE}" >&2
  exit 1
fi

echo "Applying zoom-adaptive tile SQL to database ${POSTGRES_GIS_DB}..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER}" -d "${POSTGRES_GIS_DB}" < "${SQL_FILE}"
echo "Zoom-adaptive tile SQL applied."
