const mongoose = require('mongoose');

/**
 * AgentCache - Stores cached AI agent responses to reduce LLM calls
 * Cache entries expire after a configurable TTL (default 1 hour)
 */
const AgentCacheSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    agentType: {
      type: String,
      required: true,
      enum: ['plan-guidance', 'financial-validation', 'strategy-suggestion', 'progress-status'],
      index: true
    },
    // Hash of input data to detect if cache is stale
    inputHash: { type: String, required: true },
    // The cached response
    response: { type: mongoose.Schema.Types.Mixed, required: true },
    // Metadata
    generatedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: true },
    // Performance tracking
    generationTimeMs: { type: Number },
  },
  { timestamps: true }
);

// Compound index for efficient lookups
AgentCacheSchema.index({ user: 1, agentType: 1 });

// TTL index to auto-delete expired entries (MongoDB handles this)
AgentCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AgentCache', AgentCacheSchema);
