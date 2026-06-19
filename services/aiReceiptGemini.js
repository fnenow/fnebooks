const { GoogleGenAI } = require("@google/genai");

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

async function extractReceiptWithGemini(file) {
  const base64Image = file.buffer.toString("base64");

  const prompt = `
Extract receipt data for a construction bookkeeping app.

Rules:
- Return only JSON.
- If card payment is shown, return only last 4 digits.
- If payment method is not clear, use "unknown".
- Use null for missing numeric values.
- Date must be YYYY-MM-DD.
- Category should be simple: Material, Tool, Labor, Food, Permit, Marketing, Software, Office Supply, Vehicle, Professional Service, Insurance, License, Bank Fee, Other.
- Add missing field names to missing_fields.
`;

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
    contents: [
      {
        inlineData: {
          mimeType: file.mimetype,
          data: base64Image,
        },
      },
      {
        text: prompt,
      },
    ],
    config: {
      responseFormat: {
        text: {
          mimeType: "application/json",
          schema: {
            type: "object",
            properties: {
              receipt_date: { type: "string" },
              store: { type: "string" },
              receipt_number: { type: "string" },
              payment_method: { type: "string" },
              subtotal: { type: "number" },
              tax: { type: "number" },
              total: { type: "number" },
              category: { type: "string" },
              note: { type: "string" },
              confidence: { type: "number" },
              missing_fields: {
                type: "array",
                items: { type: "string" },
              },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    product_name: { type: "string" },
                    product_code: { type: "string" },
                    quantity: { type: "number" },
                    unit_price: { type: "number" },
                    item_total: { type: "number" },
                    category: { type: "string" },
                  },
                },
              },
            },
            required: [
              "receipt_date",
              "store",
              "receipt_number",
              "payment_method",
              "subtotal",
              "tax",
              "total",
              "category",
              "confidence",
              "missing_fields",
              "items"
            ],
          },
        },
      },
    },
  });

  return JSON.parse(response.text);
}

module.exports = {
  extractReceiptWithGemini,
};