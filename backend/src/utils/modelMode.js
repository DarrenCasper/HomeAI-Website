function normalizeModel(model) {
  return typeof model === 'string' ? model.toLowerCase() : '';
}

// qwen models answer fast enough to stream straight through. The job +
// polling path (see handleJobMode/ChatJob in routes/chat.js) stays available
// as reusable machinery for any future model slow enough to risk Cloudflare's
// ~100s proxy timeout - nothing currently routes to it. Anything unrecognized
// defaults to streaming since it's the simpler/cheaper path.
function getModelMode(model) {
  const name = normalizeModel(model);

  if (name.includes('qwen')) return 'stream';

  return 'stream';
}

// How long Ollama keeps a model resident in memory after a response (its
// `keep_alive` param - see lib/ollama.js). qwen is the everyday/fast model,
// worth keeping warm. Overridable per env in case the homelab's memory
// budget needs different numbers.
function getKeepAlive(model) {
  const name = normalizeModel(model);

  if (name.includes('qwen')) return process.env.OLLAMA_KEEP_ALIVE_QWEN || '30m';

  return process.env.OLLAMA_KEEP_ALIVE_DEFAULT || '5m';
}

// qwen is tagged "tools"-capable on Ollama's model library.
function supportsTools(model) {
  const name = normalizeModel(model);
  return name.includes('qwen');
}

// No selectable model currently exposes a reasoning trace - qwen3.5 has its
// own native thinking mode, but turning that on is a separate decision from
// this. Ollama's `think` param (see lib/ollama.js) and the frontend's
// ReasoningTrace.jsx stay in place as dead-but-ready infrastructure for
// whichever model needs this next.
function supportsThinking(model) {
  return false;
}

module.exports = { getModelMode, getKeepAlive, supportsTools, supportsThinking };
