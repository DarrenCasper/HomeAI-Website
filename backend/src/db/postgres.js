const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Without this handler, an error on an idle client (e.g. the DB restarting)
// would be an unhandled 'error' event and crash the whole process.
pool.on('error', (err) => {
  console.error('[postgres] unexpected error on idle client:', err.message);
});

async function pingPostgres() {
  await pool.query('SELECT 1');
}

// Upserts the user row and always bumps last_seen_at. display_name is only
// seeded on first insert (from the Tailscale login string) and left alone
// afterwards so future profile edits aren't clobbered.
async function upsertUser(userId) {
  await pool.query(
    `INSERT INTO users (id, display_name, last_seen_at)
     VALUES ($1, $1, now())
     ON CONFLICT (id) DO UPDATE SET last_seen_at = now()`,
    [userId]
  );
}

// Throws with Postgres error code '23505' (unique_violation) if the email is
// already registered - the auth route translates that into a 409.
async function createUser({ email, name, passwordHash }) {
  const result = await pool.query(
    `INSERT INTO users (id, display_name, password_hash, last_seen_at)
     VALUES ($1, $2, $3, now())
     RETURNING id, display_name`,
    [email, name, passwordHash]
  );
  return result.rows[0];
}

async function findUserByEmail(email) {
  const result = await pool.query(
    'SELECT id, display_name, password_hash FROM users WHERE id = $1',
    [email]
  );
  return result.rows[0] || null;
}

async function findUserById(userId) {
  const result = await pool.query(
    'SELECT id, display_name FROM users WHERE id = $1',
    [userId]
  );
  return result.rows[0] || null;
}

async function createSession({ tokenHash, userId, expiresAt }) {
  await pool.query(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [tokenHash, userId, expiresAt]
  );
}

// Joins straight to the owning user so callers get back exactly what auth
// needs (id + display name) in one round trip, and expired sessions never
// match even if a cleanup job hasn't swept them yet.
async function findSessionUser(tokenHash) {
  const result = await pool.query(
    `SELECT u.id, u.display_name
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

async function deleteSession(tokenHash) {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
}

module.exports = {
  pool,
  pingPostgres,
  upsertUser,
  createUser,
  findUserByEmail,
  findUserById,
  createSession,
  findSessionUser,
  deleteSession
};
