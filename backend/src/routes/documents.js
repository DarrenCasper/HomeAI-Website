const router = require('express').Router();
const multer = require('multer');
const pdfParse = require('pdf-parse');
const DocumentChunk = require('../models/DocumentChunk');
const { embedText } = require('../lib/embeddings');

// 20MB is generous for the text/markdown/PDF notes this is meant for -
// uploads stay in memory only for the duration of one request, never
// written to disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Rough chars-per-token approximation (~4:1) rather than a real tokenizer -
// simple fixed-size chunking is enough at this scale, per the brief. ~500
// tokens per chunk, ~50 tokens of overlap so a fact split across a chunk
// boundary isn't lost to search.
const CHUNK_SIZE_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 200;

function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE_CHARS, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end === text.length) break;
    start = end - CHUNK_OVERLAP_CHARS;
  }
  return chunks;
}

// Synchronous response, not job+polling like vision.js - uploads here are
// meant to be short notes/text files (see the chunk size above), so this
// should stay well under Cloudflare's ~100-120s idle-connection timeout in
// practice. A very large PDF could still risk it; revisit with the same
// job+polling pattern if that turns out to matter.
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'file is required' });
  }

  const { originalname, mimetype, buffer } = req.file;

  let text;
  try {
    if (mimetype === 'application/pdf' || originalname.toLowerCase().endsWith('.pdf')) {
      const parsed = await pdfParse(buffer);
      text = parsed.text;
    } else {
      text = buffer.toString('utf8');
    }
  } catch (err) {
    console.error('[documents] text extraction failed:', err.message);
    return res.status(400).json({ error: 'Could not extract text from that file' });
  }

  const chunks = typeof text === 'string' && text.trim() ? chunkText(text.trim()) : [];
  if (chunks.length === 0) {
    return res.status(400).json({ error: 'No extractable text found in that file' });
  }

  // Re-uploading the same filename replaces its previous chunks rather than
  // duplicating them.
  try {
    await DocumentChunk.deleteMany({ userId: req.userId, sourceFileName: originalname });
  } catch (err) {
    console.error('[documents] clearing previous chunks failed:', err.message);
  }

  let stored = 0;
  for (const chunk of chunks) {
    try {
      const embedding = await embedText(chunk);
      await DocumentChunk.create({ userId: req.userId, sourceFileName: originalname, chunkText: chunk, embedding });
      stored++;
    } catch (err) {
      // One bad chunk (e.g. a transient embedding-service hiccup) shouldn't
      // discard an otherwise-successful upload - partial indexing is still
      // useful, and the file can be re-uploaded to fill gaps.
      console.error('[documents] embedding/storing a chunk failed:', err.message);
    }
  }

  if (stored === 0) {
    return res.status(503).json({ error: 'Could not index this document - embedding service unavailable' });
  }

  res.json({ sourceFileName: originalname, chunkCount: stored });
});

router.get('/', async (req, res) => {
  try {
    const rows = await DocumentChunk.aggregate([
      { $match: { userId: req.userId } },
      { $group: { _id: '$sourceFileName', chunkCount: { $sum: 1 }, uploadedAt: { $min: '$createdAt' } } },
      { $sort: { uploadedAt: -1 } }
    ]);

    res.json(rows.map((r) => ({ sourceFileName: r._id, chunkCount: r.chunkCount, uploadedAt: r.uploadedAt })));
  } catch (err) {
    console.error('[documents] list failed:', err.message);
    res.status(503).json({ error: 'Document store unavailable' });
  }
});

router.delete('/:sourceFileName', async (req, res) => {
  try {
    // Scoped to req.userId, same as every other resource route - a filename
    // belonging to another user's upload simply matches nothing.
    const result = await DocumentChunk.deleteMany({
      userId: req.userId,
      sourceFileName: req.params.sourceFileName
    });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('[documents] delete failed:', err.message);
    res.status(503).json({ error: 'Document store unavailable' });
  }
});

module.exports = router;
