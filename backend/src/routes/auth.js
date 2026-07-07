const router = require('express').Router();
const bcrypt = require('bcryptjs');
const {
  createUser,
  findUserByEmail,
  createSession,
  findSessionUser,
  deleteSession
} = require('../db/postgres');
const { SESSION_COOKIE, SESSION_TTL_MS, generateToken, hashToken, cookieOptions } = require('../lib/session');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 10;

function toSafeUser(user) {
  return { id: user.id, name: user.display_name, email: user.id };
}

async function issueSession(res, userId) {
  const token = generateToken();
  await createSession({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS)
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body || {};

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'A valid email is required' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const existing = await findUserByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await createUser({ email: normalizedEmail, name: name.trim(), passwordHash });

    await issueSession(res, user.id);
    console.log(`[auth] registered new account: ${normalizedEmail}`);
    res.json({ user: toSafeUser(user) });
  } catch (err) {
    // Race with another concurrent registration slipping past the findUserByEmail check.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with that email already exists' });
    }
    console.error('[auth] register failed:', err.message);
    res.status(503).json({ error: 'Account store unavailable' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  let user;
  try {
    user = await findUserByEmail(normalizedEmail);
  } catch (err) {
    console.error('[auth] login lookup failed:', err.message);
    return res.status(503).json({ error: 'Account store unavailable' });
  }

  // Same generic message whether the email is unknown or the account has no
  // password set (e.g. a Tailscale-only identity) - don't leak which.
  if (!user || !user.password_hash) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  try {
    await issueSession(res, user.id);
  } catch (err) {
    console.error('[auth] issuing session failed:', err.message);
    return res.status(503).json({ error: 'Account store unavailable' });
  }

  res.json({ user: toSafeUser(user) });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    try {
      await deleteSession(hashToken(token));
    } catch (err) {
      console.error('[auth] logout session delete failed:', err.message);
    }
  }
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
  res.json({});
});

router.get('/me', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  try {
    const user = await findSessionUser(hashToken(token));
    if (!user) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    res.json({ user: toSafeUser(user) });
  } catch (err) {
    console.error('[auth] session lookup failed:', err.message);
    res.status(503).json({ error: 'Account store unavailable' });
  }
});

module.exports = router;
