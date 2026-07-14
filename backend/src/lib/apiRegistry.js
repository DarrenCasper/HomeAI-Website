const ApiRegistry = require('../models/ApiRegistry');

// Same cap as browsing-agent's /fetch (MAX_CHARS) - keeps a runaway/huge
// API response from blowing up the prompt sent to Ollama afterward.
const MAX_RESPONSE_CHARS = 8000;

// Projected to just what the tool description needs - approved+enabled
// only, so a pending/rejected/disabled entry is invisible to the model
// entirely, not just soft-blocked at call time.
async function getEnabledApis() {
  return ApiRegistry.find({ enabled: true, status: 'approved' }, 'name description').lean();
}

function buildUrl(api, params) {
  const pathParamDefs = api.params.filter((p) => p.in === 'path');
  const queryParamDefs = api.params.filter((p) => p.in === 'query');

  for (const def of pathParamDefs.concat(queryParamDefs)) {
    const value = params[def.name];
    if (def.required && (value === undefined || value === null || value === '')) {
      throw new Error(`Missing required param "${def.name}" for API "${api.name}"`);
    }
  }

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
  const url = buildUrl(api, safeParams);
  const headers = {};
  applyAuth(api, url, headers);

  let response;
  try {
    response = await fetch(url.toString(), { method: api.method || 'GET', headers });
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

// Rebuilt per-request (see routes/chat.js's resolveTools) rather than
// cached at startup - the registry can grow (manual additions, approved
// AI proposals) without a redeploy, and this is the only thing that needs
// to reflect that immediately.
async function buildApiRegistryTool() {
  const apis = await getEnabledApis();
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

module.exports = { getEnabledApis, callRegisteredApi, buildApiRegistryTool };
