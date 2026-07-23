# Аудит бота и план: улучшения + Telegram Mini App

Дата аудита: 2026-07-23. Проведён по всей кодовой базе (server/, shared/, tests/, доки, сборка).

---

## Часть 1. Что реализовано сейчас

### Ввод еды
- **Текст** → классификация intent (еда/тренировка/оба) → анализ gpt-4o-mini (JSON: КБЖУ, вес, микронутриенты, foodScore 1–10, советы) → карточка подтверждения или мульти-список при нескольких блюдах.
- **Фото** → сначала AI-поиск штрихкода (отключаемо в настройках) → Open Food Facts → иначе vision-анализ gpt-4o (temperature 0, читает этикетки, все блюда на фото).
- **Голос** → транскрибация Gemini Flash через OpenRouter (аудио >60 сек режется ffmpeg на чанки по 55 сек) → текстовый анализ.
- Редактирование pending-карточки: вес/калории/БЖУ вручную, пропорциональный пересчёт при смене веса.
- mealType определяется автоматически по времени юзера с настраиваемыми границами завтрака/обеда.

### Команды (23 шт.)
`/start` (регистрация + заявка админу), `/profile` (wizard: пол→возраст→вес→рост→активность→цель→расчёт норм по Миффлину-Сан Жеору→корректировка ±100/250), `/editprofile`, `/goal`, `/stats` (день: прогресс-бары, стрик, приёмы, энергобаланс BMR/TDEE, микро), `/week` и `/month` (+ AI-анализ периодов), `/pdf` (отчёт за 28 дней), `/export` (Excel, 2 листа, AI-группировка топ-продуктов), `/clear`, `/history` (+редактирование/удаление записей), `/weight` (+тренд, AI-анализ недели), `/workout`, `/ask` (AI-тренер с контекстом дня), `/report`, `/settings`, `/sync` + `/healthsetup` (Apple Health через iOS Shortcut), `/users` (админка), `/help` + 3 команды-алиаса.

### Настройки (живой экран с тогглами)
Микронутриенты, AI-анализы (неделя/месяц/вечерний отчёт), smart-группировка Excel, штрихкоды, время вечернего отчёта, напоминания (завтрак/обед/ужин/«нет записей»/взвешивание с днями недели), таймзона (12 зон), границы приёмов пищи.

### Фоновые задачи
setInterval 60 сек по всем approved-юзерам: вечерний отчёт (с опциональным AI-текстом), напоминания о еде, «нет записей», взвешивание. Дедупликация — in-memory ключи. Per-user таймзоны.

### Инфраструктура
- Express + node-telegram-bot-api (webhook с секретом в пути + заголовке, fallback на polling), PostgreSQL 16 + Drizzle, rate-limit на всех эндпоинтах.
- Apple Health webhook `/api/health-sync/:token` — шаги, active calories, тренировки; идемпотентный ре-синк по source.
- Прод: vps4 (94.183.189.7), docker compose (bot + postgres), nginx с HTTPS (alxforbot.online), деплой `git pull && docker compose up -d --build`.
- Тесты: node:test, 3 файла — хорошо покрыт только Apple Health parsing; запуск вручную, CI нет.

---

## Часть 2. Проблемы по приоритетам

### P0 — безопасность (чинить до любого Mini App)
1. **`admin_delete_` без проверки `isAdmin`** (bot.ts:2669) — любой юзер forged-callback'ом может удалить чужой аккаунт. Все остальные админ-ветки проверку имеют.
2. **Нет проверки владельца записи**: `deleteFoodLog(logId)` / `updateFoodLog(logId)` вызываются без сверки `log.userId === user.id` (bot.ts:2241, 2250, 3077-3100; storage.ts не принимает userId) — правка/удаление чужих записей перебором id. Для REST API это готовая IDOR-дыра.
3. **callback_query не проверяет blocked/approved** (bot.ts:2032) — заблокированный юзер продолжает пользоваться всеми кнопками.
4. `/clear` удаляет период **без подтверждения** (bot.ts:2003).
5. Health-sync токен в URL попадает в nginx access-логи; полные JSON-ответы API логируются (index.ts:86).

### P1 — баги
6. Незаякоренные regex команд: `/weightreminder` триггерит и `/weight` (двойной ответ), `/statsfoo` сработает как `/stats` (bot.ts:1033 и почти все onText).
7. Таймзоны: `/history`, `/export`, `/clear` используют `getMoscowNow()` вместо таймзоны юзера (bot.ts:1780, 1797, 1989); границы дня в storage ставятся в серверной TZ (storage.ts:118-120); сам механизм — хрупкий хак через `toLocaleString`.
8. `deleteUser` не удаляет waterLogs → падение по FK при наличии записей воды (storage.ts:94-99).
9. mealType с фото не нормализуется рус→англ (openai.ts:644-653) — в БД может попасть «обед» вместо «lunch».
10. Caption у фото игнорируется — подпись «это борщ 400 г» теряется (bot.ts:3384+).
11. Всё pending-состояние в памяти — рестарт контейнера теряет неподтверждённые карточки и может задублировать вечерние отчёты.
12. Планировщик: точное сравнение HH:MM при setInterval(60000) — минута может быть пропущена; упавший отчёт не ретраится.

### P2 — надёжность и производительность
13. **N+1**: `getStreak` — до 365 запросов, `getMonthlyStats` — до 28, `getWeeklyStats` — 7; `getDailyStats` суммирует в JS вместо SQL SUM (storage.ts:118-263). Для Mini App-дашборда это станет заметно — переписать на GROUP BY.
14. **Ни одного индекса** в схеме; все выборки по (user_id, date) — full scan. userId nullable, без onDelete.
15. Нет retry/timeout ни на одном AI-вызове (весь openai.ts), ошибки глотаются в null; OpenFoodFacts без timeout. p-retry/p-limit стоят в deps, но не используются.
16. Нет транзакций (deleteUser, health re-sync).
17. Миграции = `drizzle-kit push` на каждом старте + ad-hoc `ALTER TABLE IF NOT EXISTS` в routes.ts:12-40 — без версионирования, деструктивные изменения пройдут молча.
18. Штрихкод читает LLM без валидации контрольной цифры EAN — галлюцинации цифр.

### P3 — техдолг
19. **Мёртвый код**: `server/replit_integrations/` + `client/replit_integrations/` (ни одного импорта), `shared/models/chat.ts`, jspdf(+autotable), passport/express-session/connect-pg-simple/memorystore (при этом `SESSION_SECRET` обязателен в config, хотя не используется нигде), `server/fonts/` (pdfkit берёт шрифты из node_modules), фантомный allowlist в script/build.ts (stripe, multer, xlsx…).
20. Дубли: 4 копии пересчёта КБЖУ по весу, 2 копии timeHint-блока в openai.ts, topFoods-агрегация в /week и /month, клавиатура adj_cal, 3 команды-алиаса.
21. bot.ts — монолит 3500 строк (команды + UI + Excel + health + планировщик).
22. Хардкоды: старый домен `alxthecreatortg.ru` как fallback (bot.ts:460, 2073) и в .env.example; дефолты границ приёмов в 6+ местах.
23. Доки: DEPLOY_GUIDE.md полностью устарел (противоречит реальным Dockerfile/compose), replit.md описывает Replit-прокси вместо OpenRouter, README не упоминает Apple Health.
24. Тесты: нет `npm test` и CI; unit-тесты проверяют **копии** функций, а не импорт реального кода; storage-тесты пишут в БД из DATABASE_URL (риск запуска на проде).

---

## Часть 3. План

### Этап 0 — критичные фиксы (до Mini App, ~день)
- [ ] Проверка `isAdmin` в `admin_delete_`; проверка blocked/approved в callback_query.
- [ ] Ownership: `deleteFoodLog`/`updateFoodLog`/`getFoodLogById` принимают `userId` и фильтруют по нему (заодно закрывает будущий REST).
- [ ] Подтверждение у `/clear`.
- [ ] `deleteUser`: + waterLogs, всё в транзакции.
- [ ] Заякорить regex всех команд (`/^\/stats(@\w+)?$/` и т.п.).
- [ ] Убрать тела JSON-ответов из логов.

### Этап 1 — фундамент для Mini App (~2-3 дня)
- [ ] Выпилить мёртвый код (replit_integrations, chat.ts, лишние deps, SESSION_SECRET из required).
- [ ] Индексы `(user_id, date)` на все 4 лог-таблицы; `.notNull()` + `onDelete: 'cascade'` на userId.
- [ ] Перейти с `drizzle-kit push` на версионированные миграции (`drizzle-kit generate` + `migrate` в entrypoint).
- [ ] Агрегаты в SQL: `getDailyStats`/`getStreak`/`getWeeklyStats`/`getMonthlyStats` через GROUP BY; честные границы дня в таймзоне юзера (SQL `AT TIME ZONE`).
- [ ] Дополнить storage для CRUD: water (список/update/delete), weight (update/delete), workout (update, getById), пагинация getFoodLogs.
- [ ] Обёртка AI-вызовов: timeout + p-retry (уже в deps).
- [ ] `npm test` + GitHub Actions (unit + health-тесты на эфемерном postgres); тесты импортируют реальные функции, а не копии.

### Этап 2 — Mini App MVP (~неделя)
**Серверная часть:**
- [ ] Auth middleware: валидация Telegram `initData` (HMAC-SHA256 с bot token, TTL auth_date), маппинг telegramId → user. Никаких сессий/паролей.
- [ ] REST API поверх storage (контракт — реанимировать `shared/routes.ts` + zod):
  `GET /api/app/me` (профиль+цели), `GET /api/app/day/:date` (еда+вода+тренировки+итоги+энергобаланс), `GET /api/app/stats?range=week|month`, `GET /api/app/weight`, CRUD `/api/app/logs/:id`, `PATCH /api/app/profile`, `PATCH /api/app/settings`.
- [ ] Rate-limit + проверка approved/blocked в middleware.

**Клиент (стек уже в deps: React, Vite, Tailwind, shadcn/ui, recharts, react-query, wouter):**
- [ ] Каркас: `client/src/`, @telegram-apps SDK (initData, тема, BackButton, haptic), тёмная/светлая тема из Telegram.
- [ ] Экран «Сегодня»: кольца калорий/БЖУ, лента приёмов пищи, вода, тренировки, энергобаланс.
- [ ] Экран «История»: календарь + список записей с редактированием/удалением (свайпы).
- [ ] Экран «Тренды»: график веса, калории по дням (неделя/месяц), стрик.
- [ ] Экран «Профиль/Настройки»: формы вместо лабиринта inline-кнопок.
- Ввод еды остаётся в чате бота — Mini App не дублирует сильную сторону бота.

**Деплой:**
- [ ] nginx: `location /app/` и `location /api/app/` → 8082; для `/app/` снять `X-Frame-Options: DENY` (Telegram Web открывает Mini App в iframe).
- [ ] BotFather: кнопка меню → Web App URL `https://alxforbot.online/app/`.
- [ ] Inline-кнопка «📊 Открыть дашборд» в ответах бота (/stats, вечерний отчёт).

### Этап 3 — развитие (после MVP)
- Редактирование целей/норм с пересчётом, undo для удалений.
- Быстрый ввод воды из Mini App (+250/500 мл).
- Графики микронутриентов, корреляция «питание↔вес» (переиспользовать логику pdf.ts).
- Persistent-состояние pending-подтверждений и дедупликации напоминаний (таблица в PG) — переживает рестарты.
- Рефакторинг bot.ts на модули (commands/, callbacks/, scheduler, excel).
- Актуализация доков: README (+Apple Health, +Mini App), удалить DEPLOY_GUIDE.md, переписать replit.md.

---

## Рекомендуемый порядок
Этап 0 → Этап 1 → Этап 2. Этапы 0–1 не только чинят дыры, но и являются прямой подготовкой API: ownership-проверки, CRUD-методы, быстрые агрегаты и миграции — всё это Mini App использует с первого дня.
