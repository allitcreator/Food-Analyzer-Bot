# Calorie Tracker Bot & Dashboard

This project is a fullstack application with a Telegram bot for tracking nutrition.

## Features
- **Telegram Bot**: Send text or photos of food to get nutrition info automatically.
- **AI Analysis**: Uses OpenAI (GPT-4o) for text and vision analysis with food scoring.
- **Food Score**: Each food item gets a 1-10 nutritional quality score with advice.
- **Personal Profile**: Users set up age, weight, height, activity level, and goals for personalized KBJU norms (Mifflin-St Jeor equation).
- **Weight Adjustment**: Inline buttons to adjust portion weight/volume before saving.
- **Smart Units**: Liquids automatically measured in ml, solids in grams.
- **Admin Whitelist**: User approval/rejection via ADMIN_TELEGRAM_ID secret.
- **Excel Export**: Detailed breakdown by date, food name, and nutritional values.
- **Water Tracking**: /water command with quick-add buttons (150ml/250ml/500ml), daily progress (goal: 2500ml). Also auto-detects "вода 330мл" text messages.
- **Meal Reminders**: Configurable reminders for breakfast/lunch/dinner via /reminders command with per-meal time selection.
- **Evening Report**: AI-powered daily diet summary with recommendations (food only, no water), configurable notification time.
- **Database**: PostgreSQL for storing users, food logs, and water logs.

## Setup
1. **Telegram Token**: You need to create a bot via @BotFather in Telegram.
2. **Environment Variable**: Set `TELEGRAM_BOT_TOKEN` in the Secrets tab (Tools > Secrets).
3. **OpenAI**: Configured via Replit AI Integrations (no personal key needed).

## Tech Stack
- Frontend: React, Shadcn UI, Recharts
- Backend: Express, Drizzle ORM, Node-Telegram-Bot-API
- AI: OpenAI (GPT-4o)

## Commands
- `/start` - Start the bot
- `/profile` - Set up personal profile for KBJU calculation
- `/stats` - Daily stats with progress towards personal goals
- `/history` - Recent food logs with delete buttons
- `/export DD.MM.YYYY [ - DD.MM.YYYY ]` - Export to Excel
- `/clear DD.MM.YYYY [ - DD.MM.YYYY ]` - Clear history
- `/water` - Water tracking with quick-add buttons
- `/report` - Manual evening report with AI recommendations
- `/report_time` - Set auto-report time (19:00-23:00 or off)
- `/reminders` - Configure meal reminders (breakfast/lunch/dinner)
- `/help` - List all commands
- `/users` - Admin: manage users
- Send photo - Analyze food in image
- Send text - Analyze food description

## Key Architecture
- **server/bot.ts**: Telegram bot logic, profile flow, food confirmation with weight buttons
- **server/openai.ts**: GPT-4o prompts for text and vision food analysis (includes foodScore + nutritionAdvice), evening report generation
- **server/storage.ts**: Database CRUD, Mifflin-St Jeor calorie calculation in calculateAndSetGoals()
- **shared/schema.ts**: Drizzle schema for users (with profile fields, goals & reportTime), foodLogs (with foodScore & nutritionAdvice), and waterLogs
- **Helper functions**: getUnit(), buildConfirmMessage(), buildConfirmKeyboard() in bot.ts to avoid duplication
- **Liquid detection**: LIQUID_PATTERN regex matches beverages for ml vs g display
