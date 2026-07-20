const ApiSecret = require('../models/ApiSecret');
const ApiRegistry = require('../models/ApiRegistry');

// Database first, then process.env - additive to how OPENAI_API_KEY/
// TAVILY_API_KEY already work (an env var alone still works exactly as
// before with nothing stored here), and lets a database value override an
// env var if both somehow exist, without requiring either to be cleared.
async function getSecretValue(envVarName) {
  if (!envVarName) return undefined;
  const stored = await ApiSecret.findOne({ envVarName }).lean();
  if (stored) return stored.value;
  return process.env[envVarName];
}

async function setSecretValue(envVarName, value) {
  await ApiSecret.updateOne({ envVarName }, { $set: { value, updatedAt: new Date() } }, { upsert: true });
}

// Every distinct authEnvVar referenced by a registry entry that could
// actually use it - approved (already live) and pending (will need it the
// moment it's approved) both included, so a secret can be set ahead of
// time rather than discovered missing only after approval. Status only,
// never the value - see routes/adminSecrets.js.
async function listReferencedEnvVars() {
  const rawNames = await ApiRegistry.distinct('authEnvVar', { status: { $in: ['approved', 'pending'] } });
  const names = rawNames.filter(Boolean).sort();

  const stored = await ApiSecret.find({ envVarName: { $in: names } }, 'envVarName').lean();
  const inDb = new Set(stored.map((s) => s.envVarName));

  return names.map((envVarName) => {
    const isInDb = inDb.has(envVarName);
    const isInEnv = Boolean(process.env[envVarName]);
    return {
      envVarName,
      isSet: isInDb || isInEnv,
      source: isInDb ? 'database' : isInEnv ? 'environment' : 'unset'
    };
  });
}

module.exports = { getSecretValue, setSecretValue, listReferencedEnvVars };
