const { getKeepAlive } = require('../utils/modelMode');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

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
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, tools, stream: false, keep_alive: getKeepAlive(model) })
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${OLLAMA_URL}: ${err.message}`);
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
// content delta as it arrives; the full accumulated text is returned once the
// stream ends.
async function ollamaChatStream(model, messages, onChunk) {
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, keep_alive: getKeepAlive(model) })
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${OLLAMA_URL}: ${err.message}`);
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama request failed (${response.status}): ${text}`);
  }

  let full = '';
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

      if (parsed.message && typeof parsed.message.content === 'string' && parsed.message.content) {
        full += parsed.message.content;
        onChunk(parsed.message.content);
      }

      if (parsed.done) {
        return full;
      }
    }
  }

  return full;
}

// Single-shot vision call: one user turn carrying both the prompt and a
// base64-encoded image, no history - the caller (routes/vision.js) is
// describing a screenshot, not continuing a multi-turn exchange with images.
async function ollamaVisionChat(model, prompt, base64Image) {
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
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
    throw new Error(`Could not reach Ollama at ${OLLAMA_URL}: ${err.message}`);
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
