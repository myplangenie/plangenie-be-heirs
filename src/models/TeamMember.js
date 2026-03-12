const mongoose = require('mongoose');

const TeamMemberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    mid: { type: String, required: true, index: true },
    name: String,
    email: String,
    role: { type: String, enum: ['Admin', 'Editor', 'Viewer'], default: 'Viewer' },
    // Human job title (mirrors OrgPosition.position)
    position: { type: String, default: '' },
    department: String,
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);

TeamMemberSchema.index({ user: 1, workspace: 1, email: 1 });
TeamMemberSchema.index({ user: 1, workspace: 1, mid: 1 }, { unique: true });

module.exports = mongoose.model('TeamMember', TeamMemberSchema);
