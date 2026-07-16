const ApiRegistry = require('../models/ApiRegistry');
const { callRegisteredApi } = require('./apiRegistry');

const BASE_URL_CHECK_TIMEOUT_MS = 5000;
const FAILURE_THRESHOLD = 3;

// Weak fallback for entries nobody's given healthCheckParams to yet: only
// confirms the domain answers at all, not that this specific endpoint still
// works. Zero cost though, so it's a reasonable default for the rest.
async function checkBaseUrlReachable(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BASE_URL_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl, { signal: controller.signal });
    if (!res.ok) throw new Error(`base URL responded ${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function checkOne(entry) {
  if (entry.healthCheckParams) {
    // A real functional call - exercises the actual current schema/response
    // shape, not just "did something respond." This is what catches a
    // deprecated endpoint that still 200s but with a different shape.
    await callRegisteredApi(entry.name, entry.healthCheckParams);
  } else {
    await checkBaseUrlReachable(entry.baseUrl);
  }
}

// Checks every approved, non-opted-out registry entry - including ones
// already disabled by a previous health check, so a recovered API gets
// noticed and re-enabled automatically. Each entry's check (and the write
// of its result) is isolated in its own try/catch so one API throwing
// unexpectedly can't stop the rest of the batch from running.
async function runHealthChecks() {
  const entries = await ApiRegistry.find({ status: 'approved', skipHealthCheck: { $ne: true } });

  let checked = 0;
  let failing = 0;
  let newlyDisabled = 0;
  let reEnabled = 0;

  for (const entry of entries) {
    checked++;
    try {
      await checkOne(entry);

      entry.lastCheckedAt = new Date();
      entry.lastCheckOk = true;
      entry.consecutiveFailures = 0;
      if (entry.disabledReason === 'health_check') {
        entry.enabled = true;
        entry.disabledReason = null;
        reEnabled++;
        console.log(`[apiHealthCheck] "${entry.name}" recovered - re-enabled`);
      }
      await entry.save();
    } catch (err) {
      failing++;
      try {
        entry.lastCheckedAt = new Date();
        entry.lastCheckOk = false;
        entry.consecutiveFailures = (entry.consecutiveFailures || 0) + 1;

        if (entry.consecutiveFailures >= FAILURE_THRESHOLD && entry.enabled) {
          entry.enabled = false;
          entry.disabledReason = 'health_check';
          newlyDisabled++;
          console.warn(
            `[apiHealthCheck] "${entry.name}" auto-disabled after ${entry.consecutiveFailures} consecutive failures: ${err.message}`
          );
        }
        await entry.save();
      } catch (saveErr) {
        console.error(`[apiHealthCheck] could not record failure for "${entry.name}":`, saveErr.message);
      }
    }
  }

  console.log(
    `[apiHealthCheck] checked ${checked}, failing ${failing}, newly disabled ${newlyDisabled}, re-enabled ${reEnabled}`
  );
}

module.exports = { runHealthChecks };
