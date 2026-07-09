const mongoose = require('mongoose');
const { Schema } = mongoose;

const messageSchema = new Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  model: { type: String, default: null }, // which Ollama model answered; null for user turns
  thinking: { type: String, default: null }, // reasoning trace, deepseek-r1 only - see utils/modelMode.js supportsThinking
  createdAt: { type: Date, default: Date.now }
});

const conversationSchema = new Schema({
  userId: { type: String, required: true, index: true }, // matches postgres users.id
  projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
  title: String,
  messages: [messageSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

conversationSchema.index({ userId: 1, updatedAt: -1 });

conversationSchema.pre('save', function bumpUpdatedAt(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Conversation', conversationSchema);
