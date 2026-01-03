const mongoose = require('mongoose');

const DepartmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', index: true },
    name: String,
    owner: String,
    dueDate: String,
    progress: Number,
    status: { type: String, enum: ['on-track', 'in-progress', 'at-risk'], default: 'in-progress' },
  },
  { timestamps: true }
);

DepartmentSchema.index({ user: 1, workspace: 1, name: 1 });

module.exports = mongoose.model('Department', DepartmentSchema);

