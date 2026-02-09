import OpenAI from "openai";

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
          3. Return ONLY a JSON object with:
          - foodName (string, exact product or dish name)
          - calories (number)
          - protein (number)
          - fat (number)
          - carbs (number)
          - weight (number, grams)
          - mealType (string: "breakfast", "lunch", "dinner", "snack")`
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

export async function analyzeFoodImage(imageBase64: string) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a nutrition expert with vision capabilities.
          1. Identify the exact food items or products in the image.
          2. If a label or barcode is visible, use that for precision.
          3. Look up exact or highly accurate nutrition facts for the identified food.
          4. Return ONLY a JSON object with:
          - foodName (string, exact name of the identified food/product)
          - calories (number)
          - protein (number)
          - fat (number)
          - carbs (number)
          - weight (number, grams)
          - mealType (string: "breakfast", "lunch", "dinner", "snack")`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Identify the food and provide its exact nutrition facts." },
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
