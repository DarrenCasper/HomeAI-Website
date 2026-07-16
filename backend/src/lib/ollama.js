const { getKeepAlive, supportsThinking } = require('../utils/modelMode');
const { buildCategorySelectorTool } = require('./apiRegistry');

const PRIMARY_OLLAMA_URL = process.env.OLLAMA_URL || 'http://100.x.x.x:11434'; // Nitro 7's Tailscale IP - set the real one via env
const FALLBACK_OLLAMA_URL = process.env.OLLAMA_FALLBACK_URL || 'http://127.0.0.1:11434'; // this machine's own Ollama
const PRIMARY_CHECK_TIMEOUT_MS = parseInt(process.env.OLLAMA_PRIMARY_TIMEOUT_MS || '3000', 10);
const PRIMARY_CACHE_TTL_MS = 15000; // avoid re-checking reachability on every single call in a burst

const FALLBACK_MODEL_MAP = JSON.parse(
  process.env.OLLAMA_FALLBACK_MODEL_MAP || '{"qwen3.5:4b":"qwen3.5:0.8b"}'
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

// Tools handed to Ollama on the non-streaming "decide" call in
// routes/chat.js, composed fresh per request (not a static list) since
// select_api_category's own description embeds the current category index
// - see buildCategorySelectorTool() in lib/apiRegistry.js. The registry
// grew past ~200 entries, so the full call_external_api index no longer
// lives in this first-pass tool list at all - picking a category here is
// step one of a two-step lookup routes/chat.js's resolveTools() runs, with
// the actual per-category call_external_api tool only built and offered
// on a second, narrower call once a category's been picked. Priority
// order, baked into the descriptions below so the model sees it too, not
// just this comment: search_documents (the user's own notes) >
// select_api_category (structured, fast, no scraping risk) > fetch_page
// (cheap, but only for a URL you already have) > browse_web (genuine last
// resort - actual clicking/forms/multi-step interaction). get_weather sits
// outside that chain as a dedicated tool - it needs two chained calls
// (geocode then forecast), which the generic single-endpoint registry
// caller doesn't support, so it can't be a call_external_api registry entry.
async function buildToolsForRequest() {
  const tools = [
    {
      type: 'function',
      function: {
        name: 'search_documents',
        description:
          "Search the user's own uploaded documents/notes. Check this FIRST when a question might be answered by something the user has previously uploaded - it's their own private data, not available anywhere else.",
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to search for in the uploaded documents.' }
          },
          required: ['query']
        }
      }
    },
    await buildCategorySelectorTool(),
    {
      type: 'function',
      function: {
        name: 'fetch_page',
        description:
          'Fetch and read a specific, already-known URL. Cheap and fast - use when you already have the exact URL and no interaction is required. Prefer select_api_category when a structured API covers the same information.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The exact URL to fetch.' }
          },
          required: ['url']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description:
          'Current weather and short forecast for a location. Needs two chained lookups (geocoding then forecast), which is why this stays a dedicated tool instead of a registry entry reachable via select_api_category.',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string', description: 'City or place name.' }
          },
          required: ['location']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'browse_web',
        description:
          'Drive a real browser to search, click, fill forms, or navigate multiple pages. Last resort - only when the task genuinely requires interaction that search_documents, select_api_category, fetch_page, and get_weather all cannot do.',
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

  if (process.env.ALLOW_AI_API_PROPOSALS === 'true') {
    tools.push({
      type: 'function',
      function: {
        name: 'discover_api_schema',
        description:
          'Try to find a structured, machine-readable schema (OpenAPI/Swagger spec) for an API before reading its docs page. Always use this FIRST when researching a new API to propose - only fall back to browse_web on the actual documentation website if this returns found: false, and expect that fallback to sometimes fail (doc sites are often protected against scraping) - if it does, tell the user you could not reliably determine the API schema rather than guessing.',
        parameters: {
          type: 'object',
          properties: {
            domain_or_name: { type: 'string', description: 'The API\'s domain or common name, e.g. "jikan.moe" or "OpenWeather".' }
          },
          required: ['domain_or_name']
        }
      }
    });
    tools.push({
      type: 'function',
      function: {
        name: 'propose_api',
        description:
          "After reading an API's documentation via discover_api_schema, browse_web, or fetch_page, propose adding it to the registry for future use. Use discover_api_schema first if you haven't already - if it found a real spec, base this proposal on that rather than your own reading of a docs page. Creates a pending entry a human must approve - does not make the API usable immediately. Only propose APIs you have actually read documentation for in this conversation.",
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            baseUrl: { type: 'string' },
            path: { type: 'string' },
            method: { type: 'string', enum: ['GET'] },
            params: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  in: { type: 'string', enum: ['query', 'path'] },
                  required: { type: 'boolean' },
                  description: { type: 'string' }
                }
              }
            },
            authType: { type: 'string', enum: ['none', 'header', 'query'] },
            authKeyName: { type: 'string' }
          },
          required: ['name', 'description', 'baseUrl', 'path', 'params', 'authType']
        }
      }
    });
  }

  return tools;
}

// Calls Ollama's /api/chat with streaming disabled so we get one JSON object
// back instead of newline-delimited chunks. Returns the full message object
// (not just its content) so callers can inspect `tool_calls` when `tools` is
// passed - see routes/chat.js's tool-resolution step. `think` should be true
// for thinking models (see modelMode.supportsThinking) so Ollama splits any
// reasoning trace into `message.thinking` instead of leaving raw <think>
// tags inline in `message.content`.
async function ollamaChat(model, messages, tools, think) {
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
        keep_alive: getKeepAlive(resolvedModel),
        ...(think ? { think: true } : {})
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

module.exports = { ollamaChat, ollamaChatStream, ollamaVisionChat, buildToolsForRequest };
