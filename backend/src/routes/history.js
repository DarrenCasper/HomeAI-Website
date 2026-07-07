const router = require('express').Router();
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');

// All queries below filter by req.userId (set by the auth middleware from
// the Tailscale header) - never by anything from params/body/query - so a
// conversation can never be read or modified by a user who merely guessed
// its id.

router.get('/', async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.userId })
      .sort({ updatedAt: -1 })
      .select('_id title updatedAt')
      .lean();

    res.json(
      conversations.map((c) => ({ id: c._id, title: c.title, updatedAt: c.updatedAt }))
    );
  } catch (err) {
    console.error('[history] list failed:', err.message);
    res.status(503).json({ error: 'Conversation store unavailable' });
  }
});

router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const conversation = await Conversation.findOne({
      _id: req.params.id,
      userId: req.userId
    }).lean();

    if (!conversation) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json({
      id: conversation._id,
      title: conversation.title,
      messages: conversation.messages,
      updatedAt: conversation.updatedAt
    });
  } catch (err) {
    console.error('[history] get failed:', err.message);
    res.status(503).json({ error: 'Conversation store unavailable' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const result = await Conversation.deleteOne({ _id: req.params.id, userId: req.userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.status(204).end();
  } catch (err) {
    console.error('[history] delete failed:', err.message);
    res.status(503).json({ error: 'Conversation store unavailable' });
  }
});

module.exports = router;
