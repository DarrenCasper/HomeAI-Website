const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectSchema = new Schema({
  userId: { type: String, required: true, index: true }, // matches postgres users.id
  name: { type: String, required: true, trim: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

projectSchema.index({ userId: 1, updatedAt: -1 });

projectSchema.pre('save', function bumpUpdatedAt(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Project', projectSchema);
