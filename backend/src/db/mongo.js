const mongoose = require('mongoose');

mongoose.set('strictQuery', true);

let connectAttempted = false;

// Fire-and-forget: mongoose queues operations until connected (and errors
// them out after its own timeout), so callers don't need to await this.
function connectMongo() {
  if (connectAttempted) return;
  connectAttempted = true;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('[mongo] MONGODB_URI not set; conversation features will be unavailable');
    return;
  }

  mongoose.connection.on('connected', () => console.log('[mongo] connected'));
  mongoose.connection.on('error', (err) => console.error('[mongo] connection error:', err.message));
  mongoose.connection.on('disconnected', () => console.warn('[mongo] disconnected'));

  mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 }).catch((err) => {
    console.error('[mongo] initial connection failed, will keep retrying in background:', err.message);
  });
}

module.exports = { connectMongo };
