const mongoose = require('mongoose');

  const CollaborationSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    viewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    invitedAt: { type: Date, default: Date.now },
    acceptedAt: { type: Date, default: null },
    acceptToken: { type: String, default: null, index: true },
    tokenExpires: { type: Date, default: null },
  },
  { timestamps: true }
);

CollaborationSchema.index({ owner: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('Collaboration', CollaborationSchema);
