import TelegramBot from "node-telegram-bot-api";
import ExcelJS from "exceljs";
import { IStorage } from "./storage";
import { analyzeFoodText, analyzeFoodImage } from "./openai";

export function setupBot(storage: IStorage) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set. Bot will not start.");
    return;
  }

  const bot = new TelegramBot(token, { polling: true });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    const username = msg.from?.username;

    if (!telegramId) return;

    let user = await storage.getUserByTelegramId(telegramId);
    if (!user) {
      user = await storage.createUser({ telegramId, username });
    }

    bot.sendMessage(chatId, "Привет! Я помогу тебе считать калории. Отправь мне фото еды или напиши, что ты съел (например, 'яблоко 100г').\n\nКоманды:\n/stats - статистика за сегодня\n/history - последние записи\n/export ДД.ММ.ГГГГ [ - ДД.ММ.ГГГГ ] - выгрузка в Excel");
  });

  bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await storage.getUserByTelegramId(telegramId);
    if (!user) {
      bot.sendMessage(chatId, "Сначала нажми /start");
      return;
    }

    const today = new Date();
    const stats = await storage.getDailyStats(user.id, today);
    
    bot.sendMessage(chatId, `Твоя статистика за сегодня:\nКкал: ${stats.calories}\nБелки: ${stats.protein}г\nЖиры: ${stats.fat}г\nУглеводы: ${stats.carbs}г`);
  });

  bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId) return;

    const user = await storage.getUserByTelegramId(telegramId);
    if (!user) return;

    const logs = await storage.getFoodLogs(user.id);
    if (logs.length === 0) {
      bot.sendMessage(chatId, "История пуста.");
      return;
    }

    const historyText = logs.slice(0, 10).map(l => 
      `${l.date?.toLocaleDateString()}: ${l.foodName} (${l.calories} ккал)`
    ).join('\n');

    bot.sendMessage(chatId, `Последние записи:\n${historyText}`);
  });

  bot.onText(/\/export (\d{2}\.\d{2}\.\d{4})(?: - (\d{2}\.\d{2}\.\d{4}))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    if (!telegramId || !match) return;

    const user = await storage.getUserByTelegramId(telegramId);
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

  bot.on("callback_query", async (query) => {
    // Keep callback query handler for other potential needs, but remove export logic if not needed
    // or just leave as is if no other callback queries exist. 
    // Since we only had export_xls and export_pdf, and we are removing the choice, 
    // this handler might become redundant for exports.
    bot.answerCallbackQuery(query.id);
  });

  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from?.id.toString();
    
    if (!telegramId) return;
    if (msg.text?.startsWith('/')) return; // Ignore commands

    let user = await storage.getUserByTelegramId(telegramId);
    if (!user) {
       // Auto-register if not started
       user = await storage.createUser({ telegramId, username: msg.from?.username });
    }

    // Handle Text
    if (msg.text) {
      console.log("Text received:", msg.text);
      bot.sendMessage(chatId, "Анализирую текст...");
      try {
        const analysis = await analyzeFoodText(msg.text);
        console.log("Text analysis result:", analysis);
        if (analysis && analysis.foodName) {
          await storage.createFoodLog({
            userId: user.id,
            foodName: analysis.foodName,
            calories: Math.round(Number(analysis.calories)) || 0,
            protein: Math.round(Number(analysis.protein)) || 0,
            fat: Math.round(Number(analysis.fat)) || 0,
            carbs: Math.round(Number(analysis.carbs)) || 0,
            weight: Math.round(Number(analysis.weight)) || 0,
            mealType: analysis.mealType || 'snack'
          });
          
          bot.sendMessage(chatId, `Записал: ${analysis.foodName}\nКкал: ${analysis.calories} | Б: ${analysis.protein} | Ж: ${analysis.fat} | У: ${analysis.carbs}`);
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
        // Ensure token is available here
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        const fileLink = `https://api.telegram.org/file/bot${botToken}/${file.file_path}`;
        console.log("File link generated:", fileLink);
        
        const imgResponse = await fetch(fileLink);
        if (!imgResponse.ok) {
           throw new Error(`Failed to fetch image: ${imgResponse.status} ${imgResponse.statusText}`);
        }
        const arrayBuffer = await imgResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');

        const analysis = await analyzeFoodImage(base64);
        console.log("Vision analysis result:", analysis);
        
        if (analysis && analysis.foodName) {
           await storage.createFoodLog({
            userId: user.id,
            foodName: analysis.foodName,
            calories: Math.round(Number(analysis.calories)) || 0,
            protein: Math.round(Number(analysis.protein)) || 0,
            fat: Math.round(Number(analysis.fat)) || 0,
            carbs: Math.round(Number(analysis.carbs)) || 0,
            weight: Math.round(Number(analysis.weight)) || 0,
            mealType: analysis.mealType || 'snack'
          });
          
          bot.sendMessage(chatId, `Записал: ${analysis.foodName}\nКкал: ${analysis.calories} | Б: ${analysis.protein} | Ж: ${analysis.fat} | У: ${analysis.carbs}`);
        } else {
          bot.sendMessage(chatId, "Не удалось распознать еду на фото. Попробуйте более четкий снимок.");
        }
      } catch (err: any) {
        console.error("Error processing photo:", err);
        bot.sendMessage(chatId, "Произошла ошибка при обработке фото. Проверьте размер файла или попробуйте позже.");
      }
    }
  });

  console.log("Telegram Bot started!");
}
