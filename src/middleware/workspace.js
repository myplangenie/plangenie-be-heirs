const Workspace = require('../models/Workspace');

// Reads X-Workspace-Id header (or query ?workspace) and ensures req.workspace if present/valid.
// If user has no workspaces, sets req.workspace to null.
module.exports = async function workspaceContext(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return next();
    const header = String(req.headers['x-workspace-id'] || req.query?.workspace || '').trim();
    let current = null;
    if (header) {
      current = await Workspace.findOne({ user: userId, wid: header }).lean().exec();
    }
    if (!current) {
      // Fallback to user's default workspace, if any (do not create one)
      current = await Workspace.findOne({ user: userId, defaultWorkspace: true }).lean().exec();
    }
    req.workspace = current || null;
    return next();
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to resolve workspace' });
  }
}
