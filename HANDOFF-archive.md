# HANDOFF archive

## Перенесено из HANDOFF.md 2026-10-26 22:40 MSK (статус на момент переноса: открыт; сессия аудита завершена, файл переписан с нуля)

# HANDOFF

Статус: открыт
Обновлено: 2026-10-26 21:45 MSK
Клиент: Claude

## Цель

Две задачи в одном файле:

1. Техдолг из `docs/ROADMAP.md`: 14 ошибок `tsc`, рефакторинг `bot.ts` на
   модули, undo удалений, актуализация README.
2. Утечка пользовательского текста и секрета вебхука в логи. Закрыта в этой
   сессии, ниже зафиксировано, что именно и где остались хвосты.
3. Кнопка «Открыть» у бота в списке чатов Telegram, как у бота «Наши денежки».
   Делается в BotFather без правок кода, инструкция ниже.

## Выполнено

1. **Typecheck проходит чисто (`0dbb6c0`).** В `tsconfig.json` не был задан
   `target`, поэтому TypeScript целился в ES5 и запрещал итерацию `Map`/`Set`.
   Все 14 ошибок росли отсюда: сначала `TS2802` на `for...of`, следом типы
   разъезжались в `any`. Поставлен `ES2022`.

   Грабли: первый прогон после правки показал те же 14 ошибок из
   инкрементального кэша — помогло удаление
   `node_modules/typescript/tsbuildinfo`.

2. **Энергобаланс перестал существовать в двух копиях (`4af7a69`).**
   В `server/lib/energy.ts` уже лежали `calculateBMR` и `calculateTDEE`, а в
   `bot.ts` — их дословные копии (в комментарии модуля это было записано).
   Копии убраны, туда же переехал `buildEnergyBalanceText`. Пять мест вызова
   не изменились. Добавлен `tests/energy.test.ts`.

3. **`tests/api.test.ts` оформлен как интеграционный (`8fe6b73`).** Он не
   входил в `npm test`, и было непонятно почему — выглядел забытым сломанным
   тестом. Требует запущенного сервера, получил свой скрипт `test:api`, шапку
   с условиями и переменную `API_BASE`.

   Обманчивый симптом, записан в шапке теста: на macOS порт 5000 занимает
   системный AirPlay-приёмник, он отвечает `403`, а не отказом в соединении.

4. **Утечка в логах закрыта (`3a4ccec`, задеплоено, секрет сменён).**
   Повод: в соседнем боте расходов агент нашёл текст сообщений в логах.
   У нас было то же и хуже:
   - в docker logs шли текст каждого сообщения, расшифровка голосовых,
     результат vision, профиль (вес, рост, возраст, пол) с `user.id`;
   - `console.error("...", err)` печатал объект целиком, а `TelegramError`
     носит в `response.request` тело отправляемого сообщения, body-parser в
     `err.body` сырое тело запроса;
   - секрет вебхука стоял в пути URL, путь печатали request-логгер Express и
     nginx на хосте на каждом апдейте.

   Сделано: логи контента заменены на длины и счётчики; `describeError` в
   `server/lib/safe-log.ts` печатает имя, message, коды и до 5 фреймов стека,
   для `SyntaxError`/`entity.parse.failed` message не печатает (V8 вставляет
   в него фрагмент разбираемой строки); вебхук на фиксированном пути
   `/api/telegram-webhook/update`, проверка только по заголовку через
   `timingSafeEqual` (`server/lib/webhook-auth.ts`); 5xx клиенту без
   `err.message`; у quick-роутера свой error-handler; `quick-reject-log` не
   выдаёт токен за scheme и чистит управляющие символы; OpenAI SDK
   `logLevel: "off"`; docker json-file 10m × 3. Guard-тест
   `tests/log-privacy.test.ts` сканирует `console.*` и `log(` в `server/**`
   на запрещённые идентификаторы.

   На проде: старый секрет остался в `/var/log/nginx/access.log` (47 строк),
   поэтому `WEBHOOK_SECRET` в `/root/foodbot/.env` сменён, бэкап
   `/root/foodbot/.env.bak-202609081830`. Контейнер новый секрет подхватил,
   сверено хэшами. Лог контейнера был пересоздан деплоем 8fe6b73 в тот же
   день, старых утечек в нём уже нет.

5. **Кнопка «Открыть» в списке чатов (2026-10-26), только инструкция.**
   Эту кнопку Telegram показывает у бота с настроенным Main Mini App, код
   для неё не нужен. Настройка: @BotFather → `/mybots` → BroBotFood →
   Bot Settings → Configure Mini App → Enable Mini App, URL
   `https://alxforbot.online/app/` (`server/static.ts` раздаёт Mini App по
   `/app`). После этого кнопка появится в списке чатов и в профиле бота.
   Кнопка меню у поля ввода настраивается отдельно, через
   Bot Settings → Menu Button; вызова `setChatMenuButton` в коде нет.
   Пользователь настраивает сам, результат не подтверждён.

## Текущее состояние

Прод на vps4 — `3a4ccec`, бот поднялся, `getWebhookInfo` показывает
`/api/telegram-webhook/update` без ошибок, без заголовка эндпоинт отвечает 403.
`npm run check` чист, 194 теста зелёные.

`server/bot.ts` — 4047 строк, из них `setupBot` занимает 3756: одна функция,
27 обработчиков, 23 команды. Это и есть основной оставшийся техдолг.

## Решения и ограничения

- Рефакторинг `bot.ts` идёт малыми шагами, а не одним заходом: тестов на
  поведение бота почти нет, регрессию ловить нечем. Первым шагом вынесено то,
  что уже дублировалось и легко покрывается тестом.
- Порядок для следующих шагов: сначала чистые построители текста и клавиатур
  (`buildConfirmMessage`, `buildConfirmKeyboard`, `buildEditKeyboard`,
  `formatTotalsLine`, `getUnit`), потом команды с малой связностью, и только
  затем `bot.on("message")` и `callback_query` — там основная логика и
  замыкания на состояние внутри `setupBot`.
- Список тестовых файлов в `package.json` перечислен вручную. Из-за этого
  `api.test.ts` годами не запускался. Новые файлы не забывать добавлять либо
  перевести на glob, когда интеграционные тесты будут отделены надёжнее.

## Изменённые файлы

- `tsconfig.json` — добавлен `target: ES2022`.
- `server/lib/energy.ts` — переехал `buildEnergyBalanceText`.
- `server/bot.ts` — убраны дубли расчётов, добавлен импорт из `lib/energy`.
- `tests/energy.test.ts` — новый.
- `tests/api.test.ts` — шапка с условиями запуска, `API_BASE`.
- `package.json` — скрипт `test:api`, подключён `energy.test.ts`.

По утечке в логах (`3a4ccec`):

- `server/lib/safe-log.ts` — новый, `describeError`.
- `server/lib/webhook-auth.ts` — новый, `secretsMatch`.
- `server/bot.ts` — путь вебхука, проверка заголовка, логи без контента,
  все `console.error` через `describeError`.
- `server/index.ts` — 5xx без `err.message`, лог через `describeError`.
- `server/quick-api.ts` — завершающий error-handler.
- `server/lib/quick-reject-log.ts` — `describeScheme`, `safeClientString`.
- `server/openai.ts` — `logLevel: "off"`, ошибки через `describeError`.
- `server/app-api.ts`, `server/barcode.ts`, `server/lib/persistent-state.ts` —
  ошибки через `describeError`.
- `docker-compose.yml` — секция `logging` у `bot` и `db`.
- `DEPLOY.md` — путь вебхука и ожидаемые строки лога без секрета.
- `tests/log-privacy.test.ts`, `tests/webhook-auth.test.ts` — новые,
  подключены в `npm test`; `tests/quick-entry.test.ts` — тесты на scheme и
  чистку строк.

## Проверки

- `npm run check` — 0 ошибок (было 14).
- `npm test` — 175 тестов, 0 падений. Тест на `buildEnergyBalanceText` сначала
  падал на отсутствии функции.
- `npm run build` — клиент и сервер собираются.
- Деплой на vps4: контейнер поднят, `Telegram Bot started`, webhook установлен.
- Формулы `calculateBMR`/`calculateTDEE` сверены построчно до удаления копий —
  реализации совпадали дословно, поведение не менялось.

По утечке в логах:

- Guard-тест до правок падал на 10 местах в `bot.ts` и `openai.ts`, после
  расширения списка ещё на 5 (`webhookUrl`, `barcode`); юнит-тесты
  `describeError` и `secretsMatch` падали до появления кода.
- `npm test` — 194 теста, 0 падений; `npm run check` — 0 ошибок.
- Ревью `reviewer` и `security-reviewer`: все находки закрыты, кроме
  перечисленных в рисках.
- Прод после деплоя: `Telegram webhook set` в логе, `/api/health` 200,
  `POST /api/telegram-webhook/update` без заголовка 403, `LogConfig`
  контейнера `json-file max-size=10m max-file=3`.

## Блокеры и риски

- Обязательных блокеров нет.
- Риск рефакторинга `setupBot`: обработчики замкнуты на общие переменные
  внутри функции (storage, pending-состояние, хелперы). Вынос потребует
  явного контекста, и это самая опасная часть работы.
- `tests/api.test.ts` по-прежнему падает без запущенного сервера — это
  ожидаемо, но прогонять его руками никто не будет.
- nginx на хосте фактически не ротирует логи: `/etc/logrotate.d/nginx`
  настроен на daily/14, но `/var/log/nginx/access.log` один и на 26 МБ. В нём
  старый секрет вебхука (уже сменён, бесполезен) и query-строки запросов;
  бинарный путь `/api/quick` передаёт подпись к фото в query
  (`server/lib/quick-binary.ts`), так что подписи могут лежать в access.log.
  Проверить и починить ротацию либо отключить логирование query для этого
  location.
- Тело вебхука парсится `express.json()` до проверки секрета, как и раньше.
  Rate-limit 30 rps на IP есть; при желании проверять заголовок раньше парсера.
- Guard-тест ловит имена переменных, а не смысл: лог через новую переменную
  с другим именем он пропустит. Список `FORBIDDEN` расширять, а не ослаблять.

## План дробления bot.ts (проработан, к реализации не приступали)

Замеры связности, снятые с текущего кода:

| Блок | Строк | Общее состояние | Хелперы |
|---|---|---|---|
| `callback_query` | 1230, 30 веток | все 8 записей | 12 |
| `message` | 564 | 5 записей | 7 |
| Команды отчётов | ~600 | не использует | 4 |
| Построители текста | ~250 | не использует | — |

Внутри `setupBot`: 8 persistent-записей (`userStates`, `pendingMulti`,
`pendingLogs`, `pendingWorkouts`, `pendingFavSuggestion`,
`pendingMealFavorite`, `smartSnooze`, `settingsMessageIds`), ~20 вложенных
хелперов, 27 обработчиков. Всё замкнуто на переменные функции — простой
перенос кода невозможен.

Порядок работ определён этими замерами: начинаем с того, что не касается
состояния.

1. **Построители → `server/bot/format.ts`** (~250 строк). `buildConfirmMessage`,
   `buildConfirmKeyboard`, `buildEditKeyboard`, `buildMultiSummaryText/Keyboard`,
   `buildMultiItemEditorText/EditKeyboard`, `buildHistoryItemText/Keyboard`,
   `buildSettingsText/Keyboard`, `formatTotalsLine`, `getUnit`. Чистые, сразу
   под тесты. Риск минимальный.
2. **Команды отчётов → `server/bot/commands/reports.ts`** (~600 строк).
   `stats`, `week`, `month`, `pdf`, `export`, `report`. Состояния не касаются;
   здесь впервые вводится явный контекст (бот, storage, общие хелперы) вместо
   замыкания.
3. **Явный контекст для состояния.** 8 persistent-записей собрать в объект и
   передавать. Короткий, но блокирующий шаг для этапов 4–5.
4. **`message` → `server/bot/handlers/message.ts`** (564 строки, 5 записей).
   Основная логика ввода еды, нужна аккуратность.
5. **`callback_query` → роутер по префиксам** (1230 строк, 30 веток) —
   разложить по темам: подтверждение блюда, настройки, история, напоминания.
   Самый опасный кусок, поэтому последний.

**Чем проверять.** Этапы 1–2 — тест на каждую вынесенную функцию. Этапы 3–5
требуют подставного бота (объект с `sendMessage`) и подставного storage, иначе
проверять нечем. После каждого этапа: тесты, сборка, деплой, ручная проверка
затронутых команд.

**Критерий приёмки:** поведение не меняется. Только структурные правки,
никаких попутных улучшений формулировок.

**Оценка.** Этапы 1–2 — по сессии, риск низкий, файл худеет примерно на
четверть. Этап 3 — короткий. Этапы 4–5 — по сессии-две, здесь возможны
регрессии. Разумная точка остановки — после этапа 2.

## Следующий точный шаг

**2026-10-26: проведён полный аудит, итог — раздел «Аудит 2026-10-26» в
`docs/ROADMAP.md`.** Блок 1 там почти закрыт: logrotate на vps4 поставлен
(пакета не было), ежедневный дамп БД работает (`scripts/backup-db.sh`, cron
04:20, дампы в `/root/foodbot/backups`), nginx не пишет `/api/quick` в
access.log. Хвост по логам из пунктов ниже закрыт. Открыто: копия дампов вне
VPS не делаем, решение пользователя. Блок 2: первые пять пунктов
сделаны и задеплоены (`f4b9778`): safeHandler на всех хендлерах и тике,
`unhandledRejection`, `pool.on('error')`, округление по типу колонки,
двойной тап, проверка цели админ-действий, allowlist `/me`. Блок 2 закрыт (`e727a09`): дневной лимит AI
(env `AI_DAILY_LIMIT`, `AI_DAILY_PHOTO_LIMIT`, `VOICE_MAX_SECONDS`), vision-кэш
штрихкодов без правок, `.dockerignore`, `USER node`, healthcheck с БД, CSP.
Мини-апп в Telegram и голосовое под non-root ждут ручной проверки
пользователем. Сборка образа на vps4 идёт ~10 мин. `.env.example` закрыт
deny-правилом — переменные описаны в DEPLOY.md.
Блок 3, шаг 1 задеплоен (`81f469c`): модели по ролям в env
(`AI_MODEL_VISION/BARCODE/TEXT/CHAT/AUDIO`, `AI_FALLBACK_*`,
`AI_REASONING_EFFORT`, см. DEPLOY.md), на проде не заданы — работают прежние
модели, снапшот-тест гарантирует те же запросы. Каркас eval: `eval/`,
`scripts/eval-models.ts`, 80 текстов и 19 синтетических голосовых. Eval текста и голоса
прогнан, на проде переключены text/chat → gpt-6-luna, audio →
gemini-3.5-flash-lite (итоги в ROADMAP блок 3). Vision остаётся gpt-4o до eval
на фото пользователя.
Блок 4 закрыт и задеплоен (`bd3e2c4`, `7158863`): планировщик «пора и
не отправлено» с окном догона 2 ч, бесконечный снуз, `/cancel` и TTL 30 мин
диалогов, порции OFF, баги Mini App, единый `server/lib/tz.ts`. Важно: старые
выборки через сырой `sql` с Date считали сутки с 03:00 МСК (pg сериализует Date в
зоне процесса, колонка `timestamp` без tz, Postgres в UTC) — теперь drizzle
`gte/lte` и настоящие сутки пользователя. Блок 5: снапшоты миграций
0005–0007 восстановлены и сверены со схемой прода, CI с check/build/audit,
сборка не качает SDK (`npm run update:tg-sdk`), удалено ~50 пакетов, `replit.md`,
`DEPLOY_GUIDE.md`, `.replit`, `db:push`; `script/` → `scripts/`. Затем `17b5505`:
audit = 0 (drizzle-orm 0.45.4, zod 4, overrides request→@cypress/request,
qs, uuid), `describeError` не печатает SQL/параметры `DrizzleQueryError`,
35 HTTP-тестов Mini App API, 404 на удаление чужой воды/избранного. Прод на
Node 20 поднялся, тики планировщика без ошибок. Блоки 1–5 ROADMAP закрыты,
кроме: внешний uptime-пинг, тесты storage на PG, суточный потолок
`/api/app/analyze`, дубли заголовков nginx для `/app/`, eval фото. Дальше —
блок 6 (функции). Затем блок 3 (модели: `gpt-4o`/`-mini`
отключаются 2027-01-14).


Незавершённой работы в коде нет: всё закоммичено, запушено и задеплоено,
прод на `3a4ccec`, секрет вебхука сменён.

Уточнить у пользователя, включён ли Main Mini App в BotFather и появилась
ли кнопка «Открыть». Если Mini App с этой кнопки не авторизуется, проверить
`telegramAuth` на `/api/app` с `initData`, пришедшим из списка чатов.

Каталог `knowledge-base/` не отслеживается git, в HANDOFF о нём ничего не
было. Спросить, коммитить его или добавить в `.gitignore`.

Первым делом при возобновлении, до техдолга, закрыть хвост по логам на хосте:
`ssh vps4 "ls -la /var/log/nginx; systemctl status logrotate.timer"`, понять,
почему access.log не ротируется, и решить, чистить ли текущий файл.

При возобновлении — выбрать одно из двух и начать:

1. **Этап 1 дробления `bot.ts`** — построители текста и клавиатур в
   `server/bot/format.ts` (~250 строк, план выше).
2. **Продуктовая задача** — отложенный пункт 5 релиза 2: подсказки «топ-3
   вероятных блюда по дню недели и времени». Образец запроса — `getTopMealFood`,
   частотный анализ по (день недели, mealType) за 8 недель.

## Rollback

```
git revert 3a4ccec
git revert 8fe6b73 4af7a69 0dbb6c0
```

Затем на vps4: `cd ~/foodbot && git pull origin main && docker compose up -d --build`.

Откат `3a4ccec` возвращает секрет в путь вебхука: при старте бот сам вызовет
`setWebHook` со старым форматом URL, nginx менять не нужно. Сменённый
`WEBHOOK_SECRET` откатывать не надо, он работает с любой версией кода; старое
значение лежит в `/root/foodbot/.env.bak-202609081830`.

Схема БД и nginx не тронуты, миграций не было — откат ограничен кодом.

## Перенесено из HANDOFF.md 2026-10-27 00:00 MSK (статус на момент переноса: открыт; итоги аудита, файл переписан под редизайн Mini App)

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
