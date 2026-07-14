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
  proposedBy: { type: String, enum: ['user', 'ai'], default: 'user' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ApiRegistry', apiRegistrySchema);
