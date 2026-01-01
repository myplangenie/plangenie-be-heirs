const mongoose = require('mongoose');

const ActionItemSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    owner: { type: String },
    dueWhen: { type: String },
    status: { type: String, enum: ['Not started','In progress','Completed'], default: 'Not started' },
  },
  { _id: false }
);

const ReviewSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    rid: { type: String, required: true, unique: true },
    cadence: { type: String, enum: ['weekly','monthly','quarterly'], default: 'weekly', index: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    status: { type: String, enum: ['open','closed'], default: 'open', index: true },
    notes: { type: String, default: '' },
    attendees: [{ type: String }],
    actionItems: [ActionItemSchema],
    decisions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Decision' }],
  },
  { timestamps: true }
);

ReviewSessionSchema.index({ user: 1, workspace: 1, startedAt: -1 });

module.exports = mongoose.model('ReviewSession', ReviewSessionSchema);

