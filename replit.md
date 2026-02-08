# Calorie Tracker Bot & Dashboard

This project is a fullstack application with a Telegram bot for tracking nutrition.

## Features
- **Telegram Bot**: Send text or photos of food to get nutrition info automatically.
- **AI Analysis**: Uses OpenAI (GPT-5.2) for text and vision analysis.
- **Dashboard**: Web interface to view daily/weekly stats and logs.
- **Database**: PostgreSQL for storing users and food logs.

## Setup
1. **Telegram Token**: You need to create a bot via @BotFather in Telegram.
2. **Environment Variable**: Set `TELEGRAM_BOT_TOKEN` in the Secrets tab (Tools > Secrets).
3. **OpenAI**: Configured via Replit AI Integrations (no personal key needed).

## Tech Stack
- Frontend: React, Shadcn UI, Recharts
- Backend: Express, Drizzle ORM, Node-Telegram-Bot-API
- AI: OpenAI (GPT-5.2)

## Commands
- `/start` - Start the bot
- Send photo - Analyze food in image
- Send text - Analyze food description
