const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const auth = require('./middleware/auth');
const authRouter = require('./routes/auth');
const whoamiRouter = require('./routes/whoami');
const historyRouter = require('./routes/history');
const chatRouter = require('./routes/chat');
const projectsRouter = require('./routes/projects');
const visionRouter = require('./routes/vision');
const usageRouter = require('./routes/usage');
const documentsRouter = require('./routes/documents');
const voiceRouter = require('./routes/voice');
const adminApisRouter = require('./routes/adminApis');

const app = express();

// The frontend is a static build served from its own origin (nginx, no
// reverse proxy in front) that calls this API cross-origin, so it needs an
// explicit allowlist. Comma-separated in CORS_ORIGIN; defaults to the known
// production frontend plus local Vite dev ports. credentials: true is
// required for the session cookie (see lib/session.js) to be sent/accepted
// cross-origin - the origin allowlist below is what makes that safe.
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
    },
    credentials: true
  })
);

app.use(cookieParser());
app.use(express.json({ limit: '10mb' })); // was '1mb' - screen captures need headroom

// Liveness check ahead of auth so it works even without a Tailscale identity.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Ahead of the global auth gate below - you can't be logged in before you
// log in, and /me does its own cookie check and 401s on its own.
app.use('/api/auth', authRouter);

// Also ahead of the auth gate: UsageLog isn't user-scoped (whole-app OpenAI
// cost tracking, not per-user billing), and POST /api/usage/log is called
// server-to-server by the browsing-agent service, which has no Tailscale
// identity of its own - see routes/usage.js.
app.use('/api/usage', usageRouter);

app.use(auth);

app.use('/api/whoami', whoamiRouter);
app.use('/api/history', historyRouter);
app.use('/api/chat', chatRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/vision', visionRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/voice', voiceRouter);
app.use('/api/admin/apis', adminApisRouter);

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
