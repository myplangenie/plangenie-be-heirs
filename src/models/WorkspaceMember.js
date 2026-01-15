const mongoose = require('mongoose');
const crypto = require('crypto');

const WorkspaceMemberSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // null if pending invite
    email: { type: String, required: true, lowercase: true, trim: true },
    role: {
      type: String,
      enum: ['owner', 'admin', 'contributor', 'viewer'],
      default: 'viewer',
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'declined', 'removed'],
      default: 'pending',
    },
    // Invite fields
    inviteToken: { type: String, index: true },
    inviteTokenExpires: { type: Date },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    invitedAt: { type: Date },
    // Acceptance fields
    acceptedAt: { type: Date },
    // Department-level access (optional, for scoped access)
    departments: [{ type: String }], // empty = all departments
    // Permissions overrides (optional)
    permissions: {
      canEditPlan: { type: Boolean },
      canViewFinancials: { type: Boolean },
      canManageMembers: { type: Boolean },
      canDeleteWorkspace: { type: Boolean },
      // AI feature permissions (null = inherit from role, true/false = override)
      canUseAI: { type: Boolean }, // Master AI access toggle
      aiFeatures: {
        visionSuggestions: { type: Boolean },
        valueSuggestions: { type: Boolean },
        swotAnalysis: { type: Boolean },
        marketAnalysis: { type: Boolean },
        financialSuggestions: { type: Boolean },
        actionPlanSuggestions: { type: Boolean },
        coreProjectSuggestions: { type: Boolean },
      },
      // Export permissions (null = inherit from workspace settings, true/false = override)
      canExport: { type: Boolean }, // Master export toggle for this member
      exportFormats: {
        pdf: { type: Boolean },
        docx: { type: Boolean },
        csv: { type: Boolean },
      },
      exportContent: {
        plan: { type: Boolean },
        strategyCanvas: { type: Boolean },
        departments: { type: Boolean },
        financials: { type: Boolean },
      },
    },
    // Member-level notification preferences (null = inherit from workspace, true/false = override)
    notificationPreferences: {
      email: {
        weeklyDigest: { type: Boolean },
        dailyWish: { type: Boolean },
        reviewReminders: { type: Boolean },
        deadlineAlerts: { type: Boolean },
        teamActivity: { type: Boolean },
      },
      inApp: {
        taskUpdates: { type: Boolean },
        reviewReminders: { type: Boolean },
        deadlineAlerts: { type: Boolean },
        teamActivity: { type: Boolean },
        aiInsights: { type: Boolean },
      },
    },
  },
  { timestamps: true }
);

// Unique constraint: one membership per user per workspace
WorkspaceMemberSchema.index({ workspace: 1, email: 1 }, { unique: true });
WorkspaceMemberSchema.index({ workspace: 1, user: 1 }, { sparse: true });

// Generate invite token
WorkspaceMemberSchema.statics.generateInviteToken = function () {
  return crypto.randomBytes(32).toString('hex');
};

// Get role hierarchy value (higher = more permissions)
WorkspaceMemberSchema.statics.getRoleLevel = function (role) {
  const levels = { viewer: 1, contributor: 2, admin: 3, owner: 4 };
  return levels[role] || 0;
};

// Check if role has at least the required level
WorkspaceMemberSchema.methods.hasRoleLevel = function (requiredRole) {
  const levels = { viewer: 1, contributor: 2, admin: 3, owner: 4 };
  return (levels[this.role] || 0) >= (levels[requiredRole] || 0);
};

module.exports = mongoose.model('WorkspaceMember', WorkspaceMemberSchema);
