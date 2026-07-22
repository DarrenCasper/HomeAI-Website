const ApiRegistry = require('../models/ApiRegistry');
const { getSecretValue } = require('./apiSecrets');

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

// Best-effort structured-params extraction from a spreadsheet-style Key
// Params cell, e.g. "movie_id (path, required)" ->
// [{name:'movie_id', in:'path', required:true, ...}]. Shared by
// scripts/seedApiRegistryFromExcel.js (import time) and
// bulkApproveEligible() below (approval time, against the same text
// carried forward in importNotes) - one implementation, not two copies
// that could drift. Deliberately conservative: any text that doesn't
// cleanly match a "name(s) (location[, required/optional])[ - description]"
// shape returns [] rather than guessing - false negatives (still needing a
// human to fill params in by hand) are far cheaper than false positives (a
// wrong param silently registered as if it were verified).
//
// Note on the trailing-description split: this looks for " - " AFTER the
// closing paren of the location qualifier specifically, not just the first
// " - " anywhere in the string - some cells put a dash INSIDE the
// parenthetical itself (e.g. "(path - winter/spring/summer/fall)"), and a
// naive whole-string split on the first " - " would cut the qualifier in
// half and make the paren-match fail entirely.
function parseParamsFromText(text) {
  if (!text || /^\(none\)$/i.test(text.trim())) return [];

  const parenMatch = text.match(/^(.*?)\(([^)]*)\)(.*)$/);
  if (!parenMatch) return []; // no recognizable (location) segment - don't guess, leave empty

  const namesPart = parenMatch[1].trim();
  const parenContent = parenMatch[2].toLowerCase();
  const trailingDesc = parenMatch[3].replace(/^\s*-\s*/, '').trim() || null;

  const names = namesPart.split(',').map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) return [];

  let paramIn = null;
  if (parenContent.includes('path')) paramIn = 'path';
  else if (parenContent.includes('query')) paramIn = 'query';
  else if (parenContent.includes('body')) paramIn = 'body';
  if (!paramIn) return []; // no recognizable location keyword - don't guess, leave empty for human review

  const required = parenContent.includes('required')
    ? true
    : parenContent.includes('optional')
      ? false
      : names.length === 1; // single named param with no explicit keyword - lean toward required, since most single-param entries in this catalog are the primary required input

  return names.map((name) => ({
    name,
    in: paramIn,
    required,
    description: names.length === 1 && trailingDesc ? trailingDesc : 'Imported from spreadsheet - verify this description'
  }));
}

// Projected to just what the tool description needs - approved+enabled
// only, so a pending/rejected/disabled entry is invisible to the model
// entirely, not just soft-blocked at call time.
async function getEnabledApis() {
  return ApiRegistry.find({ enabled: true, status: 'approved' }, 'name description').lean();
}

function buildUrl(api, params, queryParamDefs, pathParamDefs) {
  let path = api.path;
  // Names already consumed by path substitution (defined or fallback) -
  // the query-param fallback below excludes these, otherwise the same
  // value ends up both substituted into the path AND re-sent as a query
  // param with the same name (e.g. /anime/5114?id=5114), since an empty
  // pathParamDefs and empty queryParamDefs commonly go together on the
  // same unstructured entry.
  const usedInPath = new Set();

  if (pathParamDefs.length === 0 && /\{[^}]+\}/.test(path)) {
    // Same "trust the AI's own param name, since bulk-approve was already
    // a deliberate human action and there's no stricter schema to check
    // against" reasoning as the query-param fallback below - bulk-approve
    // no longer excludes entries with a {placeholder} path (see
    // isBulkApproveEligible), so this is what keeps such a call from
    // sending literal curly braces instead of a real value.
    const placeholderNames = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    const matchedNames = [];
    for (const name of placeholderNames) {
      if (params[name] !== undefined && params[name] !== null) {
        path = path.replace(`{${name}}`, encodeURIComponent(params[name]));
        matchedNames.push(name);
        usedInPath.add(name);
      }
      // No matching key - leave the literal {name} in place rather than
      // silently dropping it, so a missing value produces a visibly
      // broken URL (and shows up in the logs below) instead of vanishing
      // quietly into a request that looks fine but hits the wrong resource.
    }
    if (matchedNames.length) {
      console.log(
        `[apiRegistry] "${api.name}" has no defined path params - substituting AI-provided values as-is: ${matchedNames.join(', ')}`
      );
    }
  } else {
    for (const def of pathParamDefs) {
      if (params[def.name] !== undefined && params[def.name] !== null) {
        path = path.replace(`{${def.name}}`, encodeURIComponent(params[def.name]));
        usedInPath.add(def.name);
      }
    }
  }

  const base = api.baseUrl.replace(/\/+$/, '');
  const url = new URL(base + (path.startsWith('/') ? path : `/${path}`));

  if (queryParamDefs.length === 0) {
    // Bulk-imported entries register with params: [] by design (the
    // spreadsheet's params were free text, not a structured schema a human
    // had translated yet - see scripts/seedApiRegistryFromExcel.js). With
    // no defined query params, the strict per-def loop below would silently
    // drop everything the AI actually sent, making an "approved" entry
    // functionally useless despite calling successfully (no thrown error).
    // This trusts the AI's own param names/values instead of a
    // human-reviewed schema - acceptable specifically because the
    // domain/endpoint itself already went through human approval
    // (bulk-approve was a deliberate action), and a query param is much
    // lower-risk to get wrong than something like auth header injection.
    // Path params get the same pass-through treatment above, for the same
    // reason - bulk-approve no longer excludes {placeholder} paths. Keys
    // already consumed there are excluded here (see usedInPath above) so
    // a path value doesn't also get sent again as a same-named query param.
    const providedKeys = Object.keys(params || {}).filter((key) => !usedInPath.has(key));
    for (const key of providedKeys) {
      const value = params[key];
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, value);
      }
    }
    if (providedKeys.length) {
      console.log(
        `[apiRegistry] "${api.name}" has no defined query params - passing AI-provided params through as-is: ${providedKeys.join(', ')}`
      );
    }
  } else {
    for (const def of queryParamDefs) {
      const value = params[def.name];
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(def.name, value);
      }
    }
  }

  return url;
}

// Async because the key can now live in the database (see lib/apiSecrets.js)
// instead of only ever being a Coolify-set env var - callRegisteredApi()
// below awaits this.
async function applyAuth(api, url, headers) {
  if (api.authType === 'none') return;

  if (!api.authEnvVar) {
    throw new Error(`API "${api.name}" is misconfigured: authType is "${api.authType}" but no authEnvVar is set`);
  }
  const key = await getSecretValue(api.authEnvVar);
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

// A bare Docker container name (e.g. "homelab-jikan"), localhost, or a
// private IP range - traffic to any of these never leaves this app's own
// Docker network, so the "don't send credentials over unencrypted public
// internet" reasoning the https-only rule exists for doesn't apply. A real
// public domain always has at least one dot, so "no dot at all" is a safe
// signal for "this is a container name, not a real hostname."
function isInternalHostname(hostname) {
  if (hostname === 'localhost') return true;
  if (/^[\d.]+$/.test(hostname)) {
    // bare IP - check private ranges (10.x, 172.16-31.x, 192.168.x)
    const parts = hostname.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return false;
  }
  return !hostname.includes('.');
}

// True for a real https:// URL, or plain http:// specifically to an
// internal destination (see isInternalHostname) - shared by every place
// that validates a baseUrl (the admin routes at create/edit time, the
// Excel importer, and callRegisteredApi's own call-time check below) so
// the exception is defined exactly once, not re-derived per call site.
// An unparseable baseUrl is never valid, same as before this existed.
function isSecureOrInternalUrl(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || isInternalHostname(url.hostname);
}

// Looks up a registered API by exact name and calls it. Enforces
// https-only on every call (not just at registration/proposal time) - a
// baseUrl could in principle be edited after the fact, so this is checked
// here too rather than trusted from whenever the row was last saved. Plain
// http is allowed specifically for internal Docker-network destinations -
// see isInternalHostname - everything else still requires real https.
async function callRegisteredApi(apiName, params) {
  const api = await ApiRegistry.findOne({ name: apiName });
  if (!api) throw new Error(`No registered API named "${apiName}"`);
  if (!api.enabled) throw new Error(`API "${apiName}" is disabled`);
  if (api.status !== 'approved') throw new Error(`API "${apiName}" is not approved for use`);
  if (!isSecureOrInternalUrl(api.baseUrl)) {
    throw new Error(`API "${apiName}" has an insecure baseUrl for a public destination - refusing to call it`);
  }

  const safeParams = params && typeof params === 'object' ? params : {};
  const method = api.method || 'GET';
  const pathParamDefs = api.params.filter((p) => p.in === 'path');
  const queryParamDefs = api.params.filter((p) => p.in === 'query');
  const bodyParamDefs = api.params.filter((p) => p.in === 'body');

  // When queryParamDefs is empty (every bulk-imported entry, see buildUrl()
  // below) this loop already has nothing to check on the query side -
  // concat'ing in an empty array is a no-op - so an unstructured entry's
  // required-param check naturally reduces to whatever path/body params
  // it DOES define, rather than blocking the AI's own query params from
  // flowing through via buildUrl()'s fallback. Not a special case to add
  // logic for, just worth this note so a future edit doesn't "fix" it by
  // accident.
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
  await applyAuth(api, url, headers);

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

// A pending entry is safe to approve without a human filling anything in
// first when it either needs no auth at all, or the secret it needs is
// already configured (database or env - see lib/apiSecrets.js's
// getSecretValue) - covers Tavily automatically today, and any future key
// set up the same way, without hardcoding provider names here. Path
// params no longer disqualify an entry - buildUrl()'s path-param
// pass-through fallback (mirroring the existing query-param one) makes an
// undefined path-param schema safe to call through instead of a reason to
// keep something stuck in Pending.
async function isBulkApproveEligible(entry) {
  if (entry.authType === 'none') return true;
  if (!entry.authEnvVar) return false;
  const secretValue = await getSecretValue(entry.authEnvVar);
  return !!secretValue; // eligible if the secret it needs is already configured, regardless of which one
}

// Approves every pending entry that qualifies in one pass, leaving
// anything still needing a secret configured untouched in the queue - see
// isBulkApproveEligible for exactly what qualifies now.
async function bulkApproveEligible() {
  const pending = await ApiRegistry.find({ status: 'pending' });

  const approvedNames = [];
  let skippedCount = 0;
  let paramsExtracted = 0;
  let paramsUnmatched = 0;

  for (const entry of pending) {
    if (!(await isBulkApproveEligible(entry))) {
      skippedCount++;
      continue;
    }

    // The Params: text from importNotes - same block the description
    // enrichment below reads from - run through the shared parser to try
    // to populate real structured params. Never overwrites params that
    // are already there (a manual edit, or a previous extraction run),
    // same rule as the import script's own backfill.
    const paramsMatch = entry.importNotes?.match(/^Params: (.+)$/m);
    if (paramsMatch) {
      // Guidance that survives even when structured extraction below comes
      // up empty - the model's only source of what to pass is this
      // description text (see buildApiToolForCategory), not the params
      // schema itself, so this stays unconditional either way.
      entry.description = `${entry.description} (${paramsMatch[1]})`;

      if (!entry.params?.length) {
        const parsedParams = parseParamsFromText(paramsMatch[1]);
        if (parsedParams.length > 0) {
          entry.params = parsedParams;
          paramsExtracted++;
        } else {
          paramsUnmatched++;
        }
      }
    }

    entry.status = 'approved';
    await entry.save();
    approvedNames.push(entry.name);
  }

  return { approvedCount: approvedNames.length, approvedNames, skippedCount, paramsExtracted, paramsUnmatched };
}

// Re-enables every disabled, approved entry in one category in a single
// action - the recovery counterpart to a whole category going down
// together (a shared upstream outage, a health check catching several
// related entries at once) without clicking each row's toggle individually.
// Same reset as the manual single-entry re-enable in adminApis.js's PATCH
// handler: consecutiveFailures back to 0, disabledReason cleared, so an
// entry that's still actually broken doesn't just get silently re-disabled
// on the very next scheduled health check.
async function bulkEnableCategory(category) {
  const disabled = await ApiRegistry.find({ status: 'approved', category, enabled: false });

  const enabledNames = [];
  for (const entry of disabled) {
    entry.enabled = true;
    entry.consecutiveFailures = 0;
    entry.disabledReason = null;
    await entry.save();
    enabledNames.push(entry.name);
  }

  return { enabledCount: enabledNames.length, enabledNames };
}

module.exports = {
  getEnabledApis,
  getCategorySummary,
  getApisInCategory,
  callRegisteredApi,
  buildCategorySelectorTool,
  buildApiToolForCategory,
  parseParamsFromText,
  isSecureOrInternalUrl,
  isBulkApproveEligible,
  bulkApproveEligible,
  bulkEnableCategory
};
