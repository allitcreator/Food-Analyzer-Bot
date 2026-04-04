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


export async function analyzeFoodText(text: string, currentTime?: Date): Promise<FoodItem[] | null> {
  try {
    // Determine default mealType based on Moscow time
    let timeHint = '';
    if (currentTime) {
      const h = currentTime.getHours();
      const m = currentTime.getMinutes();
      const totalMin = h * 60 + m;
      let defaultMeal: string;
      if (totalMin >= 300 && totalMin <= 750) {        // 5:00–12:30
        defaultMeal = 'breakfast';
      } else if (totalMin >= 751 && totalMin <= 990) { // 12:31–16:30
        defaultMeal = 'lunch';
      } else {                                          // 16:31–4:59
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
2. Find accurate nutrition data per the specified or estimated portion.
3. Rate nutritional quality 1-10 (10 = very healthy, 1 = very unhealthy).
4. Write a brief nutrition advice in Russian (1-2 sentences).
5. Estimate micronutrients based on typical composition.
6. Determine mealType: use the user's explicit mention (завтрак/обед/ужин/перекус) if present, otherwise use the default based on current time.
${timeHint}
Return ONLY a JSON object with a single key "items" containing an array. Each element:
- foodName (string)
- calories (number)
- protein (number, grams)
- fat (number, grams)
- carbs (number, grams)
- weight (number, grams or ml for liquids)
- mealType ("breakfast" | "lunch" | "dinner" | "snack")
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
  totals: { calories: number; protein: number; fat: number; carbs: number },
  goals: { caloriesGoal?: number | null; proteinGoal?: number | null; fatGoal?: number | null; carbsGoal?: number | null },
  workouts: { description: string; caloriesBurned: number }[],
  userGoal: string | null
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
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `Ты нутрициолог. Проанализируй дневной рацион пользователя и дай детальный вечерний отчёт на русском языке.
Цель пользователя: ${goalText}.

Структура ответа:
1. Оценка калорийности и БЖУ относительно нормы и цели (2-3 предложения с конкретными цифрами)
2. Качество питания: что конкретно хорошо или плохо в выбранных продуктах — опирайся на foodScore и состав (1-2 пункта)
3. Тренировки: одно предложение о том, как они вписались в день — только если тренировки были${workouts.length === 0 ? ' (тренировок не было — этот пункт пропусти)' : ''}
4. Что уже хорошо и не требует изменений (1-2 пункта)
5. Что скорректировать завтра — конкретно (1-2 пункта)
Не используй эмодзи. Опирайся только на данные из рациона.`
        },
        {
          role: "user",
          content: `Рацион за сегодня:\n${foodList || 'Ничего не записано'}\n\nИтого: ${totals.calories} ккал, Б${totals.protein}г, Ж${totals.fat}г, У${totals.carbs}г\n${goalsText}${workoutsText ? '\n' + workoutsText : ''}`
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
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `Ты нутрициолог. Проанализируй питание пользователя за ${periodLabel} и дай развёрнутый анализ на русском языке.
Цель пользователя: ${goalText}.

Структура ответа (6-8 предложений):
1. Общая оценка калорийности и БЖУ относительно нормы и цели
2. Анализ частых блюд: найди закономерности среди топ-блюд и прокомментируй каждое из них — полезно оно или нет, почему. Будь конкретен (например: "Гречка 12 раз — отлично, это источник сложных углеводов и клетчатки" или "Пицца 8 раз — слишком часто, высокая калорийность и мало нутриентов")
3. Физическая активность: оцени тренировки как вспомогательный фактор (1 предложение)
4. Динамика веса: прокомментируй изменение, соответствует ли оно цели (только если данные есть)
5. 2-3 конкретных практических рекомендации что изменить в рационе
Не используй эмодзи. Опирайся строго на предоставленные данные.`
        },
        {
          role: "user",
          content: `Период: ${periodLabel}\nСреднее в день: ${avgCalories} ккал, Б${avgProtein}г, Ж${avgFat}г, У${avgCarbs}г\n${user.caloriesGoal ? `Норма: ${user.caloriesGoal} ккал` : 'Норма не установлена'}\n\nЧастые блюда:\n${topFoodsText}\n\n${workoutsText}\n${weightText}`
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
      model: "openai/gpt-4o",
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
  profile: { caloriesGoal?: number | null; goal?: string | null; weight?: number | null }
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
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `Ты нутрициолог-аналитик. Проанализируй данные о весе и питании пользователя за неделю.
Структура ответа (кратко, по-русски):
1. Изменение веса: факт + оценка (нормально ли это для цели пользователя)
2. Связь питания с весом: что повлияло (калораж, белок, дефицит/профицит)
3. Рекомендация: что скорректировать на следующей неделе
Пиши дружелюбно, конкретно, 4-6 предложений. Без воды.`
        },
        {
          role: "user",
          content: `Цель пользователя: ${goalMap[profile.goal ?? ''] ?? 'не указана'}\nНорма калорий: ${profile.caloriesGoal ?? 'не указана'} ккал/день\n\nДинамика веса:\n${weightLines || 'Нет данных'}\n\nРацион за неделю:\n${dietLines || 'Нет данных'}`
        }
      ]
    });

    return response.choices[0].message.content || null;
  } catch (error) {
    console.error("OpenAI Weight Analysis Error:", error);
    return null;
  }
}

export async function analyzeFoodImage(imageBase64: string) {
  try {
    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o",
      temperature: 0,
      max_tokens: 1024,
      messages: [
        {
          role: "system",
          content: `You are a nutrition expert with vision capabilities.
          CRITICAL: You must be deterministic. If you see the same image, provide the same data.
          1. Identify the exact food items or products in the image.
          2. If a label or barcode is visible, use that for precision.
          3. Look up exact or highly accurate nutrition facts for the identified food.
          4. Language rules:
          - foodName: EXACT product name from the package in its original language.
          - Analysis and all other text: Russian.
          5. Rate the food's nutritional quality on a scale of 1-10 (10 = very healthy, 1 = very unhealthy). Consider: fiber, vitamins, added sugar, trans fats, processing level.
          6. Provide a brief nutrition advice in Russian (1-2 sentences) about this food: what's good/bad about it, and a suggestion to improve the meal.
          7. Estimate micronutrients based on typical composition or label.
          8. Return ONLY a JSON object with:
          - foodName (string, exact name from package in original language)
          - calories (number)
          - protein (number, grams)
          - fat (number, grams)
          - carbs (number, grams)
          - weight (number, grams)
          - mealType (string: "breakfast", "lunch", "dinner", "snack")
          - foodScore (number, 1-10)
          - nutritionAdvice (string, in Russian)
          - fiber (number, grams — dietary fiber)
          - sugar (number, grams — total sugars)
          - sodium (number, milligrams)
          - saturatedFat (number, grams)`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identify the food and provide its exact nutrition facts. Write foodName in original language, but the rest of the analysis in Russian." },
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

    return JSON.parse(response.choices[0].message.content || "{}");
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
