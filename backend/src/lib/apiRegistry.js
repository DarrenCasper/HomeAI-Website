const ApiRegistry = require('../models/ApiRegistry');

// Same cap as browsing-agent's /fetch (MAX_CHARS) - keeps a runaway/huge
// API response from blowing up the prompt sent to Ollama afterward.
const MAX_RESPONSE_CHARS = 8000;

// Per-API last-call timestamp, in memory only - resets on restart, which is
// fine at this scale (no Redis needed just to pace a few hundred APIs
// nobody's hitting concurrently across processes).
const lastCallAt = new Map();

// Blocks until at least minIntervalMs has passed since the last call to
// this specific API - the simplest way to respect a strict published rate
// limit (Nominatim, MusicBrainz, ...) without a token-bucket/queue
// implementation this app doesn't need at its actual call volume.
async function waitForRateLimit(apiName, minIntervalMs) {
  const last = lastCallAt.get(apiName);
  const now = Date.now();
  if (last !== undefined) {
    const elapsed = now - last;
    if (elapsed < minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, minIntervalMs - elapsed));
    }
  }
  lastCallAt.set(apiName, Date.now());
}

// Retries a 429 with backoff (Retry-After header if the API sends one,
// otherwise a simple linear backoff) instead of surfacing the rate-limit
// error straight to the model on the first hit - most free-tier APIs here
// are hit rarely enough that a short wait clears a transient 429 outright.
async function fetchWithBackoff(url, options, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, options);
    if (response.status !== 429) return response;
    if (attempt === maxRetries) return response;

    const retryAfterHeader = response.headers.get('retry-after');
    const backoffMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : (attempt + 1) * 1000;
    console.warn(`[apiRegistry] 429 from ${url}, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }
}

// Projected to just what the tool description needs - approved+enabled
// only, so a pending/rejected/disabled entry is invisible to the model
// entirely, not just soft-blocked at call time.
async function getEnabledApis() {
  return ApiRegistry.find({ enabled: true, status: 'approved' }, 'name description').lean();
}

function buildUrl(api, params, queryParamDefs, pathParamDefs) {
  let path = api.path;
  for (const def of pathParamDefs) {
    if (params[def.name] !== undefined && params[def.name] !== null) {
      path = path.replace(`{${def.name}}`, encodeURIComponent(params[def.name]));
    }
  }

  const base = api.baseUrl.replace(/\/+$/, '');
  const url = new URL(base + (path.startsWith('/') ? path : `/${path}`));

  for (const def of queryParamDefs) {
    const value = params[def.name];
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(def.name, value);
    }
  }

  return url;
}

function applyAuth(api, url, headers) {
  if (api.authType === 'none') return;

  if (!api.authEnvVar) {
    throw new Error(`API "${api.name}" is misconfigured: authType is "${api.authType}" but no authEnvVar is set`);
  }
  const key = process.env[api.authEnvVar];
  if (!key) {
    throw new Error(`API key not configured: set ${api.authEnvVar} to use "${api.name}"`);
  }

  if (api.authType === 'header') {
    headers[api.authKeyName || 'Authorization'] = key;
  } else if (api.authType === 'bearer') {
    headers['Authorization'] = `Bearer ${key}`;
  } else if (api.authType === 'query') {
    url.searchParams.set(api.authKeyName || 'api_key', key);
  }
}

// Looks up a registered API by exact name and calls it. Enforces
// https-only on every call (not just at registration/proposal time) - a
// baseUrl could in principle be edited after the fact, so this is checked
// here too rather than trusted from whenever the row was last saved.
async function callRegisteredApi(apiName, params) {
  const api = await ApiRegistry.findOne({ name: apiName });
  if (!api) throw new Error(`No registered API named "${apiName}"`);
  if (!api.enabled) throw new Error(`API "${apiName}" is disabled`);
  if (api.status !== 'approved') throw new Error(`API "${apiName}" is not approved for use`);
  if (!api.baseUrl.startsWith('https://')) throw new Error(`API "${apiName}" has an insecure baseUrl - refusing to call it`);

  const safeParams = params && typeof params === 'object' ? params : {};
  const method = api.method || 'GET';
  const pathParamDefs = api.params.filter((p) => p.in === 'path');
  const queryParamDefs = api.params.filter((p) => p.in === 'query');
  const bodyParamDefs = api.params.filter((p) => p.in === 'body');

  for (const def of pathParamDefs.concat(queryParamDefs, bodyParamDefs)) {
    const value = safeParams[def.name];
    if (def.required && (value === undefined || value === null || value === '')) {
      throw new Error(`Missing required param "${def.name}" for API "${api.name}"`);
    }
  }

  if (method === 'GET' && bodyParamDefs.length > 0) {
    console.warn(`[apiRegistry] "${apiName}" is registered as GET but has body-type params - ignoring them (misconfigured registry entry)`);
  }

  const url = buildUrl(api, safeParams, queryParamDefs, pathParamDefs);
  const headers = {};
  applyAuth(api, url, headers);

  const fetchOptions = { method, headers };
  if (method === 'POST') {
    const bodyPayload = {};
    for (const def of bodyParamDefs) {
      const value = safeParams[def.name];
      if (value !== undefined && value !== null && value !== '') {
        bodyPayload[def.name] = value;
      }
    }
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(bodyPayload);
  }

  await waitForRateLimit(apiName, api.minIntervalMs);

  let response;
  try {
    response = await fetchWithBackoff(url.toString(), fetchOptions);
  } catch (err) {
    throw new Error(`Could not reach "${apiName}": ${err.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`"${apiName}" request failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  const resultText = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
  return resultText.slice(0, MAX_RESPONSE_CHARS);
}

// Approved+enabled entries grouped by category, most-populated first - the
// index the model sees on its first pass now (buildCategorySelectorTool
// below), instead of every individual API. Entries with no category set
// group under "Uncategorized".
async function getCategorySummary() {
  const apis = await ApiRegistry.find({ enabled: true, status: 'approved' }, 'category').lean();
  const counts = new Map();
  for (const api of apis) {
    const key = api.category || 'Uncategorized';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

// Same shape as getEnabledApis(), scoped to one category - pass category:
// null for "Uncategorized" (entries with no category set), matching
// getCategorySummary's grouping above.
async function getApisInCategory(category) {
  return ApiRegistry.find({ enabled: true, status: 'approved', category }, 'name description').lean();
}

// First-pass tool (see lib/ollama.js's buildToolsForRequest): a ~20-line
// category index instead of every individual API description, so the
// model isn't drowning in a 200-entry list on every single request. Once
// it picks a category, routes/chat.js makes a second, narrower call with
// buildApiToolForCategory() below.
async function buildCategorySelectorTool() {
  const summary = await getCategorySummary();
  const index = summary.length
    ? summary.map((s) => `- ${s.category} (${s.count} APIs)`).join('\n')
    : '(no APIs currently registered)';

  return {
    type: 'function',
    function: {
      name: 'select_api_category',
      description: `If the question might be answered by a registered structured API, pick the ONE category most likely to contain it - you'll then be shown the specific APIs in that category to choose from. Categories:\n${index}`,
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Exact category name from the list above.' }
        },
        required: ['category']
      }
    }
  };
}

// Second-step tool, only built and offered (see routes/chat.js) after
// select_api_category has narrowed things down to one category - same
// shape as the old flat buildApiRegistryTool(), still named
// call_external_api and dispatched the same way, just scoped to a handful
// of APIs instead of the whole registry.
async function buildApiToolForCategory(category) {
  const apis = await getApisInCategory(category);
  const index = apis.length ? apis.map((a) => `- ${a.name}: ${a.description}`).join('\n') : '(no APIs currently registered)';

  return {
    type: 'function',
    function: {
      name: 'call_external_api',
      description: `Prefer this over fetch_page or browse_web whenever one of these structured APIs covers the question - faster, more reliable, no scraping risk. Call one by exact name, with whatever params it needs as a JSON object:\n${index}`,
      parameters: {
        type: 'object',
        properties: {
          api_name: { type: 'string', description: 'Exact name of the API to call, from the list above.' },
          params: { type: 'object', description: 'Params the chosen API needs.' }
        },
        required: ['api_name', 'params']
      }
    }
  };
}

// A pending entry is only safe to approve with no human review when it
// needs no auth setup (nothing to configure) and has no {param} path
// placeholder (nothing that would 404/error with params left empty) -
// anything else needs a human to supply real values first.
function isBulkApproveEligible(entry) {
  const hasPathParam = /\{[^}]+\}/.test(entry.path || '');
  return entry.authType === 'none' && !hasPathParam;
}

// Approves every pending entry that qualifies in one pass, leaving
// anything needing auth setup or a path param untouched in the queue.
async function bulkApproveEligible() {
  const pending = await ApiRegistry.find({ status: 'pending' });

  const approvedNames = [];
  let skippedCount = 0;

  for (const entry of pending) {
    if (!isBulkApproveEligible(entry)) {
      skippedCount++;
      continue;
    }

    // The only param guidance that survives with params left empty - fold
    // a short version into description so the tool index the model sees
    // still carries it, even though there's nothing in the structured
    // params array to tell the model what to pass.
    const paramsMatch = entry.importNotes?.match(/^Params: (.+)$/m);
    if (paramsMatch) {
      entry.description = `${entry.description} (${paramsMatch[1]})`;
    }

    entry.status = 'approved';
    await entry.save();
    approvedNames.push(entry.name);
  }

  return { approvedCount: approvedNames.length, approvedNames, skippedCount };
}

module.exports = {
  getEnabledApis,
  getCategorySummary,
  getApisInCategory,
  callRegisteredApi,
  buildCategorySelectorTool,
  buildApiToolForCategory,
  isBulkApproveEligible,
  bulkApproveEligible
};
