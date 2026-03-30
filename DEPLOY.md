# Деплой Food Analyzer Bot на VPS

Схема:
```
Telegram --> https://alxthecreatortg.ru/api/telegram-webhook/<secret>
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
> Бот получит запрос на `/api/telegram-webhook/<secret>`, а не на `/`.

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

WEBHOOK_URL=https://alxthecreatortg.ru
WEBHOOK_SECRET=<openssl rand -hex 32>

TZ=Europe/Moscow
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
Telegram webhook set: https://alxthecreatortg.ru/api/telegram-webhook/<secret>
```

---

## Шаг 4. Проверка webhook

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo" | python3 -m json.tool
```

Успешный ответ:
```json
{
    "url": "https://alxthecreatortg.ru/api/telegram-webhook/<secret>",
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
