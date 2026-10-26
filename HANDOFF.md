# HANDOFF

Статус: открыт
Обновлено: 2026-10-26 22:40 MSK
Клиент: Claude

## Цель

Аудит бота от 2026-10-26: ревью кода, безопасности, Mini App, прода на vps4,
рынка и LLM — и исправление найденного. Полный список доработок с отметками —
раздел «Аудит 2026-10-26» в `docs/ROADMAP.md`. Блоки 1–5 (прод, устойчивость
и безопасность, модели, баги, сопровождение) сделаны; впереди блок 6 —
новые функции. Прошлая история (техдолг tsc, утечка в логах) — в
`HANDOFF-archive.md`.

## Выполнено

Всё закоммичено, запушено и задеплоено. Прод — `17b5505`, следом только
docs-коммиты.

1. **Прод (vps4).** Поставлен logrotate (пакета не было, nginx-логи не
   ротировались). Ежедневный дамп БД: `scripts/backup-db.sh`, cron 04:20,
   `/root/foodbot/backups`, 14 дней; копий вне VPS не делаем — решение
   пользователя. nginx: `access_log off` для `location = /api/quick`, 9 строк
   с подписями к фото вырезаны из access.log, бэкап конфига
   `/root/nginx-bots.bak-*`.
2. **Устойчивость и безопасность** (`f4b9778`, `e727a09`): `safeHandler` на всех
   хендлерах и тике, `unhandledRejection`, `pool.on('error')`; округление по
   типу колонки; защита от двойного тапа; проверка цели в `admin_*`;
   allowlist полей `/me`; дневной лимит AI (`AI_DAILY_LIMIT=150`,
   `AI_DAILY_PHOTO_LIMIT=40`, `VOICE_MAX_SECONDS=300`, счётчик в памяти);
   vision-кэш штрихкодов без пользовательских правок и без затирания OFF;
   `.dockerignore`, `USER node`, runtime без devDependencies, healthcheck с
   `SELECT 1`, CSP + `nosniff` + `no-referrer`.
3. **Модели** (`81f469c` + `.env` на проде): роли `AI_MODEL_VISION/BARCODE/
   TEXT/CHAT/AUDIO`, `AI_FALLBACK_*`, `AI_REASONING_EFFORT`
   (`server/lib/ai-models.ts`). На проде: text и chat → `openai/gpt-6-luna`
   (fallback `gpt-4o-mini`), audio → `google/gemini-3.5-flash-lite`
   (fallback `gemini-3-flash-preview`). Vision и barcode — прежние
   `gpt-4o`/`gpt-4o-mini`. Бэкап `.env` — `/root/foodbot/.env.bak-*`.
   Eval: `eval/`, `scripts/eval-models.ts`; итоги — ROADMAP блок 3.
4. **Баги** (`bd3e2c4`, `7158863`): планировщик «время наступило и не
   отправлено» с окном догона 2 ч, неналожение тиков, неблокирующие отправки;
   снуз без лимита; заблокированным не шлём; `/cancel` и TTL 30 мин диалогов;
   порции OFF; баги Mini App (тема, цели, ошибки, таймауты, «сегодня» по tz,
   `disableVerticalSwipes`); единый `server/lib/tz.ts`.
5. **Сопровождение** (`783a729`, `17b5505`): снапшоты миграций 0005–0007
   (сверены со схемой прода), CI с check/build/audit, сборка не качает SDK
   (`npm run update:tg-sdk`), удалено ~50 пакетов и устаревшие доки, `db:push`
   убран, `script/` → `scripts/`; `npm audit` = 0 (drizzle-orm 0.45.4, zod 4,
   overrides для request/qs/uuid); `describeError` не печатает SQL и параметры
   `DrizzleQueryError`; 35 HTTP-тестов Mini App API; 404 на удаление чужой
   воды/избранного.

## Текущее состояние

- Прод на vps4: `17b5505`, контейнер `healthy`, Node 20, миграции без повторов,
  вебхук без ошибок, тики планировщика без ошибок.
- `npm run check` чист, `npm test` — 474 теста, 0 падений; тесты зелёные и при
  `TZ=UTC`, `TZ=Asia/Tokyo`.
- `server/bot.ts` — 4227 строк, `setupBot` по-прежнему одна функция.
- Ручная проверка в Telegram пользователем не подтверждена: Mini App в
  светлой/тёмной теме, голосовое (ffmpeg под `node`), `/cancel` в числовом
  шаге, карточка еды текстом (новая модель), `/pdf`, вечерние отчёты на
  `gpt-6-luna` (смотреть неделю).
- Main Mini App в BotFather для кнопки «Открыть» — инструкция дана
  (`/mybots` → Bot Settings → Configure Mini App, URL
  `https://alxforbot.online/app/`), включено ли — неизвестно.

## Решения и ограничения

- Код пишут сабагенты с `model: opus`, проверку и деплой делает основной цикл.
- Изменения в автомоде: запись на прод по ssh, правка логов и вывоз ключа
  OpenRouter на Mac классификатор блокирует до явного «делай сам» от
  пользователя; обходить нельзя.
- `.env.example` закрыт deny-правилом — новые переменные описываются в
  `DEPLOY.md`.
- Миграции — только `drizzle-kit generate` (порядок в `DEPLOY.md`), руками не
  пишем; существующие `.sql` и журнал 0000–0007 не трогать.
- Сутки — по таймзоне пользователя через `server/lib/tz.ts`; ключ дня claim в
  `notification_sends` — `YYYY-MM-DD` в tz пользователя, формат не менять.
- Postgres в контейнере в UTC, колонки `timestamp` без tz хранят UTC; сырой
  `sql` с `Date` сдвигает на зону процесса — использовать drizzle `gte/lte`.
- Сборка образа на vps4 (1 vCPU) — около 10 минут; запускать в фоне, затем
  `docker compose up -d bot`.

## Изменённые файлы

Основное за сессию (подробно — `git log 3a4ccec..HEAD`, 18 коммитов):

- `server/lib/`: `safe-handler`, `callback-guard`, `admin-target`,
  `food-log-fields`, `public-user`, `ai-quota`, `vision-barcode-cache`,
  `health`, `security-headers`, `ai-models`, `scheduler`, `serving-size`,
  `dialog-state`, `tz`, `stats-days`; правки `safe-log`, `telegram-auth`.
- `server/bot.ts`, `storage.ts`, `app-api.ts`, `openai.ts`, `pdf.ts`,
  `config.ts`, `db.ts`, `index.ts`, `routes.ts`, `static.ts`.
- `client/src/**` — тема, профиль, история, тренды, таймауты, a11y.
- `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `.github/workflows/ci.yml`,
  `scripts/` (backup-db, build, update-tg-sdk, eval), `migrations/meta/0005–0007`.
- `eval/`, `tests/` (+~280 тестов), `README.md`, `DEPLOY.md`, `docs/ROADMAP.md`.

## Проверки

- Перед каждым коммитом: `npm run check`, `npm test`; для клиента и сборки —
  `npm run build`.
- Каждый деплой: сборка образа на vps4, `docker compose up -d bot`, статус
  `healthy`, `/api/health` 200, `getWebhookInfo` без `last_error`, лог без
  `handler failed`.
- Миграции: `drizzle-kit generate` → «No schema changes»; снапшот 0007 сверен с
  `pg_dump --schema-only` прода.
- Eval моделей (2026-10-26): текст 80×2 на 4 моделях, голос 19 на 3 — таблицы в
  ROADMAP блок 3, сырые результаты в `eval/results/` (не в git).

## Блокеры и риски

- **`gpt-4o` и `gpt-4o-mini` отключаются 2027-01-14.** На них ещё vision,
  barcode и все fallback'и. Для vision нужен eval на фото пользователя
  (`eval/photos/manifest.json` по образцу `manifest.example.json`) — фото
  пока нет.
- Нет внешнего мониторинга: о полном падении бота никто не узнает.
- `/api/app/analyze` ограничен только 10/мин, суточного потолка нет.
- nginx для `/app/` ставит свои `nosniff`, `Referrer-Policy` и CSP с
  `frame-ancestors` — дублируются с приложением; убрать после подтверждения,
  что Mini App работает в Telegram.
- После `17b5505` повторное удаление уже удалённой записи в Mini App (двойной
  тап) вернёт 404 — клиент может показать тост об ошибке.
- Последняя запись еды в БД — 2026-07-24; дальше только вода, вес, тренировки.
  Пользователю сказано, ответа нет.
- Хвосты tz: `ai-quota.ts` свой ключ дня; даты замеров в промпте
  `generateWeightAnalysis` в зоне процесса; скользящие окна «N дней назад» в
  storage.
- Тестов `storage.ts` на настоящем Postgres и хендлеров бота нет — дробление
  `bot.ts` без них рискованно.
- На vps4 build cache ~2.5 ГБ (1.5 ГБ можно освободить `docker builder prune`).
- `knowledge-base/` в корне не отслеживается git — не решено, коммитить или в
  `.gitignore`.

## План дробления bot.ts

Проработан ранее, не начат (замеры и этапы — `HANDOFF-archive.md`, раздел
«План дробления bot.ts»). Коротко: 1) построители текста и клавиатур в
`server/bot/format.ts`; 2) команды отчётов; 3) явный контекст для 8
persistent-записей; 4) `message`; 5) `callback_query`. Перед этапами 3–5
нужны подставной бот и storage. Строки в архиве указаны для старого файла —
перемерить.

## Следующий точный шаг

Пользователь выбирает начало блока 6 (`docs/ROADMAP.md`, раздел 6):
предложено начать с недельного дайджеста с паттернами (= релиз 3) и правки
карточки свободным текстом/голосом, либо с быстрых — undo, порция ×0.5/×2,
алерт превышения нормы. До выбора — ничего не начинать.

Параллельно, когда пользователь пришлёт фото с известным КБЖУ: положить в
`eval/photos/`, прогнать `scripts/eval-models.ts --task photo` на
`openai/gpt-4o`, `openai/gpt-6-luna`, `google/gemini-3.6-flash` и переключить
`AI_MODEL_VISION` до декабря.

## Rollback

- Модели: удалить строки `AI_*` из `/root/foodbot/.env` (или вернуть
  `.env.bak-*`) и `docker compose up -d --force-recreate bot`.
- Код: `git revert <коммит>` нужного блока (`17b5505`, `783a729`, `7158863`,
  `bd3e2c4`, `81f469c`, `e727a09`, `f4b9778`), затем на vps4
  `cd /root/foodbot && git pull origin main && docker compose build bot &&
  docker compose up -d bot`. Если не стартует под non-root — откатить
  `e727a09` (Dockerfile `USER node`).
- Миграций за сессию не было, схема БД не менялась — откат ограничен кодом.
- nginx: `cp /root/nginx-bots.bak-<время> /etc/nginx/sites-available/bots &&
  nginx -t && systemctl reload nginx`.
- Бэкап БД: восстановление — `DEPLOY.md`, раздел «Бэкапы БД».
