const router = require('express').Router();
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const { ollamaChat } = require('../lib/ollama');

router.post('/', async (req, res) => {
  const { message, model, conversationId } = req.body || {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'model is required' });
  }
  if (conversationId !== undefined && !mongoose.isValidObjectId(conversationId)) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const trimmedMessage = message.trim();

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
      conversation = new Conversation({
        userId: req.userId,
        title: trimmedMessage.slice(0, 40),
        messages: []
      });
    }
  } catch (err) {
    console.error('[chat] loading conversation failed:', err.message);
    return res.status(503).json({ error: 'Conversation store unavailable' });
  }

  // Held in memory only until Ollama replies; nothing is persisted yet, so a
  // failed call below leaves no orphaned user-only turn in the database.
  conversation.messages.push({ role: 'user', content: trimmedMessage, model: null });
  const ollamaMessages = conversation.messages.map((m) => ({ role: m.role, content: m.content }));

  let replyContent;
  try {
    replyContent = await ollamaChat(model.trim(), ollamaMessages);
  } catch (err) {
    console.error('[chat] ollama call failed:', err.message);
    return res.status(502).json({ error: 'AI backend unavailable' });
  }

  conversation.messages.push({ role: 'assistant', content: replyContent, model: model.trim() });

  try {
    await conversation.save();
  } catch (err) {
    console.error('[chat] saving conversation failed:', err.message);
    return res.status(503).json({ error: 'Conversation store unavailable' });
  }

  res.json({
    conversationId: conversation._id,
    reply: replyContent,
    model: model.trim()
  });
});

module.exports = router;
