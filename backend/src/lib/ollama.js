const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// Calls Ollama's /api/chat with streaming disabled so we get one JSON object
// back instead of newline-delimited chunks.
async function ollamaChat(model, messages) {
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false })
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

module.exports = { ollamaChat };
