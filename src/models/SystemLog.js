const mongoose = require('mongoose');

const SystemLogSchema = new mongoose.Schema(
  {
    time: { type: Date, default: Date.now, index: true },
    event: { type: String, required: true },
    severity: { type: String, enum: ['info','warning','error'], default: 'info', index: true },
    details: { type: String, default: '' },
    meta: { type: Object },
  },
  { timestamps: true }
);

SystemLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SystemLog', SystemLogSchema);

