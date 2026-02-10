import TelegramBot from "node-telegram-bot-api";
import ExcelJS from "exceljs";
import { IStorage } from "./storage";
import { analyzeFoodText, analyzeFoodImage } from "./openai";

export function setupBot(storage: IStorage) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID;

  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set. Bot will not start.");
    return;
  }

  const bot = new TelegramBot(token, { polling: true });

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
    
    bot.sendMessage(chatId, `Твоя статистика за сегодня:\nКкал: ${stats.calories}\nБелки: ${stats.protein}г\nЖиры: ${stats.fat}г\nУглеводы: ${stats.carbs}г`);
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
        await storage.createFoodLog({
          userId: user.id,
          foodName: pending.foodName,
          calories: Math.round(Number(pending.calories)) || 0,
          protein: Math.round(Number(pending.protein)) || 0,
          fat: Math.round(Number(pending.fat)) || 0,
          carbs: Math.round(Number(pending.carbs)) || 0,
          weight: Math.round(Number(pending.weight)) || 0,
          mealType: pending.mealType || 'snack'
        });
        bot.editMessageText(`✅ Добавлено: ${pending.foodName} (${pending.weight}г)`, {
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
      const newWeight = action === "plus" ? oldWeight + amount : Math.max(0, oldWeight - amount);
      
      if (newWeight === oldWeight) return;

      // Recalculate nutrients based on new weight
      const ratio = newWeight / oldWeight;
      pending.weight = newWeight;
      pending.calories = Math.round(pending.calories * ratio);
      pending.protein = Math.round(pending.protein * ratio);
      pending.fat = Math.round(pending.fat * ratio);
      pending.carbs = Math.round(pending.carbs * ratio);

      const unit = pending.foodName.toLowerCase().match(/(сок|вода|чай|кофе|пиво|вино|молоко|кефир|напиток|бульон|суп|кола|пепси|лимонад|смузи|йогурт питьевой|латте|капучино|американо|раф|маккиато|флэт уайт|водка|виски|ром|джин|коньяк|сидр|шампанское|какао|морс|компот|энергетик|квас|мартини|текила|ликёр|абсент|настойка)/i) ? 'мл' : 'г';
      
      bot.editMessageText(`Распознано: ${pending.foodName}\nКкал: ${pending.calories} | Б: ${pending.protein} | Ж: ${pending.fat} | У: ${pending.carbs}\nОбъем: ${pending.weight}${unit}\n\nДобавить в дневник?`, {
        chat_id: chatId,
        message_id: query.message?.message_id,
        reply_markup: {
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
        }
      });
    } else if (query.data.startsWith("delete_log_")) {
      const logId = parseInt(query.data.split("_")[2]);
      await storage.deleteFoodLog(logId);
      bot.editMessageText("🗑 Запись удалена", {
        chat_id: chatId,
        message_id: query.message?.message_id
      });
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

    // Handle Text
    if (msg.text) {
      console.log("Text received:", msg.text);
      bot.sendMessage(chatId, "Анализирую текст...");
      try {
        const analysis = await analyzeFoodText(msg.text);
        console.log("Text analysis result:", analysis);
        if (analysis && analysis.foodName) {
          (bot as any).pendingLogs = (bot as any).pendingLogs || {};
          (bot as any).pendingLogs[telegramId] = analysis;

          const unit = (analysis.foodName.toLowerCase().match(/(сок|вода|чай|кофе|пиво|вино|молоко|кефир|напиток|бульон|суп|кола|пепси|лимонад|смузи|йогурт питьевой|латте|капучино|американо|раф|маккиато|флэт уайт|водка|виски|ром|джин|коньяк|сидр|шампанское|какао|морс|компот|энергетик|квас|мартини|текила|ликёр|абсент|настойка)/i)) ? 'мл' : 'г';

          bot.sendMessage(chatId, `Распознано: ${analysis.foodName}\nКкал: ${analysis.calories} | Б: ${analysis.protein} | Ж: ${analysis.fat} | У: ${analysis.carbs}\n${unit === 'мл' ? 'Объем' : 'Вес'}: ${analysis.weight}${unit}\n\nДобавить в дневник?`, {
            reply_markup: {
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
            }
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

          const unit = (analysis.foodName.toLowerCase().match(/(сок|вода|чай|кофе|пиво|вино|молоко|кефир|напиток|бульон|суп|кола|пепси|лимонад|смузи|йогурт питьевой|латте|капучино|американо|раф|маккиато|флэт уайт|водка|виски|ром|джин|коньяк|сидр|шампанское|какао|морс|компот|энергетик|квас|мартини|текила|ликёр|абсент|настойка)/i)) ? 'мл' : 'г';

          bot.sendMessage(chatId, `Распознано: ${analysis.foodName}\nКкал: ${analysis.calories} | Б: ${analysis.protein} | Ж: ${analysis.fat} | У: ${analysis.carbs}\n${unit === 'мл' ? 'Объем' : 'Вес'}: ${analysis.weight}${unit}\n\nДобавить в дневник?`, {
            reply_markup: {
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
            }
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

          const unit = (analysis.foodName.toLowerCase().match(/(сок|вода|чай|кофе|пиво|вино|молоко|кефир|напиток|бульон|суп|кола|пепси|лимонад|смузи|йогурт питьевой|латте|капучино|американо|раф|маккиато|флэт уайт|водка|виски|ром|джин|коньяк|сидр|шампанское|какао|морс|компот|энергетик|квас|мартини|текила|ликёр|абсент|настойка)/i)) ? 'мл' : 'г';

          bot.sendMessage(chatId, `Распознано: ${analysis.foodName}\nКкал: ${analysis.calories} | Б: ${analysis.protein} | Ж: ${analysis.fat} | У: ${analysis.carbs}\n${unit === 'мл' ? 'Объем' : 'Вес'}: ${analysis.weight}${unit}\n\nДобавить в дневник?`, {
            reply_markup: {
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
            }
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
