/**
 * Utility for workspace-aware database queries.
 * Returns query conditions that filter by user and workspace.
 */

/**
 * Get the query filter for user + workspace
 * For READ operations - returns filter with workspace ID or null
 * @param {object} req - Express request object (must have req.user.id and optionally req.workspace)
 * @returns {object} MongoDB query filter { user, workspace }
 */
function getWorkspaceFilter(req) {
  const filter = { user: req.user?.id || null };
  // Always include workspace in filter - either the selected workspace or null
  // If workspace is null, queries will only find legacy null-workspace data (which should be empty after migration)
  filter.workspace = req.workspace?._id || null;
  return filter;
}

/**
 * Get workspace ID from request (for creating new documents)
 * For WRITE operations - returns workspace ID or null
 * @param {object} req - Express request object
 * @returns {ObjectId|null} Workspace ObjectId or null
 */
function getWorkspaceId(req) {
  return req.workspace?._id || null;
}

/**
 * Add workspace to a document before saving
 * @param {object} doc - Mongoose document or plain object
 * @param {object} req - Express request object
 * @returns {object} Document with workspace field added
 * @throws {Error} If no workspace is available (should not happen with middleware)
 */
function addWorkspaceToDoc(doc, req) {
  const wsId = getWorkspaceId(req);
  if (!wsId) {
    console.warn('[addWorkspaceToDoc] No workspace found on request - this should not happen');
  }
  // Always set workspace field (even if null, to make debugging easier)
  doc.workspace = wsId;
  return doc;
}

module.exports = {
  getWorkspaceFilter,
  getWorkspaceId,
  addWorkspaceToDoc,
};
