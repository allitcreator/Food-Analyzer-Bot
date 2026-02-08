import TelegramBot from "node-telegram-bot-api";
import { IStorage } from "./storage";
import { analyzeFoodText, analyzeFoodImage } from "./openai";

export function setupBot(storage: IStorage) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set. Bot will not start.");
    return;
  }

  const bot = new TelegramBot(token, { polling: true });

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
      bot.sendMessage(chatId, "Анализирую текст...");
      const analysis = await analyzeFoodText(msg.text);
      if (analysis && analysis.foodName) {
        await storage.createFoodLog({
          userId: user.id,
          foodName: analysis.foodName,
          calories: analysis.calories,
          protein: analysis.protein,
          fat: analysis.fat,
          carbs: analysis.carbs,
          weight: analysis.weight,
          mealType: analysis.mealType || 'snack'
        });
        
        bot.sendMessage(chatId, `Записал: ${analysis.foodName}\nКкал: ${analysis.calories} | Б: ${analysis.protein} | Ж: ${analysis.fat} | У: ${analysis.carbs}`);
      } else {
        bot.sendMessage(chatId, "Не удалось распознать еду. Попробуй еще раз.");
      }
    }

    // Handle Photo
    if (msg.photo) {
      bot.sendMessage(chatId, "Анализирую фото...");
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      try {
        const fileLink = await bot.getFileLink(fileId);
        
        // Fetch the image
        const response = await fetch(fileLink);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');

        const analysis = await analyzeFoodImage(base64);
        
        if (analysis && analysis.foodName) {
           await storage.createFoodLog({
            userId: user.id,
            foodName: analysis.foodName,
            calories: analysis.calories,
            protein: analysis.protein,
            fat: analysis.fat,
            carbs: analysis.carbs,
            weight: analysis.weight,
            mealType: analysis.mealType || 'snack'
          });
          
          bot.sendMessage(chatId, `Записал: ${analysis.foodName}\nКкал: ${analysis.calories} | Б: ${analysis.protein} | Ж: ${analysis.fat} | У: ${analysis.carbs}`);
        } else {
          bot.sendMessage(chatId, "Не удалось распознать еду на фото.");
        }
      } catch (err) {
        console.error("Error processing photo:", err);
        bot.sendMessage(chatId, "Произошла ошибка при обработке фото.");
      }
    }
  });

  console.log("Telegram Bot started!");
}
