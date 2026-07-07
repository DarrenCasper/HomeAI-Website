const router = require('express').Router();
const mongoose = require('mongoose');
const Project = require('../models/Project');
const Conversation = require('../models/Conversation');

// All queries below filter by req.userId (set by the auth middleware) -
// never by anything from params/body/query - so a project can never be read
// or modified by a user who merely guessed its id. Same pattern as history.js.

router.get('/', async (req, res) => {
  try {
    const projects = await Project.find({ userId: req.userId })
      .sort({ updatedAt: -1 })
      .select('_id name updatedAt')
      .lean();

    res.json(projects.map((p) => ({ id: p._id, name: p.name, updatedAt: p.updatedAt })));
  } catch (err) {
    console.error('[projects] list failed:', err.message);
    res.status(503).json({ error: 'Project store unavailable' });
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const project = await Project.create({ userId: req.userId, name: name.trim() });
    res.json({ id: project._id, name: project.name });
  } catch (err) {
    console.error('[projects] create failed:', err.message);
    res.status(503).json({ error: 'Project store unavailable' });
  }
});

router.get('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const project = await Project.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!project) {
      return res.status(404).json({ error: 'Not found' });
    }

    const conversations = await Conversation.find({ projectId: project._id, userId: req.userId })
      .sort({ updatedAt: -1 })
      .select('_id title updatedAt')
      .lean();

    res.json({
      id: project._id,
      name: project.name,
      conversations: conversations.map((c) => ({ id: c._id, title: c.title, updatedAt: c.updatedAt }))
    });
  } catch (err) {
    console.error('[projects] get failed:', err.message);
    res.status(503).json({ error: 'Project store unavailable' });
  }
});

router.patch('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { name: name.trim(), updatedAt: new Date() },
      { new: true }
    );

    if (!project) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.json({ id: project._id, name: project.name });
  } catch (err) {
    console.error('[projects] rename failed:', err.message);
    res.status(503).json({ error: 'Project store unavailable' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Not found' });
  }

  try {
    const project = await Project.findOneAndDelete({ _id: req.params.id, userId: req.userId });
    if (!project) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Un-tag rather than cascade-delete: chats that were in this project stay
    // in history, just no longer grouped under it.
    await Conversation.updateMany(
      { projectId: project._id, userId: req.userId },
      { $set: { projectId: null } }
    );

    res.status(204).end();
  } catch (err) {
    console.error('[projects] delete failed:', err.message);
    res.status(503).json({ error: 'Project store unavailable' });
  }
});

module.exports = router;
