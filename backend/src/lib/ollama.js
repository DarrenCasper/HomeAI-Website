const { getKeepAlive, supportsThinking } = require('../utils/modelMode');

const PRIMARY_OLLAMA_URL = process.env.OLLAMA_URL || 'http://100.x.x.x:11434'; // Nitro 7's Tailscale IP - set the real one via env
const FALLBACK_OLLAMA_URL = process.env.OLLAMA_FALLBACK_URL || 'http://127.0.0.1:11434'; // this machine's own Ollama
const PRIMARY_CHECK_TIMEOUT_MS = parseInt(process.env.OLLAMA_PRIMARY_TIMEOUT_MS || '3000', 10);
const PRIMARY_CACHE_TTL_MS = 15000; // avoid re-checking reachability on every single call in a burst

const FALLBACK_MODEL_MAP = JSON.parse(
  process.env.OLLAMA_FALLBACK_MODEL_MAP ||
  '{"qwen3.5:4b":"qwen3.5:0.8b","deepseek-r1:7b":"deepseek-r1:1.5b"}'
);

let primaryReachableCache = null; // { reachable: boolean, checkedAt: number }

// Known limitation: this checks reachability once per PRIMARY_CACHE_TTL_MS
// cache window, not per in-flight request - if the Nitro 7 goes to sleep
// mid-stream (after a successful check but before/during the real call),
// that individual request still fails rather than gracefully falling back
// mid-flight. A full request-level retry-with-fallback is deliberately out
// of scope here, since restarting a partially-streamed response to the
// client isn't safe to do silently. The 15s cache window keeps the common
// case (Nitro 7 fully off/asleep/unreachable for a while) working correctly
// without re-checking on every single call.
//
// Checks whether the Nitro 7 is currently reachable (cached briefly so a
// burst of requests doesn't re-check on every single call), and resolves
// which {url, model} a request should actually use. Falling back also
// remaps the model tag - the tiny CPU-friendly models are different tags
// entirely, not just a different host serving the same one.
async function resolveOllamaTarget(model) {
  const now = Date.now();
  if (!primaryReachableCache || now - primaryReachableCache.checkedAt > PRIMARY_CACHE_TTL_MS) {
    let reachable = false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PRIMARY_CHECK_TIMEOUT_MS);
      const res = await fetch(`${PRIMARY_OLLAMA_URL}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      reachable = res.ok;
    } catch {
      reachable = false;
    }
    primaryReachableCache = { reachable, checkedAt: now };
  }

  if (primaryReachableCache.reachable) {
    return { url: PRIMARY_OLLAMA_URL, model };
  }

  console.warn(`[ollama] Nitro 7 unreachable, falling back to ${FALLBACK_OLLAMA_URL} with ${FALLBACK_MODEL_MAP[model] || model}`);
  return { url: FALLBACK_OLLAMA_URL, model: FALLBACK_MODEL_MAP[model] || model };
}

// Tool schema for the browsing agent, handed to Ollama on the non-streaming
// "decide" call in routes/chat.js so tool-capable models can request a live
// web lookup instead of answering from training data alone.
const BROWSE_TOOL_SCHEMA = [
  {
    type: 'function',
    function: {
      name: 'browse_web',
      description:
        'Browse the live web to answer questions about current events, prices, or anything not in your training data. Use only when the question genuinely requires up-to-date or external information.',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'A clear, specific instruction describing what to find or do on the web.' }
        },
        required: ['task']
      }
    }
  }
];

// Calls Ollama's /api/chat with streaming disabled so we get one JSON object
// back instead of newline-delimited chunks. Returns the full message object
// (not just its content) so callers can inspect `tool_calls` when `tools` is
// passed - see routes/chat.js's tool-resolution step.
async function ollamaChat(model, messages, tools) {
  const { url, model: resolvedModel } = await resolveOllamaTarget(model);

  let response;
  try {
    response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: resolvedModel,
        messages,
        tools,
        stream: false,
        keep_alive: getKeepAlive(resolvedModel)
      })
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${url}: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data || typeof data.message !== 'object' || data.message === null) {
    throw new Error('Unexpected response shape from Ollama');
  }

  return data.message;
}

// Calls Ollama's /api/chat with streaming enabled. Ollama sends one
// newline-delimited JSON object per token/chunk (`{message:{content:"..."}}`),
// terminated by a final object with `done: true`. onChunk is called with each
// content delta as it arrives. When the model supports it (see
// utils/modelMode.js) and a caller passes onThinking, Ollama's `think: true`
// param splits its reasoning trace into a separate `message.thinking` field -
// Ollama streams thinking chunks first, then shifts to content chunks once
// reasoning concludes (never both populated in the same chunk). Returns
// { content, thinking } with the full accumulated text of each.
async function ollamaChatStream(model, messages, onChunk, onThinking) {
  const { url, model: resolvedModel } = await resolveOllamaTarget(model);
  const think = supportsThinking(resolvedModel) && typeof onThinking === 'function';

  let response;
  try {
    response = await fetch(`${url}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: resolvedModel,
        messages,
        stream: true,
        keep_alive: getKeepAlive(resolvedModel),
        ...(think ? { think: true } : {})
      })
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${url}: ${err.message}`);
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama request failed (${response.status}): ${text}`);
  }

  let full = '';
  let thinking = '';
  let buffer = '';
  // response.body yields raw Uint8Arrays (not Node Buffers), and a multi-byte
  // UTF-8 character can land split across two chunks - a stateful decoder
  // with {stream: true} handles that instead of mangling it.
  const decoder = new TextDecoder('utf-8');

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // skip a malformed line rather than aborting the whole stream
      }

      if (parsed.message) {
        if (typeof parsed.message.thinking === 'string' && parsed.message.thinking) {
          thinking += parsed.message.thinking;
          // Guard even though `think` gates the request: defensive against a
          // server sending a thinking field back regardless of what was asked.
          onThinking?.(parsed.message.thinking);
        }
        if (typeof parsed.message.content === 'string' && parsed.message.content) {
          full += parsed.message.content;
          onChunk(parsed.message.content);
        }
      }

      if (parsed.done) {
        return { content: full, thinking };
      }
    }
  }

  return { content: full, thinking };
}

// Single-shot vision call: one user turn carrying both the prompt and a
// base64-encoded image, no history - the caller (routes/vision.js) is
// describing a screenshot, not continuing a multi-turn exchange with images.
// Not part of the Nitro 7 failover above (see resolveOllamaTarget) - this is
// only ever used as OpenAI's fallback in routes/vision.js, always against
// the primary Ollama host, unchanged from before.
async function ollamaVisionChat(model, prompt, base64Image) {
  let response;
  try {
    response = await fetch(`${PRIMARY_OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt, images: [base64Image] }],
        stream: false,
        keep_alive: getKeepAlive(model)
      })
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${PRIMARY_OLLAMA_URL}: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama vision request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data || !data.message || typeof data.message.content !== 'string') {
    throw new Error('Unexpected response shape from Ollama');
  }

  return data.message.content;
}

module.exports = { ollamaChat, ollamaChatStream, ollamaVisionChat, BROWSE_TOOL_SCHEMA };
