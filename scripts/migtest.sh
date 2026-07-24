#!/bin/bash
# Тест ВСЕЙ цепочки миграций на копии прод-схемы. Запускается НА VPS:
#   ssh vps4 'bash -s' < scripts/migtest.sh
# Список миграций и их порядок берутся из migrations/meta/_journal.json (GitHub main):
# поле tag каждой записи — имя .sql-файла без расширения. Скрипт скачивает все
# миграции по порядку и прогоняет их цепочкой.
# Прод-контейнеры не трогает: поднимает одноразовый postgres, копирует
# только структуру БД (без данных), применяет миграции и удаляет всё за собой.
set -euo pipefail

RAW_BASE="https://raw.githubusercontent.com/allitcreator/Food-Analyzer-Bot/main/migrations"
JOURNAL_URL="$RAW_BASE/meta/_journal.json"
MIG_DIR="/tmp/migtest_migrations"

cleanup() { docker rm -f migtest-pg >/dev/null 2>&1 || true; rm -f /tmp/prod_schema.sql /tmp/journal.json; rm -rf "$MIG_DIR"; }
trap cleanup EXIT

# Прогон всей цепочки миграций по одной БД (каждая — с ON_ERROR_STOP=1)
apply_chain() {
  local db="$1"
  local tag
  for tag in "${MIG_TAGS[@]}"; do
    echo "  -> $db: $tag.sql"
    docker exec -i migtest-pg psql -q -U postgres -v ON_ERROR_STOP=1 "$db" < "$MIG_DIR/$tag.sql"
  done
}

echo "=== 1. Одноразовый postgres ==="
docker run -d --name migtest-pg -e POSTGRES_PASSWORD=migtest postgres:16-alpine >/dev/null
sleep 6

echo "=== 2. Schema-only дамп прода (данные не читаются) ==="
docker exec foodbot-db-1 sh -c 'pg_dump -U $POSTGRES_USER --schema-only --no-owner --no-privileges $POSTGRES_DB' > /tmp/prod_schema.sql
echo "дамп: $(wc -l < /tmp/prod_schema.sql) строк"

echo "=== 3. Тестовые БД: prodlike (копия структуры прода) и freshdb (пустая) ==="
docker exec migtest-pg psql -U postgres -q -c "CREATE DATABASE prodlike;" -c "CREATE DATABASE freshdb;"
docker exec -i migtest-pg psql -q -U postgres -v ON_ERROR_STOP=1 prodlike < /tmp/prod_schema.sql

echo "=== 4. Список миграций из _journal.json (GitHub main) ==="
curl -fsSL "$JOURNAL_URL" -o /tmp/journal.json
# Достаём значения поля "tag" в порядке появления (jq на VPS может отсутствовать).
mapfile -t MIG_TAGS < <(grep -o '"tag"[[:space:]]*:[[:space:]]*"[^"]*"' /tmp/journal.json | sed -E 's/.*"tag"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
if [ "${#MIG_TAGS[@]}" -eq 0 ]; then
  echo "ОШИБКА: не удалось разобрать список миграций из _journal.json" >&2
  exit 1
fi
echo "миграций: ${#MIG_TAGS[@]} -> ${MIG_TAGS[*]}"

echo "=== 5. Скачивание всех .sql по порядку ==="
mkdir -p "$MIG_DIR"
for tag in "${MIG_TAGS[@]}"; do
  curl -fsSL "$RAW_BASE/$tag.sql" -o "$MIG_DIR/$tag.sql"
  echo "  $tag.sql: $(wc -l < "$MIG_DIR/$tag.sql") строк"
done

echo "=== 6. prodlike: цепочка 1-й раз (как будет на проде) ==="
apply_chain prodlike && echo "OK"

echo "=== 7. prodlike: цепочка 2-й раз (идемпотентность) ==="
apply_chain prodlike && echo "OK"

echo "=== 8. freshdb: цепочка дважды (пустая БД) ==="
apply_chain freshdb && echo "OK-1"
apply_chain freshdb && echo "OK-2"

echo "=== 9. Проверка результата на prodlike (глазная сверка) ==="
echo "--- Колонки таблицы users ---"
docker exec migtest-pg psql -U postgres prodlike -c "
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='users'
ORDER BY ordinal_position;"
echo "--- Таблицы public-схемы ---"
docker exec migtest-pg psql -U postgres prodlike -c "
SELECT tablename FROM pg_tables
WHERE schemaname='public' ORDER BY tablename;"

echo "=== ГОТОВО: контейнер и временные файлы удалены ==="
