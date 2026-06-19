const { extractReceiptWithGemini } = require("./aiReceiptGemini");
const { extractReceiptWithOpenAI } = require("./aiReceiptOpenAI");

async function extractReceipt(file) {
  const provider = process.env.AI_PROVIDER || "gemini";

  if (provider === "openai") {
    return {
      provider: "openai",
      model: process.env.OPENAI_MODEL || "gpt-5.5",
      data: await extractReceiptWithOpenAI(file),
    };
  }

  return {
    provider: "gemini",
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
    data: await extractReceiptWithGemini(file),
  };
}

module.exports = {
  extractReceipt,
};