'use strict';

function getProvider() {
  const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();

  if (provider === 'openai') {
    if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_ADMIN_KEY) {
      throw new Error('AI_PROVIDER is set to openai, but OPENAI_API_KEY is missing.');
    }

    return require('./aiReceiptOpenAI');
  }

  if (provider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('AI_PROVIDER is set to gemini, but GEMINI_API_KEY is missing.');
    }

    return require('./aiReceiptGemini');
  }

  throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
}

async function processReceipt(...args) {
  const ai = getProvider();

  if (typeof ai === 'function') {
    return ai(...args);
  }

  if (typeof ai.processReceipt === 'function') {
    return ai.processReceipt(...args);
  }

  if (typeof ai.extractReceipt === 'function') {
    return ai.extractReceipt(...args);
  }

  if (typeof ai.analyzeReceipt === 'function') {
    return ai.analyzeReceipt(...args);
  }

  throw new Error('AI receipt provider does not export processReceipt, extractReceipt, analyzeReceipt, or a function.');
}

module.exports = {
  processReceipt
};
