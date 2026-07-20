const router = require('express').Router();
const ApiRegistry = require('../models/ApiRegistry');
const { listReferencedEnvVars, setSecretValue } = require('../lib/apiSecrets');

// Status only (envVarName, isSet, source) - never the value itself, see
// lib/apiSecrets.js's listReferencedEnvVars.
router.get('/', async (req, res) => {
  try {
    const secrets = await listReferencedEnvVars();
    res.json(secrets);
  } catch (err) {
    console.error('[adminSecrets] list failed:', err.message);
    res.status(503).json({ error: 'Secrets store unavailable' });
  }
});

router.post('/', async (req, res) => {
  const envVarName = typeof req.body?.envVarName === 'string' ? req.body.envVarName.trim() : '';
  const value = typeof req.body?.value === 'string' ? req.body.value : '';

  if (!envVarName) return res.status(400).json({ error: 'envVarName is required' });
  if (!value.trim()) return res.status(400).json({ error: 'value is required' });

  try {
    // No point storing a secret nothing currently asks for - also keeps
    // this from silently accumulating orphaned entries over time.
    const referenced = await ApiRegistry.exists({
      authEnvVar: envVarName,
      status: { $in: ['approved', 'pending'] }
    });
    if (!referenced) {
      return res.status(400).json({ error: `"${envVarName}" isn't referenced by any current registry entry` });
    }

    await setSecretValue(envVarName, value);
    res.json({ envVarName, saved: true });
  } catch (err) {
    console.error('[adminSecrets] save failed:', err.message);
    res.status(503).json({ error: 'Secrets store unavailable' });
  }
});

module.exports = router;
