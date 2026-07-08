const router = require('express').Router();
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const { ollamaVisionChat } = require('../lib/ollama');

const VISION_MODEL = process.env.VISION_MODEL || 'qwen2.5vl:7b';

const DEFAULT_PROMPT =
  'Describe what is currently visible on this screen, focusing on any text, UI elements, or data that would be useful context for a conversation.';

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

  let description;
  try {
    description = await ollamaVisionChat(VISION_MODEL, prompt, image);
  } catch (err) {
    console.error('[vision] ollama vision call failed:', err.message);
    return res.status(503).json({ error: 'Vision model unavailable' });
  }
  // The base64 image itself is discarded here - only the resulting text
  // description is ever persisted, matching the "don't stockpile
  // screenshots" principle.

  // role must be 'user' or 'assistant' per the Conversation schema - there's
  // no dedicated "vision" role, so this is stored as a user turn with a
  // recognizable prefix the frontend can style distinctly if it wants to.
  conversation.messages.push({ role: 'user', content: `[Screen share] ${description}`, model: null });

  try {
    await conversation.save();
  } catch (err) {
    console.error('[vision] saving conversation failed:', err.message);
    return res.status(503).json({ error: 'Conversation store unavailable' });
  }

  res.json({ description });
});

module.exports = router;
