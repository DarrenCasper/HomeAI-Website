const express = require('express');
const cors = require('cors');
const auth = require('./middleware/auth');
const whoamiRouter = require('./routes/whoami');
const historyRouter = require('./routes/history');
const chatRouter = require('./routes/chat');

const app = express();

// The frontend is a static build served from its own origin (nginx, no
// reverse proxy in front) that calls this API cross-origin, so it needs an
// explicit allowlist. Comma-separated in CORS_ORIGIN; defaults to the known
// production frontend plus local Vite dev ports.
const allowedOrigins = (
  process.env.CORS_ORIGIN || 'https://homeai.darrencasper.com,http://localhost:5173'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header means a same-origin or non-browser request (curl,
      // healthchecks, server-to-server) - always allow those through.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed`));
      }
    }
  })
);

app.use(express.json({ limit: '1mb' }));

// Liveness check ahead of auth so it works even without a Tailscale identity.
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use(auth);

app.use('/api/whoami', whoamiRouter);
app.use('/api/history', historyRouter);
app.use('/api/chat', chatRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Catches malformed JSON bodies from express.json() and anything else that
// calls next(err) upstream.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
