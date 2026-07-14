const UsageLog = require('../models/UsageLog');
const { estimateCostUsd } = require('./pricing');

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini';

// Single-shot vision call via OpenAI directly - deliberately not sharing
// request-building with ollama.js's ollamaVisionChat: OpenAI's message shape
// (content as an array of typed parts, image as a data: URL) is different
// from Ollama's `images: [base64]` array, not just a different endpoint.
async function openaiVisionChat(prompt, base64Image, userId) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  let response;
  try {
    response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_VISION_MODEL,
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } }
            ]
          }
        ]
      })
    });
  } catch (err) {
    throw new Error(`Could not reach OpenAI: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenAI vision request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Unexpected response shape from OpenAI');
  }

  await logUsage(data.usage, userId);

  return content;
}

// Best-effort: a logging failure must never break the vision response the
// caller is already holding - every failure mode here is caught and logged,
// never rethrown. userId is only ever used by lib/usageCap.js to total one
// user's monthly spend against USER_MONTHLY_CAP_USD.
async function logUsage(usage, userId) {
  if (!usage) return;
  try {
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    await UsageLog.create({
      userId: userId || null,
      kind: 'vision',
      model: OPENAI_VISION_MODEL,
      promptTokens,
      completionTokens,
      costUsd: estimateCostUsd(OPENAI_VISION_MODEL, promptTokens, completionTokens)
    });
  } catch (err) {
    console.error('[openaiVision] usage logging failed:', err.message);
  }
}

module.exports = { openaiVisionChat };
