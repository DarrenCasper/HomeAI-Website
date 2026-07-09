const mongoose = require('mongoose');
const { Schema } = mongoose;

const visionJobSchema = new Schema({
  userId: { type: String, required: true, index: true },
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  status: { type: String, enum: ['queued', 'running', 'done', 'error'], default: 'queued', index: true },
  description: { type: String, default: null },
  error: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

visionJobSchema.pre('save', function bumpUpdatedAt(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('VisionJob', visionJobSchema);
