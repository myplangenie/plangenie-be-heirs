const mongoose = require('mongoose');

/**
 * AgentActionLog - Records every mutation the AI agent performs.
 * Enables audit trail and future undo functionality.
 */
const AgentActionLogSchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  toolName: { type: String, required: true },  // e.g. 'create_core_project'
  args: { type: mongoose.Schema.Types.Mixed },  // what the AI passed in
  result: { type: mongoose.Schema.Types.Mixed }, // what came back
  success: { type: Boolean, default: true },
  agentType: { type: String, default: null },   // which agent panel triggered this
}, { timestamps: true });

AgentActionLogSchema.index({ workspace: 1, createdAt: -1 });
AgentActionLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('AgentActionLog', AgentActionLogSchema);
