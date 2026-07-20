const mongoose = require('mongoose');
const { Schema } = mongoose;

const apiSecretSchema = new Schema({
  envVarName: { type: String, required: true, unique: true },
  value: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ApiSecret', apiSecretSchema);
