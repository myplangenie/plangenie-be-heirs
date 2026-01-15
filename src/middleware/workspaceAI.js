/**
 * Workspace AI Permission Middleware
 *
 * Enforces AI access controls at workspace and member levels.
 * Should be used AFTER workspaceRole middleware (needs req.workspace and req.workspaceMember).
 *
 * Permission Resolution Order:
 * 1. User's subscription plan must include AI features (handled by plan.js)
 * 2. Workspace must have AI enabled (aiSettings.enabled)
 * 3. Workspace must have the specific feature enabled (aiSettings.features.X)
 * 4. Member must have AI access (permissions.canUseAI - null inherits from role)
 * 5. Member must have the specific feature access (permissions.aiFeatures.X)
 *
 * Role-based defaults (when member permission is null/undefined):
 * - owner/admin: Full AI access
 * - contributor: Full AI access
 * - viewer: No AI access (read-only)
 */

const Workspace = require('../models/Workspace');
const WorkspaceMember = require('../models/WorkspaceMember');

// Map AI feature names to workspace aiSettings.features keys
const AI_FEATURE_MAP = {
  vision: 'visionSuggestions',
  values: 'valueSuggestions',
  swot: 'swotAnalysis',
  market: 'marketAnalysis',
  financial: 'financialSuggestions',
  actions: 'actionPlanSuggestions',
  core: 'coreProjectSuggestions',
};

/**
 * Check if member has AI access based on role defaults
 * @param {string} role - Member role
 * @returns {boolean}
 */
function getRoleDefaultAIAccess(role) {
  // Viewers get no AI by default, everyone else gets AI
  return role !== 'viewer';
}

/**
 * Resolve member's AI permission with role fallback
 * @param {Object} member - WorkspaceMember document
 * @param {string} permissionKey - Key in permissions.aiFeatures
 * @returns {boolean}
 */
function resolveMemberAIPermission(member, permissionKey) {
  // First check master AI toggle
  const canUseAI = member?.permissions?.canUseAI;
  if (canUseAI === false) return false;
  if (canUseAI === true) {
    // Master is enabled, check specific feature
    const featurePermission = member?.permissions?.aiFeatures?.[permissionKey];
    if (featurePermission === false) return false;
    return true;
  }

  // canUseAI is null/undefined - fall back to role
  const roleDefault = getRoleDefaultAIAccess(member?.role);
  if (!roleDefault) return false;

  // Check specific feature permission
  const featurePermission = member?.permissions?.aiFeatures?.[permissionKey];
  if (featurePermission === false) return false;

  return true;
}

/**
 * Middleware factory to require AI access for a specific feature
 *
 * @param {string} feature - AI feature key (vision, values, swot, market, financial, actions, core)
 * @returns {Function} Express middleware
 *
 * Usage:
 *   router.post('/vision/suggest', requireContributor, requireAI('vision'), ai.suggestVision);
 *   router.post('/financial/suggest', requireContributor, requireAI('financial'), ai.suggestFinancial);
 */
function requireAI(feature) {
  const featureKey = AI_FEATURE_MAP[feature];

  if (!featureKey) {
    console.warn(`[requireAI] Unknown feature: ${feature}, allowing access`);
    return (req, res, next) => next();
  }

  return async (req, res, next) => {
    try {
      // Get workspace (should already be set by workspace middleware)
      let workspace = req.workspace;
      if (!workspace?.aiSettings) {
        // Fetch full workspace with aiSettings
        workspace = await Workspace.findById(workspace?._id || req.workspace?._id).lean();
        if (workspace) req.workspace = workspace;
      }

      if (!workspace) {
        return res.status(400).json({
          message: 'Workspace context required for AI features',
          code: 'WORKSPACE_REQUIRED',
        });
      }

      // Check 1: Workspace AI master toggle
      if (workspace.aiSettings?.enabled === false) {
        return res.status(403).json({
          message: 'AI features are disabled for this workspace',
          code: 'AI_DISABLED_WORKSPACE',
        });
      }

      // Check 2: Workspace feature toggle
      if (workspace.aiSettings?.features?.[featureKey] === false) {
        return res.status(403).json({
          message: `AI ${feature} suggestions are disabled for this workspace`,
          code: 'AI_FEATURE_DISABLED_WORKSPACE',
          feature,
        });
      }

      // Get member (should be set by workspaceRole middleware)
      let member = req.workspaceMember;
      if (!member && req.user?.id) {
        member = await WorkspaceMember.findOne({
          workspace: workspace._id,
          user: req.user.id,
          status: 'active',
        }).lean();
      }

      // For workspace owners without a WorkspaceMember record, allow full access
      if (!member && req.isWorkspaceOwner) {
        return next();
      }

      // Check 3 & 4: Member AI permissions
      const hasAccess = resolveMemberAIPermission(member, featureKey);
      if (!hasAccess) {
        return res.status(403).json({
          message: `You don't have permission to use AI ${feature} suggestions in this workspace`,
          code: 'AI_PERMISSION_DENIED',
          feature,
        });
      }

      next();
    } catch (err) {
      console.error('[requireAI] Error:', err?.message || err);
      next(err);
    }
  };
}

/**
 * Middleware to require general AI access (no specific feature)
 * Useful for generic AI endpoints like chat
 */
const requireAIAccess = async (req, res, next) => {
  try {
    let workspace = req.workspace;
    if (!workspace?.aiSettings) {
      workspace = await Workspace.findById(workspace?._id).lean();
      if (workspace) req.workspace = workspace;
    }

    if (!workspace) {
      return res.status(400).json({
        message: 'Workspace context required for AI features',
        code: 'WORKSPACE_REQUIRED',
      });
    }

    // Check workspace AI master toggle
    if (workspace.aiSettings?.enabled === false) {
      return res.status(403).json({
        message: 'AI features are disabled for this workspace',
        code: 'AI_DISABLED_WORKSPACE',
      });
    }

    // Check member master AI permission
    let member = req.workspaceMember;
    if (!member && req.user?.id) {
      member = await WorkspaceMember.findOne({
        workspace: workspace._id,
        user: req.user.id,
        status: 'active',
      }).lean();
    }

    // Workspace owners without member record get full access
    if (!member && req.isWorkspaceOwner) {
      return next();
    }

    // Check member's canUseAI permission
    const canUseAI = member?.permissions?.canUseAI;
    if (canUseAI === false) {
      return res.status(403).json({
        message: "You don't have permission to use AI features in this workspace",
        code: 'AI_PERMISSION_DENIED',
      });
    }

    // If canUseAI is null, check role default
    if (canUseAI === undefined || canUseAI === null) {
      if (!getRoleDefaultAIAccess(member?.role)) {
        return res.status(403).json({
          message: 'Viewers cannot use AI features. Please contact workspace admin for access.',
          code: 'AI_VIEWER_RESTRICTED',
        });
      }
    }

    next();
  } catch (err) {
    console.error('[requireAIAccess] Error:', err?.message || err);
    next(err);
  }
};

/**
 * Get AI settings for a workspace (for settings UI)
 */
async function getWorkspaceAISettings(workspaceId) {
  const workspace = await Workspace.findById(workspaceId).select('aiSettings').lean();
  return workspace?.aiSettings || {
    enabled: true,
    features: {
      visionSuggestions: true,
      valueSuggestions: true,
      swotAnalysis: true,
      marketAnalysis: true,
      financialSuggestions: true,
      actionPlanSuggestions: true,
      coreProjectSuggestions: true,
    },
  };
}

/**
 * Update AI settings for a workspace
 */
async function updateWorkspaceAISettings(workspaceId, aiSettings) {
  return Workspace.findByIdAndUpdate(
    workspaceId,
    { $set: { aiSettings } },
    { new: true, select: 'aiSettings' }
  );
}

/**
 * Get member AI permissions
 */
async function getMemberAIPermissions(workspaceId, userId) {
  const member = await WorkspaceMember.findOne({
    workspace: workspaceId,
    user: userId,
    status: 'active',
  }).select('role permissions').lean();

  if (!member) return null;

  return {
    role: member.role,
    canUseAI: member.permissions?.canUseAI,
    aiFeatures: member.permissions?.aiFeatures || {},
    effectiveAccess: {
      canUseAI: resolveMemberAIPermission(member, 'visionSuggestions'), // Use any feature as proxy
    },
  };
}

/**
 * Update member AI permissions
 */
async function updateMemberAIPermissions(workspaceId, memberId, aiPermissions) {
  const update = {};
  if (aiPermissions.canUseAI !== undefined) {
    update['permissions.canUseAI'] = aiPermissions.canUseAI;
  }
  if (aiPermissions.aiFeatures) {
    for (const [key, value] of Object.entries(aiPermissions.aiFeatures)) {
      if (AI_FEATURE_MAP[key] || Object.values(AI_FEATURE_MAP).includes(key)) {
        update[`permissions.aiFeatures.${key}`] = value;
      }
    }
  }

  return WorkspaceMember.findByIdAndUpdate(
    memberId,
    { $set: update },
    { new: true, select: 'permissions' }
  );
}

module.exports = {
  requireAI,
  requireAIAccess,
  getWorkspaceAISettings,
  updateWorkspaceAISettings,
  getMemberAIPermissions,
  updateMemberAIPermissions,
  AI_FEATURE_MAP,
};
