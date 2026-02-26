# Calorie Tracker Bot & Dashboard

## Overview

This is a fullstack nutrition tracking application centered around a Telegram bot interface. Users interact primarily through Telegram to log food (via text or photo), track water intake, view daily stats, and receive AI-powered dietary recommendations. A minimal web frontend (React) serves as a status page. The backend handles Telegram bot logic, AI food analysis via OpenAI GPT-4o, and persists all data to a PostgreSQL database using Drizzle ORM.

**Core Features:**
- Telegram bot for food/water logging with inline button interactions
- AI-powered food analysis from text descriptions or photos (GPT-4o)
- Nutritional quality scoring (1-10) with personalized advice in Russian
- Personal profile setup (age, weight, height, goal) with Mifflin-St Jeor calorie calculation
- Daily/weekly stats, Excel export, configurable meal reminders, and evening AI reports
- Admin whitelist system for user approval

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend (Express + Node.js)

- **Entry point**: `server/index.ts` — creates an Express HTTP server, registers routes, and serves static files
- **Routes**: `server/routes.ts` — registers the Telegram bot via `setupBot()`, adds a `/api/health` endpoint, and sets up a keep-alive ping in production
- **Bot logic**: `server/bot.ts` — all Telegram interaction logic including command handlers, food confirmation flow with inline weight-adjustment buttons, water tracking, reminders, and admin controls using `node-telegram-bot-api`
- **AI integration**: `server/openai.ts` — wraps OpenAI GPT-4o for food text analysis, food image analysis, and evening report generation; uses Replit AI Integration environment variables (`AI_INTEGRATIONS_OPENAI_API_KEY` / `AI_INTEGRATIONS_OPENAI_BASE_URL`) so no personal key is needed
- **Storage layer**: `server/storage.ts` — `DatabaseStorage` class implementing the `IStorage` interface with all CRUD operations for users, food logs, and water logs; includes `calculateAndSetGoals()` using the Mifflin-St Jeor equation
- **Database connection**: `server/db.ts` — Drizzle ORM connected to PostgreSQL via `pg` Pool using `DATABASE_URL`

### Frontend (React + Vite)

- Minimal frontend — `client/index.html` renders a simple "Telegram Bot is active" page
- Built with React, Vite, Tailwind CSS, and shadcn/ui (New York style)
- Vite serves as dev server in development and builds to `dist/public` for production
- `@tanstack/react-query` is available for data fetching
- Recharts available for nutrition visualization (charts)

### Shared Layer

- `shared/schema.ts` — Drizzle schema definitions for `users`, `foodLogs`, and `waterLogs` tables; also exports Zod insert schemas
- `shared/models/chat.ts` — schema for `conversations` and `messages` tables (Replit integration boilerplate)
- `shared/routes.ts` — typed API route definitions using Zod

### Database Schema

**users** table:
- Telegram ID, username, approval status, admin flag
- Profile: age, gender, weight (kg), height (cm), activity level, goal
- Computed goals: caloriesGoal, proteinGoal, fatGoal, carbsGoal
- Notification settings: reportTime, breakfastReminder, lunchReminder, dinnerReminder

**foodLogs** table:
- userId (FK), foodName, calories, protein, fat, carbs, weight (g/ml), mealType
- foodScore (1-10), nutritionAdvice, date

**waterLogs** table:
- userId (FK), amount (ml), date

### Build System

- `script/build.ts` — runs Vite build for the client, then esbuild for the server into a single `dist/index.cjs`; bundles key server dependencies (openai, drizzle-orm, pg, xlsx, etc.) while externalizing UI/Radix packages

### Replit Integration Boilerplate

The repo includes `server/replit_integrations/` and `client/replit_integrations/` directories with pre-built utilities for chat, audio (voice recording/playback via AudioWorklet), image generation, and batch processing. These are scaffolding from Replit's AI integration templates and are **not actively used** by the main bot application.

## External Dependencies

### Required Environment Variables
- `TELEGRAM_BOT_TOKEN` — from @BotFather on Telegram (required for bot to start)
- `DATABASE_URL` — PostgreSQL connection string (required; Drizzle will throw on missing)
- `ADMIN_TELEGRAM_ID` — Telegram user ID for admin commands (optional but needed for user management)
- `AI_INTEGRATIONS_OPENAI_API_KEY` and `AI_INTEGRATIONS_OPENAI_BASE_URL` — provided automatically by Replit AI Integrations (no personal OpenAI key needed)
- `REPLIT_DEPLOYMENT_URL` — used in production to set up a keep-alive ping every 4 minutes

### Third-Party Services
- **OpenAI GPT-4o / GPT-4o-mini** — food text analysis, image analysis, evening report generation; accessed via Replit AI Integrations proxy
- **Telegram Bot API** — primary user interface via `node-telegram-bot-api`
- **PostgreSQL** — persistent storage for users, food logs, water logs; provisioned as a Replit database

### Key Libraries
- `drizzle-orm` + `drizzle-kit` — ORM and schema migrations (PostgreSQL dialect)
- `drizzle-zod` — auto-generates Zod schemas from Drizzle tables
- `node-telegram-bot-api` — Telegram bot client with polling
- `exceljs` — Excel file export for food log history
- `xlsx` — additional spreadsheet support (bundled in server build)
- `express` + `express-session` + `connect-pg-simple` — HTTP server and session management
- `react` + `vite` + `tailwindcss` + `shadcn/ui` (Radix UI) — frontend stack
- `@tanstack/react-query` — client-side data fetching
- `recharts` — chart components for nutrition visualization
- `date-fns` — date formatting and manipulation
- `zod` — runtime validation throughout shared layer