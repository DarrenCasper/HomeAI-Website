const DocumentChunk = require('../models/DocumentChunk');
const { embedText, cosineSimilarity } = require('./embeddings');

// Brute-force cosine similarity over every chunk this user owns - fine at
// personal scale (hundreds to low thousands of chunks); an ANN index or
// external vector store is unwarranted complexity until that stops being true.
async function searchDocuments(userId, query, topK = 5) {
  const queryEmbedding = await embedText(query);

  const chunks = await DocumentChunk.find({ userId }).lean();
  if (chunks.length === 0) return '';

  const scored = chunks
    .map((chunk) => ({ chunk, score: cosineSimilarity(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return scored.map(({ chunk }) => `[from ${chunk.sourceFileName}]\n${chunk.chunkText}`).join('\n\n---\n\n');
}

module.exports = { searchDocuments };
