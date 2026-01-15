/**
 * Workspace Role-Based Access Control Middleware
 *
 * Enforces role-based access on workspace data operations.
 * Requires auth middleware to run first (sets req.user).
 * Requires workspace middleware to run first (sets req.workspace).
 *
 * Role Hierarchy (low to high):
 * - viewer (1): Read-only access
 * - contributor (2): Can edit content
 * - admin (3): Can manage members, edit all content
 * - owner (4): Full access including delete workspace
 */

const WorkspaceMember = require('../models/WorkspaceMember');
const Workspace = require('../models/Workspace');

const ROLE_LEVELS = {
  viewer: 1,
  contributor: 2,
  admin: 3,
  owner: 4,
};

/**
 * Check if user has required role in workspace
 * @param {string} userId - User ID
 * @param {string} workspaceId - Workspace ObjectId
 * @param {string} requiredRole - Minimum required role
 * @returns {Object|null} Role info if authorized, null if denied
 */
async function checkWorkspaceRole(userId, workspaceId, requiredRole = 'viewer') {
  // First check WorkspaceMember collection
  const member = await WorkspaceMember.findOne({
    workspace: workspaceId,
    user: userId,
    status: 'active',
  }).lean();

  if (!member) {
    // Fall back to legacy owner check (workspace creator)
    const workspace = await Workspace.findById(workspaceId).lean();
    if (workspace && String(workspace.user) === String(userId)) {
      return { isOwner: true, role: 'owner', member: null };
    }
    return null;
  }

  const userLevel = ROLE_LEVELS[member.role] || 0;
  const requiredLevel = ROLE_LEVELS[requiredRole] || 0;

  if (userLevel >= requiredLevel) {
    return { isOwner: member.role === 'owner', role: member.role, member };
  }

  return null;
}

/**
 * Middleware factory to require a minimum workspace role
 *
 * @param {string} requiredRole - Minimum role required (viewer, contributor, admin, owner)
 * @returns {Function} Express middleware
 *
 * Usage:
 *   router.patch('/data', requireWorkspaceRole('contributor'), controller.updateData);
 *   router.delete('/item', requireWorkspaceRole('admin'), controller.deleteItem);
 */
function requireWorkspaceRole(requiredRole = 'viewer') {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      // Get workspace from request (set by workspace middleware or from params)
      let workspaceId = req.workspace?._id;

      if (!workspaceId) {
        // Try to get from params or header
        const wid = req.params?.wid || req.headers['x-workspace-id'] || req.query?.workspace;
        if (wid) {
          const workspace = await Workspace.findOne({ wid }).lean();
          if (workspace) {
            workspaceId = workspace._id;
            req.workspace = workspace;
          }
        }
      }

      if (!workspaceId) {
        return res.status(400).json({
          message: 'Workspace context required',
          code: 'WORKSPACE_REQUIRED',
        });
      }

      // Check role
      const access = await checkWorkspaceRole(userId, workspaceId, requiredRole);

      if (!access) {
        const roleNames = {
          viewer: 'view this workspace',
          contributor: 'edit content in this workspace',
          admin: 'perform administrative actions',
          owner: 'perform this action (owner only)',
        };
        return res.status(403).json({
          message: `Access denied. You need ${requiredRole} role to ${roleNames[requiredRole] || 'access this resource'}.`,
          code: 'INSUFFICIENT_ROLE',
          requiredRole,
        });
      }

      // Attach role info to request for downstream use
      req.workspaceRole = access.role;
      req.isWorkspaceOwner = access.isOwner;
      req.workspaceMember = access.member;

      next();
    } catch (err) {
      console.error('[requireWorkspaceRole] Error:', err?.message || err);
      next(err);
    }
  };
}

/**
 * Middleware to require viewer or higher (read access)
 */
const requireViewer = requireWorkspaceRole('viewer');

/**
 * Middleware to require contributor or higher (edit access)
 */
const requireContributor = requireWorkspaceRole('contributor');

/**
 * Middleware to require admin or higher (management access)
 */
const requireAdmin = requireWorkspaceRole('admin');

/**
 * Middleware to require owner (full access)
 */
const requireOwner = requireWorkspaceRole('owner');

module.exports = {
  requireWorkspaceRole,
  requireViewer,
  requireContributor,
  requireAdmin,
  requireOwner,
  checkWorkspaceRole,
  ROLE_LEVELS,
};
