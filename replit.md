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

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend (Express + Node.js)

- **Entry point**: `server/index.ts` — Express HTTP server, routes, static files
- **Routes**: `server/routes.ts` — registers bot via `setupBot()`, `/api/health`, keep-alive ping in production
- **Bot logic**: `server/bot.ts` — all Telegram interaction: commands, profile flow, multi-item food confirmation with inline buttons, per-item weight editing, meal reminders, evening reports, admin controls
- **AI integration**: `server/openai.ts`:
  - `openai` client — Replit AI Integration proxy for GPT-4o / GPT-4o-mini
  - `whisperClient` — direct OpenAI client using `OPENAI_API_KEY` (Replit proxy does not support audio API)
  - `analyzeFoodText()` → `FoodItem[]` (GPT-4o-mini)
  - `analyzeFoodImage()` → `FoodItem[]` (GPT-4o)
  - `transcribeVoice()` → string (Whisper-1, requires OPENAI_API_KEY)
  - `generateEveningReport()` → string (GPT-4o-mini)
- **Storage layer**: `server/storage.ts` — `DatabaseStorage` implementing `IStorage`; includes `calculateAndSetGoals()` (Mifflin-St Jeor)
- **Database**: `server/db.ts` — Drizzle ORM connected to PostgreSQL via `pg` Pool

### Frontend (React + Vite)

- Minimal frontend — `client/index.html` renders a "Telegram Bot is active" status page
- React, Vite, Tailwind CSS, shadcn/ui (New York style)
- `@tanstack/react-query` available for data fetching

### Shared Layer

- `shared/schema.ts` — Drizzle schema for `users` and `foodLogs` tables; Zod insert schemas

### Database Schema

**users** table:
- telegramId, username, isApproved, isAdmin
- Profile: age, gender, weight (kg), height (cm), activityLevel, goal
- Computed: caloriesGoal, proteinGoal, fatGoal, carbsGoal
- Notifications: reportTime, breakfastReminder, lunchReminder, dinnerReminder, noLogReminderTime
- Weight reminders: weightReminderTime (HH:MM|off), weightReminderDays ("1,3,5" = Mon,Wed,Fri; "" = all days)

**foodLogs** table:
- userId (FK), foodName, calories, protein, fat, carbs, weight (g/ml), mealType
- foodScore (1–10), nutritionAdvice, date

**weightLogs** table:
- userId (FK), weight (real, kg with decimals e.g. 85.3), date

### Build System

- `script/build.ts` — Vite build for client, esbuild for server → `dist/index.cjs`; bundles openai, drizzle-orm, pg, xlsx, etc.

## Multi-Item Food Flow

When AI detects multiple dishes in one message:
1. `pendingMulti[telegramId]: FoodItem[]` stores the array
2. Summary message shows all items with total calories
3. Inline buttons: `mi_e_N` (edit item N), `save_all`, `cancel_multi`
4. Editor buttons: `mi_wp_AMOUNT_N` / `mi_wm_AMOUNT_N` (weight ±), `mi_del_N` (delete), `mi_back` (back to list)
5. Weight changes recalculate КБЖУ proportionally

Single-item flow still uses `(bot as any).pendingLogs[telegramId]` with weight adjustment buttons.

## External Dependencies

### Required Environment Variables
- `TELEGRAM_BOT_TOKEN` — from @BotFather (required)
- `DATABASE_URL` — PostgreSQL connection string (required)
- `OPENAI_API_KEY` — direct OpenAI key required for Whisper; also used as fallback for GPT on VPS
- `ADMIN_TELEGRAM_ID` — admin Telegram user ID (optional)
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
- `pdfkit` — PDF generation with charts; fonts via `dejavu-fonts-ttf` npm package (Cyrillic support)
- `dejavu-fonts-ttf` — DejaVu Sans TTF fonts with full Cyrillic support for PDFKit
- `express` + `express-session` + `connect-pg-simple` — HTTP server and sessions
- `react` + `vite` + `tailwindcss` + `shadcn/ui` — frontend
- `@tanstack/react-query` — client-side data fetching
- `date-fns` — date formatting
- `zod` — runtime validation

### PDF Font Path Resolution
The PDF generator (`server/pdf.ts`) uses DejaVu Sans from the `dejavu-fonts-ttf` npm package.
Font path is resolved via `createRequire(import.meta.url)` + `require.resolve("dejavu-fonts-ttf/package.json")` — this is required because `server/pdf.ts` runs as an ES module where `__dirname` is not available.
