const { upsertUser } = require('../db/postgres');

// Tailscale serve injects Tailscale-User-Login identifying the caller. This
// app only ever listens on 127.0.0.1, so the only way to reach it is through
// that proxy - trust the header as the authenticated identity.
function extractHeaderUser(req) {
  const raw = req.headers['tailscale-user-login'];
  if (Array.isArray(raw)) return raw[0]?.trim() || null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

async function auth(req, res, next) {
  const userId = extractHeaderUser(req) || process.env.DEV_FALLBACK_USER || null;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: no Tailscale identity present' });
  }

  req.userId = userId;

  // Being a valid identity that reached this app IS the signup. Best-effort:
  // a Postgres hiccup shouldn't take down chat/history, which only need Mongo.
  try {
    await upsertUser(userId);
  } catch (err) {
    console.error('[auth] postgres upsert failed, continuing without it:', err.message);
  }

  next();
}

module.exports = auth;
