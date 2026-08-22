# HANDOFF

Обновлено: 2026-08-22 22:57 MSK
Клиент: Claude

**Статус: ЗАКРЫТ.** Работа сессии доведена до прода и проверена пользователем.
Незавершённых веток нет — файл оставлен как точка входа в следующую сессию.

## Цель

Довести до прода быструю запись еды с iPhone (шорткат → эндпоинт), разобранную
в исследовании 2026-08-18 (`QUICK-ENTRY.md`), и закрыть висевший техдолг.

## Выполнено

1. **Быстрая запись `POST /api/quick`** (`c2df1b8`). Эндпоинт не анализирует еду сам, а
   вбрасывает синтетический Telegram-Update в живой `bot.on("message")` — штрихкоды,
   мультиблюдо, вода и карточка правки веса достались без переписывания цепочек.
   Bearer-токен в `users.quick_token` (миграция 0007), команда `/quick` печатает URL и
   токен, кнопка ротации. Rate-limit 30/час на пользователя.
2. **Фикс P1-бага №10**: подпись к фото уходит в vision как `userNote` с приоритетом над
   визуальной оценкой (раньше терялась).
3. **Вода в быстрой записи**: убран edge-case «выпил воды → other» в `classifyIntent`.
4. **Домен** (`643bbb6`): `alxforbot.online` вместо мёртвого `alxthecreatortg.ru` в
   `DEPLOY.md` и в HTTP-Referer OpenRouter.
5. **Переносы строк в base64** (`107b696`) вычищаются сервером — Shortcuts по умолчанию
   рвёт строку на 76 символов, заставлять человека помнить про галочку не стали.
6. **Готовые шорткаты** (`bc95228`, `487ca2f`): собрать цепочку руками не вышло, поэтому
   шорткат описан кодом — `scripts/build-shortcuts.py` → plist → `shortcuts sign -m anyone`.
   Меню из трёх пунктов: 🎤 Сказать (диктовка `ru-RU`) / ⌨️ Написать / 📷 Сфотографировать.
7. **Уборка диагностики iOS-фриза** (`5a3101b`): удалены `client/src/lib/debug.ts`, 30
   вызовов `crumb()`, `installCrumbReporter`, эндпоинт `POST /api/app/crumb`.

## Текущее состояние

Прод на vps4 = main = `5a3101b`. Бот стартует, миграции применены, Mini App отдаёт 200,
`/api/quick` отвечает `401 invalid_token` без токена. Шорткат собран и работает на iPhone
пользователя — еда пишется с домашнего экрана, карточка подтверждения приходит в Telegram.

## Решения и ограничения

- Синтетический Update — договор с ФОРМОЙ объекта `node-telegram-bot-api`, не публичный
  контракт. Вынесен в env-free `server/lib/synthetic-update.ts` и покрыт тестом, чтобы
  апгрейд библиотеки ломался в тестах, а не в проде.
- Токен ездит в заголовке, не в URL: прошлый аудит health-sync поймал утечку токена в
  nginx access-логи.
- Режим «записал и забыл» осознанно НЕ делали — AI промахивается с весом порции.
- Вес по-прежнему только через `/weight`: расширять `classifyIntent` на вес не просили.
- В шорткате токен вставляется в ТРИ действия «Получить содержимое URL» (по ветке меню).
  Предлагал вынести в одно действие «Текст» и подставлять переменной — пользователь пока
  не просил.
- `ErrorBoundary` и fatal-overlay в `main.tsx` оставлены: это штатная защита от белого
  экрана, а не разовая диагностика.

## Изменённые файлы

Новые: `server/quick-api.ts`, `server/lib/quick-auth.ts`, `server/lib/synthetic-update.ts`,
`migrations/0007_quick_token.sql`, `tests/quick-entry.test.ts`, `scripts/build-shortcuts.py`,
`shortcuts/*.shortcut`.
Правлены: `server/bot.ts`, `server/openai.ts`, `server/storage.ts`, `server/routes.ts`,
`server/app-api.ts`, `shared/routes.ts`, `shared/schema.ts`, `client/src/main.tsx`,
`client/src/pages/{Today,History,Favorites}.tsx`, `client/src/components/AddFoodModal.tsx`,
`DEPLOY.md`, `QUICK-ENTRY.md`, `package.json`.
Вне репозитория: в `/etc/nginx/sites-available/bots` на vps4 добавлен `location = /api/quick`
с `client_max_body_size 2m` (бэкап — `bots.bak-quick-20260822`).

## Проверки

- `npm test` — 146 тестов, 0 падений (было 131).
- `npm run check` — 14 ошибок, все старые в `bot.ts` (`downlevelIteration` + implicit any),
  новых нет.
- `npm run build` — проходит.
- `scripts/migtest.sh` на vps4 — цепочка миграций дважды на копии прод-схемы и дважды на
  пустой БД, `quick_token` на месте.
- Прод: `curl` на `/api/quick` → 401, `/app/` → 200, логи старта чистые.

## Блокеры и риски

Блокеров нет. Риски:
- Правка nginx на vps4 блокируется auto-режимом — нужен разовый явный апрув пользователя.
- Новый `/api/*` без своего `location` в nginx отдаёт 404 снаружи. Помнить при следующем
  эндпоинте.

## Следующий точный шаг

**Этап 2.3, последний в релизе 2** — умные подсказки «топ-3 вероятных блюда по дню недели и
времени»: кнопки-варианты в напоминании рядом с «повторить как обычно» и карточка на экране
Today. Частотный анализ по (день недели, mealType) за 8 недель; за образец запроса брать
`getTopMealFood` в `server/storage.ts`.

Не забыть спросить в начале сессии:
1. Открылся ли Mini App у второго пользователя после self-host `telegram-web-app.js`
   (`1d58f2d`) — по логам заходов с чужих устройств с конца июля не видно.
2. Умные напоминания задеплоены 25 июля, но тумблер `smart_reminders` не включён НИ У КОГО
   (0 из 3 пользователей, в `notification_sends` только `report`) — фича ни разу не работала
   в бою. Включить и проверить первый пинг.

## Rollback

Любой шаг откатывается `git revert <sha>` + деплой
(`ssh vps4 "cd foodbot && git pull && docker compose up -d --build"`).
Миграция 0007 только добавляет колонку — откат схемы не требуется.
nginx: `cp /etc/nginx/sites-available/bots.bak-quick-20260822 /etc/nginx/sites-available/bots
&& nginx -t && systemctl reload nginx`.
