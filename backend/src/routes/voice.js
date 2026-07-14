const router = require('express').Router();
const multer = require('multer');
const { Readable } = require('stream');

const VOICE_AGENT_URL = process.env.VOICE_AGENT_URL || 'http://127.0.0.1:8002';

// A voice clip from MediaRecorder is small (a few seconds of audio); 20MB
// is generous headroom, same limit as the other upload routes.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'audio is required' });
  }

  const form = new FormData();
  form.append('file', new Blob([req.file.buffer]), req.file.originalname || 'audio.webm');

  let response;
  try {
    response = await fetch(`${VOICE_AGENT_URL}/transcribe`, { method: 'POST', body: form });
  } catch (err) {
    console.error('[voice] could not reach voice agent:', err.message);
    return res.status(503).json({ error: 'Voice service unavailable' });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error(`[voice] transcribe failed (${response.status}):`, text);
    return res.status(502).json({ error: 'Transcription failed' });
  }

  const data = await response.json();
  res.json({ text: data.text || '' });
});

router.post('/speak', async (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  let response;
  try {
    response = await fetch(`${VOICE_AGENT_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim() })
    });
  } catch (err) {
    console.error('[voice] could not reach voice agent:', err.message);
    return res.status(503).json({ error: 'Voice service unavailable' });
  }

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '');
    console.error(`[voice] speak failed (${response.status}):`, errText);
    return res.status(502).json({ error: 'Speech synthesis failed' });
  }

  res.setHeader('Content-Type', 'audio/wav');
  // Streams straight through rather than buffering the whole clip in
  // memory first - Readable.fromWeb bridges undici's web ReadableStream to
  // a Node stream so .pipe() handles backpressure for us.
  Readable.fromWeb(response.body).pipe(res);
});

module.exports = router;
