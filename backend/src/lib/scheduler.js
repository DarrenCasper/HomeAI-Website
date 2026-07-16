const { runHealthChecks } = require('./apiHealthCheck');

const HEALTH_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

function runHealthChecksSafely() {
  runHealthChecks().catch((err) => console.error('[scheduler] health check run failed:', err.message));
}

// Runs once on startup (so a deploy gets an immediate read on registry
// health) and then every 24h. Mongoose queues queries until connectMongo()
// finishes connecting, same as every route handler already relies on, so
// this doesn't need to wait on that itself. Plain setInterval is enough at
// this scale - not worth a cron dependency for one daily job.
function startScheduledJobs() {
  runHealthChecksSafely();
  setInterval(runHealthChecksSafely, HEALTH_CHECK_INTERVAL_MS);
}

module.exports = { startScheduledJobs };
