const router = require('express').Router();
const UsageLog = require('../models/UsageLog');
const { estimateCostUsd } = require('../lib/pricing');

const VALID_KINDS = ['vision', 'browsing'];

// Neither route here requires a Tailscale identity (both are mounted ahead
// of the global auth gate in app.js): POST /log is called server-to-server
// by the browsing-agent service, which has no Tailscale identity of its own
// to send. userId is accepted but optional and unvalidated against the real
// user store - it's only ever used by lib/usageCap.js to total one user's
// monthly spend, never to gate access to this endpoint itself. GET /summary
// stays whole-app/combined across users by design - see UsageLog.js.
router.post('/log', async (req, res) => {
  const { userId, kind, model, promptTokens, completionTokens } = req.body || {};

  if (!VALID_KINDS.includes(kind)) {
    return res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
  }
  if (typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'model is required' });
  }
  if (typeof promptTokens !== 'number' || !Number.isFinite(promptTokens) || promptTokens < 0) {
    return res.status(400).json({ error: 'promptTokens must be a non-negative number' });
  }
  if (typeof completionTokens !== 'number' || !Number.isFinite(completionTokens) || completionTokens < 0) {
    return res.status(400).json({ error: 'completionTokens must be a non-negative number' });
  }

  const trimmedModel = model.trim();

  try {
    await UsageLog.create({
      userId: typeof userId === 'string' && userId.trim() ? userId.trim() : null,
      kind,
      model: trimmedModel,
      promptTokens,
      completionTokens,
      costUsd: estimateCostUsd(trimmedModel, promptTokens, completionTokens)
    });
    res.status(204).end();
  } catch (err) {
    console.error('[usage] log write failed:', err.message);
    res.status(503).json({ error: 'Usage store unavailable' });
  }
});

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function sumCost(match) {
  const [row] = await UsageLog.aggregate([
    { $match: match },
    { $group: { _id: null, costUsd: { $sum: { $ifNull: ['$costUsd', 0] } } } }
  ]);
  return row ? row.costUsd : 0;
}

// One row per (day, kind) with cost summed, days with zero usage filled in
// so the chart doesn't show gaps. All bucketing is UTC throughout - the
// totals above use the same UTC day boundaries, so "today" here always
// matches the last point in `daily`.
async function dailyBreakdown(since) {
  const rows = await UsageLog.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, kind: '$kind' },
        costUsd: { $sum: { $ifNull: ['$costUsd', 0] } }
      }
    }
  ]);

  const byDate = new Map();
  for (const row of rows) {
    const date = row._id.date;
    if (!byDate.has(date)) byDate.set(date, { date, vision: 0, browsing: 0 });
    byDate.get(date)[row._id.kind] = row.costUsd;
  }

  const days = [];
  const cursor = new Date(since);
  const today = startOfUtcDay(new Date());
  while (cursor <= today) {
    const key = cursor.toISOString().slice(0, 10);
    days.push(byDate.get(key) || { date: key, vision: 0, browsing: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days.map((d) => ({ ...d, total: d.vision + d.browsing }));
}

router.get('/summary', async (req, res) => {
  try {
    const now = new Date();
    const startOfToday = startOfUtcDay(now);
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setUTCDate(startOfWeek.getUTCDate() - 6); // trailing 7 days, inclusive of today
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startOfChartWindow = new Date(startOfToday);
    startOfChartWindow.setUTCDate(startOfChartWindow.getUTCDate() - 29); // trailing 30 days, inclusive of today

    const [today, week, month, allTime, daily] = await Promise.all([
      sumCost({ createdAt: { $gte: startOfToday } }),
      sumCost({ createdAt: { $gte: startOfWeek } }),
      sumCost({ createdAt: { $gte: startOfMonth } }),
      sumCost({}),
      dailyBreakdown(startOfChartWindow)
    ]);

    res.json({ totals: { today, week, month, allTime }, daily });
  } catch (err) {
    console.error('[usage] summary failed:', err.message);
    res.status(503).json({ error: 'Usage store unavailable' });
  }
});

module.exports = router;
