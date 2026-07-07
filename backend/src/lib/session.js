const crypto = require('crypto');

const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The raw token goes in the cookie; only its hash is ever stored in Postgres,
// so a database leak alone can't be used to forge a valid session.
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS
  };
}

module.exports = { SESSION_COOKIE, SESSION_TTL_MS, generateToken, hashToken, cookieOptions };
