function normalizeModel(model) {
  return typeof model === 'string' ? model.toLowerCase() : '';
}

// qwen models answer fast enough to stream straight through. deepseek/deepsek
// (reasoning) models can run well past Cloudflare's ~100s proxy timeout, so
// those go through the background job + polling path instead. Anything
// unrecognized defaults to streaming since it's the simpler/cheaper path.
function getModelMode(model) {
  const name = normalizeModel(model);

  if (name.includes('qwen')) return 'stream';
  if (name.includes('deepseek') || name.includes('deepsek')) return 'job';

  return 'stream';
}

// How long Ollama keeps a model resident in memory after a response (its
// `keep_alive` param - see lib/ollama.js). qwen is the everyday/fast model,
// worth keeping warm; deepseek/deepsek is a large reasoning model used less
// often, so it's evicted sooner to free RAM for everything else. Overridable
// per env in case the homelab's memory budget needs different numbers.
function getKeepAlive(model) {
  const name = normalizeModel(model);

  if (name.includes('qwen')) return process.env.OLLAMA_KEEP_ALIVE_QWEN || '30m';
  if (name.includes('deepseek') || name.includes('deepsek')) {
    return process.env.OLLAMA_KEEP_ALIVE_DEEPSEEK || '5m';
  }

  return process.env.OLLAMA_KEEP_ALIVE_DEFAULT || '5m';
}

// Both model families are tagged "tools"-capable on Ollama's model library.
// deepseek-r1 goes through job mode (see getModelMode), so its tool
// resolution happens inline in runJob() instead of the heartbeat-wrapped
// path handleStreamMode uses for qwen - see routes/chat.js.
function supportsTools(model) {
  const name = normalizeModel(model);
  return name.includes('qwen') || name.includes('deepseek') || name.includes('deepsek');
}

// deepseek-r1 is the reasoning model in this app - Ollama's `think` param
// (see lib/ollama.js) surfaces its chain-of-thought as a separate stream
// from the final answer so the frontend can show it in a collapsible
// section. qwen isn't treated as a thinking model here.
function supportsThinking(model) {
  const name = normalizeModel(model);
  return name.includes('deepseek') || name.includes('deepsek');
}

module.exports = { getModelMode, getKeepAlive, supportsTools, supportsThinking };
