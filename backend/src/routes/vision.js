const router = require('express').Router();
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const VisionJob = require('../models/VisionJob');
const { openaiVisionChat } = require('../lib/openaiVision');
const { ollamaVisionChat } = require('../lib/ollama');

// Local Ollama model, used only as a fallback if OpenAI is unreachable or
// OPENAI_API_KEY isn't set - see runVisionJob below.
const VISION_MODEL = process.env.VISION_MODEL || 'qwen2.5vl:7b';

const DEFAULT_PROMPT =
  'Describe what is currently visible on this screen, focusing on any text, UI elements, or data that would be useful context for a conversation.';

// Job + polling, same pattern as /api/chat's job mode (routes/chat.js) - a
// synchronous response here held the connection silent for as long as
// vision inference took, and Cloudflare kills any connection that goes
// ~100-120s with zero response bytes regardless of whether the call would
// have eventually succeeded (vision inference on a CPU-only host routinely
// exceeds that).
router.post('/', async (req, res) => {
  const { image, conversationId, question } = req.body || {};

  if (typeof image !== 'string' || !image.trim()) {
    return res.status(400).json({ error: 'image is required' });
  }
  if (!mongoose.isValidObjectId(conversationId)) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  let conversation;
  try {
    // Scoped to req.userId, same as history/chat - an id belonging to
    // another user 404s exactly like one that doesn't exist.
    conversation = await Conversation.findOne({ _id: conversationId, userId: req.userId });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }
  } catch (err) {
    console.error('[vision] loading conversation failed:', err.message);
    return res.status(503).json({ error: 'Conversation store unavailable' });
  }

  const prompt = (typeof question === 'string' && question.trim()) || DEFAULT_PROMPT;

  let job;
  try {
    job = await VisionJob.create({
      userId: req.userId,
      conversationId: conversation._id,
      status: 'queued'
    });
  } catch (err) {
    console.error('[vision] creating job failed:', err.message);
    return res.status(503).json({ error: 'Job store unavailable' });
  }

  res.json({
    jobId: job._id,
    status: 'queued',
    statusUrl: `/api/vision/jobs/${job._id}`
  });

  // image is only ever held in memory for this call - not persisted here or
  // in runVisionJob, matching the "don't stockpile screenshots" principle.
  runVisionJob(job._id, conversation._id, prompt, image).catch((err) => {
    console.error('[vision] background job crashed:', err.message);
  });
});

async function runVisionJob(jobId, conversationId, prompt, image) {
  try {
    await VisionJob.updateOne({ _id: jobId }, { $set: { status: 'running', updatedAt: new Date() } });
  } catch (err) {
    console.error('[vision] job status update failed:', err.message);
  }

  let description;
  try {
    description = await openaiVisionChat(prompt, image);
  } catch (err) {
    // Degrades to the local model rather than failing outright - same
    // "don't hard-fail on an external dependency" pattern as the browse_web
    // tool call in chat.js falling back when the browsing agent is down.
    console.error('[vision] openai vision call failed, falling back to local model:', err.message);
    try {
      description = await ollamaVisionChat(VISION_MODEL, prompt, image);
    } catch (fallbackErr) {
      console.error('[vision] ollama vision call failed:', fallbackErr.message);
      try {
        await VisionJob.updateOne(
          { _id: jobId },
          { $set: { status: 'error', error: fallbackErr.message, updatedAt: new Date() } }
        );
      } catch (saveErr) {
        console.error('[vision] job error update failed:', saveErr.message);
      }
      return;
    }
  }

  try {
    await VisionJob.updateOne(
      { _id: jobId },
      { $set: { status: 'done', description, updatedAt: new Date() } }
    );
  } catch (err) {
    console.error('[vision] job done update failed:', err.message);
  }

  try {
    // Re-fetched rather than reusing the request-time doc - same pattern as
    // runJob() in chat.js, since other messages may have landed on this
    // conversation while the vision call was in flight.
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      // role must be 'user' or 'assistant' per the Conversation schema -
      // there's no dedicated "vision" role, so this is stored as a user turn
      // with a recognizable prefix the frontend styles distinctly.
      conversation.messages.push({ role: 'user', content: `[Screen share] ${description}`, model: null });
      await conversation.save();
    }
  } catch (err) {
    console.error('[vision] saving conversation failed:', err.message);
  }
}

router.get('/jobs/:jobId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.jobId)) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    // Scoped to req.userId, same as the chat job route - a job id belonging
    // to another user 404s exactly like one that doesn't exist.
    const job = await VisionJob.findOne({ _id: req.params.jobId, userId: req.userId }).lean();
    if (!job) {
      return res.status(404).json({ error: 'Not found' });
    }

    const payload = { jobId: job._id, status: job.status };
    if (job.status === 'done') {
      payload.description = job.description;
    } else if (job.status === 'error') {
      payload.error = job.error;
    }

    res.json(payload);
  } catch (err) {
    console.error('[vision] job lookup failed:', err.message);
    res.status(503).json({ error: 'Job store unavailable' });
  }
});

module.exports = router;
