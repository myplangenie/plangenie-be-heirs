const mongoose = require('mongoose');
const Collaboration = require('../models/Collaboration');
const User = require('../models/User');

// Methods that can modify data - block these for collaborators
// POST is allowed because many read endpoints use POST (e.g., /batch with body)
// The route handlers use requireContributor vs requireViewer to enforce write permissions
const WRITE_METHODS = new Set(['PUT', 'PATCH', 'DELETE']);

// PATCH endpoints that collaborators can use (with restrictions enforced by the handler)
const ALLOWED_PATCH_PATTERNS = [
  /^\/api\/workspaces\/[^/]+\/reviews\/[^/]+$/,  // Update own action items in reviews
  /^\/api\/okrs\/[a-f0-9]{24}\/key-results\/[a-f0-9]{24}\/metrics$/i, // Update own KR metrics
];

// Allow a viewer to access an owner's dashboard read-only by setting X-View-As: <ownerUserId>
module.exports = async function viewAs(req, res, next) {
  try {
    if (!req.user || !req.user.id) return next();
    const header = req.headers['x-view-as'];
    const q = req.query && req.query.as;
    const asId = String(header || q || '').trim();
    if (!asId) return next();
    if (!mongoose.Types.ObjectId.isValid(asId)) return res.status(400).json({ message: 'Invalid view-as user id' });
    if (String(asId) === String(req.user.id)) return next();

    // Verify viewer is invited to owner
    const row = await Collaboration.findOne({ owner: asId, $or: [{ viewer: req.user.id }, { collaborator: req.user.id }] }).exec();
    if (!row) return res.status(403).json({ message: 'No access to requested dashboard' });
    if (row.status !== 'accepted') {
      return res.status(403).json({ message: row.status === 'declined' ? 'Invite declined' : 'Invite pending – please accept' });
    }
    // Block writes for non-admin collaborators. Admin collaborators have full access.
    // Allow GET, POST, HEAD, OPTIONS - POST is used for read operations with complex bodies
    // Route handlers use requireContributor to block writes on POST endpoints
    const method = (req.method || 'GET').toUpperCase();
    if (WRITE_METHODS.has(method)) {
      // If this is an admin collaborator, allow writes
      if ((row.accessType || 'admin') === 'admin') {
        // proceed
      } else {
        // Allow specific PATCH endpoints that support collaborator edits
        const isAllowedPatch = method === 'PATCH' &&
        ALLOWED_PATCH_PATTERNS.some(pattern => pattern.test(req.path));
        if (!isAllowedPatch) {
          return res.status(403).json({ message: 'Read-only access for collaborators' });
        }
      }
    }
    // Stash original id and impersonate for downstream handlers
    const original = req.user.id;
    req.user = {
      id: String(asId),
      viewerId: String(original),
      viewOnly: true,
      accessType: row.accessType || 'admin',
      // Keys are display-only; restrict by department ids only
      allowedDepartments: [],
      allowedDeptIds: Array.isArray(row.departmentIds) ? row.departmentIds.map(String) : [],
    };
    return next();
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to authorize collaborator' });
  }
}
