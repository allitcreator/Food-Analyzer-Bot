import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupBot, sendAppleHealthConfirmation } from "./bot";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Start the bot
  setupBot(storage, app);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: Date.now() });
  });

  const appleHealthSchema = z.object({
    token: z.string().min(1),
    steps: z.number().int().min(0).optional(),
    active_calories: z.number().int().min(0).optional(),
    workouts: z.array(z.object({
      type: z.string(),
      duration_min: z.number().int().min(0).optional(),
      calories: z.number().int().min(0),
    })).optional(),
  });

  app.post("/api/health/apple", async (req, res) => {
    const parsed = appleHealthSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { token, steps, active_calories, workouts } = parsed.data;

    const user = await storage.getUserByHealthToken(token);
    if (!user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const today = new Date();

    await storage.deleteWorkoutLogsBySource(user.id, today, "apple_health");

    const savedEntries: string[] = [];

    if (workouts && workouts.length > 0) {
      for (const w of workouts) {
        await storage.createWorkoutLog({
          userId: user.id,
          description: w.duration_min ? `${w.type} ${w.duration_min} мин` : w.type,
          workoutType: w.type.toLowerCase(),
          durationMin: w.duration_min ?? null,
          caloriesBurned: w.calories,
          source: "apple_health",
        });
        const label = w.duration_min ? `${w.type} ${w.duration_min} мин — ${w.calories} ккал` : `${w.type} — ${w.calories} ккал`;
        savedEntries.push(label);
      }
    }

    if (steps && steps > 0) {
      const workoutKcal = (workouts ?? []).reduce((s, w) => s + w.calories, 0);
      const stepsCalories = active_calories != null
        ? Math.max(0, active_calories - workoutKcal)
        : Math.round(steps * 0.04);

      await storage.createWorkoutLog({
        userId: user.id,
        description: `${steps.toLocaleString('ru-RU')} шагов`,
        workoutType: "шаги",
        durationMin: null,
        caloriesBurned: stepsCalories,
        source: "apple_health",
      });
      savedEntries.push(`${steps.toLocaleString('ru-RU')} шагов — ${stepsCalories} ккал`);
    }

    if (savedEntries.length === 0) {
      return res.json({ ok: true, message: "No activity to log" });
    }

    await sendAppleHealthConfirmation(user.telegramId!, savedEntries);

    return res.json({ ok: true, logged: savedEntries.length });
  });

  app.get("/api/health/setup/:token", async (req, res) => {
    const { token } = req.params;
    const user = await storage.getUserByHealthToken(token);
    if (!user) {
      return res.status(404).send("Token not found. Generate a new one with /token in the bot.");
    }

    const baseUrl = process.env.REPLIT_DEPLOYMENT_URL
      ? `https://${process.env.REPLIT_DEPLOYMENT_URL}`
      : `${req.protocol}://${req.get("host")}`;
    const webhookUrl = `${baseUrl}/api/health/apple`;

    const jsonPayload = JSON.stringify({
      token,
      steps: "<<Шаги сегодня>>",
      active_calories: "<<Активная энергия>>",
      workouts: [{ type: "<<Тип>>", duration_min: "<<Мин>>", calories: "<<Ккал>>" }]
    }, null, 2);

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Apple Health — настройка синхронизации</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f7; color: #1d1d1f; }
    h1 { font-size: 22px; }
    h2 { font-size: 17px; margin-top: 24px; }
    .card { background: #fff; border-radius: 12px; padding: 16px; margin: 12px 0; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
    .step { display: flex; gap: 12px; align-items: flex-start; margin: 10px 0; }
    .num { background: #007aff; color: #fff; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 14px; }
    code { background: #f0f0f5; padding: 2px 6px; border-radius: 5px; font-size: 14px; word-break: break-all; }
    .copy-box { display: flex; align-items: center; gap: 8px; background: #f0f0f5; border-radius: 8px; padding: 10px 12px; margin: 8px 0; }
    .copy-box span { flex: 1; font-size: 13px; word-break: break-all; font-family: monospace; }
    button { background: #007aff; color: #fff; border: none; border-radius: 8px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
    button:active { background: #0051d4; }
    pre { background: #f0f0f5; border-radius: 8px; padding: 12px; font-size: 12px; overflow-x: auto; }
    .note { color: #6e6e73; font-size: 13px; }
  </style>
</head>
<body>
  <h1>📱 Apple Health → Бот</h1>
  <p class="note">Пошаговая настройка iOS Ярлыка для автоматической синхронизации активности.</p>

  <div class="card">
    <h2>Шаг 1 — Ваш токен</h2>
    <div class="copy-box">
      <span id="token">${token}</span>
      <button onclick="copy('token')">Копировать</button>
    </div>
  </div>

  <div class="card">
    <h2>Шаг 2 — URL вебхука</h2>
    <div class="copy-box">
      <span id="url">${webhookUrl}</span>
      <button onclick="copy('url')">Копировать</button>
    </div>
  </div>

  <div class="card">
    <h2>Шаг 3 — Создайте Ярлык в приложении «Команды»</h2>
    <div class="step"><div class="num">1</div><div>«Найти образцы здоровья» → <b>Шаги</b>, период: Сегодня, агрегат: Сумма → переменная <code>steps</code></div></div>
    <div class="step"><div class="num">2</div><div>«Найти образцы здоровья» → <b>Активная энергия</b>, период: Сегодня, агрегат: Сумма → переменная <code>active_calories</code></div></div>
    <div class="step"><div class="num">3</div><div>«Найти тренировки» → период: Сегодня → переменная <code>workouts</code> (опционально)</div></div>
    <div class="step"><div class="num">4</div><div>«Получить содержимое URL» → метод <b>POST</b>, URL выше, тип: JSON</div></div>
    <p>Пример тела запроса (JSON):</p>
    <div class="copy-box" style="align-items:flex-start">
      <pre id="json" style="margin:0;flex:1">${jsonPayload}</pre>
      <button onclick="copy('json')">Копировать</button>
    </div>
  </div>

  <div class="card">
    <h2>Шаг 4 — Автоматизация</h2>
    <p>Перейдите во вкладку <b>«Автоматизация»</b> → «+» → «Время суток» → <b>22:00</b> → каждый день → выберите созданный Ярлык.</p>
    <p class="note">Данные будут приходить автоматически каждый вечер. При повторной синхронизации дублей не будет.</p>
  </div>

  <script>
    function copy(id) {
      const el = document.getElementById(id);
      navigator.clipboard.writeText(el.innerText || el.textContent).then(() => {
        event.target.textContent = '✓';
        setTimeout(() => event.target.textContent = 'Копировать', 1500);
      });
    }
  </script>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  });

  const REPLIT_DEPLOYMENT_URL = process.env.REPLIT_DEPLOYMENT_URL;
  if (process.env.NODE_ENV === "production" && REPLIT_DEPLOYMENT_URL) {
    const keepAliveUrl = `https://${REPLIT_DEPLOYMENT_URL}/api/health`;
    setInterval(() => {
      fetch(keepAliveUrl).catch(() => {});
    }, 4 * 60 * 1000);
    console.log("Keep-alive ping enabled every 4 minutes");
  }

  return httpServer;
}
