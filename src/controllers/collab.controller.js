const Collaboration = require('../models/Collaboration');
const User = require('../models/User');

function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email || '').toLowerCase());
}

// POST /api/collab/invite { email }
exports.invite = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const emailRaw = String(req.body?.email || '').trim().toLowerCase();
    if (!isValidEmail(emailRaw)) return res.status(400).json({ message: 'Valid email is required' });

    let collab = await Collaboration.findOne({ owner: userId, email: emailRaw });
    if (!collab) {
      collab = await Collaboration.create({ owner: userId, email: emailRaw, status: 'pending' });
    }
    // If the user already exists with this email, auto-mark accepted
    const existing = await User.findOne({ email: emailRaw }).lean().exec();
    if (existing && String(existing._id) !== String(userId)) {
      collab.status = 'accepted';
      collab.viewer = existing._id;
      collab.acceptedAt = collab.acceptedAt || new Date();
      await collab.save();
    }
    return res.json({ ok: true, invite: { id: collab._id, email: collab.email, status: collab.status } });
  } catch (err) {
    const dup = err && err.code === 11000;
    if (dup) return res.json({ ok: true });
    return res.status(500).json({ message: err?.message || 'Failed to create invite' });
  }
};

// GET /api/collab/viewables -> list of owners this user can view
exports.viewables = async (req, res) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) return res.status(401).json({ message: 'Unauthorized' });
    const me = await User.findById(viewerId).lean().exec();
    if (!me) return res.status(401).json({ message: 'Unauthorized' });
    const email = (me.email || '').toLowerCase();
    const rows = await Collaboration.find({ $or: [ { viewer: viewerId }, { email } ] }).lean().exec();
    const ownerIds = Array.from(new Set(rows.map((r) => String(r.owner))));
    if (ownerIds.length === 0) return res.json({ owners: [] });
    const owners = await User.find({ _id: { $in: ownerIds } }).lean().exec();
    const out = owners.map((o) => ({ id: String(o._id), name: (o.firstName || o.lastName) ? `${o.firstName || ''} ${o.lastName || ''}`.trim() : (o.fullName || o.email), email: o.email, companyName: o.companyName || '' }));
    return res.json({ owners: out });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to load collaborators' });
  }
};

