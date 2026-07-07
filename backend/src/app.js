const express = require('express');
const auth = require('./middleware/auth');
const whoamiRouter = require('./routes/whoami');
const historyRouter = require('./routes/history');
const chatRouter = require('./routes/chat');

const app = express();

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
