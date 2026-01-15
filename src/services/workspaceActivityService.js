/**
 * Workspace Activity Tracking Service
 *
 * Updates lastActivityAt timestamp on workspaces when users interact with them.
 */

const Workspace = require('../models/Workspace');

/**
 * Update the lastActivityAt timestamp for a workspace
 * @param {string|ObjectId} workspaceId - Workspace _id
 * @returns {Promise<void>}
 */
async function touchWorkspace(workspaceId) {
  if (!workspaceId) return;

  try {
    await Workspace.updateOne(
      { _id: workspaceId },
      { $set: { lastActivityAt: new Date() } }
    );
  } catch (err) {
    // Log but don't throw - activity tracking shouldn't break the main operation
    console.error('[touchWorkspace] Failed to update activity:', err?.message || err);
  }
}

/**
 * Update lastActivityAt by workspace wid
 * @param {string} wid - Workspace wid (external ID)
 * @returns {Promise<void>}
 */
async function touchWorkspaceByWid(wid) {
  if (!wid) return;

  try {
    await Workspace.updateOne(
      { wid },
      { $set: { lastActivityAt: new Date() } }
    );
  } catch (err) {
    console.error('[touchWorkspaceByWid] Failed to update activity:', err?.message || err);
  }
}

/**
 * Express middleware to touch workspace on any request
 * Use sparingly - only on routes where you want to track access
 */
function touchWorkspaceMiddleware(req, res, next) {
  // Touch asynchronously without waiting
  const workspaceId = req.workspace?._id;
  if (workspaceId) {
    touchWorkspace(workspaceId).catch(() => {});
  }
  next();
}

module.exports = {
  touchWorkspace,
  touchWorkspaceByWid,
  touchWorkspaceMiddleware,
};
