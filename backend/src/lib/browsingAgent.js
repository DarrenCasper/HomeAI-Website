const BROWSER_AGENT_URL = process.env.BROWSER_AGENT_URL || 'http://127.0.0.1:8001';

// userId is passed through purely so browsing-agent can attribute its own
// OpenAI usage-log POST (see browsing-agent/main.py's _log_usage) to the
// right user for lib/usageCap.js - it plays no role in the browse itself.
async function browse(task, userId) {
  let response;
  try {
    response = await fetch(`${BROWSER_AGENT_URL}/browse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, userId })
    });
  } catch (err) {
    throw new Error(`Could not reach browsing agent at ${BROWSER_AGENT_URL}: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Browsing agent request failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.result;
}

module.exports = { browse };
