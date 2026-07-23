#!/bin/bash
# Тест baseline-миграции на копии прод-схемы. Запускается НА VPS:
#   ssh vps4 'bash -s' < scripts/migtest.sh
# Прод-контейнеры не трогает: поднимает одноразовый postgres, копирует
# только структуру БД (без данных), применяет миграцию и удаляет всё за собой.
set -euo pipefail

MIG_URL="https://raw.githubusercontent.com/allitcreator/Food-Analyzer-Bot/main/migrations/0000_baseline.sql"

cleanup() { docker rm -f migtest-pg >/dev/null 2>&1 || true; rm -f /tmp/prod_schema.sql /tmp/mig.sql; }
trap cleanup EXIT

echo "=== 1. Одноразовый postgres ==="
docker run -d --name migtest-pg -e POSTGRES_PASSWORD=migtest postgres:16-alpine >/dev/null
sleep 6

echo "=== 2. Schema-only дамп прода (данные не читаются) ==="
docker exec foodbot-db-1 sh -c 'pg_dump -U $POSTGRES_USER --schema-only --no-owner --no-privileges $POSTGRES_DB' > /tmp/prod_schema.sql
echo "дамп: $(wc -l < /tmp/prod_schema.sql) строк"

echo "=== 3. Тестовые БД: prodlike (копия структуры прода) и freshdb (пустая) ==="
docker exec migtest-pg psql -U postgres -q -c "CREATE DATABASE prodlike;" -c "CREATE DATABASE freshdb;"
docker exec -i migtest-pg psql -q -U postgres -v ON_ERROR_STOP=1 prodlike < /tmp/prod_schema.sql

echo "=== 4. Миграция из GitHub (main) ==="
curl -fsSL "$MIG_URL" -o /tmp/mig.sql
echo "миграция: $(wc -l < /tmp/mig.sql) строк"

echo "=== 5. Применение к prodlike (1-й раз — как будет на проде) ==="
docker exec -i migtest-pg psql -q -U postgres -v ON_ERROR_STOP=1 prodlike < /tmp/mig.sql && echo "OK"

echo "=== 6. Применение к prodlike (2-й раз — идемпотентность) ==="
docker exec -i migtest-pg psql -q -U postgres -v ON_ERROR_STOP=1 prodlike < /tmp/mig.sql && echo "OK"

echo "=== 7. Применение к freshdb (пустая БД, дважды) ==="
docker exec -i migtest-pg psql -q -U postgres -v ON_ERROR_STOP=1 freshdb < /tmp/mig.sql && echo "OK-1"
docker exec -i migtest-pg psql -q -U postgres -v ON_ERROR_STOP=1 freshdb < /tmp/mig.sql && echo "OK-2"

echo "=== 8. Проверка результата на prodlike ==="
docker exec migtest-pg psql -U postgres prodlike -c "
SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE column_name='user_id' AND table_schema='public'
ORDER BY table_name;"
docker exec migtest-pg psql -U postgres prodlike -c "
SELECT conrelid::regclass AS table_name, conname, confdeltype
FROM pg_constraint WHERE contype='f' ORDER BY 1;"
docker exec migtest-pg psql -U postgres prodlike -c "
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND indexname LIKE '%user_id_date_idx' ORDER BY 1;"

echo "=== ГОТОВО: контейнер и временные файлы удалены ==="
