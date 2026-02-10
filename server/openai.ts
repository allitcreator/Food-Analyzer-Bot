import OpenAI from "openai";
import fs from "fs";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "dummy",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function analyzeFoodText(text: string) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a nutrition expert. 
          1. If the text is a barcode (digits), search for the specific product name and its exact nutrition facts (per serving or 100g).
          2. If it's a food name, find the most accurate nutrition data for that specific item.
          3. Rate the food's nutritional quality on a scale of 1-10 (10 = very healthy, 1 = very unhealthy). Consider: fiber, vitamins, added sugar, trans fats, processing level.
          4. Provide a brief nutrition advice in Russian (1-2 sentences) about this food: what's good/bad about it, and a suggestion to improve the meal.
          5. Return ONLY a JSON object with:
          - foodName (string, exact product or dish name)
          - calories (number)
          - protein (number)
          - fat (number)
          - carbs (number)
          - weight (number, grams)
          - mealType (string: "breakfast", "lunch", "dinner", "snack")
          - foodScore (number, 1-10)
          - nutritionAdvice (string, in Russian)`
        },
        { role: "user", content: text }
      ],
      response_format: { type: "json_object" }
    });

    return JSON.parse(response.choices[0].message.content || "{}");
  } catch (error) {
    console.error("OpenAI Text Analysis Error:", error);
    return null;
  }
}

export async function generateEveningReport(foodItems: { foodName: string; calories: number; protein: number; fat: number; carbs: number; weight: number; foodScore?: number | null }[], totals: { calories: number; protein: number; fat: number; carbs: number }, goals: { caloriesGoal?: number | null; proteinGoal?: number | null; fatGoal?: number | null; carbsGoal?: number | null }, waterMl: number) {
  try {
    const foodList = foodItems.map(f => `${f.foodName} (${f.weight}г): ${f.calories} ккал, Б${f.protein} Ж${f.fat} У${f.carbs}${f.foodScore ? `, оценка ${f.foodScore}/10` : ''}`).join('\n');
    const goalsText = goals.caloriesGoal ? `Цели: ${goals.caloriesGoal} ккал, Б${goals.proteinGoal}г, Ж${goals.fatGoal}г, У${goals.carbsGoal}г` : 'Цели не установлены';

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
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
          content: `Рацион за сегодня:\n${foodList || 'Ничего не записано'}\n\nИтого: ${totals.calories} ккал, Б${totals.protein}г, Ж${totals.fat}г, У${totals.carbs}г\nВода: ${waterMl}мл / 2500мл\n${goalsText}`
        }
      ]
    });

    return response.choices[0].message.content || null;
  } catch (error) {
    console.error("OpenAI Evening Report Error:", error);
    return null;
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
