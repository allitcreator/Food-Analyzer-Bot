import TelegramBot from "node-telegram-bot-api";
import ExcelJS from "exceljs";
import { IStorage } from "./storage";
import { analyzeFoodText, analyzeFoodImage, generateEveningReport } from "./openai";
import { User } from "@shared/schema";

const LIQUID_PATTERN = /(сок|вода|чай|кофе|пиво|вино|молоко|кефир|напиток|бульон|суп|кола|пепси|лимонад|смузи|йогурт питьевой|латте|капучино|американо|раф|маккиато|флэт уайт|водка|виски|ром|джин|коньяк|сидр|шампанское|какао|морс|компот|энергетик|квас|мартини|текила|ликёр|абсент|настойка)/i;

const WATER_TEXT_PATTERN = /^(?:(?:вод[аыу]?\s+(\d+)\s*(?:мл)?)|(?:(\d+)\s*(?:мл)?\s+вод[аыу]?))$/i;

function getUnit(foodName: string): string {
  return foodName.toLowerCase().match(LIQUID_PATTERN) ? 'мл' : 'г';
}

function buildConfirmMessage(analysis: any): string {
  const unit = getUnit(analysis.foodName);
  let msg = `Распознано: ${analysis.foodName}\nКкал: ${analysis.calories} | Б: ${analysis.protein} | Ж: ${analysis.fat} | У: ${analysis.carbs}\n${unit === 'мл' ? 'Объем' : 'Вес'}: ${analysis.weight}${unit}`;
  if (analysis.foodScore) msg += `\nОценка полезности: ${analysis.foodScore}/10`;
  if (analysis.nutritionAdvice) msg += `\n\n${analysis.nutritionAdvice}`;
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
      "/start - Начать работу с ботом",
      "/profile - Настроить профиль (пол, возраст, вес, рост, активность, цель) и рассчитать норму КБЖУ",
      "/stats - Статистика за сегодня: калории, БЖУ, вода",
      "/water - Трекер воды: добавить выпитое за день",
      "/history - Последние записи еды с возможностью удаления",
      "/export ДД.ММ.ГГГГ [ - ДД.ММ.ГГГГ] - Экспорт дневника в Excel",
      "/clear ДД.ММ.ГГГГ [ - ДД.ММ.ГГГГ] - Очистить записи за период",
      "/report - Вечерний отчёт с рекомендациями ИИ (вручную)",
      "/report_time - Настроить время автоматического отчёта",
      "/reminders - Напоминания о приёмах пищи (завтрак, обед, ужин)",
      "/users - (Админ) Управление пользователями",
      "",
      "Отправьте текст с описанием еды или фото - бот распознает продукты и посчитает КБЖУ."
    ].join("\n");
    bot.sendMessage(chatId, helpText);
  });

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
      bot.sendMessage(chatId, "Привет! Я помогу тебе считать калории. Отправь мне фото еды или напиши, что ты съел (например, 'яблоко 100г').\n\nКоманды:\n/stats - статистика за сегодня\n/history - последние записи\n/export ДД.ММ.ГГГГ [ - ДД.ММ.ГГГГ ] - выгрузка в Excel\n/clear ДД.ММ.ГГГГ [ - ДД.ММ.ГГГГ ] - очистка истории");
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
    const stats = await storage.getDailyStats(user.id, today);

    const waterTotal = await storage.getDailyWater(user.id, today);
    const waterGoal = 2500;
    
    let text = `Твоя статистика за сегодня:\n`;
    text += `Ккал: ${stats.calories}${user.caloriesGoal ? ` / ${user.caloriesGoal}` : ''}\n`;
    text += `Белки: ${stats.protein}г${user.proteinGoal ? ` / ${user.proteinGoal}г` : ''}\n`;
    text += `Жиры: ${stats.fat}г${user.fatGoal ? ` / ${user.fatGoal}г` : ''}\n`;
    text += `Углеводы: ${stats.carbs}г${user.carbsGoal ? ` / ${user.carbsGoal}г` : ''}`;
    text += `\nВода: ${waterTotal}мл / ${waterGoal}мл`;

    if (user.caloriesGoal) {
      const percent = Math.round((stats.calories / user.caloriesGoal) * 100);
      text += `\n\nПрогресс по калориям: ${percent}%`;
    }

    bot.sendMessage(chatId, text);
  });

  bot.onText(/\/water/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

    const today = new Date();
    const waterTotal = await storage.getDailyWater(user.id, today);
    const waterGoal = 2500;

    bot.sendMessage(chatId, `Вода за сегодня: ${waterTotal}мл / ${waterGoal}мл\n\nСколько выпили?`, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "150мл", callback_data: "water_150" },
            { text: "250мл", callback_data: "water_250" },
            { text: "500мл", callback_data: "water_500" }
          ]
        ]
      }
    });
  });

  async function sendEveningReport(user: User) {
    const today = new Date();
    const stats = await storage.getDailyStats(user.id, today);
    const foodLogs = await storage.getFoodLogsInRange(user.id, (() => { const d = new Date(today); d.setHours(0,0,0,0); return d; })(), (() => { const d = new Date(today); d.setHours(23,59,59,999); return d; })());
    const waterTotal = await storage.getDailyWater(user.id, today);

    const report = await generateEveningReport(
      foodLogs.map(f => ({ foodName: f.foodName, calories: f.calories, protein: f.protein, fat: f.fat, carbs: f.carbs, weight: f.weight, foodScore: f.foodScore })),
      { calories: stats.calories, protein: stats.protein, fat: stats.fat, carbs: stats.carbs },
      { caloriesGoal: user.caloriesGoal, proteinGoal: user.proteinGoal, fatGoal: user.fatGoal, carbsGoal: user.carbsGoal },
      waterTotal
    );

    if (report) {
      let text = `Вечерний отчёт\n\n`;
      text += `Итого за день: ${stats.calories} ккал | Б${stats.protein}г Ж${stats.fat}г У${stats.carbs}г\n`;
      text += `Вода: ${waterTotal}мл / 2500мл\n\n`;
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
    await sendEveningReport(user);
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

    const formatTime = (t: string) => t === 'off' ? 'выкл' : t;

    bot.sendMessage(chatId, `Напоминания о приёмах пищи:\n\nЗавтрак: ${formatTime(br)}\nОбед: ${formatTime(lu)}\nУжин: ${formatTime(di)}\n\nВыберите, что настроить:`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: `Завтрак (${formatTime(br)})`, callback_data: "rmnd_breakfast" }],
          [{ text: `Обед (${formatTime(lu)})`, callback_data: "rmnd_lunch" }],
          [{ text: `Ужин (${formatTime(di)})`, callback_data: "rmnd_dinner" }],
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
    }
  }

  setTimeout(() => checkScheduledNotifications(), 5000);
  setInterval(checkScheduledNotifications, 60000);

  const userStates: Record<string, { step: string; data: Partial<User> & { reminderMeal?: string } }> = {};

  bot.onText(/\/profile/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await isUserAllowed(chatId, telegramId);
    if (!user) return;

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
          nutritionAdvice: pending.nutritionAdvice || null
        });
        bot.editMessageText(`✅ Добавлено: ${pending.foodName} (${pending.weight}${unit})`, {
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

      const unit = getUnit(pending.foodName);
      bot.editMessageText(buildConfirmMessage(pending), {
        chat_id: chatId,
        message_id: query.message?.message_id,
        reply_markup: buildConfirmKeyboard(unit)
      });
    } else if (query.data.startsWith("delete_log_")) {
      const logId = parseInt(query.data.split("_")[2]);
      await storage.deleteFoodLog(logId);
      bot.editMessageText("🗑 Запись удалена", {
        chat_id: chatId,
        message_id: query.message?.message_id
      });
    } else if (query.data.startsWith("water_")) {
      const amount = parseInt(query.data.split("_")[1]);
      if (![150, 250, 500].includes(amount)) return;
      if (!user.isApproved && user.telegramId !== process.env.ADMIN_TELEGRAM_ID) return;
      await storage.logWater(user.id, amount);
      const waterTotal = await storage.getDailyWater(user.id, new Date());
      const waterGoal = 2500;
      bot.editMessageText(`Записано +${amount}мл\n\nВода за сегодня: ${waterTotal}мл / ${waterGoal}мл\n\nСколько ещё выпили?`, {
        chat_id: chatId,
        message_id: query.message?.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "150мл", callback_data: "water_150" },
              { text: "250мл", callback_data: "water_250" },
              { text: "500мл", callback_data: "water_500" }
            ]
          ]
        }
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
        bot.editMessageText("Все напоминания выключены.", {
          chat_id: chatId,
          message_id: query.message?.message_id
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
      const meal = query.data.replace("rmcustom_", "") as 'breakfast' | 'lunch' | 'dinner';
      userStates[telegramId] = { step: 'reminder_time', data: { reminderMeal: meal } };
      bot.editMessageText(`Введите время для напоминания "${MEAL_LABELS[meal]}" в формате ЧЧ:ММ\nНапример: 07:30`, {
        chat_id: chatId,
        message_id: query.message?.message_id
      });
    } else if (query.data.startsWith("rmset_")) {
      const parts = query.data.replace("rmset_", "").split("_");
      const meal = parts[0] as 'breakfast' | 'lunch' | 'dinner';
      const time = parts[1];
      await storage.updateUserReminder(user.id, meal, time);
      const label = time === 'off' ? 'выкл' : time;
      bot.editMessageText(`${MEAL_LABELS[meal]}: ${label}`, {
        chat_id: chatId,
        message_id: query.message?.message_id
      });
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
      const waterMatch = msg.text.trim().match(WATER_TEXT_PATTERN);
      if (waterMatch) {
        const amount = parseInt(waterMatch[1] || waterMatch[2]);
        if (amount > 0 && amount <= 5000) {
          await storage.logWater(user.id, amount);
          const waterTotal = await storage.getDailyWater(user.id, new Date());
          const waterGoal = 2500;
          bot.sendMessage(chatId, `Записано +${amount}мл воды\n\nВода за сегодня: ${waterTotal}мл / ${waterGoal}мл`);
          return;
        }
      }

      console.log("Text received:", msg.text);
      bot.sendMessage(chatId, "Анализирую текст...");
      try {
        const analysis = await analyzeFoodText(msg.text);
        console.log("Text analysis result:", analysis);
        if (analysis && analysis.foodName) {
          (bot as any).pendingLogs = (bot as any).pendingLogs || {};
          (bot as any).pendingLogs[telegramId] = analysis;

          const unit = getUnit(analysis.foodName);
          bot.sendMessage(chatId, buildConfirmMessage(analysis), {
            reply_markup: buildConfirmKeyboard(unit)
          });
        } else {
          bot.sendMessage(chatId, "Не удалось распознать еду. Попробуй описать точнее.");
        }
      } catch (err) {
        console.error("Error processing text:", err);
        bot.sendMessage(chatId, "Произошла ошибка при анализе текста.");
      }
    }

    // Handle Photo
    if (msg.photo) {
      console.log("Photo received, processing...");
      bot.sendMessage(chatId, "Анализирую фото...");
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      try {
        const file = await bot.getFile(fileId);
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const fileLink = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
        
        const imgResponse = await fetch(fileLink);
        if (!imgResponse.ok) throw new Error(`Failed to fetch image: ${imgResponse.status}`);
        
        const arrayBuffer = await imgResponse.arrayBuffer();
        const base64 = Buffer.from(arrayBuffer).toString('base64');

        const analysis = await analyzeFoodImage(base64);
        console.log("Vision analysis result:", analysis);
        
        if (analysis && analysis.foodName) {
          (bot as any).pendingLogs = (bot as any).pendingLogs || {};
          (bot as any).pendingLogs[telegramId] = analysis;

          const unit = getUnit(analysis.foodName);
          bot.sendMessage(chatId, buildConfirmMessage(analysis), {
            reply_markup: buildConfirmKeyboard(unit)
          });
        } else {
          bot.sendMessage(chatId, "Не удалось распознать еду на фото. Попробуйте более четкий снимок.");
        }
      } catch (err: any) {
        console.error("Error processing photo:", err);
        bot.sendMessage(chatId, "Произошла ошибка при обработке фото.");
      }
    }

    // Handle Voice
    if (msg.voice) {
      console.log("Voice message received:", JSON.stringify(msg.voice, null, 2));
      // Check for transcription in various possible fields
      const telegramTranscript = (msg as any).voice.transcription?.text || (msg as any).voice.text;
      
      if (telegramTranscript) {
        console.log("Using Telegram's transcription:", telegramTranscript);
        bot.sendMessage(chatId, `Текст: "${telegramTranscript}"\nАнализирую...`);
        const analysis = await analyzeFoodText(telegramTranscript);
        if (analysis && analysis.foodName) {
          (bot as any).pendingLogs = (bot as any).pendingLogs || {};
          (bot as any).pendingLogs[telegramId] = analysis;

          const unit = getUnit(analysis.foodName);
          bot.sendMessage(chatId, buildConfirmMessage(analysis), {
            reply_markup: buildConfirmKeyboard(unit)
          });
        } else {
          bot.sendMessage(chatId, "Не удалось распознать еду в вашем сообщении.");
        }
      } else {
        // If not found in the immediate message, maybe it comes as a separate update or field
        // For now, let's log the full message to see where the text might be
        console.log("Full message object:", JSON.stringify(msg, null, 2));
        bot.sendMessage(chatId, "Голос получен, но текст расшифровки не найден. Убедитесь, что в настройках Telegram включена расшифровка или подождите пару секунд.");
      }
    }
  });

  console.log("Telegram Bot started!");
}
