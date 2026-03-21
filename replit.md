# Calorie Tracker Bot & Dashboard

## Overview

Fullstack nutrition tracking application centered around a Telegram bot. Users log food via text, photo, or voice message; the bot analyses it with OpenAI, calculates КБЖУ, and stores everything in PostgreSQL. A minimal React frontend serves as a status page.

**Core Features:**
- Telegram bot for food logging via text, photo, voice, or barcode photo
- GPT-4o for photo/barcode analysis (vision), GPT-4o-mini for text/reports/coach, Whisper-1 for voice transcription
- Multi-item recognition: one message → multiple food items, each editable before saving
- Nutritional quality scoring (1–10) with personalized advice in Russian
- Personal profile setup + `/editprofile` for editing individual fields (age/weight/height/activity/goal/calories)
- Mifflin-St Jeor calorie calculation, daily stats with progress bars
- Streak tracking (consecutive days), `/week` weekly breakdown, `/goal` quick goal change
- `/month` monthly stats with 4-week breakdown; `/pdf` PDF report with charts (pdfkit, hand-drawn bar charts)
- Weight tracking: `/weight [kg]` to log, history with trend, AI weekly analysis (GPT-4o-mini)
- Weight reminders: configurable time + days of week (Mon/Tue/.../all) — fires only if no weight logged that day
- `/ask` AI coach command with full profile + today's food context
- Barcode scanning via Open Food Facts API (GPT-4o detects barcode → Open Food Facts lookup)
- Meal reminders (breakfast/lunch/dinner) + no-log reminder if no entries by a set time
- Evening AI-powered diet reports, Excel export, admin whitelist system
- **Micronutrients** (user-controlled toggle via `/settings`): fiber, sugar, sodium, saturated fat — estimated by AI per food item, shown in `/stats` and daily progress; scales with weight adjustments
- **Workout tracking**: free-text or voice input ("ran 5km", "30 min elliptical", "10000 steps") → AI estimates calories burned using MET values; `workoutLogs` table; `/workout` shows today's summary; `/stats` and daily progress show net calories (consumed − burned)
- **Apple Health sync**: Telegram-native flow — `/sync` sends inline button `shortcuts://run-shortcut?name=HealthSync` that opens the iOS Shortcuts app; the "HealthSync" shortcut collects steps + active calories + workouts from Apple Health, then opens Telegram with a pre-filled `/health {json}` message; user taps Send and the bot saves everything to `workoutLogs` with `source="apple_health"`; re-sync is idempotent (replaces previous entries for that day); `/healthsetup` sends step-by-step shortcut creation guide

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend (Express + Node.js)

- **Entry point**: `server/index.ts` — Express HTTP server, routes, static files
- **Routes**: `server/routes.ts` — registers bot via `setupBot()`, `/api/health` status endpoint, keep-alive ping in production (every 4 min); runs startup migration `ALTER TABLE users DROP COLUMN IF EXISTS health_token` (cleanup from old webhook approach)
- **Bot logic**: `server/bot.ts` — all Telegram interaction: commands, profile flow, multi-item food confirmation with inline buttons, per-item weight editing, meal reminders, evening reports, admin controls
- **AI integration**: `server/openai.ts`:
  - `openai` client — Replit AI Integration proxy for GPT-4o / GPT-4o-mini
  - `whisperClient` — direct OpenAI client using `OPENAI_API_KEY` (Replit proxy does not support audio API)
  - `analyzeFoodText()` → `FoodItem[]` (GPT-4o-mini)
  - `analyzeFoodImage()` → `FoodItem[]` (GPT-4o)
  - `transcribeVoice()` → string (Whisper-1, requires OPENAI_API_KEY)
  - `generateEveningReport()` → string (GPT-4o-mini)
- **Apple Health helpers**: `server/health-helpers.ts` — exported separately for unit testing:
  - `parseHealthPayload(rawText)` → `HealthParseResult` — strict JSON validation; errors: `invalid_json`, `not_object`, `invalid_steps`, `invalid_active_calories`, `workouts_not_array`, `workout_not_object`, `workout_missing_type`, `workout_invalid_calories`, `workout_invalid_duration`, `no_storable_data`; rejects payloads with no steps and no workouts (including `active_calories`-only payloads)
  - `calcStepsCalories(steps, activeCalories, workoutKcal)` → number — `max(0, active_calories - workoutKcal)`; fallback `steps * 0.04` if `activeCalories` is null
- **Storage layer**: `server/storage.ts` — `DatabaseStorage` implementing `IStorage`; includes `calculateAndSetGoals()` (Mifflin-St Jeor), `deleteWorkoutLogsBySource(userId, date, source)` for idempotent Apple Health re-sync
- **Database**: `server/db.ts` — Drizzle ORM connected to PostgreSQL via `pg` Pool
- **PDF generation**: `server/pdf.ts` — pdfkit + DejaVu Sans; fonts loaded from `server/fonts/` directory (DejaVuSans.ttf, DejaVuSans-Bold.ttf) resolved via `createRequire(import.meta.url)` + `require.resolve("dejavu-fonts-ttf/package.json")` because `__dirname` is unavailable in ES modules

### Frontend (React + Vite)

- Minimal frontend — `client/index.html` renders a "Telegram Bot is active" status page
- React, Vite, Tailwind CSS, shadcn/ui (New York style)
- `@tanstack/react-query` available for data fetching

### Shared Layer

- `shared/schema.ts` — Drizzle schema for all main tables + Zod insert schemas + TypeScript types:
  - `users`, `foodLogs`, `waterLogs`, `weightLogs`, `workoutLogs`
  - All relations defined via `drizzle-orm/relations`
- `shared/models/chat.ts` — leftover template file with `conversations` and `messages` tables; not used by the bot or frontend

### Database Schema

**users** table:
- `id`, `telegramId` (unique), `username`, `isApproved`, `isAdmin`, `createdAt`
- Profile: `age`, `gender` (male/female), `weight` (kg, integer), `height` (cm), `activityLevel` (sedentary/light/moderate/active/very_active), `goal` (lose/maintain/gain)
- Computed goals: `caloriesGoal`, `proteinGoal`, `fatGoal`, `carbsGoal`
- Notifications: `reportTime` (HH:MM, default "21:00"), `breakfastReminder`, `lunchReminder`, `dinnerReminder`, `noLogReminderTime` (all HH:MM or "off")
- Weight reminders: `weightReminderTime` (HH:MM or "off"), `weightReminderDays` ("1,3,5" = Mon,Wed,Fri using JS getDay; "" = all days)
- `showMicronutrients` (boolean, default false) — user toggle for fiber/sugar/sodium/saturatedFat display

**foodLogs** table:
- `userId` (FK → users.id), `foodName`, `calories`, `protein`, `fat`, `carbs`, `weight` (g/ml), `mealType` (breakfast/lunch/dinner/snack)
- `foodScore` (1–10, nullable), `nutritionAdvice` (nullable), `date`
- Micronutrients (nullable, always stored when AI returns them): `fiber` (g), `sugar` (g), `sodium` (mg), `saturatedFat` (g)

**waterLogs** table:
- `userId` (FK), `amount` (ml), `date`

**weightLogs** table:
- `userId` (FK), `weight` (real, kg with decimals e.g. 85.3), `date`

**workoutLogs** table:
- `userId` (FK), `description` (e.g. "Бег 30 мин"), `workoutType` ("бег", "эллипс", "шаги" etc.), `durationMin` (nullable), `caloriesBurned`, `date`
- `source` (text, default "manual") — "manual" for bot-entered workouts, "apple_health" for synced entries; used for idempotent re-sync

### Build System

- `script/build.ts` — Vite build for client, esbuild for server → `dist/index.cjs`; bundles openai, drizzle-orm, pg, xlsx, etc.

## Bot Commands

| Command | Description |
|---|---|
| `/stats` | Статистика за сегодня + серия дней 🔥 |
| `/week` | Разбивка по дням за 7 дней |
| `/month` | Статистика за месяц с графиками |
| `/history` | Последние записи питания |
| `/pdf` | PDF-отчёт с графиками за месяц |
| `/export ДД.ММ.ГГГГ [-ДД.ММ.ГГГГ]` | Excel-экспорт за дату или диапазон |
| `/clear ДД.ММ.ГГГГ [-ДД.ММ.ГГГГ]` | Удалить записи за дату или диапазон |
| `/weight [кг]` | Записать вес / посмотреть историю и тренд |
| `/weightreminder` | Настроить напоминание взвешиваться |
| `/ask` | Вопрос ИИ-тренеру-нутрициологу |
| `/report` | Вечерний ИИ-отчёт (вручную) |
| `/report_time` | Время авто-отчёта |
| `/reminders` | Настроить напоминания о приёмах пищи |
| `/goal` | Быстро изменить цель (похудение/поддержание/набор) |
| `/profile` | Настроить профиль полностью |
| `/editprofile` | Редактировать поля профиля по одному |
| `/workout` | История тренировок за сегодня |
| `/sync` | Синхронизировать Apple Health (запустить шорткат) |
| `/health {json}` | Принять данные от шортката Apple Health (автоматически) |
| `/healthsetup` | Инструкция по настройке шортката Apple Health |
| `/settings` | Настройки (микронутриенты и др.) |
| `/help` | Список всех команд |

## Multi-Item Food Flow

When AI detects multiple dishes in one message:
1. `pendingMulti[telegramId]: FoodItem[]` stores the array
2. Summary message shows all items with total calories
3. Inline buttons: `mi_e_N` (edit item N), `save_all`, `cancel_multi`
4. Editor buttons: `mi_wp_AMOUNT_N` / `mi_wm_AMOUNT_N` (weight ±), `mi_del_N` (delete), `mi_back` (back to list)
5. Weight changes recalculate КБЖУ proportionally

Single-item flow still uses `(bot as any).pendingLogs[telegramId]` with weight adjustment buttons.

## Apple Health Sync Flow

Telegram-native, no public webhook needed:

1. User sends `/sync`
2. Bot sends inline button → `shortcuts://run-shortcut?name=HealthSync`
3. iPhone opens the "HealthSync" shortcut in Shortcuts app
4. Shortcut collects: steps (sum), active calories (sum), optional workouts array from Apple Health for today
5. Shortcut opens Telegram with pre-filled message: `tg://resolve?domain=BOTNAME&text=/health+{json}`
6. User taps **Send** in Telegram
7. Bot `/health` handler (regex `/^\/health(@\w+)?(?:\s+([\s\S]+))?$/`) parses + validates JSON via `parseHealthPayload()`
8. Bot deletes all `apple_health` entries for that date (idempotent), then saves:
   - Steps entry: `workoutType="шаги"`, `caloriesBurned = calcStepsCalories(steps, activeCalories, workoutKcal)`
   - Each workout entry separately

**JSON format for `/health`:**
```json
{"steps": 8000, "active_calories": 320, "workouts": [{"type": "Бег", "duration_min": 30, "calories": 280}]}
```
- `steps` — integer ≥ 0 (required unless workouts provided)
- `active_calories` — integer ≥ 0 (optional; used to split calories between steps and workouts)
- `workouts` — array (optional); each item: `type` (string, required), `calories` (integer ≥ 0, required), `duration_min` (integer > 0, optional)

## Test Suite

Three test files in `tests/` using Node.js built-in `node:test`:

- **`tests/unit.test.ts`** — pure logic: `progressBar()`, Mifflin-St Jeor calculation, macro goal ratios, `calcStepsCalories()`
- **`tests/api.test.ts`** — HTTP: `GET /api/health` returns `{ status: "ok" }`
- **`tests/apple-health.test.ts`** — `parseHealthPayload()` (valid + invalid payloads), `calcStepsCalories()`, storage integration (idempotency, source isolation)

Run: `npx tsx --test tests/<file>.test.ts`

## External Dependencies

### Required Environment Variables
- `TELEGRAM_BOT_TOKEN` — from @BotFather (required)
- `DATABASE_URL` — PostgreSQL connection string (required)
- `OPENAI_API_KEY` — direct OpenAI key required for Whisper; also used as fallback for GPT on VPS
- `ADMIN_TELEGRAM_ID` — admin Telegram user ID (optional, stored as secret)
- `SESSION_SECRET` — Express session secret (required for sessions, stored as secret)
- `AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL` — Replit AI Integrations proxy (auto-provided on Replit)
- `REPLIT_DEPLOYMENT_URL` — used for keep-alive ping in Replit production

### Two OpenAI Clients (important)
- `openai` — uses Replit proxy (`AI_INTEGRATIONS_OPENAI_BASE_URL`), supports only chat completions
- `whisperClient` — uses `OPENAI_API_KEY` directly (no proxy), required for `audio.transcriptions`
- On VPS: replace both with a single `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`

### Key Libraries
- `drizzle-orm` + `drizzle-kit` — ORM and schema migrations
- `drizzle-zod` — Zod schemas from Drizzle tables
- `node-telegram-bot-api` — Telegram bot client
- `exceljs` — Excel export
- `openai` — GPT-4o, GPT-4o-mini, Whisper-1
- `pdfkit` — PDF generation with charts
- `dejavu-fonts-ttf` — DejaVu Sans TTF fonts with full Cyrillic support for PDFKit (also copied to `server/fonts/`)
- `express` + `express-session` + `connect-pg-simple` — HTTP server and sessions
- `react` + `vite` + `tailwindcss` + `shadcn/ui` — frontend
- `@tanstack/react-query` — client-side data fetching
- `date-fns` — date formatting
- `zod` — runtime validation

### PDF Font Path Resolution
The PDF generator (`server/pdf.ts`) uses DejaVu Sans from the `dejavu-fonts-ttf` npm package.
Font path is resolved via `createRequire(import.meta.url)` + `require.resolve("dejavu-fonts-ttf/package.json")` — this is required because `server/pdf.ts` runs as an ES module where `__dirname` is not available. TTF files are also stored in `server/fonts/` as a local fallback.
