const mongoose = require('mongoose');
const { Schema } = mongoose;

const chatJobSchema = new Schema({
  userId: { type: String, required: true, index: true },
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  message: { type: String, required: true },
  model: { type: String, required: true },
  status: { type: String, enum: ['queued', 'running', 'done', 'error'], default: 'queued', index: true },
  partial: { type: String, default: '' },
  thinking: { type: String, default: '' }, // reasoning trace for thinking-capable models - see utils/modelMode.js supportsThinking
  answer: { type: String, default: null },
  error: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

chatJobSchema.pre('save', function bumpUpdatedAt(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('ChatJob', chatJobSchema);
