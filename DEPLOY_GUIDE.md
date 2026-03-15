# Инструкция по переносу Calorie Tracker Bot на свою VPS

## Стек технологий

- **Runtime:** Node.js 20+
- **Язык:** TypeScript
- **Сервер:** Express
- **База данных:** PostgreSQL
- **ORM:** Drizzle ORM
- **AI:** GPT-4o (фото), GPT-4o-mini (текст, отчёты), Whisper-1 (голос)
- **Telegram:** node-telegram-bot-api
- **Сборка:** Vite + esbuild

## Структура проекта

```
├── server/
│   ├── index.ts          # Точка входа, Express сервер
│   ├── bot.ts            # Telegram бот: команды, профиль, еда, голос, напоминания, отчёты
│   ├── openai.ts         # OpenAI: GPT-4o (фото), GPT-4o-mini (текст/отчёты), Whisper (голос)
│   ├── storage.ts        # CRUD, расчёт КБЖУ (Mifflin-St Jeor)
│   ├── routes.ts         # API роуты + запуск бота
│   ├── db.ts             # PostgreSQL через Drizzle ORM
│   ├── vite.ts           # Dev-сервер Vite (только разработка)
│   └── static.ts         # Раздача статики в продакшене
├── shared/
│   └── schema.ts         # Drizzle схема: users, foodLogs
├── client/               # React фронтенд (страница статуса)
├── drizzle.config.ts
├── package.json
└── tsconfig.json
```

## Что нужно изменить для работы вне Replit

### 1. OpenAI клиент

В `server/openai.ts` сейчас два клиента:

```typescript
// Для GPT-4o / GPT-4o-mini — через Replit-прокси:
const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "dummy",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// Для Whisper — прямой OpenAI (прокси не поддерживает audio API):
const whisperClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;
```

На VPS Replit-прокси недоступен. Заменить оба клиента на один:

```typescript
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// whisperClient тоже использует тот же ключ:
const whisperClient = openai;
```

> Один ключ `OPENAI_API_KEY` даёт доступ ко всем моделям: GPT-4o, GPT-4o-mini и Whisper.

### 2. Webhook вместо polling

В `server/bot.ts` заменить логику инициализации:

```typescript
// БЫЛО (Replit):
const REPLIT_DEPLOYMENT_URL = process.env.REPLIT_DEPLOYMENT_URL;
const useWebhook = isProduction && !!REPLIT_DEPLOYMENT_URL && !!app;

// СТАЛО (VPS):
const WEBHOOK_URL = process.env.WEBHOOK_URL; // например https://bot.example.com
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const useWebhook = !!WEBHOOK_URL && !!app;

if (useWebhook) {
  if (!WEBHOOK_SECRET) {
    throw new Error("WEBHOOK_SECRET required. Generate: openssl rand -hex 32");
  }
  bot = new TelegramBot(token);
  const webhookPath = `/api/telegram-webhook/${WEBHOOK_SECRET}`;
  bot.setWebHook(`${WEBHOOK_URL}${webhookPath}`);
  app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
} else {
  bot = new TelegramBot(token, { polling: true });
}
```

> **Безопасность:** путь использует `WEBHOOK_SECRET`, а не `TELEGRAM_BOT_TOKEN`. Токен в URL попадёт в логи Nginx.

### 3. Nginx (reverse proxy + SSL)

`/etc/nginx/sites-available/bot`:

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

    # Telegram может присылать фото до 20 МБ
    client_max_body_size 20M;

    # Таймауты для OpenAI (фото анализируется до 30 сек)
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

SSL через Let's Encrypt:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d bot.example.com
sudo ln -s /etc/nginx/sites-available/bot /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 4. Удалить keep-alive (только для Replit Autoscale)

В `server/routes.ts` удалить:

```typescript
// Удалить этот блок:
const REPLIT_DEPLOYMENT_URL = process.env.REPLIT_DEPLOYMENT_URL;
if (process.env.NODE_ENV === "production" && REPLIT_DEPLOYMENT_URL) {
  ...
}
```

### 5. Удалить папки Replit Integrations

```bash
rm -rf server/replit_integrations client/replit_integrations
```

Удалить их импорты из `server/routes.ts`, если есть.

## Переменные окружения (.env)

```env
# ── Telegram ───────────────────────────────────────
TELEGRAM_BOT_TOKEN=токен_от_BotFather

# ── База данных ────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/calorie_bot

# ── OpenAI ─────────────────────────────────────────
# Один ключ для всех моделей: GPT-4o, GPT-4o-mini, Whisper-1
OPENAI_API_KEY=sk-ваш_ключ

# ── Webhook ────────────────────────────────────────
WEBHOOK_URL=https://bot.example.com
# Сгенерировать: openssl rand -hex 32
WEBHOOK_SECRET=случайная_строка_64_символа

# ── Администратор ──────────────────────────────────
# Узнать через @userinfobot в Telegram
ADMIN_TELEGRAM_ID=123456789

# ── Прочее ─────────────────────────────────────────
SESSION_SECRET=любая_случайная_строка
NODE_ENV=production
TZ=Europe/Moscow
PORT=5000
```

**Обязательные:** `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`, `OPENAI_API_KEY`

**Нужны вместе:** `WEBHOOK_URL` + `WEBHOOK_SECRET` (для webhook-режима). Без них бот запустится в polling.

**Где получить:**
- `TELEGRAM_BOT_TOKEN` — у @BotFather
- `OPENAI_API_KEY` — [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- `ADMIN_TELEGRAM_ID` — отправить `/start` боту @userinfobot
- `WEBHOOK_SECRET` — `openssl rand -hex 32`

## Установка и запуск

### Вариант A: Запуск напрямую (PM2)

```bash
# 1. Node.js 20+ и PostgreSQL
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs postgresql

# 2. База данных
sudo -u postgres createdb calorie_bot
sudo -u postgres psql -c "CREATE USER bot WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE calorie_bot TO bot;"

# 3. Проект
git clone <your-repo-url> calorie-bot
cd calorie-bot
npm install

# 4. Создать .env (см. выше)

# 5. Применить схему БД
npm run db:push

# 6. Собрать и запустить
npm run build
npm start

# 7. Автоперезапуск через PM2
npm install -g pm2
pm2 start dist/index.cjs --name calorie-bot
pm2 save && pm2 startup
```

### Вариант B: Docker Compose

**Dockerfile:**

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 5000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
```

**entrypoint.sh:**

```bash
#!/bin/sh
set -e

echo "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
  " 2>/dev/null; then
    echo "PostgreSQL is ready"
    break
  fi
  echo "Waiting... ($i/30)"
  sleep 1
done

echo "Running migrations..."
npx drizzle-kit push

echo "Starting application..."
exec "$@"
```

**docker-compose.yml:**

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

```bash
# Запуск
docker compose up -d

# Логи
docker compose logs -f bot
```

## Команды npm

| Команда | Описание |
|--------|----------|
| `npm run dev` | Разработка (TypeScript + Vite hot reload) |
| `npm run build` | Сборка в `dist/` |
| `npm start` | Продакшен из `dist/` |
| `npm run db:push` | Применить схему Drizzle к БД |

## Функции бота

### Команды

| Команда | Описание |
|---------|----------|
| `/start` | Регистрация + автонастройка профиля если не заполнен |
| `/profile` | Повторная настройка профиля |
| `/stats` | Статистика за день с прогресс-барами |
| `/history` | Последние записи с кнопками удаления |
| `/report` | Ручной вечерний AI-отчёт |
| `/report_time HH:MM` | Время автоотчёта (19:00–23:00 или `off`) |
| `/reminders` | Напоминания о приёмах пищи |
| `/export ДД.ММ.ГГГГ [ - ДД.ММ.ГГГГ ]` | Экспорт в Excel |
| `/clear ДД.ММ.ГГГГ [ - ДД.ММ.ГГГГ ]` | Очистка записей |
| `/users` | Управление пользователями (только админ) |
| `/help` | Список команд |

### Взаимодействие без команд

| Тип сообщения | Обработка |
|--------------|-----------|
| Фото | GPT-4o распознаёт блюда на изображении |
| Текст | GPT-4o-mini анализирует описание еды |
| Голосовое | Whisper-1 транскрибирует → GPT-4o-mini анализирует |

### Мультипозиционное распознавание

Если в сообщении несколько блюд (например, "завтрак: яйца, бутерброд, кофе"), бот покажет список всех позиций с кнопками:
- **✏️ N. Название** — открыть редактор позиции (корректировка веса ±10/50/100, удаление)
- **✅ Сохранить все** — сохранить все позиции сразу
- **❌ Отмена** — отменить без сохранения

### Поведение

- Профиль запускается автоматически после `/start`, если age/weight/height не заполнены
- Автоотчёт пропускается без сообщения, если за день нет записей
- Ручной `/report` сообщает об отсутствии данных вместо пустого отчёта
- Напоминания срабатывают один раз в день на каждый приём пищи

## Схема базы данных

### users
Профиль пользователя, нормы КБЖУ, настройки напоминаний и отчётов

### food_logs
Название, калории, БЖУ, вес (г/мл), тип приёма пищи, оценка (1–10), совет

## Особенности кода

| Деталь | Где |
|-------|-----|
| Mifflin-St Jeor расчёт | `storage.ts → calculateAndSetGoals()` |
| Жидкости vs твёрдое (мл/г) | `bot.ts → LIQUID_PATTERN` |
| Два OpenAI-клиента | `openai.ts` — `openai` (прокси) + `whisperClient` (прямой) |
| Мультипозиционный стейт | `bot.ts → pendingMulti[telegramId]: FoodItem[]` |
| Вечерний планировщик | Проверка каждую минуту по UTC+3 |
| Excel экспорт | Библиотека `exceljs` |
