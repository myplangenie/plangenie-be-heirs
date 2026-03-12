const mongoose = require('mongoose');

  const CollaborationSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Invitee email (for pending invites and audit). For accepted collaborations, prefer collaborator id.
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    status: { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    // Legacy accepted-link: viewer id (kept for backward compatibility)
    viewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    // New canonical collaborator id for accepted collaborations
    collaborator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    invitedAt: { type: Date, default: Date.now },
    acceptedAt: { type: Date, default: null },
    acceptToken: { type: String, default: null, index: true },
    tokenExpires: { type: Date, default: null },
    // Access control - determines what data collaborator can see
    accessType: {
      type: String,
      enum: ['admin', 'limited', 'department'], // 'department' kept for backward compatibility
      default: 'admin',
    },
    // If accessType is 'limited' or 'department', which departments can they access (empty = all)
    departments: [{
      type: String,
      enum: [
        'marketing',
        'sales',
        'operations',
        'financeAdmin',
        'peopleHR',
        'partnerships',
        'technology',
        'communityImpact',
      ],
    }],
    // If accessType is 'limited', which pages are restricted (collaborator cannot access these)
    restrictedPages: [{
      type: String,
      enum: [
        'core-projects',
        'departments',
        'action-plans',
        'financial-clarity',
        'strategy-canvas',
        'plan',
        'decisions',
        'reviews',
        'assumptions',
      ],
    }],
    // Optional linkage to the owner's Department documents (id-based)
    // Primary department this collaborator belongs to (if any)
    primaryDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    // Additional departments (scoped access)
    departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
  },
  { timestamps: true }
);

// Prevent duplicate invites per owner/email
CollaborationSchema.index({ owner: 1, email: 1 }, { unique: true });
// Ensure at most one accepted link per owner-collaborator
try {
  CollaborationSchema.index(
    { owner: 1, collaborator: 1 },
    { unique: true, partialFilterExpression: { collaborator: { $type: 'objectId' } } }
  );
} catch (_) {}

module.exports = mongoose.model('Collaboration', CollaborationSchema);
