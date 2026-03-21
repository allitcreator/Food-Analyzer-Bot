import TelegramBot from "node-telegram-bot-api";
import ExcelJS from "exceljs";
import { IStorage } from "./storage";
import { analyzeFoodText, analyzeFoodImage, generateEveningReport, transcribeVoice, askCoach, detectBarcode, generateWeightAnalysis, classifyIntent, analyzeWorkout, FoodItem } from "./openai";
import { generateMonthlyPDF, extractTopFoods } from "./pdf";
import { User } from "@shared/schema";
import { parseHealthPayload, calcStepsCalories } from "./health-helpers";

const LIQUID_PATTERN = /(сок|вода|чай|кофе|пиво|вино|молоко|кефир|напиток|бульон|суп|кола|пепси|лимонад|смузи|йогурт питьевой|латте|капучино|американо|раф|маккиато|флэт уайт|водка|виски|ром|джин|коньяк|сидр|шампанское|какао|морс|компот|энергетик|квас|мартини|текила|ликёр|абсент|настойка)/i;

let botInstance: TelegramBot | null = null;

function getUnit(foodName: string): string {
  return foodName.toLowerCase().match(LIQUID_PATTERN) ? 'мл' : 'г';
}

function progressBar(current: number, goal: number, length = 10): string {
  const ratio = Math.min(current / goal, 1);
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return `[${('█'.repeat(filled) + '░'.repeat(empty))}] ${Math.round(ratio * 100)}%`;
}

async function lookupBarcodeProduct(barcode: string): Promise<(FoodItem & { barcode: string; foundInDb: boolean }) | null> {
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (data.status !== 1 || !data.product) return null;

    const p = data.product;
    const name: string = p.product_name_ru || p.product_name || p.generic_name_ru || p.generic_name || "";
    if (!name) return null;

    const n = p.nutriments || {};
    const cal100 = n["energy-kcal_100g"]
      ? Math.round(n["energy-kcal_100g"])
      : n["energy_100g"]
        ? Math.round(n["energy_100g"] / 4.184)
        : 0;
    const protein100 = Math.round(n["proteins_100g"] ?? 0);
    const fat100 = Math.round(n["fat_100g"] ?? 0);
    const carbs100 = Math.round(n["carbohydrates_100g"] ?? 0);

    const servingStr: string = p.serving_size || "";
    const servingMatch = servingStr.match(/(\d+)/);
    const weight = servingMatch ? parseInt(servingMatch[1]) : 100;
    const ratio = weight / 100;

    return {
      foodName: name,
      calories: Math.round(cal100 * ratio),
      protein: Math.round(protein100 * ratio),
      fat: Math.round(fat100 * ratio),
      carbs: Math.round(carbs100 * ratio),
      weight,
      mealType: "snack",
      barcode,
      foundInDb: true,
    };
  } catch (err) {
    console.error("Open Food Facts lookup error:", err);
    return null;
  }
}

async function buildDailyProgress(storage: IStorage, userId: number, user: User): Promise<string> {
  const today = new Date();
  const stats = await storage.getDailyStats(userId, today);
  const workouts = await storage.getDailyWorkouts(userId, today);
  const burnedTotal = workouts.reduce((s, w) => s + w.caloriesBurned, 0);
  const netCalories = stats.calories - burnedTotal;

  let text = `\n\n📊 Прогресс за сегодня:\n`;

  if (user.caloriesGoal) {
    const remaining = Math.max(0, user.caloriesGoal - stats.calories);
    text += `🔥 ${stats.calories} / ${user.caloriesGoal} ккал  ${progressBar(stats.calories, user.caloriesGoal)}`;
    text += remaining > 0 ? `  (осталось ${remaining})` : `  ⚠️ норма превышена`;
  } else {
    text += `🔥 Калории: ${stats.calories} ккал`;
  }

  if (burnedTotal > 0) {
    text += `\n🏋️ Сожжено: ${burnedTotal} ккал  →  чистые: ${netCalories} ккал`;
  }

  text += `\n💪 Б: ${stats.protein}г`;
  if (user.proteinGoal) text += ` / ${user.proteinGoal}г`;
  text += `   🧈 Ж: ${stats.fat}г`;
  if (user.fatGoal) text += ` / ${user.fatGoal}г`;
  text += `   🍞 У: ${stats.carbs}г`;
  if (user.carbsGoal) text += ` / ${user.carbsGoal}г`;

  if (user.showMicronutrients && (stats.fiber > 0 || stats.sugar > 0 || stats.sodium > 0 || stats.saturatedFat > 0)) {
    text += `\n🔬 Микро: 🌾${stats.fiber.toFixed(1)}г  🍬${stats.sugar.toFixed(1)}г  🧂${Math.round(stats.sodium)}мг  🧈нас.${stats.saturatedFat.toFixed(1)}г`;
  }

  return text;
}

function buildConfirmMessage(analysis: any, showMicronutrients = false): string {
  const unit = getUnit(analysis.foodName);
  let msg = `🍽 *${analysis.foodName}*\n`;
  msg += `🔥 Ккал: ${analysis.calories}  💪 Б: ${analysis.protein}г  🧈 Ж: ${analysis.fat}г  🍞 У: ${analysis.carbs}г\n`;
  msg += `⚖️ ${unit === 'мл' ? 'Объём' : 'Вес'}: ${analysis.weight}${unit}`;
  if (analysis.foodScore) msg += `\n⭐ Оценка полезности: ${analysis.foodScore}/10`;
  if (showMicronutrients && (analysis.fiber != null || analysis.sugar != null || analysis.sodium != null || analysis.saturatedFat != null)) {
    msg += `\n🔬 Микро: 🌾${analysis.fiber?.toFixed?.(1) ?? '—'}г  🍬${analysis.sugar?.toFixed?.(1) ?? '—'}г  🧂${analysis.sodium != null ? Math.round(analysis.sodium) : '—'}мг  🧈нас.${analysis.saturatedFat?.toFixed?.(1) ?? '—'}г`;
  }
  if (analysis.nutritionAdvice) msg += `\n\n💬 ${analysis.nutritionAdvice}`;
  msg += `\n\nДобавить в дневник?`;
  return msg;
}

function buildConfirmKeyboard(unit: string) {
  return {
    inline_keyboard: [
      [
        { text: "✅ Да", callback_data: "confirm_yes" },
        { text: "❌ Нет", callback_data: "confirm_no" }
      ],
      [
        { text: `-50${unit}`, callback_data: "weight_minus_50" },
        { text: `+50${unit}`, callback_data: "weight_plus_50" }
      ],
      [
        { text: `-100${unit}`, callback_data: "weight_minus_100" },
        { text: `+100${unit}`, callback_data: "weight_plus_100" }
      ]
    ]
  };
}

export function setupBot(storage: IStorage, app?: import("express").Express) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set. Bot will not start.");
    return;
  }

  const isProduction = process.env.NODE_ENV === "production";
  const REPLIT_DEPLOYMENT_URL = process.env.REPLIT_DEPLOYMENT_URL;
  const useWebhook = isProduction && !!REPLIT_DEPLOYMENT_URL && !!app;

  let bot: TelegramBot;

  if (useWebhook) {
    bot = new TelegramBot(token);
    const webhookPath = `/api/telegram-webhook/${token}`;
    const webhookUrl = `https://${REPLIT_DEPLOYMENT_URL}${webhookPath}`;
    bot.setWebHook(webhookUrl).then(() => {
      console.log("Telegram webhook set:", webhookUrl);
    }).catch(err => {
      console.error("Failed to set webhook:", err);
    });
    app.post(webhookPath, (req, res) => {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    });
  } else {
    bot = new TelegramBot(token);
    bot.getWebHookInfo().then(info => {
      if (info.url) {
        console.log(`Production webhook is active (${info.url}). Skipping dev polling to avoid conflicts.`);
        console.log("To test bot in dev, first shut down the published app.");
      } else {
        console.log("No webhook active, starting polling...");
        bot.startPolling();
      }
    }).catch(err => {
      console.error("Failed to check webhook info, starting polling:", err);
      bot.startPolling();
    });
  }

  botInstance = bot;

  // Register bot commands in Telegram menu
  bot.setMyCommands([
    { command: "stats",          description: "Статистика за сегодня + серия дней 🔥" },
    { command: "week",           description: "Разбивка по дням за 7 дней" },
    { command: "month",          description: "Статистика за месяц с графиками" },
    { command: "history",        description: "Последние записи питания" },
    { command: "pdf",            description: "PDF-отчёт с графиками" },
    { command: "export",         description: "Excel-экспорт (дата или диапазон)" },
    { command: "clear",          description: "Удалить записи за дату или диапазон" },
    { command: "weight",         description: "Записать вес / посмотреть историю" },
    { command: "weightreminder", description: "Напоминание взвешиваться" },
    { command: "ask",            description: "Вопрос ИИ-тренеру-нутрициологу" },
    { command: "report",         description: "Вечерний ИИ-отчёт (вручную)" },
    { command: "report_time",    description: "Время авто-отчёта" },
    { command: "reminders",      description: "Настроить напоминания о приёмах пищи" },
    { command: "goal",           description: "Быстро изменить цель (похудение/поддержание/набор)" },
    { command: "profile",        description: "Настроить профиль полностью" },
    { command: "editprofile",    description: "Редактировать поля профиля по одному" },
    { command: "workout",        description: "История тренировок за сегодня" },
    { command: "sync",           description: "Синхронизировать Apple Health" },
    { command: "healthsetup",    description: "Инструкция по настройке Apple Health (Shortcuts)" },
    { command: "settings",       description: "Настройки (микронутриенты и др.)" },
    { command: "help",           description: "Список всех команд" },
  ]).catch(err => console.error("setMyCommands error:", err));

  // Middleware-like check
  const isUserAllowed = async (chatId: number, telegramId: string) => {
    let user = await storage.getUserByTelegramId(telegramId);
    if (!user) {
      return null;
    }
    const isAdmin = ADMIN_TELEGRAM_ID && String(telegramId).trim() === String(ADMIN_TELEGRAM_ID).trim();
    if (!user.isApproved && !user.isAdmin && !isAdmin) {
      bot.sendMessage(chatId, "Ваша заявка на рассмотрении у администратора.");
      return false;
    }
    return user;
  };

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpText = [
      "📋 *Команды бота*\n",
      "🍽 *Питание и статистика*",
      "/stats — Статистика за сегодня + серия дней 🔥",
      "/week — Разбивка по дням за 7 дней",
      "/month — Статистика за месяц с графиками",
      "/history — Последние записи питания",
      "/pdf — PDF-отчёт с графиками за месяц",
      "/export ДД.ММ.ГГГГ \\[ - ДД.ММ.ГГГГ\\] — Excel-экспорт",
      "/clear ДД.ММ.ГГГГ \\[ - ДД.ММ.ГГГГ\\] — Удалить записи",
      "",
      "⚖️ *Вес*",
      "/weight \\[кг\\] — Записать вес / посмотреть историю и тренд",
      "/weightreminder — Настроить напоминание взвешиваться",
      "",
      "👤 *Профиль и цели*",
      "/profile — Настроить профиль полностью",
      "/editprofile — Редактировать поля профиля по одному",
      "/workout — Тренировки сегодня \\+ история",
      "/sync — Синхронизировать Apple Health (запустить шорткат)",
      "/healthsetup — Инструкция по настройке шортката Apple Health",
      "/settings — Настройки (микронутриенты и др.)",
      "/goal — Быстро изменить цель (похудение / поддержание / набор)",
      "",
      "🤖 *ИИ-ассистент*",
      "/ask \\[вопрос\\] — Вопрос тренеру-нутрициологу с контекстом дня",
      "/report — Вечерний ИИ-анализ питания (вручную)",
      "/report\\_time — Время авто-отчёта",
      "",
      "⏰ *Напоминания*",
      "/reminders — Завтрак / обед / ужин + «нет записей»",
      "/weightreminder — Напоминание взвеситься",
      "",
      "🔧 *Админ*",
      "/users — Управление пользователями",
      "",
      "💬 *Распознавание еды*",
      "Отправьте текст, фото блюда, голосовое сообщение или фото штрихкода — бот распознает и посчитает КБЖУ автоматически."
    ].join("\n");
    bot.sendMessage(chatId, helpText, { parse_mode: "Markdown" });
  });

  bot.onText(/^\/sync(@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    bot.sendMessage(chatId,
      `📱 *Синхронизация Apple Health*\n\nНажмите кнопку ниже — откроется шорткат "HealthSync" на iPhone.\n\nShortcuts соберёт данные и откроет Telegram с готовым сообщением. Просто нажмите *Отправить* — и всё готово.\n\n_Нет шортката? Используйте /healthsetup для инструкции по настройке._`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🍎 Запустить HealthSync", url: "shortcuts://run-shortcut?name=HealthSync" }]
          ]
        }
      }
    );
  });

  bot.onText(/^\/healthsetup(@\w+)?$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const me = await bot.getMe().catch(() => null);
    const botName = me?.username ?? "ВАШ_БОТ";

    const text = [
      `📱 *Настройка Apple Health*`,
      ``,
      `*Как это работает:*`,
      `1. /sync → кнопка "Запустить HealthSync"`,
      `2. Открывается шорткат на iPhone`,
      `3. Шорткат собирает данные и открывает Telegram`,
      `4. Нажмите *Отправить* — данные сохранены ✅`,
      ``,
      `*Создайте ярлык "HealthSync":*`,
      `В приложении «Команды» («+») добавьте действия:`,
      ``,
      `1️⃣ «Найти образцы здоровья» → Шаги → Сегодня → Сумма`,
      `2️⃣ «Найти образцы здоровья» → Активная энергия → Сегодня → Сумма`,
      `3️⃣ (опц.) «Найти тренировки» → Сегодня`,
      `4️⃣ «Текст» — введите JSON, вставив переменные из шагов 1–2:`,
      `\`{"steps":8000,"active_calories":320}\``,
      ``,
      `Если хотите добавить тренировки (шаг 3️⃣), расширьте JSON:`,
      `\`{"steps":8000,"active_calories":430,"workouts":[{"type":"Бег","duration_min":30,"calories":280}]}\``,
      ``,
      `5️⃣ «Открыть URL» — вставьте ссылку:`,
      `\`tg://resolve?domain=${botName}&text=/health+JSON\``,
      `(Вместо JSON подставьте переменную «Текст» из шага 4️⃣)`,
      ``,
      `Назовите ярлык: *HealthSync* и сохраните.`,
      ``,
      `*Формат JSON для команды /health:*`,
      `• \`steps\` — шаги за день (целое число)`,
      `• \`active_calories\` — активные калории (целое число)`,
      `• \`workouts\` — массив тренировок (опц.):`,
      `  – \`type\` — название (строка, обязательно)`,
      `  – \`calories\` — сожжено ккал (обязательно)`,
      `  – \`duration_min\` — длительность в минутах (опц.)`,
      ``,
      `*Автоматизация (опц.):*`,
      `«Автоматизация» → «+» → «Время суток» → 22:00 → HealthSync`,
    ].join("\n");

    bot.sendMessage(chatId, text, { parse_mode: "Markdown" }).catch(err => {
      console.error("/healthsetup sendMessage error:", err?.response?.body ?? err);
      bot.sendMessage(chatId, text.replace(/[`*_]/g, ""));
    });
  });

  bot.onText(/^\/health(@\w+)?(?:\s+([\s\S]+))?$/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const jsonText = match?.[2]?.trim();
    if (!jsonText) {
      bot.sendMessage(chatId, "Используйте /sync для запуска синхронизации Apple Health.");
      return;
    }

    const parsed = parseHealthPayload(jsonText);
    if (!parsed.ok) {
      const msgs: Record<string, string> = {
        invalid_json: "❌ Неверный JSON. Используйте /sync — Shortcuts отправит правильный формат.",
        not_object: "❌ Неверный формат данных.",
        invalid_steps: "❌ Поле `steps` должно быть неотрицательным числом.",
        invalid_active_calories: "❌ Поле `active_calories` должно быть неотрицательным числом.",
        workouts_not_array: "❌ Поле `workouts` должно быть массивом.",
        workout_not_object: "❌ Каждая тренировка в `workouts` должна быть объектом.",
        workout_missing_type: "❌ У каждой тренировки должно быть поле `type` (строка).",
        workout_invalid_calories: "❌ У каждой тренировки должно быть поле `calories` (неотрицательное число).",
        workout_invalid_duration: "❌ Поле `duration_min` тренировки должно быть положительным числом.",
        no_storable_data: "❌ Нет данных для сохранения. Нужны `steps` (> 0) или непустой `workouts`. `active_calories` без шагов не сохраняется.",
      };
      bot.sendMessage(chatId, msgs[parsed.error] ?? "❌ Ошибка в данных. Используйте /sync для синхронизации.");
      return;
    }

    const { steps, activeCalories, workouts } = parsed.payload;

    const today = new Date();
    await storage.deleteWorkoutLogsBySource(user.id, today, "apple_health");

    const savedLabels: string[] = [];

    for (const w of workouts) {
      const description = w.durationMin ? `${w.type} ${w.durationMin} мин` : w.type;
      await storage.createWorkoutLog({
        userId: user.id,
        description,
        workoutType: w.type.toLowerCase(),
        durationMin: w.durationMin,
        caloriesBurned: w.calories,
        source: "apple_health",
      });
      savedLabels.push(w.durationMin
        ? `${w.type} ${w.durationMin} мин — ${w.calories} ккал`
        : `${w.type} — ${w.calories} ккал`);
    }

    if (steps !== null && steps > 0) {
      const workoutKcal = workouts.reduce((s, w) => s + w.calories, 0);
      const stepsKcal = calcStepsCalories(steps, activeCalories, workoutKcal);

      await storage.createWorkoutLog({
        userId: user.id,
        description: `${steps.toLocaleString("ru-RU")} шагов`,
        workoutType: "шаги",
        durationMin: null,
        caloriesBurned: stepsKcal,
        source: "apple_health",
      });
      savedLabels.push(`${steps.toLocaleString("ru-RU")} шагов — ${stepsKcal} ккал`);
    }

    if (savedLabels.length === 0) {
      bot.sendMessage(chatId, "Нет активности для сохранения. Проверьте переданные данные.");
      return;
    }

    const list = savedLabels.map(l => `  • ${l}`).join("\n");
    const totalKcal = savedLabels.reduce((sum, l) => {
      const m = l.match(/(\d+)\s*ккал/);
      return sum + (m ? parseInt(m[1]) : 0);
    }, 0);

    bot.sendMessage(chatId,
      `📲 *Apple Health синхронизация*\n\n${list}\n\n⚡️ Итого сожжено: *${totalKcal} ккал*`,
      { parse_mode: "Markdown" }
    );
  });

  bot.onText(/\/ask(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const question = match?.[1]?.trim();
    if (!question) {
      bot.sendMessage(chatId,
        "🏋️ Задайте вопрос тренеру:\n\n" +
        "/ask сколько можно съесть на ужин?\n" +
        "/ask чем заменить творог?\n" +
        "/ask хватит ли мне белка сегодня?\n" +
        "/ask что лучше съесть перед тренировкой?"
      );
      return;
    }

    const thinking = await bot.sendMessage(chatId, "🤔 Думаю...");

    const today = new Date();
    const startOfDay = new Date(today); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(today); endOfDay.setHours(23, 59, 59, 999);
    const logs = await storage.getFoodLogsInRange(user.id, startOfDay, endOfDay);
    const stats = await storage.getDailyStats(user.id, today);

    const todayLog = logs.map(f => ({
      foodName: f.foodName,
      calories: f.calories,
      protein: f.protein,
      fat: f.fat,
      carbs: f.carbs,
      weight: f.weight
    }));

    const answer = await askCoach(question, user, todayLog, stats);

    await bot.deleteMessage(chatId, thinking.message_id).catch(() => {});

    if (!answer) {
      bot.sendMessage(chatId, "Не удалось получить ответ. Попробуйте ещё раз.");
      return;
    }

    bot.sendMessage(chatId, `🏋️ *Тренер:*\n\n${answer}`, { parse_mode: "Markdown" });
  });

  const userStates: Record<string, { step: string; data: Partial<User> & { reminderMeal?: string } }> = {};
  const pendingMulti: Record<string, FoodItem[]> = {};
  const pendingWorkouts: Record<string, { description: string; workoutType: string; durationMin: number | null; caloriesBurned: number }> = {};

  const MEAL_EMOJI: Record<string, string> = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍎' };

  function buildMultiSummaryText(items: FoodItem[]): string {
    let text = `🍽 Распознано ${items.length} позиций:\n\n`;
    let totalCal = 0, totalP = 0, totalF = 0, totalC = 0;
    items.forEach((item, i) => {
      const unit = item.foodName.toLowerCase().match(LIQUID_PATTERN) ? 'мл' : 'г';
      const emoji = MEAL_EMOJI[item.mealType] || '🍴';
      text += `${i + 1}. ${emoji} ${item.foodName} (${item.weight}${unit})\n`;
      text += `   ${item.calories} ккал | Б${item.protein} Ж${item.fat} У${item.carbs}\n\n`;
      totalCal += item.calories;
      totalP += item.protein;
      totalF += item.fat;
      totalC += item.carbs;
    });
    text += `──────────────\n`;
    text += `📊 Итого: ${totalCal} ккал | Б${totalP} Ж${totalF} У${totalC}`;
    return text;
  }

  function buildMultiSummaryKeyboard(items: FoodItem[]) {
    const editButtons = items.map((item, i) => {
      const short = item.foodName.length > 22 ? item.foodName.slice(0, 21) + '…' : item.foodName;
      return [{ text: `✏️ ${i + 1}. ${short}`, callback_data: `mi_e_${i}` }];
    });
    return {
      inline_keyboard: [
        ...editButtons,
        [
          { text: `✅ Сохранить все (${items.length})`, callback_data: 'save_all' },
          { text: '❌ Отмена', callback_data: 'cancel_multi' }
        ]
      ]
    };
  }

  function buildMultiItemEditorText(item: FoodItem, idx: number, total: number): string {
    const unit = item.foodName.toLowerCase().match(LIQUID_PATTERN) ? 'мл' : 'г';
    const emoji = MEAL_EMOJI[item.mealType] || '🍴';
    return `✏️ Редактирование ${idx + 1}/${total}\n\n${emoji} ${item.foodName}\n${item.calories} ккал | Б${item.protein}г Ж${item.fat}г У${item.carbs}г\nВес: ${item.weight}${unit}`;
  }

  function buildMultiItemEditorKeyboard(idx: number, unit: string) {
    return {
      inline_keyboard: [
        [
          { text: `-50${unit}`, callback_data: `mi_wm_50_${idx}` },
          { text: `-10${unit}`, callback_data: `mi_wm_10_${idx}` },
          { text: `+10${unit}`, callback_data: `mi_wp_10_${idx}` },
          { text: `+50${unit}`, callback_data: `mi_wp_50_${idx}` },
        ],
        [
          { text: `-100${unit}`, callback_data: `mi_wm_100_${idx}` },
          { text: `+100${unit}`, callback_data: `mi_wp_100_${idx}` },
        ],
        [
          { text: '⬅️ К списку', callback_data: 'mi_back' },
          { text: '🗑 Удалить', callback_data: `mi_del_${idx}` }
        ]
      ]
    };
  }

  async function processFoodItems(chatId: number, telegramId: string, items: FoodItem[]) {
    if (items.length === 1) {
      (bot as any).pendingLogs = (bot as any).pendingLogs || {};
      (bot as any).pendingLogs[telegramId] = items[0];
      const unit = getUnit(items[0].foodName);
      const u = await storage.getUserByTelegramId(telegramId);
      bot.sendMessage(chatId, buildConfirmMessage(items[0], u?.showMicronutrients ?? false), {
        parse_mode: 'Markdown',
        reply_markup: buildConfirmKeyboard(unit)
      });
    } else {
      pendingMulti[telegramId] = items;
      bot.sendMessage(chatId, buildMultiSummaryText(items), {
        reply_markup: buildMultiSummaryKeyboard(items)
      });
    }
  }

  function startProfileFlow(chatId: number, telegramId: string) {
    userStates[telegramId] = { step: 'gender', data: {} };
    bot.sendMessage(chatId, "Давайте настроим ваш профиль для расчета норм КБЖУ.\n\nВаш пол:", {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Мужской", callback_data: "set_gender_male" },
            { text: "Женский", callback_data: "set_gender_female" }
          ]
        ]
      }
    });
  }

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    const username = msg.from?.username;

    if (!telegramId) return;

    let user = await storage.getUserByTelegramId(telegramId);
    const isGlobalAdmin = ADMIN_TELEGRAM_ID && String(telegramId).trim() === String(ADMIN_TELEGRAM_ID).trim();

    if (!user) {
      user = await storage.createUser({ 
        telegramId, 
        username, 
        isApproved: !!isGlobalAdmin, 
        isAdmin: !!isGlobalAdmin 
      });

      if (isGlobalAdmin) {
        bot.sendMessage(chatId, "Вы зарегистрированы как администратор (через секреты).");
      } else {
        bot.sendMessage(chatId, "Ваша заявка отправлена администратору. Ожидайте подтверждения.");
        // Notify admins
        const allUsers = await storage.getAllUsers();
        const admins = allUsers.filter(u => u.isAdmin || (ADMIN_TELEGRAM_ID && String(u.telegramId).trim() === String(ADMIN_TELEGRAM_ID).trim()));
        for (const admin of admins) {
          bot.sendMessage(admin.telegramId!, `Новый пользователь @${username} (ID: ${user.id}) хочет зайти.`, {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "✅ Одобрить", callback_data: `admin_approve_${user.id}` },
                  { text: "❌ Отклонить", callback_data: `admin_reject_${user.id}` }
                ]
              ]
            }
          });
        }
      }
    } else if (isGlobalAdmin && !user.isAdmin) {
      // Upgrade existing user to admin if their ID matches secrets
      user = await storage.updateUser(user.id, { isAdmin: true, isApproved: true });
      bot.sendMessage(chatId, "Ваш аккаунт обновлен до статуса администратора.");
    }

    if (user.isApproved || user.isAdmin || isGlobalAdmin) {
      const hasProfile = user.age && user.weight && user.height;
      if (hasProfile) {
        bot.sendMessage(chatId, "Привет! Я помогу тебе считать калории. Отправь мне фото еды или напиши, что ты съел (например, 'яблоко 100г').\n\nКоманды:\n/stats - статистика за сегодня\n/history - последние записи\n/export ДД.ММ.ГГГГ [ - ДД.ММ.ГГГГ ] - выгрузка в Excel\n/clear ДД.ММ.ГГГГ [ - ДД.ММ.ГГГГ ] - очистка истории");
      } else {
        bot.sendMessage(chatId, "Привет! Я помогу тебе считать калории.\n\nДля начала давайте настроим ваш профиль, чтобы рассчитать персональные нормы КБЖУ.");
        setTimeout(() => startProfileFlow(chatId, telegramId), 500);
      }
    }
  });

  // Admin Commands
  bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await storage.getUserByTelegramId(telegramId);
    const isGlobalAdmin = ADMIN_TELEGRAM_ID && String(telegramId).trim() === String(ADMIN_TELEGRAM_ID).trim();
    if (!user?.isAdmin && !isGlobalAdmin) return;

    const allUsers = await storage.getAllUsers();
    if (allUsers.length === 0) {
      bot.sendMessage(chatId, "Пользователей нет.");
      return;
    }

    let text = "Список пользователей:\n";
    allUsers.forEach(u => {
      const isUAdmin = u.isAdmin || (ADMIN_TELEGRAM_ID && String(u.telegramId).trim() === String(ADMIN_TELEGRAM_ID).trim());
      text += `${u.id}: @${u.username || 'N/A'} [${u.isApproved ? '✅' : '⏳'}] ${isUAdmin ? '(Admin)' : ''}\n`;
    });
    bot.sendMessage(chatId, text, {
      reply_markup: {
        inline_keyboard: allUsers
          .filter(u => u.telegramId !== telegramId) // Don't allow self-deletion
          .map(u => [{ text: `❌ Удалить @${u.username || u.id}`, callback_data: `admin_delete_${u.id}` }])
      }
    });
  });

  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const today = new Date();
    const [stats, streak, workouts] = await Promise.all([
      storage.getDailyStats(user.id, today),
      storage.getStreak(user.id),
      storage.getDailyWorkouts(user.id, today),
    ]);

    let text = `📊 Статистика за сегодня\n`;

    if (streak > 0) {
      const streakEmoji = streak >= 14 ? '🏆' : streak >= 7 ? '🔥🔥' : '🔥';
      text += `${streakEmoji} Стрик: ${streak} ${streak === 1 ? 'день' : streak < 5 ? 'дня' : 'дней'} подряд\n`;
    }

    text += '\n';

    if (user.caloriesGoal) {
      text += `🔥 Калории: ${stats.calories} / ${user.caloriesGoal} ккал\n`;
      text += `${progressBar(stats.calories, user.caloriesGoal)}\n\n`;
    } else {
      text += `🔥 Калории: ${stats.calories} ккал\n\n`;
    }

    text += `💪 Белки:    ${stats.protein}г${user.proteinGoal ? ` / ${user.proteinGoal}г` : ''}\n`;
    text += `🧈 Жиры:     ${stats.fat}г${user.fatGoal ? ` / ${user.fatGoal}г` : ''}\n`;
    text += `🍞 Углеводы: ${stats.carbs}г${user.carbsGoal ? ` / ${user.carbsGoal}г` : ''}`;

    if (workouts.length > 0) {
      const burnedTotal = workouts.reduce((s, w) => s + w.caloriesBurned, 0);
      const netCalories = stats.calories - burnedTotal;
      text += `\n\n🏋️ Тренировки сегодня:\n`;
      workouts.forEach(w => {
        text += `  • ${w.description} — ${w.caloriesBurned} ккал\n`;
      });
      text += `⚖️ Чистые калории: ${netCalories} ккал (съедено − сожжено)`;
    }

    if (user.showMicronutrients) {
      const hasMicro = stats.fiber > 0 || stats.sugar > 0 || stats.sodium > 0 || stats.saturatedFat > 0;
      text += `\n\n🔬 Микронутриенты:\n`;
      text += hasMicro
        ? `🌾 Клетчатка:  ${stats.fiber.toFixed(1)}г${stats.fiber > 0 ? '' : '  (нет данных)'}\n`
        + `🍬 Сахар:      ${stats.sugar.toFixed(1)}г\n`
        + `🧂 Натрий:     ${Math.round(stats.sodium)} мг\n`
        + `🧈 Нас. жиры:  ${stats.saturatedFat.toFixed(1)}г`
        : `(нет данных — логируй еду сегодня)`;
    }

    bot.sendMessage(chatId, text);
  });

  bot.onText(/\/week/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;
    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const days = await storage.getWeeklyFullStats(user.id);
    const daysWithData = days.filter(d => d.calories > 0);
    const avgCal = daysWithData.length
      ? Math.round(daysWithData.reduce((s, d) => s + d.calories, 0) / daysWithData.length)
      : 0;

    let text = `📅 Статистика за 7 дней\n\n`;
    for (const d of days) {
      if (d.calories === 0) {
        text += `${d.dayLabel}  —\n`;
      } else {
        const bar = user.caloriesGoal
          ? `  ${progressBar(d.calories, user.caloriesGoal, 8)}`
          : '';
        text += `${d.dayLabel}  ${d.calories} ккал${bar}\n`;
        text += `   Б${d.protein} Ж${d.fat} У${d.carbs}\n`;
      }
    }

    text += `\n📊 Среднее: ${avgCal} ккал/день (${daysWithData.length}/7 дней с данными)`;

    if (user.caloriesGoal && avgCal > 0) {
      const diff = avgCal - user.caloriesGoal;
      text += diff > 0
        ? `\n⚠️ В среднем превышение на ${diff} ккал/день`
        : `\n✅ В среднем дефицит ${Math.abs(diff)} ккал/день`;
    }

    bot.sendMessage(chatId, text);
  });

  bot.onText(/\/goal/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;
    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const goalLabels: Record<string, string> = { lose: 'Похудение', maintain: 'Поддержание', gain: 'Набор массы' };
    const current = user.goal ? `Текущая цель: ${goalLabels[user.goal] ?? user.goal}\n\n` : '';

    bot.sendMessage(chatId, `${current}Выберите новую цель:`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: `🔥 Похудение${user.goal === 'lose' ? ' ✓' : ''}`, callback_data: 'goal_lose' },
            { text: `⚖️ Поддержание${user.goal === 'maintain' ? ' ✓' : ''}`, callback_data: 'goal_maintain' },
            { text: `💪 Набор массы${user.goal === 'gain' ? ' ✓' : ''}`, callback_data: 'goal_gain' },
          ]
        ]
      }
    });
  });

  // ─── /weight ──────────────────────────────────────────────────────────────
  bot.onText(/\/weight(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;
    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const arg = match?.[1]?.trim();

    if (arg) {
      const val = parseFloat(arg.replace(',', '.'));
      if (isNaN(val) || val < 20 || val > 500) {
        bot.sendMessage(chatId, "Укажите корректный вес в кг, например: /weight 74.5");
        return;
      }
      await storage.logWeight(user.id, Math.round(val * 10) / 10);
      await storage.updateUser(user.id, { weight: Math.round(val) });

      const logs = await storage.getWeightLogs(user.id, 7);
      const sorted = [...logs].sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());
      let deltaStr = '';
      if (sorted.length >= 2) {
        const delta = sorted[sorted.length - 1].weight - sorted[0].weight;
        deltaStr = `\n(${delta > 0 ? '+' : ''}${delta.toFixed(1)} кг за ${sorted.length} замеров)`;
      }
      bot.sendMessage(chatId, `⚖️ Вес записан: ${val.toFixed(1)} кг${deltaStr}`);
    } else {
      const logs = await storage.getWeightLogs(user.id, 10);
      if (logs.length === 0) {
        bot.sendMessage(chatId,
          "Нет записей о весе.\n\nЗапишите: /weight 75.0\n\nНастроить напоминание взвешиваться: /weightreminder");
        return;
      }
      const sorted = [...logs].sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());
      const lines = sorted.map(l => {
        const d = new Date(l.date!);
        const dl = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
        return `${dl}: ${l.weight.toFixed(1)} кг`;
      });
      const first = sorted[0].weight, last = sorted[sorted.length - 1].weight;
      const delta = last - first;
      const deltaStr = (delta > 0 ? '+' : '') + delta.toFixed(1) + ' кг';
      const trend = delta < -0.1 ? '📉' : delta > 0.1 ? '📈' : '➡️';
      bot.sendMessage(chatId, `⚖️ История веса:\n\n${lines.join('\n')}\n\n${trend} Изменение: ${deltaStr}`, {
        reply_markup: {
          inline_keyboard: [[
            { text: '📊 Недельный анализ', callback_data: 'weight_analysis' },
            { text: '⏰ Напоминание', callback_data: 'weight_reminder_setup' }
          ]]
        }
      });
    }
  });

  // ─── /weightreminder ──────────────────────────────────────────────────────
  bot.onText(/\/weightreminder/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;
    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;
    sendWeightReminderSetup(chatId, user);
  });

  function sendWeightReminderSetup(chatId: number, user: User) {
    const t = user.weightReminderTime || 'off';
    const days = user.weightReminderDays ? user.weightReminderDays.split(',').filter(Boolean).map(Number) : [];
    const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const daysStr = days.length > 0 ? days.map(d => DAY_NAMES[d]).join(', ') : 'все дни';
    const timeStr = t === 'off' ? 'выкл' : t;
    bot.sendMessage(chatId,
      `⚖️ Напоминание взвеситься:\nВремя: ${timeStr}\nДни: ${daysStr}\n\nВыберите время:`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '07:00', callback_data: 'wrem_t_07:00' }, { text: '08:00', callback_data: 'wrem_t_08:00' }, { text: '09:00', callback_data: 'wrem_t_09:00' }],
          [{ text: 'Своё время', callback_data: 'wrem_t_custom' }, { text: 'Выкл', callback_data: 'wrem_t_off' }],
          [{ text: '━━ Дни недели ━━', callback_data: 'wrem_ignore' }],
          [
            { text: `Пн${days.includes(1) ? '✓' : ''}`, callback_data: 'wrem_d_1' },
            { text: `Вт${days.includes(2) ? '✓' : ''}`, callback_data: 'wrem_d_2' },
            { text: `Ср${days.includes(3) ? '✓' : ''}`, callback_data: 'wrem_d_3' },
            { text: `Чт${days.includes(4) ? '✓' : ''}`, callback_data: 'wrem_d_4' },
          ],
          [
            { text: `Пт${days.includes(5) ? '✓' : ''}`, callback_data: 'wrem_d_5' },
            { text: `Сб${days.includes(6) ? '✓' : ''}`, callback_data: 'wrem_d_6' },
            { text: `Вс${days.includes(0) ? '✓' : ''}`, callback_data: 'wrem_d_0' },
            { text: 'Каждый день', callback_data: 'wrem_d_all' },
          ]
        ]
      }
    });
  }

  // ─── /workout ─────────────────────────────────────────────────────────────
  bot.onText(/\/workout/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;
    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const workouts = await storage.getDailyWorkouts(user.id, new Date());
    if (workouts.length === 0) {
      bot.sendMessage(chatId,
        `🏋️ Сегодня тренировок нет.\n\nПросто напиши что делал — например:\n• *"пробежал 5 км"*\n• *"30 мин на эллипсе"*\n• *"прошёл 10000 шагов"*\n• *"потратил 500 ккал на тренировке"*`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const total = workouts.reduce((s, w) => s + w.caloriesBurned, 0);
    let text = `🏋️ *Тренировки сегодня:*\n\n`;
    workouts.forEach(w => {
      const dur = w.durationMin ? ` · ${w.durationMin} мин` : '';
      text += `• ${w.description}${dur} — *${w.caloriesBurned} ккал*\n`;
    });
    text += `\n🔥 Итого сожжено: *${total} ккал*`;

    const stats = await storage.getDailyStats(user.id, new Date());
    const net = stats.calories - total;
    text += `\n⚖️ Чистые калории за день: *${net} ккал* (съедено ${stats.calories} − сожжено ${total})`;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });

  // ─── /settings ────────────────────────────────────────────────────────────
  bot.onText(/\/settings/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;
    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const on = user.showMicronutrients;
    bot.sendMessage(chatId,
      `⚙️ *Настройки*\n\n🔬 Микронутриенты (клетчатка, сахар, натрий, нас. жиры): *${on ? 'Включены ✅' : 'Выключены ❌'}*\n\nПри включении ИИ будет дополнительно рассчитывать клетчатку, сахар, натрий и насыщенные жиры для каждого продукта.`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: on ? '❌ Выключить микронутриенты' : '✅ Включить микронутриенты', callback_data: 'toggle_micro' }
          ]]
        }
      }
    );
  });

  // ─── /editprofile ─────────────────────────────────────────────────────────
  bot.onText(/\/editprofile/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;
    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const ACT_LABEL: Record<string, string> = {
      sedentary: 'Сидячий', light: 'Лёгкая', moderate: 'Умеренная', active: 'Активный', very_active: 'Очень активный'
    };
    const GOAL_LABEL: Record<string, string> = { lose: 'Похудение', maintain: 'Поддержание', gain: 'Набор' };

    bot.sendMessage(chatId,
      `Редактирование профиля:\n\nВозраст: ${user.age ?? '—'}\nВес: ${user.weight ?? '—'} кг\nРост: ${user.height ?? '—'} см\nАктивность: ${user.activityLevel ? ACT_LABEL[user.activityLevel] : '—'}\nЦель: ${user.goal ? GOAL_LABEL[user.goal] : '—'}\nНорма калорий: ${user.caloriesGoal ?? '—'}\n\nЧто изменить?`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: `🎂 Возраст (${user.age ?? '—'})`, callback_data: 'ep_age' }, { text: `⚖️ Вес (${user.weight ?? '—'} кг)`, callback_data: 'ep_weight' }],
          [{ text: `📏 Рост (${user.height ?? '—'} см)`, callback_data: 'ep_height' }, { text: `⚡ Активность`, callback_data: 'ep_activity' }],
          [{ text: `🎯 Цель`, callback_data: 'ep_goal' }, { text: `🔥 Калории вручную`, callback_data: 'ep_calories' }],
          [{ text: '♻️ Пересчитать нормы', callback_data: 'ep_recalc' }]
        ]
      }
    });
  });

  // ─── /month ───────────────────────────────────────────────────────────────
  bot.onText(/\/month/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;
    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    bot.sendMessage(chatId, "Собираю статистику за месяц...");
    const weeks = await storage.getMonthlyStats(user.id);

    const totalDays = weeks.reduce((s, w) => s + w.days, 0);
    if (totalDays === 0) {
      bot.sendMessage(chatId, "Нет данных за последний месяц. Начни записывать еду!");
      return;
    }

    const overall = weeks.filter(w => w.days > 0);
    const avgCal = Math.round(overall.reduce((s, w) => s + w.calories, 0) / overall.length);
    const avgProt = Math.round(overall.reduce((s, w) => s + w.protein, 0) / overall.length);
    const avgFat = Math.round(overall.reduce((s, w) => s + w.fat, 0) / overall.length);
    const avgCarbs = Math.round(overall.reduce((s, w) => s + w.carbs, 0) / overall.length);

    const goalCalMsg = user.caloriesGoal
      ? (avgCal >= user.caloriesGoal * 0.9 && avgCal <= user.caloriesGoal * 1.1
        ? '✅ В норме' : avgCal < user.caloriesGoal * 0.9 ? '⬇️ Ниже нормы' : '⬆️ Выше нормы')
      : '';

    const weekLines = weeks.map(w =>
      w.days === 0
        ? `📅 ${w.weekLabel}: нет данных`
        : `📅 ${w.weekLabel} (${w.days}д): ${w.calories} ккал | Б${w.protein} Ж${w.fat} У${w.carbs}`
    ).join('\n');

    const msg2 = [
      `📅 Статистика за месяц:\n`,
      weekLines,
      `\n📊 В среднем в день:`,
      `Калории: ${avgCal} ккал ${goalCalMsg}`,
      `Белки: ${avgProt}г | Жиры: ${avgFat}г | Углеводы: ${avgCarbs}г`,
      `\n📆 Дней залогировано: ${totalDays} из 28`,
      user.caloriesGoal ? `🎯 Ваша норма: ${user.caloriesGoal} ккал` : '',
    ].filter(Boolean).join('\n');

    bot.sendMessage(chatId, msg2, {
      reply_markup: {
        inline_keyboard: [[{ text: '📄 Скачать PDF-отчёт', callback_data: 'generate_pdf' }]]
      }
    });
  });

  // ─── /pdf ─────────────────────────────────────────────────────────────────
  bot.onText(/\/pdf/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;
    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;
    await sendPDFReport(chatId, user);
  });

  async function sendPDFReport(chatId: number, user: User) {
    bot.sendMessage(chatId, "Генерирую PDF-отчёт...");
    try {
      const today = new Date();
      const monthStart = new Date(today); monthStart.setDate(today.getDate() - 27); monthStart.setHours(0, 0, 0, 0);
      monthStart.setHours(0, 0, 0, 0);

      const [weeklyStats, dailyStats, allLogs, weightLogs] = await Promise.all([
        storage.getMonthlyStats(user.id),
        storage.getWeeklyFullStats(user.id),
        storage.getFoodLogsInRange(user.id, monthStart, today),
        storage.getWeightLogs(user.id, 30),
      ]);

      const sortedWeightLogs = [...weightLogs].sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());
      const topFoods = extractTopFoods(allLogs);
      const pdfBuffer = await generateMonthlyPDF(user, weeklyStats, dailyStats, sortedWeightLogs, topFoods);

      const monthName = today.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
      await bot.sendDocument(chatId, pdfBuffer, {
        caption: `📄 Отчёт о питании — ${monthName}`
      }, {
        filename: `nutrition_report_${today.toISOString().slice(0, 7)}.pdf`,
        contentType: 'application/pdf'
      });
    } catch (err) {
      console.error("PDF generation error:", err);
      bot.sendMessage(chatId, "Не удалось сгенерировать отчёт. Попробуйте позже.");
    }
  }

  async function sendEveningReport(user: User, manual = false) {
    const today = new Date();
    const stats = await storage.getDailyStats(user.id, today);
    const foodLogs = await storage.getFoodLogsInRange(user.id, (() => { const d = new Date(today); d.setHours(0,0,0,0); return d; })(), (() => { const d = new Date(today); d.setHours(23,59,59,999); return d; })());

    if (foodLogs.length === 0 && !manual) return;

    if (foodLogs.length === 0) {
      bot.sendMessage(user.telegramId!, "За сегодня нет записей о еде. Отчёт не сформирован.");
      return;
    }

    const report = await generateEveningReport(
      foodLogs.map(f => ({ foodName: f.foodName, calories: f.calories, protein: f.protein, fat: f.fat, carbs: f.carbs, weight: f.weight, foodScore: f.foodScore })),
      { calories: stats.calories, protein: stats.protein, fat: stats.fat, carbs: stats.carbs },
      { caloriesGoal: user.caloriesGoal, proteinGoal: user.proteinGoal, fatGoal: user.fatGoal, carbsGoal: user.carbsGoal }
    );

    if (report) {
      let text = `📊 Вечерний отчёт\n\n`;
      text += `Итого за день: ${stats.calories} ккал | Б${stats.protein}г Ж${stats.fat}г У${stats.carbs}г\n\n`;
      text += report;
      bot.sendMessage(user.telegramId!, text);
    }
  }

  bot.onText(/\/report$/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    bot.sendMessage(chatId, "Готовлю отчёт за сегодня...");
    await sendEveningReport(user, true);
  });

  bot.onText(/\/report_time(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const arg = match?.[1]?.trim();
    if (arg) {
      if (arg.toLowerCase() === 'off') {
        await storage.updateUserReportTime(user.id, 'off');
        bot.sendMessage(chatId, "Вечерний отчёт: выключен");
        return;
      }
      const timeMatch = arg.match(/^(\d{1,2}):(\d{2})$/);
      if (timeMatch) {
        const h = parseInt(timeMatch[1]);
        const m = parseInt(timeMatch[2]);
        if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
          const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          await storage.updateUserReportTime(user.id, time);
          bot.sendMessage(chatId, `Вечерний отчёт: ${time}`);
          return;
        }
      }
      bot.sendMessage(chatId, "Неверный формат. Укажите время в формате ЧЧ:ММ или off.\nНапример: /report_time 20:30");
      return;
    }

    bot.sendMessage(chatId, `Текущее время отчёта: ${user.reportTime || '21:00'}\n\nВыберите новое время или отправьте /report_time ЧЧ:ММ :`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "19:00", callback_data: "rtime_19:00" },
            { text: "20:00", callback_data: "rtime_20:00" },
            { text: "21:00", callback_data: "rtime_21:00" }
          ],
          [
            { text: "22:00", callback_data: "rtime_22:00" },
            { text: "23:00", callback_data: "rtime_23:00" },
            { text: "Выкл", callback_data: "rtime_off" }
          ]
        ]
      }
    });
  });

  const MEAL_LABELS: Record<string, string> = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин' };

  bot.onText(/\/reminders/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const br = user.breakfastReminder || 'off';
    const lu = user.lunchReminder || 'off';
    const di = user.dinnerReminder || 'off';
    const nl = user.noLogReminderTime || 'off';

    const formatTime = (t: string) => t === 'off' ? 'выкл' : t;

    bot.sendMessage(chatId,
      `Напоминания:\n\nЗавтрак: ${formatTime(br)}\nОбед: ${formatTime(lu)}\nУжин: ${formatTime(di)}\nНет записей к: ${formatTime(nl)}\n\nВыберите, что настроить:`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: `Завтрак (${formatTime(br)})`, callback_data: "rmnd_breakfast" }],
          [{ text: `Обед (${formatTime(lu)})`, callback_data: "rmnd_lunch" }],
          [{ text: `Ужин (${formatTime(di)})`, callback_data: "rmnd_dinner" }],
          [{ text: `⚠️ Нет записей к (${formatTime(nl)})`, callback_data: "rmnd_nolog" }],
          [{ text: "Выключить все", callback_data: "rmnd_all_off" }]
        ]
      }
    });
  });

  function getMoscowNow(): Date {
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }));
  }

  const reportSentKeys = new Set<string>();
  const reminderSentKeys = new Set<string>();

  async function checkScheduledNotifications() {
    const msk = getMoscowNow();
    const currentTime = `${String(msk.getHours()).padStart(2, '0')}:${String(msk.getMinutes()).padStart(2, '0')}`;
    const todayKey = `${msk.getFullYear()}-${String(msk.getMonth() + 1).padStart(2, '0')}-${String(msk.getDate()).padStart(2, '0')}`;

    Array.from(reportSentKeys).forEach(key => {
      if (!key.endsWith(`_${todayKey}`)) reportSentKeys.delete(key);
    });
    Array.from(reminderSentKeys).forEach(key => {
      if (!key.endsWith(`_${todayKey}`)) reminderSentKeys.delete(key);
    });

    const allUsers = await storage.getAllApprovedUsers();
    for (const user of allUsers) {
      if (user.reportTime && user.reportTime !== 'off' && user.reportTime === currentTime) {
        const userDayKey = `${user.id}_report_${todayKey}`;
        if (!reportSentKeys.has(userDayKey)) {
          try {
            reportSentKeys.add(userDayKey);
            console.log(`Sending evening report to user ${user.id} at ${currentTime}`);
            await sendEveningReport(user);
          } catch (e) {
            console.error(`Failed to send report to user ${user.id}:`, e);
          }
        }
      }

      const meals: Array<{ field: string | null | undefined; meal: string }> = [
        { field: user.breakfastReminder, meal: 'breakfast' },
        { field: user.lunchReminder, meal: 'lunch' },
        { field: user.dinnerReminder, meal: 'dinner' },
      ];

      for (const { field, meal } of meals) {
        if (!field || field === 'off' || field !== currentTime) continue;
        const key = `${user.id}_${meal}_${todayKey}`;
        if (reminderSentKeys.has(key)) continue;
        reminderSentKeys.add(key);
        try {
          console.log(`Sending ${meal} reminder to user ${user.id} at ${currentTime}`);
          bot.sendMessage(user.telegramId!, `Время записать ${MEAL_LABELS[meal]?.toLowerCase()}! Отправьте текст или фото еды.`);
        } catch (e) {
          console.error(`Failed to send ${meal} reminder to user ${user.id}:`, e);
        }
      }

      // No-log reminder: fires if user set noLogReminderTime and has no food entries today
      if (user.noLogReminderTime && user.noLogReminderTime !== 'off' && user.noLogReminderTime === currentTime) {
        const key = `${user.id}_nolog_${todayKey}`;
        if (!reminderSentKeys.has(key)) {
          reminderSentKeys.add(key);
          try {
            const todayStats = await storage.getDailyStats(user.id, msk);
            if (todayStats.calories === 0) {
              bot.sendMessage(user.telegramId!, `⚠️ Ты ещё ничего не записал сегодня. Не забудь залогировать еду!`);
            }
          } catch (e) {
            console.error(`Failed to send no-log reminder to user ${user.id}:`, e);
          }
        }
      }

      // Weight reminder: fires on matching time + allowed day of week
      if (user.weightReminderTime && user.weightReminderTime !== 'off' && user.weightReminderTime === currentTime) {
        const todayDow = msk.getDay(); // 0=Sun,1=Mon,...,6=Sat
        const allowedDays = user.weightReminderDays
          ? user.weightReminderDays.split(',').filter(Boolean).map(Number)
          : [];
        const dayOk = allowedDays.length === 0 || allowedDays.includes(todayDow);
        if (dayOk) {
          const key = `${user.id}_weight_${todayKey}`;
          if (!reminderSentKeys.has(key)) {
            reminderSentKeys.add(key);
            try {
              bot.sendMessage(user.telegramId!, `⚖️ Время взвеситься! Запишите вес: /weight 75.0`);
            } catch (e) {
              console.error(`Failed to send weight reminder to user ${user.id}:`, e);
            }
          }
        }
      }
    }
  }

  setTimeout(() => checkScheduledNotifications(), 5000);
  setInterval(checkScheduledNotifications, 60000);

  bot.onText(/\/profile/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    startProfileFlow(chatId, telegramId);
  });

  bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const logs = await storage.getFoodLogs(user.id);
    if (logs.length === 0) {
      bot.sendMessage(chatId, "История пуста.");
      return;
    }

    bot.sendMessage(chatId, "Последние записи:");
    
    for (const l of logs.slice(0, 10)) {
      bot.sendMessage(chatId, `${l.date?.toLocaleDateString()}: ${l.foodName} (${l.calories} ккал)`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🗑 Удалить", callback_data: `delete_log_${l.id}` }]
          ]
        }
      });
    }
  });

  bot.onText(/\/export (\d{2}\.\d{2}\.\d{4})(?: - (\d{2}\.\d{2}\.\d{4}))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId || !match) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const startStr = match[1];
    const endStr = match[2] || startStr;

    const parseDate = (s: string) => {
      const [d, m, y] = s.split('.').map(Number);
      return new Date(y, m - 1, d);
    };

    const startDate = parseDate(startStr);
    const endDate = parseDate(endStr);
    endDate.setHours(23, 59, 59, 999);

    const logs = await storage.getFoodLogsInRange(user.id, startDate, endDate);

    if (logs.length === 0) {
      bot.sendMessage(chatId, "За этот период записей нет.");
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Nutrition Stats');
    worksheet.columns = [
      { header: 'Дата', key: 'date', width: 15 },
      { header: 'Блюдо', key: 'food', width: 30 },
      { header: 'Ккал', key: 'cal', width: 10 },
      { header: 'Белки', key: 'prot', width: 10 },
      { header: 'Жиры', key: 'fat', width: 10 },
      { header: 'Углеводы', key: 'carb', width: 10 },
      { header: 'Вес (г)', key: 'weight', width: 10 }
    ];

    logs.forEach(log => {
      worksheet.addRow({
        date: log.date?.toLocaleDateString(),
        food: log.foodName,
        cal: log.calories,
        prot: log.protein,
        fat: log.fat,
        carb: log.carbs,
        weight: log.weight
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = startStr === endStr ? `stats_${startStr}.xlsx` : `stats_${startStr}_${endStr}.xlsx`;
    bot.sendDocument(chatId, Buffer.from(buffer as Buffer), {}, { filename, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  });

  bot.onText(/\/clear (\d{2}\.\d{2}\.\d{4})(?: - (\d{2}\.\d{2}\.\d{4}))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId || !match) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const startStr = match[1];
    const endStr = match[2] || startStr;

    const parseDate = (s: string) => {
      const [d, m, y] = s.split('.').map(Number);
      return new Date(y, m - 1, d);
    };

    const startDate = parseDate(startStr);
    const endDate = parseDate(endStr);
    endDate.setHours(23, 59, 59, 999);

    await storage.deleteFoodLogsInRange(user.id, startDate, endDate);
    bot.sendMessage(chatId, `История за период ${startStr}${startStr !== endStr ? ` - ${endStr}` : ''} успешно удалена.`);
  });

  bot.on("callback_query", async (query) => {
    const chatId = query.message?.chat.id;
    const telegramId = query.from?.id.toString();
    if (!chatId || !telegramId || !query.data) return;

    const user = await storage.getUserByTelegramId(telegramId);
    if (!user) return;

    if (query.data === "confirm_yes") {
      const pending = (bot as any).pendingLogs?.[telegramId];
      if (pending) {
        const unit = getUnit(pending.foodName);
        await storage.createFoodLog({
          userId: user.id,
          foodName: pending.foodName,
          calories: Math.round(Number(pending.calories)) || 0,
          protein: Math.round(Number(pending.protein)) || 0,
          fat: Math.round(Number(pending.fat)) || 0,
          carbs: Math.round(Number(pending.carbs)) || 0,
          weight: Math.round(Number(pending.weight)) || 0,
          mealType: pending.mealType || 'snack',
          foodScore: pending.foodScore ? Math.round(Number(pending.foodScore)) : null,
          nutritionAdvice: pending.nutritionAdvice || null,
          fiber: pending.fiber != null ? Number(pending.fiber) : null,
          sugar: pending.sugar != null ? Number(pending.sugar) : null,
          sodium: pending.sodium != null ? Number(pending.sodium) : null,
          saturatedFat: pending.saturatedFat != null ? Number(pending.saturatedFat) : null,
        });
        const progress = await buildDailyProgress(storage, user.id, user);
        bot.editMessageText(`✅ Добавлено: ${pending.foodName} (${pending.weight}${unit})${progress}`, {
          chat_id: chatId,
          message_id: query.message?.message_id
        });
        delete (bot as any).pendingLogs[telegramId];
      } else {
        bot.sendMessage(chatId, "Срок действия предложения истек или данные не найдены.");
      }
    } else if (query.data === "confirm_no") {
      bot.editMessageText("❌ Отменено", {
        chat_id: chatId,
        message_id: query.message?.message_id
      });
      if ((bot as any).pendingLogs) delete (bot as any).pendingLogs[telegramId];
    } else if (query.data.startsWith("weight_")) {
      const pending = (bot as any).pendingLogs?.[telegramId];
      if (!pending) return;

      const action = query.data.split("_")[1];
      const amount = parseInt(query.data.split("_")[2]);
      
      const oldWeight = pending.weight;
      const newWeight = action === "plus" ? oldWeight + amount : Math.max(10, oldWeight - amount);
      
      if (newWeight === oldWeight) return;

      // Recalculate nutrients based on new weight
      const ratio = newWeight / oldWeight;
      pending.weight = newWeight;
      pending.calories = Math.round(pending.calories * ratio);
      pending.protein = Math.round(pending.protein * ratio);
      pending.fat = Math.round(pending.fat * ratio);
      pending.carbs = Math.round(pending.carbs * ratio);
      if (pending.fiber != null) pending.fiber = Math.round(pending.fiber * ratio * 10) / 10;
      if (pending.sugar != null) pending.sugar = Math.round(pending.sugar * ratio * 10) / 10;
      if (pending.sodium != null) pending.sodium = Math.round(pending.sodium * ratio);
      if (pending.saturatedFat != null) pending.saturatedFat = Math.round(pending.saturatedFat * ratio * 10) / 10;

      const unit = getUnit(pending.foodName);
      bot.editMessageText(buildConfirmMessage(pending, user.showMicronutrients ?? false), {
        chat_id: chatId,
        message_id: query.message?.message_id,
        parse_mode: 'Markdown',
        reply_markup: buildConfirmKeyboard(unit)
      });
    } else if (query.data === "save_all") {
      const items = pendingMulti[telegramId];
      if (!items || items.length === 0) {
        bot.answerCallbackQuery(query.id, { text: "Нет позиций для сохранения" });
        return;
      }
      delete pendingMulti[telegramId];
      let savedCount = 0;
      for (const item of items) {
        try {
          await storage.createFoodLog({
            userId: user.id,
            foodName: item.foodName,
            calories: Math.round(Number(item.calories)) || 0,
            protein: Math.round(Number(item.protein)) || 0,
            fat: Math.round(Number(item.fat)) || 0,
            carbs: Math.round(Number(item.carbs)) || 0,
            weight: Math.round(Number(item.weight)) || 0,
            mealType: item.mealType || 'snack',
            foodScore: item.foodScore ? Math.round(Number(item.foodScore)) : null,
            nutritionAdvice: item.nutritionAdvice || null,
            fiber: item.fiber != null ? Number(item.fiber) : null,
            sugar: item.sugar != null ? Number(item.sugar) : null,
            sodium: item.sodium != null ? Number(item.sodium) : null,
            saturatedFat: item.saturatedFat != null ? Number(item.saturatedFat) : null,
          });
          savedCount++;
        } catch (e) {
          console.error("Error saving food item:", e);
        }
      }
      const totalCal = items.reduce((s, i) => s + i.calories, 0);
      const progress = await buildDailyProgress(storage, user.id, user);
      bot.editMessageText(`✅ Сохранено ${savedCount} из ${items.length} позиций  (+${totalCal} ккал)${progress}`, {
        chat_id: chatId,
        message_id: query.message?.message_id
      });
    } else if (query.data === "cancel_multi") {
      delete pendingMulti[telegramId];
      bot.editMessageText("❌ Отменено", {
        chat_id: chatId,
        message_id: query.message?.message_id
      });
    } else if (query.data.startsWith("mi_e_")) {
      const idx = parseInt(query.data.slice(5));
      const items = pendingMulti[telegramId];
      if (!items || idx >= items.length) return;
      const item = items[idx];
      const unit = item.foodName.toLowerCase().match(LIQUID_PATTERN) ? 'мл' : 'г';
      bot.editMessageText(buildMultiItemEditorText(item, idx, items.length), {
        chat_id: chatId,
        message_id: query.message?.message_id,
        reply_markup: buildMultiItemEditorKeyboard(idx, unit)
      });
    } else if (query.data.startsWith("mi_wp_") || query.data.startsWith("mi_wm_")) {
      const plus = query.data.startsWith("mi_wp_");
      const parts = query.data.split("_");
      const amount = parseInt(parts[2]);
      const idx = parseInt(parts[3]);
      const items = pendingMulti[telegramId];
      if (!items || idx >= items.length) return;
      const item = items[idx];
      const oldWeight = item.weight;
      const newWeight = plus ? oldWeight + amount : Math.max(5, oldWeight - amount);
      if (newWeight === oldWeight) return;
      const ratio = newWeight / oldWeight;
      item.weight = newWeight;
      item.calories = Math.round(item.calories * ratio);
      item.protein = Math.round(item.protein * ratio);
      item.fat = Math.round(item.fat * ratio);
      item.carbs = Math.round(item.carbs * ratio);
      if (item.fiber != null) item.fiber = Math.round(item.fiber * ratio * 10) / 10;
      if (item.sugar != null) item.sugar = Math.round(item.sugar * ratio * 10) / 10;
      if (item.sodium != null) item.sodium = Math.round(item.sodium * ratio);
      if (item.saturatedFat != null) item.saturatedFat = Math.round(item.saturatedFat * ratio * 10) / 10;
      const unit = item.foodName.toLowerCase().match(LIQUID_PATTERN) ? 'мл' : 'г';
      bot.editMessageText(buildMultiItemEditorText(item, idx, items.length), {
        chat_id: chatId,
        message_id: query.message?.message_id,
        reply_markup: buildMultiItemEditorKeyboard(idx, unit)
      });
    } else if (query.data.startsWith("mi_del_")) {
      const idx = parseInt(query.data.slice(7));
      const items = pendingMulti[telegramId];
      if (!items) return;
      items.splice(idx, 1);
      if (items.length === 0) {
        delete pendingMulti[telegramId];
        bot.editMessageText("❌ Все позиции удалены", {
          chat_id: chatId,
          message_id: query.message?.message_id
        });
      } else {
        bot.editMessageText(buildMultiSummaryText(items), {
          chat_id: chatId,
          message_id: query.message?.message_id,
          reply_markup: buildMultiSummaryKeyboard(items)
        });
      }
    } else if (query.data === "mi_back") {
      const items = pendingMulti[telegramId];
      if (!items) return;
      bot.editMessageText(buildMultiSummaryText(items), {
        chat_id: chatId,
        message_id: query.message?.message_id,
        reply_markup: buildMultiSummaryKeyboard(items)
      });
    } else if (query.data.startsWith("delete_log_")) {
      const logId = parseInt(query.data.split("_")[2]);
      await storage.deleteFoodLog(logId);
      bot.editMessageText("🗑 Запись удалена", {
        chat_id: chatId,
        message_id: query.message?.message_id
      });
    } else if (query.data.startsWith("rtime_")) {
      const time = query.data.replace("rtime_", "");
      await storage.updateUserReportTime(user.id, time);
      const label = time === 'off' ? 'выключен' : time;
      bot.editMessageText(`Вечерний отчёт: ${label}`, {
        chat_id: chatId,
        message_id: query.message?.message_id
      });
    } else if (query.data.startsWith("rmnd_")) {
      const action = query.data.replace("rmnd_", "");

      if (action === 'all_off') {
        await storage.updateUserReminder(user.id, 'breakfast', 'off');
        await storage.updateUserReminder(user.id, 'lunch', 'off');
        await storage.updateUserReminder(user.id, 'dinner', 'off');
        await storage.updateUser(user.id, { noLogReminderTime: 'off' });
        bot.editMessageText("Все напоминания выключены.", {
          chat_id: chatId,
          message_id: query.message?.message_id
        });
      } else if (action === 'nolog') {
        bot.editMessageText(`Напоминание если нет записей\n\nВыберите время (если к этому времени нет ни одной записи — бот напомнит):`, {
          chat_id: chatId,
          message_id: query.message?.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: "11:00", callback_data: "rmset_nolog_11:00" }, { text: "12:00", callback_data: "rmset_nolog_12:00" }, { text: "13:00", callback_data: "rmset_nolog_13:00" }],
              [{ text: "14:00", callback_data: "rmset_nolog_14:00" }, { text: "15:00", callback_data: "rmset_nolog_15:00" }, { text: "16:00", callback_data: "rmset_nolog_16:00" }],
              [{ text: "Своё время", callback_data: "rmcustom_nolog" }, { text: "Выкл", callback_data: "rmset_nolog_off" }]
            ]
          }
        });
      } else if (['breakfast', 'lunch', 'dinner'].includes(action)) {
        const meal = action as 'breakfast' | 'lunch' | 'dinner';
        const defaults: Record<string, string[][]> = {
          breakfast: [["07:00", "08:00", "09:00", "10:00"]],
          lunch: [["12:00", "13:00", "14:00", "15:00"]],
          dinner: [["18:00", "19:00", "20:00", "21:00"]],
        };
        bot.editMessageText(`Настройка напоминания: ${MEAL_LABELS[meal]}\n\nВыберите время или нажмите "Своё время":`, {
          chat_id: chatId,
          message_id: query.message?.message_id,
          reply_markup: {
            inline_keyboard: [
              ...defaults[meal].map(row => row.map(t => ({ text: t, callback_data: `rmset_${meal}_${t}` }))),
              [{ text: "Своё время", callback_data: `rmcustom_${meal}` }, { text: "Выкл", callback_data: `rmset_${meal}_off` }]
            ]
          }
        });
      }
    } else if (query.data.startsWith("rmcustom_")) {
      const target = query.data.replace("rmcustom_", "");
      if (target === 'nolog') {
        userStates[telegramId] = { step: 'nolog_reminder_time', data: {} };
        bot.editMessageText(`Введите время в формате ЧЧ:ММ\nНапример: 13:30`, {
          chat_id: chatId,
          message_id: query.message?.message_id
        });
      } else {
        const meal = target as 'breakfast' | 'lunch' | 'dinner';
        userStates[telegramId] = { step: 'reminder_time', data: { reminderMeal: meal } };
        bot.editMessageText(`Введите время для напоминания "${MEAL_LABELS[meal]}" в формате ЧЧ:ММ\nНапример: 07:30`, {
          chat_id: chatId,
          message_id: query.message?.message_id
        });
      }
    } else if (query.data.startsWith("rmset_")) {
      const parts = query.data.replace("rmset_", "").split("_");
      const meal = parts[0] as 'breakfast' | 'lunch' | 'dinner' | 'nolog';
      const time = parts[1];
      if (meal === 'nolog') {
        await storage.updateUser(user.id, { noLogReminderTime: time });
        const label = time === 'off' ? 'выкл' : time;
        bot.editMessageText(`⚠️ Нет записей к: ${label}`, {
          chat_id: chatId,
          message_id: query.message?.message_id
        });
      } else {
        await storage.updateUserReminder(user.id, meal, time);
        const label = time === 'off' ? 'выкл' : time;
        bot.editMessageText(`${MEAL_LABELS[meal]}: ${label}`, {
          chat_id: chatId,
          message_id: query.message?.message_id
        });
      }
    } else if (query.data.startsWith("set_gender_")) {
      const gender = query.data.split("_")[2];
      userStates[telegramId] = { step: 'age', data: { gender } };
      bot.editMessageText("Ваш возраст (полных лет):", { chat_id: chatId, message_id: query.message?.message_id });
    } else if (query.data.startsWith("set_activity_")) {
      const activity = query.data.split("_")[2];
      const state = userStates[telegramId];
      if (state) {
        state.data.activityLevel = activity;
        state.step = 'goal';
        bot.editMessageText("Ваша цель:", {
          chat_id: chatId,
          message_id: query.message?.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: "Похудение", callback_data: "set_goal_lose" }],
              [{ text: "Поддержание веса", callback_data: "set_goal_maintain" }],
              [{ text: "Набор массы", callback_data: "set_goal_gain" }]
            ]
          }
        });
      }
    } else if (query.data.startsWith("set_goal_")) {
      const goal = query.data.split("_")[2];
      const state = userStates[telegramId];
      if (state) {
        state.data.goal = goal;
        console.log(`Profile save for user ${user.id}:`, JSON.stringify(state.data));
        await storage.updateUser(user.id, state.data);
        const updatedUser = await storage.calculateAndSetGoals(user.id);
        console.log(`Goals calculated for user ${user.id}:`, JSON.stringify({ caloriesGoal: updatedUser.caloriesGoal, proteinGoal: updatedUser.proteinGoal, fatGoal: updatedUser.fatGoal, carbsGoal: updatedUser.carbsGoal }));
        delete userStates[telegramId];
        bot.editMessageText(`Профиль настроен!\n\nВаши нормы на день:\nКкал: ${updatedUser.caloriesGoal}\nБелки: ${updatedUser.proteinGoal}г\nЖиры: ${updatedUser.fatGoal}г\nУглеводы: ${updatedUser.carbsGoal}г\n\nХотите скорректировать калории?`, {
          chat_id: chatId,
          message_id: query.message?.message_id,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "-100 ккал", callback_data: "adj_cal_minus_100" },
                { text: "+100 ккал", callback_data: "adj_cal_plus_100" }
              ],
              [
                { text: "-250 ккал", callback_data: "adj_cal_minus_250" },
                { text: "+250 ккал", callback_data: "adj_cal_plus_250" }
              ],
              [{ text: "Готово", callback_data: "adj_cal_done" }]
            ]
          }
        });
      }
    } else if (query.data.startsWith("adj_cal_")) {
      const action = query.data.replace("adj_cal_", "");
      if (action === "done") {
        const u = await storage.getUser(user.id);
        bot.editMessageText(`Итоговые нормы на день:\nКкал: ${u?.caloriesGoal}\nБелки: ${u?.proteinGoal}г\nЖиры: ${u?.fatGoal}г\nУглеводы: ${u?.carbsGoal}г`, {
          chat_id: chatId,
          message_id: query.message?.message_id
        });
      } else {
        const parts = action.split("_");
        const direction = parts[0];
        const amount = parseInt(parts[1]);
        const currentUser = await storage.getUser(user.id);
        if (!currentUser?.caloriesGoal) return;

        const oldCal = currentUser.caloriesGoal;
        const newCal = direction === "plus" ? oldCal + amount : Math.max(800, oldCal - amount);
        if (newCal === oldCal) return;

        const ratio = newCal / oldCal;
        const newProtein = Math.round((currentUser.proteinGoal || 0) * ratio);
        const newFat = Math.round((currentUser.fatGoal || 0) * ratio);
        const newCarbs = Math.round((currentUser.carbsGoal || 0) * ratio);

        await storage.updateUser(user.id, {
          caloriesGoal: newCal,
          proteinGoal: newProtein,
          fatGoal: newFat,
          carbsGoal: newCarbs
        });

        bot.editMessageText(`Ваши нормы на день:\nКкал: ${newCal}\nБелки: ${newProtein}г\nЖиры: ${newFat}г\nУглеводы: ${newCarbs}г\n\nХотите скорректировать калории?`, {
          chat_id: chatId,
          message_id: query.message?.message_id,
          reply_markup: {
            inline_keyboard: [
              [
                { text: "-100 ккал", callback_data: "adj_cal_minus_100" },
                { text: "+100 ккал", callback_data: "adj_cal_plus_100" }
              ],
              [
                { text: "-250 ккал", callback_data: "adj_cal_minus_250" },
                { text: "+250 ккал", callback_data: "adj_cal_plus_250" }
              ],
              [{ text: "Готово", callback_data: "adj_cal_done" }]
            ]
          }
        });
      }
    } else if (query.data.startsWith("goal_")) {
      const goalMap: Record<string, string> = { lose: 'lose', maintain: 'maintain', gain: 'gain' };
      const goalLabelMap: Record<string, string> = { lose: 'Похудение', maintain: 'Поддержание веса', gain: 'Набор массы' };
      const goalKey = query.data.replace("goal_", "");
      const newGoal = goalMap[goalKey];
      if (!newGoal) return;
      await storage.updateUser(user.id, { goal: newGoal });
      const recalculated = await storage.calculateAndSetGoals(user.id);
      bot.editMessageText(
        `✅ Цель изменена: ${goalLabelMap[goalKey]}\n\nНормы на день:\nКкал: ${recalculated.caloriesGoal}\nБелки: ${recalculated.proteinGoal}г\nЖиры: ${recalculated.fatGoal}г\nУглеводы: ${recalculated.carbsGoal}г`,
        { chat_id: chatId, message_id: query.message?.message_id }
      );

    // ─── Weight analysis ────────────────────────────────────────────────────
    } else if (query.data === 'weight_analysis') {
      bot.answerCallbackQuery(query.id, { text: 'Анализирую...' });
      const wLogs = await storage.getWeightLogs(user.id, 7);
      const weekStats = await storage.getWeeklyFullStats(user.id);
      if (wLogs.length < 2) {
        bot.sendMessage(chatId, "Нужно хотя бы 2 замера веса для анализа. Записывайте вес командой /weight 75.0");
        return;
      }
      const analysis = await generateWeightAnalysis(wLogs, weekStats, user);
      if (analysis) {
        bot.sendMessage(chatId, `📊 Анализ веса за неделю:\n\n${analysis}`);
      } else {
        bot.sendMessage(chatId, "Не удалось сформировать анализ. Попробуйте позже.");
      }

    } else if (query.data === 'weight_reminder_setup') {
      const freshUser = await storage.getUser(user.id);
      if (freshUser) sendWeightReminderSetup(chatId, freshUser);

    // ─── Weight reminder time ───────────────────────────────────────────────
    } else if (query.data.startsWith('wrem_t_')) {
      const val = query.data.replace('wrem_t_', '');
      if (val === 'custom') {
        userStates[telegramId] = { step: 'weight_reminder_time', data: {} };
        bot.editMessageText('Введите время в формате ЧЧ:ММ, например: 07:30', {
          chat_id: chatId, message_id: query.message?.message_id
        });
      } else {
        await storage.updateUser(user.id, { weightReminderTime: val });
        const label = val === 'off' ? 'выкл' : val;
        bot.editMessageText(`⚖️ Напоминание взвеситься: ${label}`, {
          chat_id: chatId, message_id: query.message?.message_id
        });
      }

    // ─── Weight reminder days ───────────────────────────────────────────────
    } else if (query.data === 'wrem_ignore') {
      bot.answerCallbackQuery(query.id);

    } else if (query.data === 'wrem_d_all') {
      await storage.updateUser(user.id, { weightReminderDays: '' });
      const freshUser = await storage.getUser(user.id);
      if (freshUser) {
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: query.message?.message_id });
        bot.sendMessage(chatId, '✅ Напоминание будет каждый день');
      }

    } else if (query.data.startsWith('wrem_d_')) {
      const dayStr = query.data.replace('wrem_d_', '');
      const day = parseInt(dayStr);
      const freshUser = await storage.getUser(user.id);
      if (!freshUser) return;
      const days = freshUser.weightReminderDays ? freshUser.weightReminderDays.split(',').filter(Boolean).map(Number) : [];
      const idx = days.indexOf(day);
      if (idx >= 0) days.splice(idx, 1); else days.push(day);
      await storage.updateUser(user.id, { weightReminderDays: days.sort().join(',') });
      const updated = await storage.getUser(user.id);
      if (updated) sendWeightReminderSetup(chatId, updated);

    // ─── Generate PDF ───────────────────────────────────────────────────────
    } else if (query.data === 'generate_pdf') {
      bot.answerCallbackQuery(query.id, { text: 'Генерирую PDF...' });
      await sendPDFReport(chatId, user);

    // ─── Edit Profile ───────────────────────────────────────────────────────
    } else if (query.data.startsWith('ep_')) {
      const field = query.data.replace('ep_', '');

      if (field === 'age') {
        userStates[telegramId] = { step: 'ep_age', data: {} };
        bot.editMessageText('Введите ваш возраст (лет):', { chat_id: chatId, message_id: query.message?.message_id });

      } else if (field === 'weight') {
        userStates[telegramId] = { step: 'ep_weight', data: {} };
        bot.editMessageText('Введите ваш текущий вес (кг), например: 74.5', { chat_id: chatId, message_id: query.message?.message_id });

      } else if (field === 'height') {
        userStates[telegramId] = { step: 'ep_height', data: {} };
        bot.editMessageText('Введите ваш рост (см), например: 178', { chat_id: chatId, message_id: query.message?.message_id });

      } else if (field === 'calories') {
        userStates[telegramId] = { step: 'ep_calories', data: {} };
        bot.editMessageText(`Текущая норма: ${user.caloriesGoal ?? 'не задана'} ккал\n\nВведите новую норму калорий (ккал):`, { chat_id: chatId, message_id: query.message?.message_id });

      } else if (field === 'recalc') {
        const updated = await storage.calculateAndSetGoals(user.id);
        bot.editMessageText(`✅ Нормы пересчитаны:\nКкал: ${updated.caloriesGoal}\nБелки: ${updated.proteinGoal}г\nЖиры: ${updated.fatGoal}г\nУглеводы: ${updated.carbsGoal}г`, { chat_id: chatId, message_id: query.message?.message_id });

      } else if (field === 'activity') {
        bot.editMessageText('Выберите уровень активности:', {
          chat_id: chatId, message_id: query.message?.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🛋 Сидячий образ жизни', callback_data: 'ep_act_sedentary' }],
              [{ text: '🚶 Лёгкая активность', callback_data: 'ep_act_light' }],
              [{ text: '🏃 Умеренная активность', callback_data: 'ep_act_moderate' }],
              [{ text: '🏋️ Высокая активность', callback_data: 'ep_act_active' }],
              [{ text: '⚡ Очень высокая активность', callback_data: 'ep_act_very_active' }],
            ]
          }
        });

      } else if (field === 'goal') {
        bot.editMessageText('Выберите цель:', {
          chat_id: chatId, message_id: query.message?.message_id,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔥 Похудение', callback_data: 'ep_goal_lose' }],
              [{ text: '⚖️ Поддержание веса', callback_data: 'ep_goal_maintain' }],
              [{ text: '💪 Набор массы', callback_data: 'ep_goal_gain' }],
            ]
          }
        });
      }

    } else if (query.data.startsWith('ep_act_')) {
      const activity = query.data.replace('ep_act_', '');
      await storage.updateUser(user.id, { activityLevel: activity });
      const updated = await storage.calculateAndSetGoals(user.id);
      const ACT_LABEL: Record<string, string> = { sedentary: 'Сидячий', light: 'Лёгкая', moderate: 'Умеренная', active: 'Активный', very_active: 'Очень активный' };
      bot.editMessageText(`✅ Активность: ${ACT_LABEL[activity]}\n\nНормы пересчитаны:\nКкал: ${updated.caloriesGoal} | Б${updated.proteinGoal}г Ж${updated.fatGoal}г У${updated.carbsGoal}г`, { chat_id: chatId, message_id: query.message?.message_id });

    } else if (query.data.startsWith('ep_goal_')) {
      const goal = query.data.replace('ep_goal_', '');
      await storage.updateUser(user.id, { goal });
      const updated = await storage.calculateAndSetGoals(user.id);
      const GOAL_LABEL: Record<string, string> = { lose: 'Похудение', maintain: 'Поддержание', gain: 'Набор массы' };
      bot.editMessageText(`✅ Цель: ${GOAL_LABEL[goal]}\n\nНормы пересчитаны:\nКкал: ${updated.caloriesGoal} | Б${updated.proteinGoal}г Ж${updated.fatGoal}г У${updated.carbsGoal}г`, { chat_id: chatId, message_id: query.message?.message_id });

    } else if (query.data.startsWith("admin_approve_")) {
      if (!user.isAdmin) return;
      const targetUserId = parseInt(query.data.split("_")[2]);
      const targetUser = await storage.getUser(targetUserId);
      if (targetUser) {
        await storage.updateUser(targetUserId, { isApproved: true });
        bot.editMessageText(`✅ Пользователь @${targetUser.username} одобрен.`, {
          chat_id: chatId,
          message_id: query.message?.message_id
        });
        bot.sendMessage(targetUser.telegramId!, "Ваша заявка одобрена! Теперь вы можете пользоваться ботом.");
      }
    } else if (query.data.startsWith("admin_reject_")) {
      if (!user.isAdmin) return;
      const targetUserId = parseInt(query.data.split("_")[2]);
      const targetUser = await storage.getUser(targetUserId);
      if (targetUser) {
        await storage.deleteUser(targetUserId);
        bot.editMessageText(`❌ Пользователь @${targetUser.username} отклонен и удален.`, {
          chat_id: chatId,
          message_id: query.message?.message_id
        });
        bot.sendMessage(targetUser.telegramId!, "Ваша заявка отклонена.");
      }
    } else if (query.data.startsWith("admin_delete_")) {
      const targetUserId = parseInt(query.data.split("_")[2]);
      const targetUser = await storage.getUser(targetUserId);
      if (targetUser) {
        const isTargetGlobalAdmin = ADMIN_TELEGRAM_ID && String(targetUser.telegramId).trim() === String(ADMIN_TELEGRAM_ID).trim();
        if (isTargetGlobalAdmin) {
          bot.sendMessage(chatId, "Нельзя удалить главного администратора.");
          bot.answerCallbackQuery(query.id);
          return;
        }
        await storage.deleteUser(targetUserId);
        bot.editMessageText(`🗑 Пользователь @${targetUser.username || targetUserId} полностью удален из системы.`, {
          chat_id: chatId,
          message_id: query.message?.message_id
        });
        bot.sendMessage(targetUser.telegramId!, "Ваш доступ к боту был аннулирован администратором.");
      }
    }
    
    // ─── workout_save / workout_cancel ────────────────────────────────────
    if (query.data === "workout_save") {
      const pending = pendingWorkouts[telegramId];
      if (!pending) {
        bot.answerCallbackQuery(query.id, { text: 'Данные устарели, попробуй ещё раз' });
        return;
      }
      delete pendingWorkouts[telegramId];

      await storage.createWorkoutLog({
        userId: user.id,
        description: pending.description,
        workoutType: pending.workoutType,
        durationMin: pending.durationMin,
        caloriesBurned: pending.caloriesBurned,
      });

      const progress = await buildDailyProgress(storage, user.id, user);
      bot.editMessageText(`✅ Тренировка сохранена: *${pending.description}* — ${pending.caloriesBurned} ккал${progress}`, {
        chat_id: chatId,
        message_id: query.message?.message_id,
        parse_mode: 'Markdown',
      });
      bot.answerCallbackQuery(query.id, { text: '✅ Тренировка сохранена' });
      return;
    }

    if (query.data === "workout_cancel") {
      delete pendingWorkouts[telegramId];
      bot.editMessageText("❌ Тренировка не сохранена", {
        chat_id: chatId,
        message_id: query.message?.message_id,
      });
      bot.answerCallbackQuery(query.id);
      return;
    }

    // ─── toggle_micro ─────────────────────────────────────────────────────
    if (query.data === "toggle_micro") {
      const newVal = !user.showMicronutrients;
      await storage.updateUser(user.id, { showMicronutrients: newVal });
      const statusText = newVal ? 'Включены ✅' : 'Выключены ❌';
      bot.editMessageText(
        `⚙️ *Настройки*\n\n🔬 Микронутриенты (клетчатка, сахар, натрий, нас. жиры): *${statusText}*\n\nПри включении ИИ будет дополнительно рассчитывать клетчатку, сахар, натрий и насыщенные жиры для каждого продукта.`,
        {
          chat_id: chatId,
          message_id: query.message?.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: newVal ? '❌ Выключить микронутриенты' : '✅ Включить микронутриенты', callback_data: 'toggle_micro' }
            ]]
          }
        }
      );
      bot.answerCallbackQuery(query.id, { text: newVal ? '✅ Микронутриенты включены' : '❌ Микронутриенты выключены' });
      return;
    }

    bot.answerCallbackQuery(query.id);
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    
    if (!telegramId) return;
    if (msg.text?.startsWith('/')) return; // Ignore commands

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    // Handle Profile Flow
    const state = userStates[telegramId];
    if (state) {
      if (state.step === 'reminder_time') {
        const timeMatch = (msg.text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
        if (timeMatch) {
          const h = parseInt(timeMatch[1]);
          const m = parseInt(timeMatch[2]);
          if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            const meal = state.data.reminderMeal as 'breakfast' | 'lunch' | 'dinner';
            await storage.updateUserReminder(user.id, meal, time);
            delete userStates[telegramId];
            bot.sendMessage(chatId, `${MEAL_LABELS[meal]}: ${time}`);
            return;
          }
        }
        bot.sendMessage(chatId, "Неверный формат. Введите время в формате ЧЧ:ММ, например: 07:30");
        return;
      }

      if (state.step === 'nolog_reminder_time') {
        const timeMatch = (msg.text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
        if (timeMatch) {
          const h = parseInt(timeMatch[1]);
          const m = parseInt(timeMatch[2]);
          if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            await storage.updateUser(user.id, { noLogReminderTime: time });
            delete userStates[telegramId];
            bot.sendMessage(chatId, `⚠️ Напоминание «нет записей» установлено на ${time}`);
            return;
          }
        }
        bot.sendMessage(chatId, "Неверный формат. Введите время в формате ЧЧ:ММ, например: 13:30");
        return;
      }

      if (state.step === 'weight_reminder_time') {
        const timeMatch = (msg.text || '').trim().match(/^(\d{1,2}):(\d{2})$/);
        if (timeMatch) {
          const h = parseInt(timeMatch[1]);
          const m = parseInt(timeMatch[2]);
          if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
            const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            await storage.updateUser(user.id, { weightReminderTime: time });
            delete userStates[telegramId];
            bot.sendMessage(chatId, `⚖️ Напоминание взвеситься: ${time}`);
            return;
          }
        }
        bot.sendMessage(chatId, "Неверный формат. Введите время в формате ЧЧ:ММ, например: 08:00");
        return;
      }

      if (state.step === 'ep_age') {
        const v = parseInt(msg.text || '');
        if (isNaN(v) || v < 10 || v > 100) {
          bot.sendMessage(chatId, "Введите корректный возраст (10–100):");
          return;
        }
        await storage.updateUser(user.id, { age: v });
        await storage.calculateAndSetGoals(user.id);
        delete userStates[telegramId];
        bot.sendMessage(chatId, `✅ Возраст обновлён: ${v} лет. Нормы пересчитаны.`);
        return;
      }

      if (state.step === 'ep_weight') {
        const v = parseFloat((msg.text || '').replace(',', '.'));
        if (isNaN(v) || v < 20 || v > 500) {
          bot.sendMessage(chatId, "Введите корректный вес (кг), например: 74.5");
          return;
        }
        await storage.updateUser(user.id, { weight: Math.round(v) });
        await storage.logWeight(user.id, Math.round(v * 10) / 10);
        await storage.calculateAndSetGoals(user.id);
        delete userStates[telegramId];
        bot.sendMessage(chatId, `✅ Вес обновлён: ${v.toFixed(1)} кг. Нормы пересчитаны.`);
        return;
      }

      if (state.step === 'ep_height') {
        const v = parseInt(msg.text || '');
        if (isNaN(v) || v < 100 || v > 250) {
          bot.sendMessage(chatId, "Введите корректный рост (100–250 см):");
          return;
        }
        await storage.updateUser(user.id, { height: v });
        await storage.calculateAndSetGoals(user.id);
        delete userStates[telegramId];
        bot.sendMessage(chatId, `✅ Рост обновлён: ${v} см. Нормы пересчитаны.`);
        return;
      }

      if (state.step === 'ep_calories') {
        const v = parseInt(msg.text || '');
        if (isNaN(v) || v < 500 || v > 10000) {
          bot.sendMessage(chatId, "Введите корректную норму (500–10000 ккал):");
          return;
        }
        const ratio = user.caloriesGoal && user.caloriesGoal > 0 ? v / user.caloriesGoal : 1;
        await storage.updateUser(user.id, {
          caloriesGoal: v,
          proteinGoal: user.proteinGoal ? Math.round(user.proteinGoal * ratio) : Math.round((v * 0.3) / 4),
          fatGoal: user.fatGoal ? Math.round(user.fatGoal * ratio) : Math.round((v * 0.3) / 9),
          carbsGoal: user.carbsGoal ? Math.round(user.carbsGoal * ratio) : Math.round((v * 0.4) / 4),
        });
        delete userStates[telegramId];
        bot.sendMessage(chatId, `✅ Норма калорий установлена: ${v} ккал.`);
        return;
      }

      const val = parseInt(msg.text || "");
      if (state.step === 'age') {
        if (isNaN(val) || val < 10 || val > 100) {
          bot.sendMessage(chatId, "Введите корректный возраст (число от 10 до 100):");
          return;
        }
        state.data.age = val;
        state.step = 'weight';
        bot.sendMessage(chatId, "Ваш текущий вес (кг):");
        return;
      }
      if (state.step === 'weight') {
        if (isNaN(val) || val < 30 || val > 250) {
          bot.sendMessage(chatId, "Введите корректный вес (число от 30 до 250):");
          return;
        }
        state.data.weight = val;
        state.step = 'height';
        bot.sendMessage(chatId, "Ваш рост (см):");
        return;
      }
      if (state.step === 'height') {
        if (isNaN(val) || val < 100 || val > 250) {
          bot.sendMessage(chatId, "Введите корректный рост (число от 100 до 250):");
          return;
        }
        state.data.height = val;
        state.step = 'activity';
        bot.sendMessage(chatId, "Ваш уровень активности:", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Сидячий (мало шагов, нет спорта)", callback_data: "set_activity_sedentary" }],
              [{ text: "Малоактивный (8-10к шагов, нет спорта)", callback_data: "set_activity_light" }],
              [{ text: "Умеренный (шаги + 2-3 тренировки)", callback_data: "set_activity_moderate" }],
              [{ text: "Активный (шаги + 4-5 тренировок)", callback_data: "set_activity_active" }],
              [{ text: "Очень активный (тяж. спорт/труд)", callback_data: "set_activity_very_active" }]
            ]
          }
        });
        return;
      }
    }

    // Handle Text
    if (msg.text) {
      console.log("Text received:", msg.text);
      const statusMsg = await bot.sendMessage(chatId, "🔍 Анализирую...");
      try {
        const intent = await classifyIntent(msg.text);
        console.log("Intent:", intent);

        if (intent === "workout" || intent === "both") {
          const weightKg = user.weight ?? 75;
          const workout = await analyzeWorkout(msg.text, weightKg);
          if (workout) {
            pendingWorkouts[telegramId] = workout;
            await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
            const durationText = workout.durationMin ? ` · ${workout.durationMin} мин` : '';
            bot.sendMessage(chatId,
              `🏋️ *${workout.description}*\n🔥 Сожжено: ~${workout.caloriesBurned} ккал${durationText}\n\nСохранить тренировку?`,
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [[
                    { text: "✅ Сохранить", callback_data: "workout_save" },
                    { text: "❌ Отмена", callback_data: "workout_cancel" }
                  ]]
                }
              }
            );
            if (intent === "both") {
              const items = await analyzeFoodText(msg.text);
              if (items && items.length > 0) await processFoodItems(chatId, telegramId, items);
            }
            return;
          }
        }

        if (intent === "food" || intent === "both" || intent === "other") {
          const items = await analyzeFoodText(msg.text);
          await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
          if (items && items.length > 0) {
            await processFoodItems(chatId, telegramId, items);
          } else if (intent === "other") {
            bot.sendMessage(chatId, "Не понял. Напиши что ты съел или какую тренировку сделал.");
          } else {
            bot.sendMessage(chatId, "Не удалось распознать еду. Попробуй описать точнее.");
          }
        }
      } catch (err) {
        console.error("Error processing text:", err);
        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        bot.sendMessage(chatId, "Произошла ошибка при анализе текста.");
      }
    }

    // Handle Photo
    if (msg.photo) {
      console.log("Photo received, processing...");
      const statusMsg = await bot.sendMessage(chatId, "📷 Анализирую фото...");
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      try {
        const file = await bot.getFile(fileId);
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const fileLink = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

        const imgResponse = await fetch(fileLink);
        if (!imgResponse.ok) throw new Error(`Failed to fetch image: ${imgResponse.status}`);

        const arrayBuffer = await imgResponse.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString("base64");

        // Step 1: Try barcode detection
        const barcode = await detectBarcode(base64);
        let analysis: any = null;
        let barcodeSource = false;

        if (barcode) {
          console.log("Barcode detected:", barcode);
          await bot.editMessageText(`🔍 Найден штрихкод: ${barcode}\nИщу в базе продуктов...`, {
            chat_id: chatId,
            message_id: statusMsg.message_id,
          });
          const barcodeResult = await lookupBarcodeProduct(barcode);
          if (barcodeResult) {
            console.log("Barcode product found:", barcodeResult.foodName);
            analysis = barcodeResult;
            barcodeSource = true;
          } else {
            console.log("Barcode not found in DB, falling back to vision...");
            await bot.editMessageText("🔍 Штрихкод не найден в базе, анализирую визуально...", {
              chat_id: chatId,
              message_id: statusMsg.message_id
            });
          }
        }

        // Step 2: Fall back to GPT-4o vision
        if (!analysis) {
          analysis = await analyzeFoodImage(base64);
          console.log("Vision analysis result:", analysis);
        }

        await bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});

        if (analysis && analysis.foodName) {
          (bot as any).pendingLogs = (bot as any).pendingLogs || {};
          (bot as any).pendingLogs[telegramId] = analysis;

          const unit = getUnit(analysis.foodName);
          const prefix = barcodeSource ? `📦 Найдено по штрихкоду\n\n` : "";
          const confirmText = prefix + buildConfirmMessage(analysis, user.showMicronutrients ?? false);
          bot.sendMessage(chatId, confirmText, {
            parse_mode: 'Markdown',
            reply_markup: buildConfirmKeyboard(unit)
          });
        } else {
          bot.sendMessage(chatId, "Не удалось распознать еду на фото. Попробуйте более чёткий снимок.");
        }
      } catch (err: any) {
        console.error("Error processing photo:", err);
        bot.deleteMessage(chatId, statusMsg.message_id).catch(() => {});
        bot.sendMessage(chatId, "Произошла ошибка при обработке фото.");
      }
    }

    // Handle Voice
    if (msg.voice) {
      bot.sendMessage(chatId, "🎤 Распознаю голосовое сообщение...");
      try {
        const file = await bot.getFile(msg.voice.file_id);
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const fileLink = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;

        const audioResponse = await fetch(fileLink);
        if (!audioResponse.ok) throw new Error(`Failed to fetch voice: ${audioResponse.status}`);

        const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
        const transcript = await transcribeVoice(audioBuffer);

        if (!transcript) {
          const hasKey = !!process.env.OPENAI_API_KEY;
          bot.sendMessage(chatId, hasKey
            ? "Не удалось распознать голосовое сообщение. Попробуйте ещё раз."
            : "Голосовые сообщения требуют личного ключа OpenAI. Добавьте OPENAI_API_KEY в секреты проекта."
          );
          return;
        }

        console.log("Voice transcription:", transcript);
        bot.sendMessage(chatId, `🗣 "${transcript}"\n\nАнализирую...`);

        const items = await analyzeFoodText(transcript);
        if (items && items.length > 0) {
          await processFoodItems(chatId, telegramId, items);
        } else {
          bot.sendMessage(chatId, "Не удалось распознать еду из голосового сообщения. Попробуй описать точнее.");
        }
      } catch (err) {
        console.error("Error processing voice:", err);
        bot.sendMessage(chatId, "Произошла ошибка при обработке голосового сообщения.");
      }
    }
  });

  console.log("Telegram Bot started!");
}
