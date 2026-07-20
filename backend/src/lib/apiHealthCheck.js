const ApiRegistry = require('../models/ApiRegistry');
const { callRegisteredApi } = require('./apiRegistry');

const BASE_URL_CHECK_TIMEOUT_MS = 5000;
const FAILURE_THRESHOLD = 3;
// The scheduler runs on every backend startup as well as every 24h - a day
// of frequent redeploys could otherwise run this several times in a few
// hours, inflating consecutiveFailures far faster than the "N consecutive
// DAILY failures" model intended.
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Identifies this app rather than mimicking a real browser - a generic
// browser-style spoof is explicitly what Nominatim's usage policy calls
// out as NOT acceptable ("stock User-Agents as set by http libraries will
// not do" - they want the actual calling application identified), and
// SEC EDGAR/MusicBrainz's own published policies want the same. What all
// three actually require is a UA string that identifies the app, not one
// that pretends to be Chrome/Safari.
const HEALTH_CHECK_USER_AGENT = 'HomelabAI/1.0 (+https://homeai.darrencasper.com)';

// Weak fallback for entries nobody's given healthCheckParams to yet: only
// confirms the domain answers at all, not that this specific endpoint still
// works. Zero cost though, so it's a reasonable default for the rest.
async function checkBaseUrlReachable(baseUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BASE_URL_CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(baseUrl, { signal: controller.signal, headers: { 'User-Agent': HEALTH_CHECK_USER_AGENT } });
    if (!res.ok) throw new Error(`base URL responded ${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

// An unauthenticated GET against the bare base URL proves nothing for an
// entry that actually needs auth (it'll 401/403 regardless of whether the
// service itself is fine) or one that's POST-only (it may not even accept
// a GET) - without real healthCheckParams to make an authoritative call
// with, there's no meaningful pass/fail signal to produce here at all.
function isInconclusiveWithoutParams(entry) {
  if (entry.healthCheckParams) return false;
  return entry.authType !== 'none' || entry.method === 'POST';
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
  let skippedRecent = 0;
  let inconclusive = 0;
  let failing = 0;
  let newlyDisabled = 0;
  let reEnabled = 0;

  const now = Date.now();

  for (const entry of entries) {
    if (entry.lastCheckedAt && now - entry.lastCheckedAt.getTime() < RECHECK_INTERVAL_MS) {
      skippedRecent++;
      continue;
    }

    checked++;

    if (isInconclusiveWithoutParams(entry)) {
      inconclusive++;
      try {
        entry.lastCheckedAt = new Date();
        entry.lastCheckOk = null;
        // consecutiveFailures/enabled deliberately untouched - an
        // inconclusive result isn't evidence of anything, so it shouldn't
        // move an entry toward (or away from) auto-disable either.
        await entry.save();
      } catch (err) {
        console.error(`[apiHealthCheck] could not record inconclusive check for "${entry.name}":`, err.message);
      }
      continue;
    }

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
    `[apiHealthCheck] checked ${checked} (${skippedRecent} skipped - checked within ${RECHECK_INTERVAL_MS / 3600000}h), ` +
      `${inconclusive} inconclusive, failing ${failing}, newly disabled ${newlyDisabled}, re-enabled ${reEnabled}`
  );
}

module.exports = { runHealthChecks };
