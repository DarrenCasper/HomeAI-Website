const router = require('express').Router();
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const ChatJob = require('../models/ChatJob');
const Project = require('../models/Project');
const { ollamaChatStream } = require('../lib/ollama');
const { getModelMode, getKeepAlive } = require('../utils/modelMode');

// Throttles how often a running job's partial answer is written to Mongo -
// streaming every token straight to the DB would be a write per few ms.
const PARTIAL_SAVE_INTERVAL_MS = 1000;

router.post('/', async (req, res) => {
  const { message, model, conversationId, projectId } = req.body || {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'model is required' });
  }
  if (conversationId !== undefined && !mongoose.isValidObjectId(conversationId)) {
    return res.status(404).json({ error: 'Conversation not found' });
  }
  // Only meaningful for a brand-new conversation - an existing one keeps
  // whatever project it was already tagged with, same as the frontend intends.
  if (!conversationId && projectId !== undefined && !mongoose.isValidObjectId(projectId)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const trimmedMessage = message.trim();
  const trimmedModel = model.trim();
  const mode = getModelMode(trimmedModel);
  console.log(`[chat] model=${trimmedModel} mode=${mode} keepAlive=${getKeepAlive(trimmedModel)}`);

  let conversation;
  try {
    if (conversationId) {
      // Scoped to req.userId: an id belonging to another user 404s exactly
      // like an id that doesn't exist at all.
      conversation = await Conversation.findOne({ _id: conversationId, userId: req.userId });
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
    } else {
      let projectDoc = null;
      if (projectId) {
        projectDoc = await Project.findOne({ _id: projectId, userId: req.userId });
        if (!projectDoc) {
          return res.status(404).json({ error: 'Project not found' });
        }
      }

      conversation = new Conversation({
        userId: req.userId,
        projectId: projectDoc ? projectDoc._id : null,
        title: trimmedMessage.slice(0, 40),
        messages: []
      });
    }
  } catch (err) {
    console.error('[chat] loading conversation failed:', err.message);
    return res.status(503).json({ error: 'Conversation store unavailable' });
  }

  conversation.messages.push({ role: 'user', content: trimmedMessage, model: null });
  const ollamaMessages = conversation.messages.map((m) => ({ role: m.role, content: m.content }));

  if (mode === 'job') {
    return handleJobMode(req, res, { conversation, ollamaMessages, model: trimmedModel });
  }

  return handleStreamMode(req, res, { conversation, ollamaMessages, model: trimmedModel });
});

// Streaming mode: pipes Ollama's tokens straight through as plain text chunks
// so the frontend can read them via response.body.getReader(). The
// conversation (user + assistant turns) is only persisted once the full
// answer is in, matching the non-streaming behavior this replaced - a failed
// Ollama call leaves no orphaned user-only turn in the database.
async function handleStreamMode(req, res, { conversation, ollamaMessages, model }) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Conversation-Id': String(conversation._id)
  });
  res.flushHeaders();

  let full;
  try {
    full = await ollamaChatStream(model, ollamaMessages, (delta) => res.write(delta));
  } catch (err) {
    console.error('[chat] ollama stream failed:', err.message);
    if (!res.writableEnded) {
      res.write('\n\n[stream interrupted: AI backend unavailable]');
      res.end();
    }
    return;
  }

  conversation.messages.push({ role: 'assistant', content: full, model });

  try {
    await conversation.save();
  } catch (err) {
    console.error('[chat] saving conversation failed:', err.message);
  }

  res.end();
}

// Job mode: the conversation (with just the user's turn) is saved right away
// so the job has a durable conversationId to attach to and GET
// /api/history/:id works while the job is still running. This is the one
// place that deliberately departs from the "no orphaned turn on failure"
// rule above - it's unavoidable for an async job the client polls, and the
// turn isn't really orphaned since the user really did send it.
async function handleJobMode(req, res, { conversation, ollamaMessages, model }) {
  try {
    await conversation.save();
  } catch (err) {
    console.error('[chat] saving conversation failed:', err.message);
    return res.status(503).json({ error: 'Conversation store unavailable' });
  }

  let job;
  try {
    job = await ChatJob.create({
      userId: req.userId,
      conversationId: conversation._id,
      message: ollamaMessages[ollamaMessages.length - 1]?.content || '',
      model,
      status: 'queued'
    });
  } catch (err) {
    console.error('[chat] creating job failed:', err.message);
    return res.status(503).json({ error: 'Job store unavailable' });
  }

  res.json({
    mode: 'job',
    jobId: job._id,
    status: 'queued',
    statusUrl: `/api/chat/jobs/${job._id}`,
    conversationId: conversation._id
  });

  runJob(job._id, model, ollamaMessages, conversation._id).catch((err) => {
    console.error('[chat] background job crashed:', err.message);
  });
}

async function runJob(jobId, model, ollamaMessages, conversationId) {
  try {
    await ChatJob.updateOne({ _id: jobId }, { $set: { status: 'running', updatedAt: new Date() } });
  } catch (err) {
    console.error('[chat] job status update failed:', err.message);
  }

  let partial = '';
  let lastFlush = 0;
  let flushing = false;

  const flushPartial = async (force) => {
    const now = Date.now();
    if (!force && (flushing || now - lastFlush < PARTIAL_SAVE_INTERVAL_MS)) return;
    flushing = true;
    lastFlush = now;
    try {
      await ChatJob.updateOne({ _id: jobId }, { $set: { partial, updatedAt: new Date() } });
    } catch (err) {
      console.error('[chat] job partial update failed:', err.message);
    } finally {
      flushing = false;
    }
  };

  let full;
  try {
    full = await ollamaChatStream(model, ollamaMessages, (delta) => {
      partial += delta;
      flushPartial(false);
    });
  } catch (err) {
    console.error('[chat] ollama job failed:', err.message);
    try {
      await ChatJob.updateOne(
        { _id: jobId },
        { $set: { status: 'error', error: err.message, updatedAt: new Date() } }
      );
    } catch (saveErr) {
      console.error('[chat] job error update failed:', saveErr.message);
    }
    return;
  }

  await flushPartial(true);

  try {
    await ChatJob.updateOne(
      { _id: jobId },
      { $set: { status: 'done', answer: full, partial: full, updatedAt: new Date() } }
    );
  } catch (err) {
    console.error('[chat] job done update failed:', err.message);
  }

  try {
    const conversation = await Conversation.findById(conversationId);
    if (conversation) {
      conversation.messages.push({ role: 'assistant', content: full, model });
      await conversation.save();
    }
  } catch (err) {
    console.error('[chat] saving conversation after job failed:', err.message);
  }
}

router.get('/jobs/:jobId', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.jobId)) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    // Scoped to req.userId, same as the history routes - a job id belonging
    // to another user 404s exactly like one that doesn't exist.
    const job = await ChatJob.findOne({ _id: req.params.jobId, userId: req.userId }).lean();
    if (!job) {
      return res.status(404).json({ error: 'Not found' });
    }

    const payload = { jobId: job._id, status: job.status, model: job.model };
    if (job.status === 'done') {
      payload.answer = job.answer;
    } else if (job.status === 'error') {
      payload.error = job.error;
    } else {
      payload.partial = job.partial || '';
    }

    res.json(payload);
  } catch (err) {
    console.error('[chat] job lookup failed:', err.message);
    res.status(503).json({ error: 'Job store unavailable' });
  }
});

module.exports = router;
