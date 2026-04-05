import OpenAI from "openai";
import { config } from "./config";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

// Chat + Vision via OpenRouter
const openai = new OpenAI({
  apiKey: config.openrouterApiKey,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://alxthecreatortg.ru",
    "X-Title": "Food Analyzer Bot",
  },
});


export async function analyzeFoodText(
  text: string,
  currentTime?: Date,
  mealBoundaries?: { breakfastEnd: string; lunchEnd: string }
): Promise<FoodItem[] | null> {
  try {
    // Determine default mealType based on Moscow time
    let timeHint = '';
    if (currentTime) {
      const h = currentTime.getHours();
      const m = currentTime.getMinutes();
      const totalMin = h * 60 + m;

      const bfEnd = mealBoundaries?.breakfastEnd ?? '12:30';
      const lnEnd = mealBoundaries?.lunchEnd ?? '16:30';
      const [bfH, bfM] = bfEnd.split(':').map(Number);
      const [lnH, lnM] = lnEnd.split(':').map(Number);
      const bfEndMin = bfH * 60 + bfM;
      const lnEndMin = lnH * 60 + lnM;

      let defaultMeal: string;
      if (totalMin >= 300 && totalMin <= bfEndMin) {
        defaultMeal = 'breakfast';
      } else if (totalMin > bfEndMin && totalMin <= lnEndMin) {
        defaultMeal = 'lunch';
      } else {
        defaultMeal = 'dinner';
      }
      timeHint = `\nCurrent time: ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}. Default mealType (when user does NOT explicitly mention a meal): "${defaultMeal}".
If the user explicitly says "на завтрак/breakfast", "на обед/lunch", "на ужин/dinner", or "перекус/snack" — use that instead of the default.
The user may describe multiple meals in one message (e.g. "на завтрак съел X, на обед съел Y") — assign the correct mealType to each item based on context.`;
    }

    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      max_tokens: 2048,
      messages: [
        {
          role: "system",
          content: `You are a nutrition expert. The user may describe one or multiple food items in a single message. They may describe food from different meals (breakfast, lunch, dinner, snack) in one message.

Split the message into individual food items/dishes. For each item:
1. Identify the exact food name (in Russian if the user wrote in Russian).
2. Parse quantities: "2 яйца" = two eggs (~120g total), "кусок хлеба" = one slice (~30g), "тарелка супа" = ~300ml.
3. If no portion is specified, assume a typical serving size (e.g., 1 egg = ~60g, 1 cup of rice/buckwheat = ~180g cooked, 1 slice of bread = ~30g, 1 apple = ~180g, 1 cup of soup = ~300ml). Reflect the assumed weight in the "weight" field.
4. Find accurate nutrition data per the specified or estimated portion.
5. Rate nutritional quality 1-10 (10 = very healthy, 1 = very unhealthy).
6. Write a brief nutrition advice in Russian (1-2 sentences) ONLY if foodScore <= 5. For healthy foods (foodScore > 5), set nutritionAdvice to empty string "".
7. Estimate micronutrients based on typical composition.
8. Determine mealType: use the user's explicit mention (завтрак/обед/ужин/перекус) if present, otherwise use the default based on current time.
${timeHint}
Return ONLY a JSON object with a single key "items" containing an array. Each element:
- foodName (string)
- calories (number)
- protein (number, grams)
- fat (number, grams)
- carbs (number, grams)
- weight (number, grams or ml for liquids)
- mealType (STRICTLY one of: "breakfast" | "lunch" | "dinner" | "snack" — always in English, never in Russian or other languages)
- foodScore (number, 1-10)
- nutritionAdvice (string, Russian)
- fiber (number, grams — dietary fiber)
- sugar (number, grams — total sugars)
- sodium (number, milligrams)
- saturatedFat (number, grams)

Example output: {"items": [{...}, {...}]}`
        },
        { role: "user", content: text }
      ],
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    if (Array.isArray(parsed.items) && parsed.items.length > 0) {
      // Normalize mealType — AI sometimes returns Russian names
      const mealTypeMap: Record<string, string> = {
        'завтрак': 'breakfast', 'breakfast': 'breakfast',
        'обед': 'lunch', 'lunch': 'lunch',
        'ужин': 'dinner', 'dinner': 'dinner',
        'перекус': 'snack', 'snack': 'snack',
      };
      for (const item of parsed.items) {
        item.mealType = mealTypeMap[(item.mealType || '').toLowerCase()] || 'snack';
      }
      return parsed.items as FoodItem[];
    }
    return null;
  } catch (error) {
    console.error("OpenAI Text Analysis Error:", error);
    return null;
  }
}

export type MessageIntent = "food" | "workout" | "both" | "other";

export async function classifyIntent(text: string): Promise<MessageIntent> {
  try {
    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      max_tokens: 50,
      messages: [
        {
          role: "system",
          content: `Classify the user's message into one of these categories:
- "food": describes food eaten, drinks, meals
- "workout": describes physical activity (steps, running, gym, cycling, swimming, elliptical, etc.) or calories burned during exercise
- "both": describes both food and physical activity
- "other": unrelated to food or exercise (e.g. greetings, questions, emotions)

Edge cases:
- "протеиновый коктейль после тренировки" → "food" (it's a consumed product, not an exercise)
- "пробежал 5 км и съел банан" → "both"
- "10000 шагов" → "workout"
- "выпил воды" → "other" (water tracking is separate)

Return ONLY a JSON object: {"intent": "food"|"workout"|"both"|"other"}`
        },
        { role: "user", content: text }
      ],
      response_format: { type: "json_object" }
    });
    const result = JSON.parse(response.choices[0].message.content || '{"intent":"other"}');
    return (result.intent as MessageIntent) || "other";
  } catch {
    return "food"; // default to food on error
  }
}

export interface WorkoutResult {
  workoutType: string;   // e.g. "бег", "эллипс", "шаги", "силовая"
  durationMin: number | null;
  caloriesBurned: number;
  description: string;   // human-readable summary in Russian
}

export async function analyzeWorkout(text: string, userWeightKg: number): Promise<WorkoutResult | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      max_tokens: 256,
      messages: [
        {
          role: "system",
          content: `You are a fitness expert. The user describes their physical activity.

Extract workout information and estimate calories burned.
User weight: ${userWeightKg} kg.

Rules for calories:
- If user explicitly states calories burned — use that value exactly
- If steps are given: 10000 steps ≈ 400-500 kcal depending on weight
- If distance is given without steps (e.g. "прошёл 3 км", "пробежал 5 км"): estimate steps (walking 1 km ≈ 1300 steps, running 1 km ≈ 1000 steps) and calculate accordingly
- If activity type + duration given: use MET values (running ~10 MET, cycling ~8 MET, elliptical ~7 MET, walking ~3.5 MET, strength training ~5 MET, swimming ~8 MET)
- Formula: kcal = MET × weight_kg × duration_hours
- Round to nearest 10

Return ONLY a JSON object:
{
  "workoutType": string (short type in Russian: "бег", "ходьба", "эллипс", "велосипед", "плавание", "силовая", "йога", "шаги", etc.),
  "durationMin": number or null (if only steps/kcal given),
  "caloriesBurned": number,
  "description": string (short human-readable summary in Russian, e.g. "Бег 30 мин" or "10 000 шагов")
}`
        },
        { role: "user", content: text }
      ],
      response_format: { type: "json_object" }
    });
    const result = JSON.parse(response.choices[0].message.content || "{}");
    if (!result.workoutType || !result.caloriesBurned) return null;
    return {
      workoutType: result.workoutType,
      durationMin: result.durationMin ?? null,
      caloriesBurned: Math.round(result.caloriesBurned),
      description: result.description || result.workoutType,
    };
  } catch (error) {
    console.error("OpenAI Workout Analysis Error:", error);
    return null;
  }
}

export interface FoodItem {
  foodName: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  weight: number;
  mealType: string;
  foodScore?: number;
  nutritionAdvice?: string;
  // Micronutrients (optional — AI returns best estimate)
  fiber?: number;        // g
  sugar?: number;        // g
  sodium?: number;       // mg
  saturatedFat?: number; // g
}

export async function generateEveningReport(
  foodItems: { foodName: string; calories: number; protein: number; fat: number; carbs: number; weight: number; mealType: string; foodScore?: number | null }[],
  totals: { calories: number; protein: number; fat: number; carbs: number; fiber: number; sugar: number; sodium: number },
  goals: { caloriesGoal?: number | null; proteinGoal?: number | null; fatGoal?: number | null; carbsGoal?: number | null },
  workouts: { description: string; caloriesBurned: number }[],
  userGoal: string | null,
  waterMl?: number
) {
  try {
    const goalMap: Record<string, string> = { lose: 'похудение', maintain: 'поддержание веса', gain: 'набор мышечной массы' };
    const goalText = userGoal ? goalMap[userGoal] ?? userGoal : 'не указана';

    const mealLabels: Record<string, string> = { breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус' };
    const foodList = foodItems.map(f => `[${mealLabels[f.mealType] || f.mealType}] ${f.foodName} (${f.weight}г): ${f.calories} ккал, Б${f.protein} Ж${f.fat} У${f.carbs}${f.foodScore ? `, оценка ${f.foodScore}/10` : ''}`).join('\n');
    const goalsText = goals.caloriesGoal ? `Норма: ${goals.caloriesGoal} ккал, Б${goals.proteinGoal}г, Ж${goals.fatGoal}г, У${goals.carbsGoal}г` : 'Нормы не установлены';
    const workoutsText = workouts.length > 0
      ? `Тренировки: ${workouts.map(w => `${w.description} (${w.caloriesBurned} ккал сожжено)`).join(', ')}`
      : '';

    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `Ты нутрициолог. Проанализируй дневной рацион пользователя и дай детальный вечерний отчёт на русском языке.
Цель пользователя: ${goalText}.

Структура ответа:
1. Оценка калорийности и БЖУ относительно нормы и цели (2-3 предложения с конкретными цифрами)
2. Качество питания: что конкретно хорошо или плохо в выбранных продуктах — опирайся на foodScore и состав (1-2 пункта)
3. Микронутриенты: если данные указаны — отметь если клетчатка < 25г, сахар > 50г, или натрий > 2300мг (1 предложение, пропусти если данных нет или всё в норме)
4. Тренировки: одно предложение о том, как они вписались в день — только если тренировки были${workouts.length === 0 ? ' (тренировок не было — этот пункт пропусти)' : ''}
5. Что уже хорошо и не требует изменений (1-2 пункта)
6. Что скорректировать завтра — конкретно (1-2 пункта)
Не используй эмодзи. Опирайся только на данные из рациона.`
        },
        {
          role: "user",
          content: `Рацион за сегодня:\n${foodList || 'Ничего не записано'}\n\nИтого: ${totals.calories} ккал, Б${totals.protein}г, Ж${totals.fat}г, У${totals.carbs}г${totals.fiber > 0 || totals.sugar > 0 || totals.sodium > 0 ? `\nМикронутриенты: клетчатка ${totals.fiber.toFixed(1)}г, сахар ${totals.sugar.toFixed(1)}г, натрий ${Math.round(totals.sodium)}мг` : ''}\n${goalsText}${waterMl ? `\nВода за день: ${waterMl} мл` : ''}${workoutsText ? '\n' + workoutsText : ''}`
        }
      ]
    });

    return response.choices[0].message.content || null;
  } catch (error) {
    console.error("OpenAI Evening Report Error:", error);
    return null;
  }
}

export async function generatePeriodAnalysis(params: {
  period: 'week' | 'month';
  dailyStats: { dayLabel: string; calories: number; protein: number; fat: number; carbs: number }[];
  avgCalories: number;
  avgProtein: number;
  avgFat: number;
  avgCarbs: number;
  topFoods: { name: string; count: number; avgScore: number | null }[];
  totalCaloriesBurned: number;
  workoutTypes: string[];
  weightStart: number | null;
  weightEnd: number | null;
  user: { goal?: string | null; caloriesGoal?: number | null; proteinGoal?: number | null };
}): Promise<string | null> {
  try {
    const { period, avgCalories, avgProtein, avgFat, avgCarbs, topFoods, totalCaloriesBurned, workoutTypes, weightStart, weightEnd, user } = params;
    const periodLabel = period === 'week' ? 'неделю' : 'месяц';
    const goalMap: Record<string, string> = { lose: 'похудение', maintain: 'поддержание веса', gain: 'набор мышечной массы' };
    const goalText = user.goal ? goalMap[user.goal] ?? user.goal : 'не указана';

    const topFoodsText = topFoods.length > 0
      ? topFoods.map(f => `${f.name} — ${f.count} раз${f.avgScore ? ` (оценка ${f.avgScore.toFixed(1)}/10)` : ''}`).join('\n')
      : 'нет данных';

    const weightText = weightStart != null && weightEnd != null
      ? `Вес в начале периода: ${weightStart} кг, в конце: ${weightEnd} кг (изменение: ${(weightEnd - weightStart).toFixed(1)} кг)`
      : 'данных о весе нет';

    const workoutsText = totalCaloriesBurned > 0
      ? `Тренировки за период: ${workoutTypes.join(', ')}, сожжено ${totalCaloriesBurned} ккал`
      : 'тренировок не было';

    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `Ты нутрициолог. Проанализируй питание пользователя за ${periodLabel} и дай развёрнутый анализ на русском языке.
Цель пользователя: ${goalText}.

Структура ответа (6-8 предложений):
1. Общая оценка калорийности и БЖУ относительно нормы и цели
2. Паттерны по дням: найди закономерности в дневной статистике (например, переедание по определённым дням недели, провалы в выходные)
3. Анализ частых блюд: найди закономерности среди топ-блюд и прокомментируй каждое из них — полезно оно или нет, почему. Будь конкретен (например: "Гречка 12 раз — отлично, это источник сложных углеводов и клетчатки" или "Пицца 8 раз — слишком часто, высокая калорийность и мало нутриентов")
4. Физическая активность: оцени тренировки как вспомогательный фактор (1 предложение)
5. Динамика веса: прокомментируй изменение, соответствует ли оно цели (только если данные есть)
6. 2-3 конкретных практических рекомендации что изменить в рационе
Не используй эмодзи. Опирайся строго на предоставленные данные.`
        },
        {
          role: "user",
          content: `Период: ${periodLabel}\nСреднее в день: ${avgCalories} ккал, Б${avgProtein}г, Ж${avgFat}г, У${avgCarbs}г\n${user.caloriesGoal ? `Норма: ${user.caloriesGoal} ккал` : 'Норма не установлена'}\n\nДневная статистика:\n${params.dailyStats.map(d => `${d.dayLabel}: ${d.calories} ккал, Б${d.protein}г, Ж${d.fat}г, У${d.carbs}г`).join('\n')}\n\nЧастые блюда:\n${topFoodsText}\n\n${workoutsText}\n${weightText}`
        }
      ]
    });

    return response.choices[0].message.content || null;
  } catch (error) {
    console.error("OpenAI Period Analysis Error:", error);
    return null;
  }
}

async function transcribeChunk(audioBuffer: Buffer): Promise<string | null> {
  const audioBase64 = audioBuffer.toString("base64");
  const response = await openai.chat.completions.create({
    model: "google/gemini-3-flash-preview",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:audio/ogg;base64,${audioBase64}` },
          } as any,
          {
            type: "text",
            text: "Транскрибируй аудио на русском языке. Верни только текст без пояснений.",
          },
        ],
      },
    ],
  });
  return response.choices[0].message.content?.trim() || null;
}

async function splitAudioIntoChunks(audioBuffer: Buffer, chunkSeconds: number = 55): Promise<Buffer[]> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "voice-"));
  const inputPath = path.join(tmpDir, "input.ogg");
  await writeFile(inputPath, audioBuffer);

  try {
    // Get duration
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", inputPath,
    ]);
    const duration = parseFloat(stdout.trim());
    if (isNaN(duration) || duration <= chunkSeconds) {
      return [audioBuffer];
    }

    const chunks: Buffer[] = [];
    const numChunks = Math.ceil(duration / chunkSeconds);
    for (let i = 0; i < numChunks; i++) {
      const start = i * chunkSeconds;
      const outPath = path.join(tmpDir, `chunk_${i}.ogg`);
      await execFileAsync("ffmpeg", [
        "-y", "-i", inputPath,
        "-ss", String(start), "-t", String(chunkSeconds),
        "-c", "copy", outPath,
      ]);
      chunks.push(await readFile(outPath));
      await unlink(outPath).catch(() => {});
    }
    return chunks;
  } finally {
    await unlink(inputPath).catch(() => {});
    // tmpDir will be cleaned up by OS
  }
}

export async function transcribeVoice(audioBuffer: Buffer, duration?: number): Promise<string | null> {
  try {
    // Short audio — transcribe directly
    if (!duration || duration <= 60) {
      return await transcribeChunk(audioBuffer);
    }

    // Long audio — split into chunks and transcribe each
    console.log(`Long voice message (${duration}s), splitting into chunks...`);
    const chunks = await splitAudioIntoChunks(audioBuffer);
    console.log(`Split into ${chunks.length} chunks`);

    const transcripts: string[] = [];
    for (const chunk of chunks) {
      const text = await transcribeChunk(chunk);
      if (text) transcripts.push(text);
    }

    return transcripts.length > 0 ? transcripts.join(" ") : null;
  } catch (error: any) {
    console.error("Gemini Voice Transcription Error:", JSON.stringify({
      message: error?.message,
      status: error?.status,
      code: error?.code,
      body: error?.error,
    }, null, 2));
    return null;
  }
}

export async function detectBarcode(imageBase64: string): Promise<string | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      max_tokens: 30,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: "If a barcode (EAN-13, EAN-8, UPC-A, QR, etc.) is visible in this image, return ONLY the numeric barcode digits. If no barcode is visible or readable, return exactly: none"
          },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
        ]
      }]
    });
    const result = response.choices[0].message.content?.trim() ?? "";
    if (!result || result.toLowerCase() === "none") return null;
    const digits = result.replace(/\D/g, "");
    return digits.length >= 8 ? digits : null;
  } catch (error) {
    console.error("Barcode Detection Error:", error);
    return null;
  }
}

export async function askCoach(
  question: string,
  profile: {
    age?: number | null; weight?: number | null; height?: number | null;
    gender?: string | null; activityLevel?: string | null; goal?: string | null;
    caloriesGoal?: number | null; proteinGoal?: number | null;
    fatGoal?: number | null; carbsGoal?: number | null;
  },
  todayLog: { foodName: string; calories: number; protein: number; fat: number; carbs: number; weight: number }[],
  todayStats: { calories: number; protein: number; fat: number; carbs: number }
): Promise<string | null> {
  try {
    const genderMap: Record<string, string> = { male: 'мужской', female: 'женский' };
    const activityMap: Record<string, string> = {
      sedentary: 'малоподвижный', light: 'лёгкая активность',
      moderate: 'умеренная активность', active: 'высокая активность', very_active: 'очень высокая активность'
    };
    const goalMap: Record<string, string> = { lose: 'похудение', maintain: 'поддержание веса', gain: 'набор массы' };

    const profileLines = [
      profile.age ? `Возраст: ${profile.age} лет` : null,
      profile.gender ? `Пол: ${genderMap[profile.gender] ?? profile.gender}` : null,
      profile.weight ? `Вес: ${profile.weight} кг` : null,
      profile.height ? `Рост: ${profile.height} см` : null,
      profile.activityLevel ? `Активность: ${activityMap[profile.activityLevel] ?? profile.activityLevel}` : null,
      profile.goal ? `Цель: ${goalMap[profile.goal] ?? profile.goal}` : null,
      profile.caloriesGoal ? `Дневная норма: ${profile.caloriesGoal} ккал, Б${profile.proteinGoal}г, Ж${profile.fatGoal}г, У${profile.carbsGoal}г` : null,
    ].filter(Boolean).join('\n');

    const logLines = todayLog.length > 0
      ? todayLog.map(f => `• ${f.foodName} (${f.weight}г): ${f.calories} ккал, Б${f.protein} Ж${f.fat} У${f.carbs}`).join('\n')
      : 'Пока ничего не записано';

    const remaining = profile.caloriesGoal
      ? `Осталось на сегодня: ${Math.max(0, profile.caloriesGoal - todayStats.calories)} ккал, Б${Math.max(0, (profile.proteinGoal ?? 0) - todayStats.protein)}г, Ж${Math.max(0, (profile.fatGoal ?? 0) - todayStats.fat)}г, У${Math.max(0, (profile.carbsGoal ?? 0) - todayStats.carbs)}г`
      : '';

    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `Ты персональный тренер-нутрициолог. Отвечай на русском языке, дружелюбно и по делу. Опирайся на конкретные данные пользователя.
Не давай медицинских диагнозов. Если вопрос не по питанию или фитнесу — мягко перенаправь к теме.
Пиши кратко: 3-5 предложений, без воды. Можно использовать эмодзи умеренно.`
        },
        {
          role: "user",
          content: `Профиль:\n${profileLines || 'Не заполнен'}\n\nЕда за сегодня:\n${logLines}\n\nИтого съедено: ${todayStats.calories} ккал, Б${todayStats.protein}г, Ж${todayStats.fat}г, У${todayStats.carbs}г\n${remaining}\n\nВопрос: ${question}`
        }
      ]
    });

    return response.choices[0].message.content || null;
  } catch (error) {
    console.error("OpenAI Coach Error:", error);
    return null;
  }
}

export async function generateWeightAnalysis(
  weightLogs: { weight: number; date: Date | null }[],
  weeklyStats: { dayLabel: string; calories: number; protein: number; fat: number; carbs: number }[],
  profile: { caloriesGoal?: number | null; goal?: string | null; weight?: number | null },
  workouts?: { description: string; caloriesBurned: number }[]
): Promise<string | null> {
  try {
    const sorted = [...weightLogs].sort((a, b) => new Date(a.date!).getTime() - new Date(b.date!).getTime());
    const weightLines = sorted.map(w => {
      const d = new Date(w.date!);
      return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}: ${w.weight.toFixed(1)} кг`;
    }).join('\n');

    const dietLines = weeklyStats.map(d =>
      `${d.dayLabel}: ${d.calories} ккал, Б${d.protein}г, Ж${d.fat}г, У${d.carbs}г`
    ).join('\n');

    const goalMap: Record<string, string> = { lose: 'похудение', maintain: 'поддержание веса', gain: 'набор массы' };

    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `Ты нутрициолог-аналитик. Проанализируй данные о весе и питании пользователя за неделю.
Структура ответа (кратко, по-русски):
1. Изменение веса: факт + оценка (нормально ли это для цели пользователя)
2. Связь питания с весом: что повлияло (калораж, белок, дефицит/профицит)
3. Влияние тренировок на вес (если тренировки были)
4. Рекомендация: что скорректировать на следующей неделе
Пиши дружелюбно, конкретно, 4-6 предложений. Без воды.`
        },
        {
          role: "user",
          content: `Цель пользователя: ${goalMap[profile.goal ?? ''] ?? 'не указана'}\nНорма калорий: ${profile.caloriesGoal ?? 'не указана'} ккал/день\n\nДинамика веса:\n${weightLines || 'Нет данных'}\n\nРацион за неделю:\n${dietLines || 'Нет данных'}${workouts && workouts.length > 0 ? `\n\nТренировки за неделю:\n${workouts.map(w => `${w.description} — ${w.caloriesBurned} ккал`).join('\n')}` : '\n\nТренировок не было'}`
        }
      ]
    });

    return response.choices[0].message.content || null;
  } catch (error) {
    console.error("OpenAI Weight Analysis Error:", error);
    return null;
  }
}

export async function analyzeFoodImage(
  imageBase64: string,
  currentTime?: Date,
  mealBoundaries?: { breakfastEnd: string; lunchEnd: string }
): Promise<FoodItem[] | null> {
  try {
    let timeHint = '';
    if (currentTime) {
      const h = currentTime.getHours();
      const m = currentTime.getMinutes();
      const totalMin = h * 60 + m;

      const bfEnd = mealBoundaries?.breakfastEnd ?? '12:30';
      const lnEnd = mealBoundaries?.lunchEnd ?? '16:30';
      const [bfH, bfM] = bfEnd.split(':').map(Number);
      const [lnH, lnM] = lnEnd.split(':').map(Number);
      const bfEndMin = bfH * 60 + bfM;
      const lnEndMin = lnH * 60 + lnM;

      let defaultMeal: string;
      if (totalMin >= 300 && totalMin <= bfEndMin) {
        defaultMeal = 'breakfast';
      } else if (totalMin > bfEndMin && totalMin <= lnEndMin) {
        defaultMeal = 'lunch';
      } else {
        defaultMeal = 'dinner';
      }
      timeHint = `\nCurrent time: ${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}. Default mealType: "${defaultMeal}".`;
    }

    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o",
      temperature: 0,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `You are a nutrition expert with vision capabilities.
1. Identify ALL food items or products visible in the image. There may be one or multiple items.
2. If a label or barcode is visible, use that for precision.
3. Look up exact or highly accurate nutrition facts for each identified food.
4. Language rules:
   - foodName: EXACT product name from the package in its original language, or descriptive name in Russian if no package.
   - nutritionAdvice: in Russian.
5. Rate nutritional quality 1-10. Write nutritionAdvice ONLY if foodScore <= 5, otherwise set to "".
6. Estimate micronutrients based on typical composition or label.
${timeHint}
Return ONLY a JSON object with key "items" containing an array. Each element:
- foodName (string)
- calories (number)
- protein (number, grams)
- fat (number, grams)
- carbs (number, grams)
- weight (number, grams)
- mealType (STRICTLY one of: "breakfast" | "lunch" | "dinner" | "snack")
- foodScore (number, 1-10)
- nutritionAdvice (string, Russian, or "" if foodScore > 5)
- fiber (number, grams)
- sugar (number, grams)
- sodium (number, milligrams)
- saturatedFat (number, grams)

Example: {"items": [{...}, {...}]}`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identify all food in the image and provide exact nutrition facts for each item." },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`
              }
            }
          ]
        }
      ],
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content || "{}");
    // Support both {items: [...]} and single-object legacy format
    if (Array.isArray(parsed.items) && parsed.items.length > 0) {
      return parsed.items as FoodItem[];
    }
    // Legacy single object
    if (parsed.foodName) {
      return [parsed as FoodItem];
    }
    return null;
  } catch (error) {
    console.error("OpenAI Vision Analysis Error:", error);
    return null;
  }
}

export async function groupFoodNames(foodNames: string[]): Promise<Record<string, string>> {
  try {
    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      max_tokens: 2048,
      messages: [
        {
          role: "system",
          content: `You are a food categorization expert. Group similar food items into base categories.
Rules:
- Merge cooking variations into one category (жареная курица, варёная курица, курица гриль → Курица)
- Keep distinct foods separate (курица and говядина are different categories)
- Do NOT group fundamentally different foods that share a word (e.g. "куриный бульон" and "куриная грудка" are different categories: "Куриный бульон" vs "Курица")
- Drinks: group by base drink (кофе с молоком, капучино, латте → Кофе; чай зелёный, чай чёрный → Чай), but keep fundamentally different drinks separate (кофе vs сок vs кефир)
- Use Russian for category names, capitalize first letter
- Return a JSON object where keys are the original food names and values are the category names

Example input: ["курица жареная", "курица варёная", "рис белый", "рис бурый", "яблоко зелёное", "яблоко красное"]
Example output: {"курица жареная": "Курица", "курица варёная": "Курица", "рис белый": "Рис", "рис бурый": "Рис", "яблоко зелёное": "Яблоко", "яблоко красное": "Яблоко"}`
        },
        { role: "user", content: JSON.stringify(foodNames) }
      ],
      response_format: { type: "json_object" },
    });
    return JSON.parse(response.choices[0].message.content || "{}");
  } catch (error) {
    console.error("Food Grouping AI Error:", error);
    return {};
  }
}
