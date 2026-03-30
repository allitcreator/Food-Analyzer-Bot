function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const config = {
  telegramBotToken:  requireEnv("TELEGRAM_BOT_TOKEN"),
  openrouterApiKey:  requireEnv("OPENROUTER_API_KEY"),
  databaseUrl:       requireEnv("DATABASE_URL"),
  sessionSecret:     requireEnv("SESSION_SECRET"),

  adminTelegramId:   optionalEnv("ADMIN_TELEGRAM_ID"),
  webhookUrl:        optionalEnv("WEBHOOK_URL"),
  webhookSecret:     optionalEnv("WEBHOOK_SECRET"),

  port: parseInt(process.env.PORT || "5000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  tz: process.env.TZ || "Europe/Moscow",
};
