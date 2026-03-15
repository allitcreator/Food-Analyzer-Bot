import OpenAI from "openai";
import fs from "fs";
import path from "path";
import os from "os";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "dummy",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function analyzeFoodText(text: string): Promise<FoodItem[] | null> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a nutrition expert. The user may describe one or multiple food items in a single message.

Split the message into individual food items/dishes. For each item:
1. Identify the exact food name (in Russian if the user wrote in Russian).
2. Find accurate nutrition data per the specified or estimated portion.
3. Rate nutritional quality 1-10 (10 = very healthy, 1 = very unhealthy).
4. Write a brief nutrition advice in Russian (1-2 sentences).

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
}

export async function generateEveningReport(foodItems: { foodName: string; calories: number; protein: number; fat: number; carbs: number; weight: number; foodScore?: number | null }[], totals: { calories: number; protein: number; fat: number; carbs: number }, goals: { caloriesGoal?: number | null; proteinGoal?: number | null; fatGoal?: number | null; carbsGoal?: number | null }) {
  try {
    const foodList = foodItems.map(f => `${f.foodName} (${f.weight}г): ${f.calories} ккал, Б${f.protein} Ж${f.fat} У${f.carbs}${f.foodScore ? `, оценка ${f.foodScore}/10` : ''}`).join('\n');
    const goalsText = goals.caloriesGoal ? `Цели: ${goals.caloriesGoal} ккал, Б${goals.proteinGoal}г, Ж${goals.fatGoal}г, У${goals.carbsGoal}г` : 'Цели не установлены';

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
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
  const tmpFile = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);
  try {
    fs.writeFileSync(tmpFile, audioBuffer);
    const response = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: fs.createReadStream(tmpFile),
      language: "ru",
    });
    return response.text || null;
  } catch (error) {
    console.error("OpenAI Whisper Error:", error);
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

export async function analyzeFoodImage(imageBase64: string) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
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
          7. Return ONLY a JSON object with:
          - foodName (string, exact name from package in original language)
          - calories (number)
          - protein (number)
          - fat (number)
          - carbs (number)
          - weight (number, grams)
          - mealType (string: "breakfast", "lunch", "dinner", "snack")
          - foodScore (number, 1-10)
          - nutritionAdvice (string, in Russian)`
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
