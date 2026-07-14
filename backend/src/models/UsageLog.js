const mongoose = require('mongoose');
const { Schema } = mongoose;

// The dashboard (routes/usage.js GET /summary) stays whole-app/combined
// across users by design - userId here exists only so lib/usageCap.js can
// enforce each user's own monthly spend limit; it's optional (null for
// entries predating per-user caps, or if a caller doesn't have one) and the
// route stays ungated - see routes/usage.js for why.
const usageLogSchema = new Schema({
  userId: { type: String, default: null, index: true },
  kind: { type: String, enum: ['vision', 'browsing'], required: true, index: true },
  model: { type: String, required: true },
  promptTokens: { type: Number, required: true, default: 0 },
  completionTokens: { type: Number, required: true, default: 0 },
  costUsd: { type: Number, default: null }, // null when the model isn't in lib/pricing.js's table
  createdAt: { type: Date, default: Date.now, index: true }
});

module.exports = mongoose.model('UsageLog', usageLogSchema);
