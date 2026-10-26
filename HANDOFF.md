# HANDOFF

Статус: открыт
Обновлено: 2026-10-27 00:00 MSK
Клиент: Claude

## Цель

Редизайн Mini App в тёплом стиле (вариант 5 из макетов) для всех экранов,
плюс голосовой ввод и штрихкод в шторке «Добавить еду». Сделано и выкачено;
осталась проверка на устройстве. Итоги прошлой сессии (аудит, блоки 1–5) —
в `HANDOFF-archive.md`, последний раздел.

## Выполнено

Коммит `101c37e`, запушен в main, задеплоен на vps4 2026-10-26 ~23:58 MSK.

1. **Макеты**: `docs/design/miniapp-mockups.html` (5 вариантов «Сегодня»),
   `docs/design/miniapp-warm-screens.html` (утверждённые: все экраны,
   тёмная тема, шторка в два шага).
2. **Клиент** (`client/src`):
   - своя палитра в `index.css` (светлая/тёмная), `lib/theme.ts` берёт от
     Telegram только colorScheme; `theme-colors.ts` удалён;
   - экраны `pages/*` переписаны; новые `AddFoodProvider`, `WeekBars`,
     `MacroPills`, `FavoriteChips`; `MealGroups.tsx` удалён;
   - FAB «+» над вкладкой «Профиль», шторка: выбор приёма, текст, фото,
     штрихкод, голос (`lib/voice.ts`, MediaRecorder 32 кбит/с, автостоп 59 с),
     степпер веса;
   - логика с тестами: `lib/week-bars.ts` (пороги ≤100% ok, ≤110% near,
     >110% over), `protein-tip.ts` (после mealLunchEnd, не хватает >20 г),
     `stats-summary.ts` (сегодня исключено из средних/мин/макс),
     `food-emoji.ts`, `weight-trend.ts`, `invalidate.ts` (сброс `day`+`stats`);
   - `shared/meal-time.ts` — `mealTypeByTime`, сервер реэкспортирует из
     `server/lib/favorites.ts`.
3. **Сервер**:
   - `POST /api/app/transcribe` → `lib/voice-transcode.ts`: явный демуксер по
     mimeType, `-protocol_whitelist file`, 2 слота (иначе 503 busy), бюджет
     40 с, длительность округляется вниз, лимит 60 с (422 too_long);
   - штрихкод в `POST /api/app/analyze` (`mode: photo|barcode`): photo — только
     zxing при `barcodeScanEnabled`, barcode — zxing + AI с EAN-checksum,
     без кода 422 no_barcode; поток вынесен в `lib/barcode-pipeline.ts`,
     `lib/open-food-facts.ts` (санитизация OFF), бот переведён на них;
   - ответ `/analyze` — `{ items, source }`, items строго по
     `analyzedItemSchema` (оценка округляется, совет ≤500);
   - `GET /api/app/stats?range=week&end=YYYY-MM-DD`;
   - общая с ботом дневная AI-квота (`lib/ai-quota-instance.ts`), Mini App
     → 429 quota_exceeded;
   - `server/barcode.ts`: `readImageSize`, zxing пропускает картинки >16 Мп.
4. **Ревью**: skeptic по плану, общий reviewer и security-reviewer по диффу;
   все подтверждённые находки исправлены до коммита.

## Текущее состояние

- Прод на vps4: `101c37e`, `foodbot-bot-1` healthy, миграции применены,
  вебхук установлен, `/api/health` и `/app/` → 200.
- В образе ffmpeg есть libopus и демуксеры matroska/mov/ogg/mp3/wav;
  пробное перекодирование webm → ogg/opus в контейнере прошло.
- Локально: `npm run check` чист, `npm test` 534/534, `npm run build` ок.
- На устройстве пользователем НЕ проверено: голос (микрофон в WebView
  Telegram iOS/Android), штрихкод, обе темы, запись/повтор/удаление/вода,
  обновление столбика «сегодня» после записи.

## Решения и ограничения

- Код пишут сабагенты с `model: opus`; ревью — отдельными агентами.
- Таб-бар: 5 вкладок, «+» плавающая над «Профилем» (решение пользователя).
- Палитра своя, themeParams Telegram не применяются (решение пользователя).
- Голос: текст расшифровки подставляется в поле, распознавание еды — по
  кнопке «Распознать» (пользователь может поправить текст).
- Кэш vision-результата по штрихкоду в Mini App не пишем (только в боте).
- Тело запроса режет nginx на 1 МБ: аудио ≤700 000 символов base64.
- Остальные постоянные решения (миграции, tz, модели, сборка на vps4) — в
  архиве, разделы «Решения и ограничения».

## Изменённые файлы

`git show --stat 101c37e` (61 файл). Ключевые: `client/src/**`,
`tailwind.config.ts`, `server/app-api.ts`, `server/bot.ts`, `server/barcode.ts`,
`server/lib/{barcode-pipeline,open-food-facts,voice-transcode,ai-quota-instance,stats-days,favorites}.ts`,
`server/storage.ts`, `shared/{routes,meal-time}.ts`, `tests/{app-api,miniapp-client,voice-transcode,barcode,tz}.test.ts`,
`package.json` (список тестов), `docs/design/*`.

## Проверки

- `npm run check`, `npm test` (534), `npm run build` — перед коммитом.
- UI на моках: временный `vite.mock.config.ts` + chrome-headless-shell из
  `~/Library/Caches/ms-playwright`, скриншоты светлой/тёмной темы всех
  вкладок (конфиг удалён, в git не попал).
- После деплоя: health, `/app/`, логи старта, ffmpeg-кодеки и пробное
  перекодирование в контейнере.

## Блокеры и риски

- Микрофон в Telegram WebView, особенно Android, может быть недоступен —
  тогда тост «Микрофон недоступен в этом клиенте Telegram».
- Квота общая: если первый отказ за день случился в Mini App, бот в этот
  день админа об этом пользователе не уведомит. Ответы busy/too_long на
  `/transcribe` тоже тратят 1 запрос квоты.
- В «Профиле» при прокрутке FAB временно перекрывает переключатели справа.
- Сырой ADTS (`audio/aac`) теперь 422; Safari шлёт `audio/mp4` — не задет.
- Разбор WebP-заголовка проверен только на синтетике.
- Из аудита остаётся актуальным: отключение `gpt-4o`/`gpt-4o-mini`
  2027-01-14 (vision, barcode, fallback'и), нет внешнего мониторинга,
  дублирующиеся заголовки nginx для `/app/`, `knowledge-base/` не решено
  (не в git), build cache на vps4 — подробности в архиве.

## Следующий точный шаг

Дождаться от пользователя результата проверки на телефоне (голос, штрихкод,
темы, запись/удаление/вода). Баги — чинить по скрину/описанию; если голос не
работает в каком-то клиенте, смотреть `docker logs foodbot-bot-1` на
`/transcribe` и консоль WebView.

Дальше — блок 6 из `docs/ROADMAP.md` (выбор за пользователем, до выбора не
начинать) и eval vision-моделей на фото пользователя до декабря (см. архив,
«Следующий точный шаг»).

## Rollback

- Код: `git revert 101c37e`, затем на vps4
  `cd /root/foodbot && git pull --ff-only origin main && docker compose up -d --build`
  (сборка до ~10 минут).
- Схема БД и `.env` не менялись — откат только кодом.
- Прошлые откаты (модели, nginx, бэкап БД) — в архиве, раздел «Rollback».
