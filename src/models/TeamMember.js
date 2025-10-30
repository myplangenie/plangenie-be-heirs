const mongoose = require('mongoose');

const TeamMemberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mid: { type: String, required: true, index: true },
    name: String,
    email: String,
    role: { type: String, enum: ['Admin', 'Editor', 'Viewer'], default: 'Viewer' },
    department: String,
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);

TeamMemberSchema.index({ user: 1, email: 1 });

module.exports = mongoose.model('TeamMember', TeamMemberSchema);

