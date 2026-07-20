const mongoose = require('mongoose');
const { Schema } = mongoose;

const apiParamSchema = new Schema(
  {
    name: { type: String, required: true },
    in: { type: String, enum: ['query', 'path', 'body'], required: true },
    required: { type: Boolean, default: false },
    description: String
  },
  { _id: false }
);

const apiRegistrySchema = new Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, required: true },
  baseUrl: { type: String, required: true },
  path: { type: String, required: true }, // supports {param} path placeholders
  method: { type: String, enum: ['GET', 'POST'], default: 'GET' },
  params: [apiParamSchema],
  authType: { type: String, enum: ['none', 'header', 'query', 'bearer'], default: 'none' },
  authEnvVar: String,
  authKeyName: String,
  enabled: { type: Boolean, default: true },
  status: { type: String, enum: ['approved', 'pending', 'rejected'], default: 'approved' },
  proposedBy: { type: String, enum: ['user', 'ai', 'import'], default: 'user' },
  createdAt: { type: Date, default: Date.now },

  // Free-text reference for whoever reviews a proposedBy: 'import' entry -
  // the spreadsheet's Key Params / Auth Notes / Free Tier / Reliability
  // Notes columns, carried forward so they don't have to re-look-up rate
  // limits or param names from scratch. Not shown/used anywhere else.
  importNotes: { type: String, default: null },
  // From the spreadsheet's Category column - lets the registry panel filter
  // a 200+ entry list instead of one long alphabetical scroll.
  category: { type: String, default: null },

  // Real test params for the scheduled health check (lib/apiHealthCheck.js)
  // to call this API with, e.g. { q: "Naruto" } for jikan_anime_search. When
  // set, the health check makes a real call via callRegisteredApi instead of
  // just pinging baseUrl - that's what catches a deprecated/changed endpoint,
  // not just a dead domain, since a deprecated API often still responds,
  // just with an error or a different shape.
  healthCheckParams: { type: Object, default: null },
  // Opt out for quota-tight APIs (e.g. Alpha Vantage's ~25/day free tier)
  // where a daily real-call check isn't worth spending quota on.
  skipHealthCheck: { type: Boolean, default: false },
  lastCheckedAt: { type: Date, default: null },
  lastCheckOk: { type: Boolean, default: null },
  consecutiveFailures: { type: Number, default: 0 },
  // 'health_check' vs 'manual' lets the UI (and the re-enable toggle) tell
  // an automatic disable - something actually broke - apart from a
  // deliberate human one, which need different responses.
  disabledReason: { type: String, enum: [null, 'manual', 'health_check'], default: null },

  // Minimum gap enforced between calls to this API (see lib/apiRegistry.js's
  // waitForRateLimit) - 350ms default is a conservative general-purpose
  // pace; entries with a known strict published limit (Nominatim,
  // MusicBrainz, CourtListener, ...) get a stricter override, see
  // scripts/setRateLimitOverrides.js.
  minIntervalMs: { type: Number, default: 350 }
});

module.exports = mongoose.model('ApiRegistry', apiRegistrySchema);
