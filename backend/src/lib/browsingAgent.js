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

// Cheap, single-request read of an already-known URL - browsing-agent's
// /fetch (trafilatura, falling back to BeautifulSoup), not a real browser.
async function fetchPage(url) {
  let response;
  try {
    response = await fetch(`${BROWSER_AGENT_URL}/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
  } catch (err) {
    throw new Error(`Could not reach browsing agent at ${BROWSER_AGENT_URL}: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Browsing agent fetch failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  if (data.error && !data.text) throw new Error(data.error);
  return data.text || '';
}

// Two chained lookups (geocode then forecast) on browsing-agent's side -
// see browsing-agent/main.py's /weather for why this stays a dedicated
// endpoint/tool instead of a registry entry.
async function getWeather(location) {
  let response;
  try {
    response = await fetch(`${BROWSER_AGENT_URL}/weather`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ location })
    });
  } catch (err) {
    throw new Error(`Could not reach browsing agent at ${BROWSER_AGENT_URL}: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Weather lookup failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.summary || JSON.stringify(data);
}

// Upstream of propose_api - tries structured, scrape-resistant sources
// (APIs.guru, common OpenAPI spec paths) before the model ever resorts to
// browse_web on a docs page. Returns { found: false } rather than throwing
// when nothing turns up - that's an expected, non-error outcome the
// calling model needs to see and react to (fall back to browse_web, or
// report it couldn't determine the schema), not a failure to swallow.
async function discoverApiSchema(domainOrName) {
  let response;
  try {
    response = await fetch(`${BROWSER_AGENT_URL}/discover-api-schema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain_or_name: domainOrName })
    });
  } catch (err) {
    throw new Error(`Could not reach browsing agent at ${BROWSER_AGENT_URL}: ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API schema discovery failed (${response.status}): ${text}`);
  }

  return response.json();
}

module.exports = { browse, fetchPage, getWeather, discoverApiSchema };
