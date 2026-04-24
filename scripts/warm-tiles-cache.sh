#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://mapvideo.gyhyry.ru}"
HAR_FILE="${2:-mapvideo.gyhyry.ru.har}"
PARALLEL="${PARALLEL:-12}"

if [[ ! -f "${HAR_FILE}" ]]; then
  echo "HAR file not found: ${HAR_FILE}" >&2
  exit 1
fi

tmp_urls="$(mktemp)"
trap 'rm -f "${tmp_urls}"' EXIT

python3 - "${HAR_FILE}" "${BASE_URL}" > "${tmp_urls}" <<'PY'
import json
import math
import sys
from urllib.parse import urlparse

har_path = sys.argv[1]
base_url = sys.argv[2].rstrip("/")

def deg2num(lon: float, lat: float, z: int) -> tuple[int, int]:
    lat_rad = math.radians(lat)
    n = 2.0 ** z
    xtile = int((lon + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.log(math.tan(lat_rad) + (1 / math.cos(lat_rad))) / math.pi) / 2.0 * n)
    return xtile, ytile

urls: list[str] = []
seen: set[str] = set()

def add(url: str) -> None:
    if url in seen:
        return
    seen.add(url)
    urls.append(url)

with open(har_path, "r", encoding="utf-8") as f:
    data = json.load(f)

entries = data.get("log", {}).get("entries", [])
for entry in entries:
    request = entry.get("request", {})
    raw_url = request.get("url")
    if not isinstance(raw_url, str) or "/tiles/" not in raw_url:
        continue
    parsed = urlparse(raw_url)
    path = parsed.path
    if path.startswith("/tiles/"):
        if path.startswith("/tiles/mv_"):
            add(f"{base_url}{path}")
            continue
        # Backward compatibility with old HAR captures from pre-zoom-adaptive endpoints.
        parts = path.split("/")
        if len(parts) >= 6 and parts[2] == "planet_osm_line":
            z, x, y = parts[3], parts[4], parts[5]
            add(f"{base_url}/tiles/mv_roads/{z}/{x}/{y}")
        elif len(parts) >= 6 and parts[2] == "planet_osm_polygon":
            z, x, y = parts[3], parts[4], parts[5]
            add(f"{base_url}/tiles/mv_water/{z}/{x}/{y}")
            add(f"{base_url}/tiles/mv_landuse/{z}/{x}/{y}")

# Warm the default editor area around Moscow center.
center_lng, center_lat = 37.618, 55.751
for z in range(4, 13):
    x, y = deg2num(center_lng, center_lat, z)
    span = 2 if z < 9 else 3
    for dx in range(-span, span + 1):
        for dy in range(-span, span + 1):
            tx = x + dx
            ty = y + dy
            if tx < 0 or ty < 0:
                continue
            add(f"{base_url}/tiles/mv_landuse/{z}/{tx}/{ty}")
            add(f"{base_url}/tiles/mv_water/{z}/{tx}/{ty}")
            if z >= 6:
                add(f"{base_url}/tiles/mv_roads/{z}/{tx}/{ty}")

for u in urls:
    print(u)
PY

count="$(wc -l < "${tmp_urls}" | tr -d '[:space:]')"
echo "Warmup URLs: ${count}"

if [[ "${count}" == "0" ]]; then
  echo "No tile URLs found to warm."
  exit 0
fi

xargs -P "${PARALLEL}" -n 1 curl -fsS --compressed --retry 2 --retry-all-errors --retry-delay 1 -o /dev/null < "${tmp_urls}" || true
echo "Warmup completed."
