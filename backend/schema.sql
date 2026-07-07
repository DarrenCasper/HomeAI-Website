CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,           -- tailscale-user-login string, or email for password accounts
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now()
);

-- Re-running this file against a database from before password auth existed
-- must be safe, so this is a separate statement rather than an inline column
-- on the CREATE TABLE above (which no-ops once the table already exists).
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT; -- NULL for Tailscale-only identities

-- Opaque bearer sessions for email/password logins (Tailscale identities
-- don't need a row here - the header itself is the credential on every
-- request). token_hash is SHA-256 of the random token in the session
-- cookie, so a DB leak alone doesn't hand out valid sessions.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
