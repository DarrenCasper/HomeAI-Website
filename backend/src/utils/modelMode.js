// qwen models answer fast enough to stream straight through. deepseek/deepsek
// (reasoning) models can run well past Cloudflare's ~100s proxy timeout, so
// those go through the background job + polling path instead. Anything
// unrecognized defaults to streaming since it's the simpler/cheaper path.
function getModelMode(model) {
  const name = typeof model === 'string' ? model.toLowerCase() : '';

  if (name.includes('qwen')) return 'stream';
  if (name.includes('deepseek') || name.includes('deepsek')) return 'job';

  return 'stream';
}

module.exports = { getModelMode };
