import OpenAI from "openai";
import { config } from "./config";

// Chat + Vision via OpenRouter
const openai = new OpenAI({
  apiKey: config.openrouterApiKey,
  baseURL: "https://openrouter.ai/api/v1",
  defaultHeaders: {
    "HTTP-Referer": "https://alxthecreatortg.ru",
    "X-Title": "Food Analyzer Bot",
  },
});


export async function analyzeFoodText(text: string): Promise<FoodItem[] | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a nutrition expert. The user may describe one or multiple food items in a single message.

Split the message into individual food items/dishes. For each item:
1. Identify the exact food name (in Russian if the user wrote in Russian).
2. Find accurate nutrition data per the specified or estimated portion.
3. Rate nutritional quality 1-10 (10 = very healthy, 1 = very unhealthy).
4. Write a brief nutrition advice in Russian (1-2 sentences).
5. Estimate micronutrients based on typical composition.

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

export async function generateEveningReport(foodItems: { foodName: string; calories: number; protein: number; fat: number; carbs: number; weight: number; foodScore?: number | null }[], totals: { calories: number; protein: number; fat: number; carbs: number }, goals: { caloriesGoal?: number | null; proteinGoal?: number | null; fatGoal?: number | null; carbsGoal?: number | null }) {
  try {
    const foodList = foodItems.map(f => `${f.foodName} (${f.weight}г): ${f.calories} ккал, Б${f.protein} Ж${f.fat} У${f.carbs}${f.foodScore ? `, оценка ${f.foodScore}/10` : ''}`).join('\n');
    const goalsText = goals.caloriesGoal ? `Цели: ${goals.caloriesGoal} ккал, Б${goals.proteinGoal}г, Ж${goals.fatGoal}г, У${goals.carbsGoal}г` : 'Цели не установлены';

    const response = await openai.chat.completions.create({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Ты нутрициолог. Проанализируй дневной рацион пользователя и дай краткий вечерний отчёт на русском языке.
Структура ответа:
1. Общая оценка дня (1-2 предложения)
2. Что было хорошо (1-2 пункта)
3. Что можно улучшить (1-2 пункта)
4. Совет на завтра (1 предложение)
Будь конкретен, дружелюбен и лаконичен. Используй факты из рациона. Не используй эмодзи.`
        },
        {
          role: "user",
          content: `Рацион за сегодня:\n${foodList || 'Ничего не записано'}\n\nИтого: ${totals.calories} ккал, Б${totals.protein}г, Ж${totals.fat}г, У${totals.carbs}г\n${goalsText}`
        }
      ]
    });

    return response.choices[0].message.content || null;
  } catch (error) {
    console.error("OpenAI Evening Report Error:", error);
    return null;
  }
}

export async function transcribeVoice(audioBuffer: Buffer): Promise<string | null> {
  try {
    const audioBase64 = audioBuffer.toString("base64");
    // Gemini via OpenRouter accepts audio as image_url with audio data URI
    const response = await openai.chat.completions.create({
      model: "google/gemini-2.0-flash",
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
  } catch (error) {
    console.error("Gemini Voice Transcription Error:", error);
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
