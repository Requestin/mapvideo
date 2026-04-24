#!/usr/bin/env bash
set -euo pipefail

# Benchmark Render V2 against SLA: processing time <= duration * 3.
#
# Required env:
#   BASE_URL   - e.g. https://mapvideo.gyhyry.ru
#   USERNAME   - benchmark user login
#   PASSWORD   - benchmark user password
#
# Optional:
#   POLL_SEC   - status polling interval (default 1)

BASE_URL="${BASE_URL:-}"
USERNAME="${USERNAME:-}"
PASSWORD="${PASSWORD:-}"
POLL_SEC="${POLL_SEC:-1}"

if [[ -z "$BASE_URL" || -z "$USERNAME" || -z "$PASSWORD" ]]; then
  echo "Usage: BASE_URL=... USERNAME=... PASSWORD=... $0"
  exit 2
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
cookiejar="$tmpdir/cookies.txt"

echo "==> Login: $BASE_URL"
curl -sS -f -c "$cookiejar" -b "$cookiejar" \
  -H 'Content-Type: application/json' \
  -X POST "$BASE_URL/api/auth/login" \
  --data "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" >/dev/null

csrf_token="$(awk '$6=="csrf_token"{print $7}' "$cookiejar" | tail -n 1)"
if [[ -z "$csrf_token" ]]; then
  echo "Failed to read csrf_token from cookie jar"
  exit 2
fi

post_render() {
  local duration="$1"
  local fps="$2"
  local payload_file="$tmpdir/payload-${duration}-${fps}.json"
  cat >"$payload_file" <<EOF
{
  "state": {
    "version": "1.0",
    "map": {
      "center": { "lng": 37.6173, "lat": 55.7558 },
      "zoom": 8,
      "bearing": 0,
      "pitch": 0,
      "theme": "dark"
    },
    "video": {
      "resolution": "1920x1080",
      "fps": $fps,
      "format": "mp4",
      "duration": $duration,
      "theme": "dark",
      "cameraBreathing": 0,
      "cameraBreathingReferenceZoom": 8
    },
    "render": {
      "engineVersion": "v2",
      "previewFrame": { "widthPx": 1600, "heightPx": 900 },
      "devicePixelRatio": 1,
      "pageZoom": 1
    },
    "elements": []
  }
}
EOF

  curl -sS -f -c "$cookiejar" -b "$cookiejar" \
    -H "X-CSRF-Token: $csrf_token" \
    -H 'Content-Type: application/json' \
    -X POST "$BASE_URL/api/render" \
    --data "@$payload_file"
}

wait_done() {
  local job_id="$1"
  while true; do
    local body
    body="$(curl -sS -f -c "$cookiejar" -b "$cookiejar" "$BASE_URL/api/render/status/$job_id")"
    local status
    status="$(printf '%s' "$body" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -n 1)"
    if [[ "$status" == "done" ]]; then
      return 0
    fi
    if [[ "$status" == "error" ]]; then
      echo "Render job failed: $job_id"
      echo "$body"
      return 1
    fi
    sleep "$POLL_SEC"
  done
}

bench_one() {
  local duration="$1"
  local fps="$2"
  local limit_ms=$((duration * 3000))
  echo "==> Benchmark duration=${duration}s fps=${fps}"
  local start_ms
  start_ms="$(date +%s%3N)"
  local response
  response="$(post_render "$duration" "$fps")"
  local job_id
  job_id="$(printf '%s' "$response" | sed -n 's/.*"jobId":"\([^"]*\)".*/\1/p' | head -n 1)"
  if [[ -z "$job_id" ]]; then
    echo "Failed to parse jobId. Response: $response"
    return 1
  fi
  wait_done "$job_id"
  local end_ms elapsed_ms
  end_ms="$(date +%s%3N)"
  elapsed_ms=$((end_ms - start_ms))
  printf '    elapsed=%dms limit=%dms\n' "$elapsed_ms" "$limit_ms"
  if (( elapsed_ms > limit_ms )); then
    echo "    ❌ SLA FAILED"
    return 1
  fi
  echo "    ✅ SLA OK"
  return 0
}

fails=0
for duration in 3 10 30; do
  for fps in 25 50; do
    if ! bench_one "$duration" "$fps"; then
      fails=$((fails + 1))
    fi
  done
done

if (( fails > 0 )); then
  echo "Benchmark finished with $fails SLA failure(s)."
  exit 1
fi

echo "Benchmark finished: all scenarios passed."
