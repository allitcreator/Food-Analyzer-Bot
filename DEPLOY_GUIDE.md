# Инструкция для переноса Calorie Tracker Bot на свою VM

## Стек технологий
- **Runtime:** Node.js 20+
- **Язык:** TypeScript
- **Серверная часть:** Express
- **База данных:** PostgreSQL
- **ORM:** Drizzle ORM
- **AI:** OpenAI GPT-4o (текстовый анализ + распознавание фото)
- **Telegram:** node-telegram-bot-api
- **Сборка:** Vite + esbuild

## Структура проекта

```
├── server/
│   ├── index.ts          # Точка входа, Express сервер
│   ├── bot.ts            # Telegram бот (команды, обработчики, планировщик отчётов)
│   ├── openai.ts         # OpenAI: анализ текста, фото, вечерний отчёт
│   ├── storage.ts        # CRUD операции, расчёт КБЖУ (Mifflin-St Jeor)
│   ├── routes.ts         # API роуты + запуск бота
│   ├── db.ts             # Подключение к PostgreSQL через Drizzle
│   ├── vite.ts           # Dev-сервер Vite (только для разработки)
│   └── static.ts         # Раздача статики в продакшене
├── shared/
│   └── schema.ts         # Drizzle схема БД (users, foodLogs, waterLogs)
├── client/               # React фронтенд (опционально)
├── drizzle.config.ts     # Конфигурация Drizzle Kit
├── package.json
└── tsconfig.json
```

## Что нужно изменить для работы вне Replit

### 1. OpenAI клиент

В файле `server/openai.ts` заменить инициализацию:

```typescript
// БЫЛО (Replit AI Integrations):
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "dummy",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// СТАЛО (стандартный OpenAI):
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
```

### 2. Режим бота — webhook через свой домен

В файле `server/bot.ts` заменить логику инициализации бота (строки ~50-83).

Сейчас бот использует `REPLIT_DEPLOYMENT_URL` для webhook. Нужно заменить на `WEBHOOK_URL`:

```typescript
// БЫЛО:
const REPLIT_DEPLOYMENT_URL = process.env.REPLIT_DEPLOYMENT_URL;
const useWebhook = isProduction && !!REPLIT_DEPLOYMENT_URL && !!app;

if (useWebhook) {
  bot = new TelegramBot(token);
  const webhookPath = `/api/telegram-webhook/${token}`;
  const webhookUrl = `https://${REPLIT_DEPLOYMENT_URL}${webhookPath}`;
  ...
}

// СТАЛО:
import crypto from "crypto";

const WEBHOOK_URL = process.env.WEBHOOK_URL; // например https://bot.example.com
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString("hex");
const useWebhook = !!WEBHOOK_URL && !!app;

if (useWebhook) {
  bot = new TelegramBot(token);
  // Используем случайный путь вместо токена — токен в URL это риск утечки через логи
  const webhookPath = `/api/telegram-webhook/${WEBHOOK_SECRET}`;
  const webhookUrl = `${WEBHOOK_URL}${webhookPath}`;
  bot.setWebHook(webhookUrl).then(() => {
    console.log("Telegram webhook set successfully");
  }).catch(err => {
    console.error("Failed to set webhook:", err);
  });
  app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
} else {
  // Fallback на polling для локальной разработки
  bot = new TelegramBot(token, { polling: true });
  console.log("Bot started in polling mode (no WEBHOOK_URL set)");
}
```

**Безопасность webhook:** путь использует `WEBHOOK_SECRET` вместо `TELEGRAM_BOT_TOKEN`. Токен в URL — риск утечки через логи Nginx/access.log. Если `WEBHOOK_SECRET` не задан, генерируется случайный при каждом запуске.

Webhook-путь: `POST /api/telegram-webhook/{WEBHOOK_SECRET}`

**Требования для webhook:**
- Домен с HTTPS (Let's Encrypt через Certbot или Cloudflare)
- Nginx как reverse proxy перед приложением

### 3. Nginx конфигурация (reverse proxy + SSL)

Создать файл `/etc/nginx/sites-available/bot`:

```nginx
server {
    listen 80;
    server_name bot.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name bot.example.com;

    ssl_certificate /etc/letsencrypt/live/bot.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bot.example.com/privkey.pem;

    # Telegram отправляет фото до 20 МБ
    client_max_body_size 20M;

    # Таймауты для обработки фото через OpenAI (может занять 10-30 сек)
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
    proxy_connect_timeout 10s;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Получить SSL-сертификат:
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d bot.example.com
```

### 4. Keep-alive

В файле `server/routes.ts` удалить блок keep-alive (он нужен только для Replit Autoscale):

```typescript
// Удалить этот блок:
const REPLIT_DEPLOYMENT_URL = process.env.REPLIT_DEPLOYMENT_URL;
if (process.env.NODE_ENV === "production" && REPLIT_DEPLOYMENT_URL) {
  ...
}
```

### 5. Папка replit_integrations

Удалить `server/replit_integrations/` целиком — она не нужна вне Replit.
Также удалить все импорты из неё, если они есть в `server/routes.ts`.

## Переменные окружения

Создать файл `.env`:

```env
# Обязательные
DATABASE_URL=postgresql://user:password@localhost:5432/calorie_bot
TELEGRAM_BOT_TOKEN=ваш_токен_от_BotFather
OPENAI_API_KEY=sk-ваш_ключ_openai
ADMIN_TELEGRAM_ID=ваш_telegram_id
WEBHOOK_URL=https://bot.example.com

# Безопасность webhook (если не задан — генерируется случайный при каждом запуске)
WEBHOOK_SECRET=случайная_строка_для_пути_webhook

# Опциональные
SESSION_SECRET=любая_случайная_строка
NODE_ENV=production
TZ=Europe/Moscow
PORT=5000
```

**Как получить:**
- `TELEGRAM_BOT_TOKEN` — у @BotFather в Telegram
- `OPENAI_API_KEY` — на https://platform.openai.com/api-keys
- `ADMIN_TELEGRAM_ID` — отправить /start боту @userinfobot в Telegram
- `WEBHOOK_SECRET` — сгенерировать: `openssl rand -hex 32`

## Установка и запуск

### Вариант A: Запуск напрямую

```bash
# 1. Установить Node.js 20+ и PostgreSQL

# 2. Создать базу данных
createdb calorie_bot

# 3. Установить зависимости
npm install

# 4. Применить схему БД
npm run db:push

# 5. Собрать проект
npm run build

# 6. Запустить
npm start
```

### Вариант B: Docker Compose

Создать `Dockerfile`:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# db:push нельзя делать на этапе build — БД ещё недоступна.
# Миграция запускается при старте контейнера через entrypoint.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
```

Создать `entrypoint.sh`:

```bash
#!/bin/sh
set -e

echo "Waiting for PostgreSQL..."
# Ждём пока БД станет доступна (до 30 секунд)
for i in $(seq 1 30); do
  if node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
  " 2>/dev/null; then
    echo "PostgreSQL is ready"
    break
  fi
  echo "Waiting for DB... ($i/30)"
  sleep 1
done

echo "Running database migrations..."
npx drizzle-kit push

echo "Starting application..."
exec "$@"
```

В `docker-compose.yml` добавить healthcheck для PostgreSQL:

```yaml
version: '3.8'
services:
  db:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_DB: calorie_bot
      POSTGRES_USER: bot
      POSTGRES_PASSWORD: your_secure_password
      TZ: Europe/Moscow
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bot -d calorie_bot"]
      interval: 5s
      timeout: 5s
      retries: 5

  bot:
    build: .
    restart: always
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://bot:your_secure_password@db:5432/calorie_bot
      TELEGRAM_BOT_TOKEN: ${TELEGRAM_BOT_TOKEN}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      ADMIN_TELEGRAM_ID: ${ADMIN_TELEGRAM_ID}
      WEBHOOK_URL: ${WEBHOOK_URL}
      WEBHOOK_SECRET: ${WEBHOOK_SECRET}
      SESSION_SECRET: ${SESSION_SECRET}
      NODE_ENV: production
      TZ: Europe/Moscow
      PORT: 5000

volumes:
  pgdata:
```

Запуск:
```bash
# Создать .env с токенами (без DATABASE_URL — он задан в docker-compose)
docker compose up -d
```

## Скрипты package.json

- `npm run dev` — разработка (TypeScript + Vite hot reload)
- `npm run build` — сборка в `dist/`
- `npm start` — запуск продакшена из `dist/`
- `npm run db:push` — применить схему Drizzle к БД

## Команды бота

- `/start` — Регистрация
- `/profile` — Настройка профиля (возраст, вес, рост, активность, цель)
- `/stats` — Статистика за сегодня
- `/history` — Последние записи с кнопками удаления
- `/water` — Трекинг воды (кнопки 150/250/500 мл, цель 2500 мл)
- `/report` — Вечерний AI-отчёт вручную
- `/report_time` — Настройка автоотчёта (HH:MM или off)
- `/export ДД.ММ.ГГГГ` — Экспорт в Excel
- `/clear ДД.ММ.ГГГГ` — Очистка записей
- `/users` — Управление пользователями (только для админа)
- `/help` — Список команд
- Отправить фото — AI распознает еду
- Отправить текст — AI проанализирует описание еды

## Схема базы данных

### users
Профили, цели КБЖУ, время отчёта

### food_logs
Записи о еде: название, КБЖУ, вес, оценка полезности (1-10), совет

### water_logs
Записи о воде: количество в мл, дата

## Важные особенности кода

- **Mifflin-St Jeor** — расчёт калорий в `storage.ts` → `calculateAndSetGoals()`
- **Оценка еды** — GPT-4o выставляет foodScore 1-10 и даёт nutritionAdvice
- **Жидкости vs твёрдое** — LIQUID_PATTERN в `bot.ts` определяет мл или г
- **Вечерний отчёт** — планировщик в `bot.ts` проверяет каждую минуту по московскому времени (UTC+3)
- **Excel экспорт** — через библиотеку `exceljs`
- **Подтверждение еды** — inline кнопки для корректировки веса перед сохранением
