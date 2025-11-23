const mongoose = require('mongoose');
const Collaboration = require('../models/Collaboration');
const User = require('../models/User');

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

    // Only allow read-only methods
    const method = (req.method || 'GET').toUpperCase();
    const READ = new Set(['GET', 'HEAD', 'OPTIONS']);
    if (!READ.has(method)) return res.status(403).json({ message: 'Read-only access for collaborators' });

    // Verify viewer is invited to owner
    const me = await User.findById(req.user.id).lean().exec();
    if (!me) return res.status(401).json({ message: 'Unauthorized' });
    const email = (me.email || '').toLowerCase();
    const row = await Collaboration.findOne({ owner: asId, $or: [{ viewer: req.user.id }, { email }] }).exec();
    if (!row) return res.status(403).json({ message: 'No access to requested dashboard' });
    if (row.status !== 'accepted') {
      return res.status(403).json({ message: row.status === 'declined' ? 'Invite declined' : 'Invite pending – please accept' });
    }
    // Stash original id and impersonate for downstream handlers
    const original = req.user.id;
    req.user = { id: String(asId), viewerId: String(original), viewOnly: true };
    return next();
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to authorize collaborator' });
  }
}
