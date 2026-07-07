require('dotenv').config();

const app = require('./app');
const { connectMongo } = require('./db/mongo');
const { pingPostgres } = require('./db/postgres');

const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1'; // only reachable via `tailscale serve`

async function start() {
  // Mongo connects/reconnects in the background; don't block startup on it.
  connectMongo();

  try {
    await pingPostgres();
    console.log('[postgres] connected');
  } catch (err) {
    console.warn('[postgres] not reachable at startup, will retry on each request:', err.message);
  }

  app.listen(PORT, HOST, () => {
    console.log(`Homelab AI backend listening on http://${HOST}:${PORT}`);
  });
}

start();
