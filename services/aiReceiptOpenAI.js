const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function extractReceiptWithOpenAI(file) {
  const base64Image = file.buffer.toString("base64");

  const response = await openai.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5.5",
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `
Extract receipt data for a construction bookkeeping app.

Return valid JSON only.

Rules:
- If card payment is shown, return only last 4 digits.
- If payment method is not clear, use "unknown".
- Date must be YYYY-MM-DD.
- Use null for missing numeric values.
- Add missing fields to missing_fields.
`
          },
          {
            type: "input_image",
            image_url: `data:${file.mimetype};base64,${base64Image}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "receipt_extraction",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            receipt_date: { type: ["string", "null"] },
            store: { type: ["string", "null"] },
            receipt_number: { type: ["string", "null"] },
            payment_method: { type: ["string", "null"] },
            subtotal: { type: ["number", "null"] },
            tax: { type: ["number", "null"] },
            total: { type: ["number", "null"] },
            category: { type: ["string", "null"] },
            note: { type: ["string", "null"] },
            confidence: { type: "number" },
            missing_fields: {
              type: "array",
              items: { type: "string" },
            },
            items: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  product_name: { type: ["string", "null"] },
                  product_code: { type: ["string", "null"] },
                  quantity: { type: ["number", "null"] },
                  unit_price: { type: ["number", "null"] },
                  item_total: { type: ["number", "null"] },
                  category: { type: ["string", "null"] },
                },
                required: [
                  "product_name",
                  "product_code",
                  "quantity",
                  "unit_price",
                  "item_total",
                  "category"
                ],
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
            "note",
            "confidence",
            "missing_fields",
            "items"
          ],
        },
      },
    },
  });

  return JSON.parse(response.output_text);
}

module.exports = {
  extractReceiptWithOpenAI,
};