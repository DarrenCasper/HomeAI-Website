// One-off override of minIntervalMs for registry entries with a known
// strict published rate limit - everything else stays at the schema's
// 350ms default. Upsert-safe to re-run (only touches entries that already
// exist; a name not yet registered is skipped and reported, not created).
//   node scripts/setRateLimitOverrides.js
require('dotenv').config();
const mongoose = require('mongoose');
const ApiRegistry = require('../src/models/ApiRegistry');

const OVERRIDES = [
  // Nominatim's usage policy caps free use at 1 req/sec - padded slightly.
  { name: 'nominatim_osm_geocoding', minIntervalMs: 1100 },
  // MusicBrainz's API docs specify 1 req/sec for unauthenticated use.
  { name: 'musicbrainz_search_artist', minIntervalMs: 1100 },
  { name: 'musicbrainz_search_release', minIntervalMs: 1100 },
  // CourtListener's free tier is 5 requests/minute - 12s minimum, padded to 15s.
  { name: 'courtlistener_free_law_project_case_law_search', minIntervalMs: 15000 },
  { name: 'courtlistener_free_law_project_citation_lookup', minIntervalMs: 15000 }
];

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('[rate-limits] MONGODB_URI is not set');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('[rate-limits] connected to Mongo');

  let updated = 0;
  let missing = 0;

  for (const { name, minIntervalMs } of OVERRIDES) {
    const result = await ApiRegistry.updateOne({ name }, { $set: { minIntervalMs } });
    if (result.matchedCount === 0) {
      console.warn(`[rate-limits] "${name}" not found in the registry - skipped`);
      missing++;
    } else {
      console.log(`[rate-limits] "${name}" -> minIntervalMs: ${minIntervalMs}`);
      updated++;
    }
  }

  console.log(`[rate-limits] done - ${updated} updated, ${missing} not found`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[rate-limits] failed:', err);
  process.exit(1);
});
