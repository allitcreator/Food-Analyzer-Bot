#!/bin/bash
# Ежедневный дамп прод-БД (сервис db из docker-compose.yml) в сжатый SQL.
# Запускается НА VPS из каталога проекта (/root/foodbot). Защищает от потери
# данных при ошибочной миграции, порче тома postgres_data или ручной ошибке.
#
# Cron (root, ежедневно в 04:20):
#   20 4 * * * /root/foodbot/scripts/backup-db.sh >> /var/log/foodbot-backup.log 2>&1
#
# Куда: $HERE/backups/foodbot-YYYYMMDD-HHMM.sql.gz (каталог 700, файлы 600).
# Переопределения через env: BACKUP_DIR — каталог дампов, KEEP_DAYS — сколько
# дней хранить (по умолчанию 14, более старые дампы удаляются).
# Пользователь и имя БД берутся из POSTGRES_USER / POSTGRES_DB в $HERE/.env,
# а если их там нет — из окружения запущенного контейнера db.
#
# Восстановление (только на пустую БД, иначе будут конфликты объектов):
#   cd /root/foodbot
#   docker compose stop bot
#   gunzip -c backups/foodbot-YYYYMMDD-HHMM.sql.gz \
#     | docker compose exec -T db psql -U <POSTGRES_USER> -d <POSTGRES_DB> -v ON_ERROR_STOP=1
#   docker compose start bot
# Пустую БД можно получить так:
#   docker compose exec -T db dropdb -U <POSTGRES_USER> <POSTGRES_DB>
#   docker compose exec -T db createdb -U <POSTGRES_USER> <POSTGRES_DB>
set -euo pipefail

# cron запускает с урезанным PATH — docker может лежать в /usr/local/bin
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
umask 077

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$HERE/docker-compose.yml"
ENV_FILE="$HERE/.env"
BACKUP_DIR="${BACKUP_DIR:-$HERE/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
die() { log "ОШИБКА: $*" >&2; exit 1; }

[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || die "KEEP_DAYS должен быть целым числом"
[[ -f "$COMPOSE_FILE" ]] || die "не найден $COMPOSE_FILE"

# Читает одно значение из .env без source: файл с секретами не исполняется.
# Берётся последняя строка KEY=..., снимаются кавычки и \r.
env_value() {
  local key="$1" line val
  [[ -f "$ENV_FILE" ]] || return 0
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 0
  val="${line#*=}"
  val="${val%$'\r'}"
  if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then
    val="${BASH_REMATCH[1]}"
  fi
  printf '%s' "$val"
}

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

# Значение переменной из окружения контейнера db; пусто, если команда упала.
container_env() {
  local val
  val="$(compose exec -T db printenv "$1" 2>/dev/null)" || return 0
  printf '%s' "${val//$'\r'/}"
}

DB_USER="$(env_value POSTGRES_USER)"
DB_NAME="$(env_value POSTGRES_DB)"
# В .env может не быть ключей: compose тогда подставляет свои значения по
# умолчанию, и правильные значения есть только в окружении контейнера.
if [[ -z "$DB_USER" ]]; then
  DB_USER="$(container_env POSTGRES_USER)"
fi
if [[ -z "$DB_NAME" ]]; then
  DB_NAME="$(container_env POSTGRES_DB)"
fi
[[ -n "$DB_USER" ]] || die "POSTGRES_USER не найден ни в $ENV_FILE, ни в контейнере db (запущен ли он?)"
[[ -n "$DB_NAME" ]] || die "POSTGRES_DB не найден ни в $ENV_FILE, ни в контейнере db (запущен ли он?)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

FILE="$BACKUP_DIR/foodbot-$(date '+%Y%m%d-%H%M').sql.gz"
PARTIAL="$FILE.partial"
trap 'rm -f "$PARTIAL"' EXIT

if ! compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner | gzip -9 > "$PARTIAL"; then
  die "pg_dump или gzip завершились с ошибкой, дамп не сохранён"
fi

SIZE="$(wc -c < "$PARTIAL" | tr -d ' ')"
[[ "$SIZE" -gt 0 ]] || die "пустой файл дампа, дамп не сохранён"
gzip -t "$PARTIAL" 2>/dev/null || die "архив дампа повреждён (gzip -t), дамп не сохранён"

chmod 600 "$PARTIAL"
mv -f "$PARTIAL" "$FILE"
trap - EXIT

# Ротация: удаляем старые дампы и брошенные partial от упавших запусков
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'foodbot-*.sql.gz' -o -name 'foodbot-*.sql.gz.partial' \) \
  -mtime +"$KEEP_DAYS" -delete

COUNT="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'foodbot-*.sql.gz' | wc -l | tr -d ' ')"
log "дамп готов: $FILE ($(du -h "$FILE" | cut -f1)), дампов в каталоге: $COUNT, хранение $KEEP_DAYS дн."
