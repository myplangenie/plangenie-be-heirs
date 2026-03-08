const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  ts: { type: Date, default: Date.now },
  agentType: { type: String, default: null },
}, { _id: false });

const ChatHistorySchema = new mongoose.Schema({
  workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  messages: { type: [MessageSchema], default: [] },
}, { timestamps: true });

ChatHistorySchema.index({ workspace: 1, user: 1 }, { unique: true });

// Append new messages and cap total at 200
ChatHistorySchema.statics.appendMessages = async function(workspaceId, userId, newMessages) {
  return this.findOneAndUpdate(
    { workspace: workspaceId, user: userId },
    { $push: { messages: { $each: newMessages, $slice: -200 } } },
    { upsert: true, new: true }
  );
};

module.exports = mongoose.model('ChatHistory', ChatHistorySchema);
