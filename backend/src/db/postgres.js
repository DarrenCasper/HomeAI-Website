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

module.exports = { pool, pingPostgres, upsertUser };
