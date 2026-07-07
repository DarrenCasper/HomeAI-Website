const { upsertUser, findSessionUser } = require('../db/postgres');
const { SESSION_COOKIE, hashToken } = require('../lib/session');

// Tailscale serve injects Tailscale-User-Login identifying the caller when
// this app is reached through that proxy - trust the header as the
// authenticated identity in that case.
function extractHeaderUser(req) {
  const raw = req.headers['tailscale-user-login'];
  if (Array.isArray(raw)) return raw[0]?.trim() || null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

async function auth(req, res, next) {
  // 1. Tailscale header - strongest signal, always fresh, no DB round trip.
  const tailscaleUser = extractHeaderUser(req);
  if (tailscaleUser) {
    req.userId = tailscaleUser;
    // Being a valid identity that reached this app IS the signup. Best-effort:
    // a Postgres hiccup shouldn't take down chat/history, which only need Mongo.
    try {
      await upsertUser(tailscaleUser);
    } catch (err) {
      console.error('[auth] postgres upsert failed, continuing without it:', err.message);
    }
    return next();
  }

  // 2. Session cookie from email/password login (see routes/auth.js).
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    try {
      const user = await findSessionUser(hashToken(token));
      if (user) {
        req.userId = user.id;
        return next();
      }
    } catch (err) {
      console.error('[auth] session lookup failed, falling through:', err.message);
    }
  }

  // 3. Local dev convenience only - never set in production.
  if (process.env.DEV_FALLBACK_USER) {
    req.userId = process.env.DEV_FALLBACK_USER;
    return next();
  }

  return res.status(401).json({ error: 'Unauthorized' });
}

module.exports = auth;
