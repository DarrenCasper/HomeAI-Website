const router = require('express').Router();
const mongoose = require('mongoose');
const ApiRegistry = require('../models/ApiRegistry');
const { bulkApproveEligible, bulkEnableCategory } = require('../lib/apiRegistry');

const EDITABLE_FIELDS = [
  'name',
  'description',
  'baseUrl',
  'path',
  'method',
  'params',
  'authType',
  'authEnvVar',
  'authKeyName',
  'category',
  'healthCheckParams',
  'minIntervalMs',
  'skipHealthCheck'
];

function toDto(doc) {
  return {
    id: doc._id,
    name: doc.name,
    description: doc.description,
    baseUrl: doc.baseUrl,
    path: doc.path,
    method: doc.method,
    params: doc.params,
    authType: doc.authType,
    authEnvVar: doc.authEnvVar,
    authKeyName: doc.authKeyName,
    enabled: doc.enabled,
    status: doc.status,
    proposedBy: doc.proposedBy,
    createdAt: doc.createdAt,
    category: doc.category,
    importNotes: doc.importNotes,
    healthCheckParams: doc.healthCheckParams,
    skipHealthCheck: doc.skipHealthCheck,
    minIntervalMs: doc.minIntervalMs,
    lastCheckedAt: doc.lastCheckedAt,
    lastCheckOk: doc.lastCheckOk,
    consecutiveFailures: doc.consecutiveFailures,
    disabledReason: doc.disabledReason
  };
}

function pickEditableFields(body) {
  const updates = {};
  for (const field of EDITABLE_FIELDS) {
    if (body?.[field] !== undefined) updates[field] = body[field];
  }
  return updates;
}

// Manual entries skip the approval queue entirely - the human filling out
// this form IS the approval, same as any other admin-only write in this
// app (no separate admin-role system, just the existing Tailscale auth gate).
router.post('/', async (req, res) => {
  const { name, description, baseUrl, path } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' });
  if (typeof description !== 'string' || !description.trim()) return res.status(400).json({ error: 'description is required' });
  if (typeof baseUrl !== 'string' || !baseUrl.startsWith('https://')) return res.status(400).json({ error: 'baseUrl must start with https://' });
  if (typeof path !== 'string' || !path.trim()) return res.status(400).json({ error: 'path is required' });

  try {
    const api = await ApiRegistry.create({
      // authEnvVar/authKeyName only, from the raw body - the rest of
      // EDITABLE_FIELDS gets the validated/defaulted versions below instead.
      authEnvVar: req.body.authEnvVar,
      authKeyName: req.body.authKeyName,
      name: name.trim(),
      description: description.trim(),
      baseUrl: baseUrl.trim(),
      path: path.trim(),
      method: req.body.method || 'GET',
      params: Array.isArray(req.body.params) ? req.body.params : [],
      authType: req.body.authType || 'none',
      // Same shared form as editing (see ApiRegistryDialog.jsx's ApiForm)
      // offers these too - accepted here so they don't silently get
      // dropped when set on a brand-new manual entry instead of an edit.
      category: req.body.category || null,
      healthCheckParams: req.body.healthCheckParams && typeof req.body.healthCheckParams === 'object' ? req.body.healthCheckParams : null,
      minIntervalMs: Number.isFinite(req.body.minIntervalMs) ? req.body.minIntervalMs : 350,
      skipHealthCheck: !!req.body.skipHealthCheck,
      enabled: true,
      status: 'approved',
      proposedBy: 'user'
    });
    res.json(toDto(api));
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: `An API named "${name}" already exists` });
    console.error('[adminApis] create failed:', err.message);
    res.status(503).json({ error: 'API registry unavailable' });
  }
});

// Approved entries only, regardless of the enabled on/off toggle - pending
// and rejected entries have their own views (GET /pending; rejected ones
// are visible nowhere in the UI but kept in the DB so a repeat AI proposal
// of the same name can be recognized and refused, see routes/chat.js).
router.get('/', async (req, res) => {
  try {
    const apis = await ApiRegistry.find({ status: 'approved' }).sort({ createdAt: -1 }).lean();
    res.json(apis.map(toDto));
  } catch (err) {
    console.error('[adminApis] list failed:', err.message);
    res.status(503).json({ error: 'API registry unavailable' });
  }
});

router.get('/pending', async (req, res) => {
  try {
    const apis = await ApiRegistry.find({ status: 'pending' }).sort({ createdAt: -1 }).lean();
    res.json(apis.map(toDto));
  } catch (err) {
    console.error('[adminApis] list pending failed:', err.message);
    res.status(503).json({ error: 'API registry unavailable' });
  }
});

// Approves every pending entry that needs neither auth setup nor a path
// param filled in - see lib/apiRegistry.js's isBulkApproveEligible. Returns
// names (not just a count) so the frontend can show exactly what happened
// rather than a silent "done".
router.post('/bulk-approve-eligible', async (req, res) => {
  try {
    const result = await bulkApproveEligible();
    res.json(result);
  } catch (err) {
    console.error('[adminApis] bulk-approve-eligible failed:', err.message);
    res.status(503).json({ error: 'API registry unavailable' });
  }
});

// Re-enables every disabled, approved entry in one category in a single
// action - see lib/apiRegistry.js's bulkEnableCategory. Distinct from the
// per-entry PATCH toggle below, which only ever touches one row at a time.
router.post('/bulk-enable-category', async (req, res) => {
  const category = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
  if (!category) return res.status(400).json({ error: 'category is required' });

  try {
    const result = await bulkEnableCategory(category);
    res.json(result);
  } catch (err) {
    console.error('[adminApis] bulk-enable-category failed:', err.message);
    res.status(503).json({ error: 'API registry unavailable' });
  }
});

router.patch('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });

  const updates = pickEditableFields(req.body);
  if (req.body?.enabled !== undefined) {
    updates.enabled = !!req.body.enabled;
    if (updates.enabled) {
      // A human re-enabling it (whether it was off manually or auto-disabled
      // by a failing health check) gets a clean slate - otherwise a
      // health-check-disabled entry whose underlying problem isn't actually
      // fixed would just re-disable itself on the very next scheduled check,
      // which would look like this toggle silently "not working."
      updates.consecutiveFailures = 0;
      updates.disabledReason = null;
    } else {
      updates.disabledReason = 'manual';
    }
  }
  if (updates.baseUrl !== undefined && !String(updates.baseUrl).startsWith('https://')) {
    return res.status(400).json({ error: 'baseUrl must start with https://' });
  }

  try {
    const api = await ApiRegistry.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!api) return res.status(404).json({ error: 'Not found' });
    res.json(toDto(api));
  } catch (err) {
    console.error('[adminApis] update failed:', err.message);
    res.status(503).json({ error: 'API registry unavailable' });
  }
});

// Accepts optional field overrides so a human can fix a wrong param (or
// anything else) before an AI-drafted proposal goes live, without a
// separate edit-then-approve round trip.
router.post('/:id/approve', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });

  const updates = { ...pickEditableFields(req.body), status: 'approved' };
  if (updates.baseUrl !== undefined && !String(updates.baseUrl).startsWith('https://')) {
    return res.status(400).json({ error: 'baseUrl must start with https://' });
  }

  try {
    const api = await ApiRegistry.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!api) return res.status(404).json({ error: 'Not found' });
    res.json(toDto(api));
  } catch (err) {
    console.error('[adminApis] approve failed:', err.message);
    res.status(503).json({ error: 'API registry unavailable' });
  }
});

// Kept, not deleted - so the same bad AI proposal is recognized and
// refused rather than re-suggested (see routes/chat.js's propose_api dedupe).
router.post('/:id/reject', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const api = await ApiRegistry.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
    if (!api) return res.status(404).json({ error: 'Not found' });
    res.json(toDto(api));
  } catch (err) {
    console.error('[adminApis] reject failed:', err.message);
    res.status(503).json({ error: 'API registry unavailable' });
  }
});

// Wipes the entire registry (approved, pending, and rejected alike) - the
// frontend's confirm() step is the only guard, there's no undo. Meant for
// clearing a bad bulk import wholesale rather than reviewing/rejecting
// hundreds of entries by hand.
router.delete('/bulk', async (req, res) => {
  try {
    const result = await ApiRegistry.deleteMany({});
    res.json({ deletedCount: result.deletedCount });
  } catch (err) {
    console.error('[adminApis] bulk delete failed:', err.message);
    res.status(503).json({ error: 'API registry unavailable' });
  }
});

router.delete('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Not found' });

  try {
    const result = await ApiRegistry.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.status(204).end();
  } catch (err) {
    console.error('[adminApis] delete failed:', err.message);
    res.status(503).json({ error: 'API registry unavailable' });
  }
});

module.exports = router;
