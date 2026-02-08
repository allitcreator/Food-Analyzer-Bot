import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || "dummy",
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export async function analyzeFoodText(text: string) {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: `You are a nutritionist assistant. Analyze the food described in the text.
          Return a JSON object with:
          - foodName (string)
          - calories (number, approx)
          - protein (number, approx g)
          - fat (number, approx g)
          - carbs (number, approx g)
          - weight (number, estimated grams)
          - mealType (string: "breakfast", "lunch", "dinner", "snack")
          
          If the quantity is not specified, make a reasonable estimate for a standard serving.
          If the text is a barcode number (just digits), try to identify the product.
          `
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
      model: "gpt-5.2",
      messages: [
        {
          role: "system",
          content: `You are a nutritionist assistant. Analyze the food in the image.
          Return a JSON object with:
          - foodName (string)
          - calories (number, approx)
          - protein (number, approx g)
          - fat (number, approx g)
          - carbs (number, approx g)
          - weight (number, estimated grams)
          - mealType (string: "breakfast", "lunch", "dinner", "snack")
          
          Make a reasonable estimate for the portion size shown.`
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this meal." },
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
