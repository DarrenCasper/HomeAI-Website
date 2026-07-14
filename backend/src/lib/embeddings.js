// Same primary Ollama host as ollamaVisionChat (lib/ollama.js) - not part of
// the Nitro 7 failover in resolveOllamaTarget, deliberately: nomic-embed-text
// needs to be pulled specifically wherever this points, and duplicating the
// failover's model-remapping logic for a single always-local-ish embedding
// model isn't worth it at this scale.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const EMBED_MODEL = 'nomic-embed-text';

// Requires `ollama pull nomic-embed-text` on whichever host OLLAMA_URL
// points at.
async function embedText(text) {
  let response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: text })
    });
  } catch (err) {
    throw new Error(`Could not reach Ollama at ${OLLAMA_URL}: ${err.message}`);
  }

  if (!response.ok) {
    const text2 = await response.text().catch(() => '');
    throw new Error(`Ollama embed request failed (${response.status}): ${text2}`);
  }

  const data = await response.json();
  const embedding = data?.embeddings?.[0];
  if (!Array.isArray(embedding)) {
    throw new Error('Unexpected response shape from Ollama /api/embed');
  }

  return embedding;
}

// Standard dot-product-over-magnitudes cosine similarity. Pure function, no
// dependency - fine at the vector sizes/chunk counts this app deals with.
function cosineSimilarity(a, b) {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

module.exports = { embedText, cosineSimilarity };
