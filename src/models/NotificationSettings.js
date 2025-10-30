const mongoose = require('mongoose');

const NotificationSettingsSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    frequency: { type: String, default: 'Real-time' },
    tone: { type: String, default: 'Professional' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NotificationSettings', NotificationSettingsSchema);

