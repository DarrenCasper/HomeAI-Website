// Per-1M-token USD rates. OpenAI changes these periodically - this table is
// the one place to update when they do; everything else calls
// estimateCostUsd() rather than hardcoding a rate.
const PRICING = {
  'gpt-4.1-mini': { prompt: 0.4, completion: 1.6 }
};

function estimateCostUsd(model, promptTokens, completionTokens) {
  const rate = PRICING[model];
  if (!rate) return null;
  return (promptTokens / 1e6) * rate.prompt + (completionTokens / 1e6) * rate.completion;
}

module.exports = { PRICING, estimateCostUsd };
