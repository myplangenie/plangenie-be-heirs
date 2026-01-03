const Workspace = require('../models/Workspace');
const crypto = require('crypto');

// Reads X-Workspace-Id header (or query ?workspace) and ensures req.workspace if present/valid.
// Auto-creates a default workspace if user has none.
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
      // Fallback to user's default workspace
      current = await Workspace.findOne({ user: userId, defaultWorkspace: true }).lean().exec();
    }
    if (!current) {
      // Auto-create default workspace if user has none
      const wid = `ws_${crypto.randomBytes(6).toString('hex')}`;
      const created = await Workspace.create({
        user: userId,
        wid,
        name: 'My Business',
        defaultWorkspace: true,
      });
      current = created.toObject();
    }
    req.workspace = current;
    return next();
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to resolve workspace' });
  }
}
