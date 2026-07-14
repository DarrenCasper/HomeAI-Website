const UsageLog = require('../models/UsageLog');

// Shared OpenAI budget for this homelab is roughly $5/month; split across
// ~5-6 people actually using vision/browsing, $1/user/month leaves headroom
// for normal use while making it impossible for any single user (or a
// runaway bug) to burn through the whole budget alone. Override via env if
// the real budget or user count changes.
const USER_MONTHLY_CAP_USD = parseFloat(process.env.USER_MONTHLY_CAP_USD || '1.00');

function startOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// Only vision/browsing spend counts against the cap - both are the only
// UsageLog kinds that cost real OpenAI money (see lib/pricing.js).
async function getUserMonthCostUsd(userId) {
  if (!userId) return 0;
  const [row] = await UsageLog.aggregate([
    { $match: { userId, createdAt: { $gte: startOfUtcMonth(new Date()) } } },
    { $group: { _id: null, costUsd: { $sum: { $ifNull: ['$costUsd', 0] } } } }
  ]);
  return row ? row.costUsd : 0;
}

// Fails open: a Mongo hiccup here shouldn't silently block every user's
// vision/browsing calls app-wide - the cap is a cost-control guard against
// runaway spend, not a hard security boundary, matching this codebase's
// existing "never hard-fail on an infra blip" pattern (vision falling back
// to the local model, chat answering without web results, etc).
async function isOverCap(userId) {
  try {
    const spent = await getUserMonthCostUsd(userId);
    return spent >= USER_MONTHLY_CAP_USD;
  } catch (err) {
    console.error('[usageCap] cap check failed, failing open:', err.message);
    return false;
  }
}

module.exports = { USER_MONTHLY_CAP_USD, getUserMonthCostUsd, isOverCap };
