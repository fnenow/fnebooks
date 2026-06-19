function hasGeminiConfig() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function stripCodeFence(value) {
  return String(value || '')
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function normalizeReceiptData(data) {
  const receipt = data && typeof data === 'object' ? data : {};
  return {
    receipt_date: receipt.receipt_date || null,
    store: receipt.store || null,
    receipt_number: receipt.receipt_number || null,
    payment_method: receipt.payment_method || 'unknown',
    subtotal: receipt.subtotal ?? null,
    tax: receipt.tax ?? null,
    total: receipt.total ?? null,
    category_id: receipt.category_id ?? null,
    category: receipt.category || null,
    note: receipt.note || '',
    confidence: receipt.confidence ?? null,
    missing_fields: Array.isArray(receipt.missing_fields) ? receipt.missing_fields : [],
    items: Array.isArray(receipt.items) ? receipt.items : []
  };
}

function categoryPrompt(categories) {
  if (!Array.isArray(categories) || !categories.length) return 'No category list was provided. Use category_id null.';
  const compact = categories.slice(0, 120).map(row => ({
    id: row.id,
    type: row.type_name,
    general: row.general_category,
    detail: row.detail_category,
    clues: row.ai_clues
  }));
  return JSON.stringify(compact);
}

async function extractReceiptWithGemini(file, categories = []) {
  if (!hasGeminiConfig()) return null;

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
  const prompt = `
Extract construction bookkeeping receipt data from the attached file.
Return valid JSON only. Do not use markdown.

Use this exact JSON shape:
{
  "receipt_date": "YYYY-MM-DD or null",
  "store": "store name or null",
  "receipt_number": "receipt number or null",
  "payment_method": "last 4 digits, cash, check, or unknown",
  "subtotal": number or null,
  "tax": number or null,
  "total": number or null,
  "category_id": number or null,
  "category": "chosen category detail or null",
  "note": "short note or empty string",
  "confidence": number from 0 to 100,
  "missing_fields": ["field_name"],
  "items": [
    {
      "product_name": "item name or null",
      "product_code": "sku/product code or null",
      "quantity": number or null,
      "unit_price": number or null,
      "item_total": number or null,
      "category_id": number or null,
      "category": "chosen category detail or null"
    }
  ]
}

Payment rule:
- If card payment is shown, return only the last 4 digits, such as "1234".
- Do not return text like "card ending 1234".
- If payment is cash, return "cash".
- If payment is check, return "check".
- If payment is unclear, return "unknown".

Category rule:
- Choose category_id only from this active expense category list.
- If you are not confident, use category_id null.
- Category list: ${categoryPrompt(categories)}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          {
            inline_data: {
              mime_type: file.mimetype,
              data: file.buffer.toString('base64')
            }
          }
        ]
      }],
      generationConfig: {
        response_mime_type: 'application/json'
      }
    })
  });

  const body = await response.text();
  let parsedResponse;
  try {
    parsedResponse = JSON.parse(body);
  } catch {
    throw new Error(`Gemini returned invalid response: ${body.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = parsedResponse.error?.message || `Gemini request failed with status ${response.status}`;
    throw new Error(message);
  }

  const text = parsedResponse.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('') || '';

  if (!text) throw new Error('Gemini did not return receipt JSON');

  let receiptJson;
  try {
    receiptJson = JSON.parse(stripCodeFence(text));
  } catch {
    throw new Error(`Gemini receipt JSON could not be parsed: ${text.slice(0, 200)}`);
  }

  return {
    provider: 'gemini',
    model,
    data: normalizeReceiptData(receiptJson),
    raw: receiptJson
  };
}

module.exports = {
  extractReceiptWithGemini,
  hasGeminiConfig
};
