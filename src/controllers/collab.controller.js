const Collaboration = require('../models/Collaboration');
const User = require('../models/User');
const Notification = require('../models/Notification');
const crypto = require('crypto');
const { effectivePlan, plans } = require('../config/entitlements');
const { Resend } = require('resend');

function isValidEmail(email) {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email || '').toLowerCase());
}

function appBaseUrl() {
  const env = (process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (env) return env;
  // Fallback to public domain
  return 'https://plangenie.com';
}

async function sendInviteEmail({ to, ownerName, acceptUrl }) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const subject = `${ownerName || 'A PlanGenie user'} invited you to view their dashboard`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif; line-height:1.5">
        <h2>PlanGenie Collaboration Invite</h2>
        <p>${ownerName || 'A PlanGenie user'} has invited you to view their PlanGenie dashboard (read-only).</p>
        <p>Click the button below to accept the invitation.</p>
        <p style="margin:24px 0">
          <a href="${acceptUrl}" style="display:inline-block; background:#111827; color:#fff; padding:10px 16px; text-decoration:none; border-radius:6px">Accept Invitation</a>
        </p>
        <p>If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="word-break:break-all"><a href="${acceptUrl}">${acceptUrl}</a></p>
      </div>
    `;
    const text = `${ownerName || 'A PlanGenie user'} invited you to view their dashboard (read-only).\nAccept: ${acceptUrl}`;
    await resend.emails.send({ from, to, subject, html, text });
  } catch (err) {
    console.error('[email] Failed to send collab invite:', err?.message || err);
  }
}

// POST /api/collab/invite { email }
exports.invite = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const emailRaw = String(req.body?.email || '').trim().toLowerCase();
    if (!isValidEmail(emailRaw)) return res.status(400).json({ message: 'Valid email is required' });

    // If the email already belongs to an existing user account,
    // do not allow adding as a collaborator per product requirement.
    const existingUser = await User.findOne({ email: emailRaw }).select('_id').lean().exec();
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists and can't be added as a collaborator" });
    }

    let collab = await Collaboration.findOne({ owner: userId, email: emailRaw });
    if (!collab) {
      collab = await Collaboration.create({ owner: userId, email: emailRaw, status: 'pending' });
    }
    // Generate (or refresh) accept token
    const token = crypto.randomBytes(24).toString('hex');
    collab.acceptToken = token;
    collab.tokenExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7); // 7 days
    await collab.save();

    // Prepare and send invite email
    const owner = await User.findById(userId).lean().exec();
    const ownerName = owner ? ((owner.firstName || owner.lastName) ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim() : (owner.fullName || owner.email)) : 'A PlanGenie user';
    const base = appBaseUrl();
    const acceptUrl = `${base}/signup?collabToken=${encodeURIComponent(token)}&email=${encodeURIComponent(emailRaw)}`;
    await sendInviteEmail({ to: emailRaw, ownerName, acceptUrl });
    // If invitee already has an account, create an in-app notification
    const invitee = await User.findOne({ email: emailRaw }).lean().exec();
    if (invitee && String(invitee._id) !== String(userId)) {
      const nid = `collab-${String(collab._id)}`;
      // Upsert to avoid duplicates if re-invited
      await Notification.findOneAndUpdate(
        { user: invitee._id, nid },
        {
          $set: {
            title: `Collaboration invite from ${ownerName}`,
            description: `${ownerName} invited you to view their PlanGenie dashboard (read-only).`,
            type: 'collaboration',
            severity: 'info',
            time: 'now',
            actions: [{ label: 'Accept', kind: 'primary' }, { label: 'Decline', kind: 'secondary' }],
            data: { collabId: String(collab._id), ownerId: String(userId), ownerName },
            read: false,
          },
          $setOnInsert: { user: invitee._id, nid },
        },
        { upsert: true }
      );
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
    const rows = await Collaboration.find({ status: 'accepted', $or: [ { viewer: viewerId }, { email } ] }).lean().exec();
    const ownerIds = Array.from(new Set(rows.map((r) => String(r.owner))));
    if (ownerIds.length === 0) return res.json({ owners: [] });
    const owners = await User.find({ _id: { $in: ownerIds } }).lean().exec();
    const out = owners.map((o) => {
      const slug = effectivePlan(o);
      return {
        id: String(o._id),
        name: (o.firstName || o.lastName) ? `${o.firstName || ''} ${o.lastName || ''}`.trim() : (o.fullName || o.email),
        email: o.email,
        companyName: o.companyName || '',
        plan: { slug, name: plans[slug]?.name || slug },
        hasActiveSubscription: !!o.hasActiveSubscription,
      };
    });
    return res.json({ owners: out });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to load collaborators' });
  }
};

// GET /api/collab/collaborators -> list of collaborators for the owner
exports.collaborators = async (req, res) => {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) return res.status(401).json({ message: 'Unauthorized' });
    const { page = 1, limit = 20, status, q } = req.query || {};
    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const filter = { owner: ownerId };
    if (typeof status === 'string' && ['pending', 'accepted', 'declined'].includes(status)) {
      filter.status = status;
    }
    if (typeof q === 'string' && q.trim()) {
      filter.email = { $regex: q.trim(), $options: 'i' };
    }
    const [rows, total] = await Promise.all([
      Collaboration.find(filter)
        .sort({ createdAt: -1 })
        .skip((p - 1) * l)
        .limit(l)
        .populate('viewer', 'firstName lastName fullName email companyName')
        .lean()
        .exec(),
      Collaboration.countDocuments(filter),
    ]);
    const list = rows.map((r) => {
      const v = r.viewer || null;
      const viewerName = v ? ((v.firstName || v.lastName) ? `${v.firstName || ''} ${v.lastName || ''}`.trim() : (v.fullName || v.email)) : '';
      return {
        id: String(r._id),
        email: r.email,
        status: r.status,
        invitedAt: r.invitedAt || r.createdAt || null,
        acceptedAt: r.acceptedAt || null,
        viewer: v ? { id: String(v._id || ''), name: viewerName, email: v.email || '' } : null,
      };
    });
    return res.json({ collaborators: list, page: p, limit: l, total });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to load collaborators' });
  }
};

// DELETE /api/collab/invite { email? id? }
exports.revoke = async (req, res) => {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) return res.status(401).json({ message: 'Unauthorized' });
    const id = (req.body && req.body.id) || null;
    const emailRaw = (req.body && req.body.email) ? String(req.body.email).trim().toLowerCase() : null;
    if (!id && !emailRaw) return res.status(400).json({ message: 'Provide id or email to revoke' });
    const query = id ? { _id: id, owner: ownerId } : { owner: ownerId, email: emailRaw };
    const doc = await Collaboration.findOneAndDelete(query).lean().exec();
    if (!doc) return res.status(404).json({ message: 'Collaboration not found' });
    // Clean up notifications for the invitee if present
    try {
      const invitee = await User.findOne({ email: doc.email }).lean().exec();
      if (invitee) {
        await Notification.deleteMany({ user: invitee._id, nid: `collab-${String(doc._id)}` }).exec();
      }
    } catch (_e) {}
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to revoke collaborator' });
  }
};

// GET /api/collab/accept?token=...
// Optionally authenticated: if logged in, links the viewer to the accepting account
exports.accept = async (req, res) => {
  try {
    const token = String((req.query && req.query.token) || (req.body && req.body.token) || '').trim();
    if (!token) return res.status(400).json({ message: 'Missing token' });
    const now = new Date();
    const collab = await Collaboration.findOne({ acceptToken: token }).exec();
    if (!collab) return res.status(400).json({ message: 'Invalid or expired token' });
    if (collab.tokenExpires && collab.tokenExpires < now) return res.status(400).json({ message: 'Token expired' });
    collab.status = 'accepted';
    collab.acceptedAt = new Date();
    // If an authenticated user is present, bind viewer
    const viewerId = req.user?.id;
    if (viewerId && String(viewerId) !== String(collab.owner)) {
      collab.viewer = collab.viewer || viewerId;
    }
    // Invalidate token
    collab.acceptToken = null;
    collab.tokenExpires = null;
    await collab.save();
    // Mark the accepting user as a collaborator
    try {
      const viewerId2 = req.user?.id;
      if (viewerId2 && String(viewerId2) !== String(collab.owner)) {
        await User.findByIdAndUpdate(viewerId2, { isCollaborator: true }).exec();
      }
    } catch {}

    return res.json({ ok: true, collaboration: { id: String(collab._id), owner: String(collab.owner), email: collab.email, status: collab.status } });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to accept invite' });
  }
};

// POST /api/collab/accept (auth) { id }
exports.acceptLogged = async (req, res) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) return res.status(401).json({ message: 'Unauthorized' });
    const id = (req.body && req.body.id) ? String(req.body.id).trim() : '';
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const collab = await Collaboration.findById(id).exec();
    if (!collab) return res.status(404).json({ message: 'Collaboration not found' });
    // Verify this viewer is the intended invitee
    const me = await User.findById(viewerId).lean().exec();
    if (!me) return res.status(401).json({ message: 'Unauthorized' });
    const email = (me.email || '').toLowerCase();
    const allowed = String(collab.owner) !== String(viewerId) && (String(collab.viewer || '') === String(viewerId) || String(collab.email || '') === email);
    if (!allowed) return res.status(403).json({ message: 'Not authorized to accept this invite' });
    collab.status = 'accepted';
    collab.acceptedAt = new Date();
    collab.viewer = collab.viewer || viewerId;
    collab.acceptToken = null;
    collab.tokenExpires = null;
    await collab.save();
    // Mark viewer as collaborator
    try { await User.findByIdAndUpdate(viewerId, { isCollaborator: true }).exec(); } catch {}
    // Mark related notification as read
    await Notification.updateMany({ user: viewerId, nid: `collab-${String(collab._id)}` }, { $set: { read: true } }).exec();
    return res.json({ ok: true, collaboration: { id: String(collab._id), owner: String(collab.owner), status: collab.status } });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to accept invite' });
  }
};

// POST /api/collab/decline (auth) { id }
exports.decline = async (req, res) => {
  try {
    const viewerId = req.user?.id;
    if (!viewerId) return res.status(401).json({ message: 'Unauthorized' });
    const id = (req.body && req.body.id) ? String(req.body.id).trim() : '';
    if (!id) return res.status(400).json({ message: 'Missing id' });
    const collab = await Collaboration.findById(id).exec();
    if (!collab) return res.status(404).json({ message: 'Collaboration not found' });
    const me = await User.findById(viewerId).lean().exec();
    if (!me) return res.status(401).json({ message: 'Unauthorized' });
    const email = (me.email || '').toLowerCase();
    const allowed = String(collab.owner) !== String(viewerId) && (String(collab.viewer || '') === String(viewerId) || String(collab.email || '') === email);
    if (!allowed) return res.status(403).json({ message: 'Not authorized to decline this invite' });
    collab.status = 'declined';
    collab.acceptToken = null;
    collab.tokenExpires = null;
    await collab.save();
    await Notification.updateMany({ user: viewerId, nid: `collab-${String(collab._id)}` }, { $set: { read: true } }).exec();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to decline invite' });
  }
};

// GET /api/collab/decline?token=...
exports.declineByToken = async (req, res) => {
  try {
    const token = String((req.query && req.query.token) || (req.body && req.body.token) || '').trim();
    if (!token) return res.status(400).json({ message: 'Missing token' });
    const collab = await Collaboration.findOne({ acceptToken: token }).exec();
    if (!collab) return res.status(400).json({ message: 'Invalid or expired token' });
    collab.status = 'declined';
    collab.acceptToken = null;
    collab.tokenExpires = null;
    await collab.save();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to decline invite' });
  }
};

// POST /api/collab/invite/resend { id? email? }
exports.resend = async (req, res) => {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) return res.status(401).json({ message: 'Unauthorized' });
    const id = (req.body && req.body.id) || null;
    const emailRaw = (req.body && req.body.email) ? String(req.body.email).trim().toLowerCase() : null;
    if (!id && !emailRaw) return res.status(400).json({ message: 'Provide id or email to resend' });
    const query = id ? { _id: id, owner: ownerId } : { owner: ownerId, email: emailRaw };
    const collab = await Collaboration.findOne(query).exec();
    if (!collab) return res.status(404).json({ message: 'Collaboration not found' });
    if (collab.status === 'accepted') return res.status(400).json({ message: 'Collaboration already accepted' });

    // Refresh token
    const token = crypto.randomBytes(24).toString('hex');
    collab.acceptToken = token;
    collab.tokenExpires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    await collab.save();

    // Send email
    const owner = await User.findById(ownerId).lean().exec();
    const ownerName = owner ? ((owner.firstName || owner.lastName) ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim() : (owner.fullName || owner.email)) : 'A PlanGenie user';
    const base = appBaseUrl();
    const acceptUrl = `${base}/signup?collabToken=${encodeURIComponent(token)}&email=${encodeURIComponent(collab.email)}`;
    await sendInviteEmail({ to: collab.email, ownerName, acceptUrl });

    // Refresh in-app notification for existing invitee
    const invitee = await User.findOne({ email: collab.email }).lean().exec();
    if (invitee && String(invitee._id) !== String(ownerId)) {
      const nid = `collab-${String(collab._id)}`;
      await Notification.findOneAndUpdate(
        { user: invitee._id, nid },
        {
          $set: {
            title: `Collaboration invite from ${ownerName}`,
            description: `${ownerName} invited you to view their PlanGenie dashboard (read-only).`,
            type: 'collaboration',
            severity: 'info',
            time: 'now',
            actions: [{ label: 'Accept', kind: 'primary' }, { label: 'Decline', kind: 'secondary' }],
            data: { collabId: String(collab._id), ownerId: String(ownerId), ownerName },
            read: false,
          },
          $setOnInsert: { user: invitee._id, nid },
        },
        { upsert: true }
      );
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to resend invite' });
  }
};
