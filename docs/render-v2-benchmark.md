# Render V2 Benchmark

Скрипт `scripts/benchmark-render-v2.sh` проверяет SLA Render V2:

- сценарии: `3s`, `10s`, `30s`
- FPS: `25p` и `50p`
- gate: `elapsed_ms <= duration * 3000`

## Что измеряется

Измеряется wall-clock время от `POST /api/render` до статуса `done` при последовательном запуске задач (без параллельной очереди). Это максимально близко к "чистому processing time" для рабочей проверки на прод-сервере.

Дополнительно backend пишет stage-тайминги в логи:

- `t_prepare_ms`
- `t_capture_base_ms`
- `t_geo_pass_ms`
- `t_total_processing_ms`

## Запуск

```bash
chmod +x scripts/benchmark-render-v2.sh
BASE_URL="https://mapvideo.gyhyry.ru" \
USERNAME="admin" \
PASSWORD="***" \
./scripts/benchmark-render-v2.sh
```

Опционально:

- `POLL_SEC=1` — интервал опроса статуса.

## Интерпретация

- `✅ SLA OK` — сценарий проходит.
- `❌ SLA FAILED` — сценарий превысил лимит `x3`.
- Код выхода `0` — все проверки пройдены, `1` — есть провалы SLA.
