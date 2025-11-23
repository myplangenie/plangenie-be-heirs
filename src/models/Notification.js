const mongoose = require('mongoose');

  const NotificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    nid: { type: String, required: true, index: true },
    title: String,
    description: String,
    type: { type: String, enum: ['task', 'collaboration', 'ai'], default: 'task' },
    severity: { type: String, enum: ['danger', 'warning', 'success', 'info'], default: 'info' },
    time: String, // human-friendly string for UI; createdAt is also available
    actions: [
      {
        label: String,
        kind: { type: String, enum: ['primary', 'secondary'], default: 'primary' },
      },
    ],
    data: { type: Object, default: null },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

NotificationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', NotificationSchema);
