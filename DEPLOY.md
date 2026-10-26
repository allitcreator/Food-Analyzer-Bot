# Деплой Food Analyzer Bot на VPS

Схема:
```
Telegram --> https://alxforbot.online/api/telegram-webhook/update
          --> nginx --> 127.0.0.1:8082 --> контейнер foodbot (порт 5000)
```

---

## Шаг 1. Nginx — добавить location для food-бота

Открыть конфиг `/etc/nginx/sites-available/bots` и добавить location в блок `server 443`:

```nginx
# Food Analyzer Bot (порт 8082)
location /api/telegram-webhook/ {
    proxy_pass http://127.0.0.1:8082;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
}
```

> **Важно:** `proxy_pass` без trailing slash — путь сохраняется полностью.
> Бот получит запрос на `/api/telegram-webhook/update`, а не на `/`.

> **Секрета в пути нет:** путь печатается в логах nginx и приложения на каждом
> апдейте. Запрос проверяется по заголовку `X-Telegram-Bot-Api-Secret-Token`,
> который Telegram шлёт сам; заголовок nginx проксирует без настройки.

Применить:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Шаг 2. Клонирование и настройка

```bash
cd ~
git clone https://github.com/allitcreator/Food-Analyzer-Bot.git foodbot
cd foodbot

cp .env.example .env
nano .env
```

Заполнить `.env`:

```env
TELEGRAM_BOT_TOKEN=<токен от @BotFather>
ADMIN_TELEGRAM_ID=<ваш Telegram ID из @userinfobot>

OPENROUTER_API_KEY=<ключ OpenRouter>

POSTGRES_USER=bot
POSTGRES_PASSWORD=<придумать пароль>
POSTGRES_DB=foodbot

SESSION_SECRET=<openssl rand -hex 32>

WEBHOOK_URL=https://alxforbot.online
WEBHOOK_SECRET=<openssl rand -hex 32>

TZ=Europe/Moscow

# Необязательно: дневные лимиты AI в боте на пользователя (сброс в полночь
# по его часовому поясу и при рестарте) и максимальная длина голосового.
# AI_DAILY_LIMIT=150
# AI_DAILY_PHOTO_LIMIT=40
# VOICE_MAX_SECONDS=300
```

Сгенерировать секреты:
```bash
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # WEBHOOK_SECRET
```

---

## Шаг 3. Запуск

```bash
docker compose up -d --build
```

Проверить логи:
```bash
docker compose logs -f bot
```

Должно быть:
```
Running database migrations...
Telegram webhook set
```

---

## Шаг 4. Проверка webhook

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo" | python3 -m json.tool
```

Успешный ответ:
```json
{
    "url": "https://alxforbot.online/api/telegram-webhook/update",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "last_error_message": ""
}
```

---

## Обновление бота

```bash
cd ~/foodbot
git pull origin main
docker compose up -d --build
```

---

## Контейнер: healthcheck, пользователь, заголовки

- Контейнер `bot` работает от пользователя `node` (uid 1000), не от root.
  Миграции в `docker-entrypoint.sh` идут от него же. Файлы в `/app` — только
  чтение; писать приложение может в `/tmp` (голосовые режет ffmpeg).
- В рантайме только production-зависимости; `drizzle-kit` для миграций лежит
  в `dependencies`.
- Healthcheck в `docker-compose.yml`: раз в 30 с `wget` на `/api/health`.
  Ручка делает `SELECT 1` и отвечает 503, если база не ответила за 3 с.
- Приложение ставит `X-Content-Type-Options: nosniff` и
  `Referrer-Policy: no-referrer` на все ответы, а на HTML Mini App ещё и
  `Content-Security-Policy` (хэш inline-скрипта считается при старте из
  `dist/public/index.html`). HSTS ставит nginx. Если nginx для `/app/` ставит
  свои `X-Frame-Options` или CSP, они конфликтуют с CSP приложения: Telegram
  Web открывает Mini App в iframe.

Что проверить после деплоя:
```bash
docker compose ps                                   # bot: Up (healthy) через ~1 мин
docker compose logs bot | head -20                  # миграции прошли, нет EACCES
docker compose exec bot id                          # uid=1000(node)
docker compose exec bot sh -c 'touch /tmp/x && rm /tmp/x && echo tmp ok'
curl -s https://alxforbot.online/api/health         # {"status":"ok",...}
curl -sI https://alxforbot.online/app/ | grep -iE 'content-security|nosniff|referrer|frame-options'
```
Открыть Mini App в Telegram iOS/Android, Desktop и web.telegram.org: экран
грузится, нет ошибок CSP (в web — DevTools → Console), работают графики и
фото еды.

---

## Полезные команды

```bash
# Логи
docker compose logs -f bot

# Перезапуск
docker compose restart bot

# Полная пересборка
docker compose up -d --build --force-recreate

# Статус webhook
curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"

# Подключиться к БД
docker compose exec db psql -U bot -d foodbot
```

---

## Бэкапы БД

Скрипт `scripts/backup-db.sh` делает `pg_dump` из контейнера `db` в
`~/foodbot/backups/foodbot-YYYYMMDD-HHMM.sql.gz` (каталог 700, файлы 600) и
удаляет дампы старше 14 дней (`KEEP_DAYS`). Пользователь и имя БД берёт из
`POSTGRES_USER` / `POSTGRES_DB` в `.env`, а если их там нет — из контейнера.

Установить cron (`crontab -e` под root):
```cron
20 4 * * * /root/foodbot/scripts/backup-db.sh >> /var/log/foodbot-backup.log 2>&1
```

Проверить вручную:
```bash
~/foodbot/scripts/backup-db.sh
ls -lh ~/foodbot/backups/
tail /var/log/foodbot-backup.log
```

Восстановить (только в пустую БД):
```bash
cd ~/foodbot
docker compose stop bot
docker compose exec -T db dropdb -U bot foodbot
docker compose exec -T db createdb -U bot foodbot
gunzip -c backups/foodbot-YYYYMMDD-HHMM.sql.gz \
  | docker compose exec -T db psql -U bot -d foodbot -v ON_ERROR_STOP=1
docker compose start bot
```

> **Открытый вопрос:** дампы лежат на том же VPS, копии вне сервера пока нет.
> Если VPS или его диск пропадут, пропадут и бэкапы.
