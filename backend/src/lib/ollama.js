const { getKeepAlive } = require('../utils/modelMode');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// Calls Ollama's /api/chat with streaming disabled so we get one JSON object
// back instead of newline-delimited chunks.
async function ollamaChat(model, messages) {
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, keep_alive: getKeepAlive(model) })
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${OLLAMA_URL}: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Ollama request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (!data || !data.message || typeof data.message.content !== 'string') {
    throw new Error('Unexpected response shape from Ollama');
  }

  return data.message.content;
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

module.exports = { ollamaChat, ollamaChatStream };
