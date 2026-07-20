// One-off: reset every entry auto-disabled by the health check before Fix 1
// (backend/src/lib/apiHealthCheck.js) landed - an unauthenticated GET
// against a bare base URL was scoring a real failure for entries that
// actually need auth or are POST-only, which proves nothing about whether
// the service is actually alive. These were disabled for the wrong reason,
// not because the API is really broken. Safe to re-run - only touches
// entries with disabledReason: 'health_check' at run time.
//   node scripts/resetHealthCheckDisabled.js
require('dotenv').config();
const mongoose = require('mongoose');
const ApiRegistry = require('../src/models/ApiRegistry');

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('[reset-health-check] MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('[reset-health-check] connected to Mongo');

  const affected = await ApiRegistry.find({ disabledReason: 'health_check' }, 'name').lean();

  const result = await ApiRegistry.updateMany(
    { disabledReason: 'health_check' },
    { $set: { enabled: true, disabledReason: null, consecutiveFailures: 0, lastCheckOk: null } }
  );

  affected.forEach((doc) => console.log(`[reset-health-check] re-enabled "${doc.name}"`));
  console.log(`[reset-health-check] done - ${result.modifiedCount} entries reset`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[reset-health-check] failed:', err);
  process.exit(1);
});
