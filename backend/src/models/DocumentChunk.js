const mongoose = require('mongoose');
const { Schema } = mongoose;

const documentChunkSchema = new Schema({
  userId: { type: String, required: true, index: true },
  sourceFileName: { type: String, required: true },
  chunkText: { type: String, required: true },
  embedding: { type: [Number], required: true },
  createdAt: { type: Date, default: Date.now }
});

// Every query here is either "all of this user's chunks" (search) or "this
// user's chunks for one file" (list/delete) - a compound index covers both.
documentChunkSchema.index({ userId: 1, sourceFileName: 1 });

module.exports = mongoose.model('DocumentChunk', documentChunkSchema);
