CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,           -- the tailscale-user-login string
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now()
);
