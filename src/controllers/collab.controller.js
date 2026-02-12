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

const VALID_DEPARTMENTS = [
  'marketing', 'sales', 'operations', 'financeAdmin',
  'peopleHR', 'partnerships', 'technology', 'communityImpact',
];

// POST /api/collab/invite { email, accessType?, departments? }
exports.invite = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const emailRaw = String(req.body?.email || '').trim().toLowerCase();
    if (!isValidEmail(emailRaw)) return res.status(400).json({ message: 'Valid email is required' });

    // Access control fields
    const accessType = req.body?.accessType || 'admin';
    if (!['admin', 'department'].includes(accessType)) {
      return res.status(400).json({ message: 'accessType must be "admin" or "department"' });
    }
    let departments = req.body?.departments || [];
    if (!Array.isArray(departments)) departments = [];
    departments = departments.filter((d) => VALID_DEPARTMENTS.includes(d));

    // If department access, must have at least one department
    if (accessType === 'department' && departments.length === 0) {
      return res.status(400).json({ message: 'At least one department required for department access' });
    }

    // Check if email belongs to an existing user
    const existingUser = await User.findOne({ email: emailRaw }).select('_id isCollaborator onboardingDone').lean().exec();

    // Allow re-inviting if:
    // 1. No existing user, OR
    // 2. Existing user is a collaborator-only account (isCollaborator=true, no onboardingDone)
    // Block if the user is a full account holder (has completed onboarding as an owner)
    if (existingUser) {
      const isCollaboratorOnly = existingUser.isCollaborator && !existingUser.onboardingDone;
      if (!isCollaboratorOnly) {
        return res.status(400).json({ message: "This email belongs to an existing account holder and can't be added as a collaborator" });
      }
      // For collaborator-only accounts, we can proceed to create/update the collaboration
    }

    let collab = await Collaboration.findOne({ owner: userId, email: emailRaw });
    if (!collab) {
      collab = await Collaboration.create({
        owner: userId,
        email: emailRaw,
        status: 'pending',
        accessType,
        departments,
        // If existing collaborator-only user exists, link them immediately
        ...(existingUser ? { viewer: existingUser._id, collaborator: existingUser._id } : {}),
      });
    } else {
      // Update access settings if re-inviting
      collab.accessType = accessType;
      collab.departments = departments;
      // If existing collaborator-only user exists, ensure they're linked
      if (existingUser) {
        collab.viewer = collab.viewer || existingUser._id;
        collab.collaborator = collab.collaborator || existingUser._id;
      }
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
    // Only consider explicit, id-based relationships (viewer/collaborator). Avoid email fallback for viewables.
    const rows = await Collaboration.find({ status: 'accepted', $or: [ { viewer: viewerId }, { collaborator: viewerId } ] }).lean().exec();
    const ownerIds = Array.from(new Set(rows.map((r) => String(r.owner))));
    if (ownerIds.length === 0) return res.json({ owners: [] });
    const owners = await User.find({ _id: { $in: ownerIds } }).lean().exec();

    // Get default workspaces for all owners
    const Workspace = require('../models/Workspace');
    const workspaces = await Workspace.find({
      user: { $in: ownerIds },
      defaultWorkspace: true
    }).select('user wid').lean().exec();
    const ownerWorkspaceMap = {};
    workspaces.forEach((ws) => {
      ownerWorkspaceMap[String(ws.user)] = ws.wid;
    });

    const out = owners.map((o) => {
      const slug = effectivePlan(o);
      return {
        id: String(o._id),
        name: (o.firstName || o.lastName) ? `${o.firstName || ''} ${o.lastName || ''}`.trim() : (o.fullName || o.email),
        email: o.email,
        companyName: o.companyName || '',
        plan: { slug, name: plans[slug]?.name || slug },
        hasActiveSubscription: !!o.hasActiveSubscription,
        workspaceWid: ownerWorkspaceMap[String(o._id)] || null,
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
        accessType: r.accessType || 'admin',
        departments: r.departments || [],
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

        // Check if this was a collaborator-only account with no other collaborations
        // If so, delete or reset their User record to free up the email
        const isCollaboratorOnly = invitee.isCollaborator && !invitee.onboardingDone;
        if (isCollaboratorOnly) {
          // Check if they have other active collaborations
          const otherCollabs = await Collaboration.countDocuments({
            $or: [{ viewer: invitee._id }, { collaborator: invitee._id }],
            status: 'accepted',
          }).exec();

          // Check if they own any collaborations (i.e., they're also an owner)
          const ownsCollabs = await Collaboration.countDocuments({ owner: invitee._id }).exec();

          // If no other collaborations and not an owner, clean up the user
          if (otherCollabs === 0 && ownsCollabs === 0) {
            // Delete the collaborator-only user account to free up the email
            await User.deleteOne({ _id: invitee._id }).exec();
            // Also clean up any related data
            try {
              const RefreshToken = require('../models/RefreshToken');
              await RefreshToken.deleteMany({ user: invitee._id }).exec();
            } catch {}
            try {
              await Notification.deleteMany({ user: invitee._id }).exec();
            } catch {}
          }
        }
      }
    } catch (_e) {
      console.error('[revoke] Cleanup error:', _e?.message || _e);
    }
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
      collab.collaborator = collab.collaborator || viewerId;
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
    const allowed = String(collab.owner) !== String(viewerId) && (String(collab.viewer || '') === String(viewerId) || String(collab.collaborator || '') === String(viewerId) || String(collab.email || '') === email);
    if (!allowed) return res.status(403).json({ message: 'Not authorized to accept this invite' });
    collab.status = 'accepted';
    collab.acceptedAt = new Date();
    collab.viewer = collab.viewer || viewerId;
    collab.collaborator = collab.collaborator || viewerId;
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

// GET /api/collab/invite/info?token=...
// Public endpoint to get invite info (owner name, company name) for pre-filling signup
exports.inviteInfo = async (req, res) => {
  try {
    const token = String((req.query && req.query.token) || '').trim();
    if (!token) return res.status(400).json({ message: 'Missing token' });

    const now = new Date();
    const collab = await Collaboration.findOne({ acceptToken: token }).lean().exec();
    if (!collab) return res.status(400).json({ message: 'Invalid or expired token' });
    if (collab.tokenExpires && collab.tokenExpires < now) {
      return res.status(400).json({ message: 'Token expired' });
    }

    // Get the owner's info
    const owner = await User.findById(collab.owner).lean().exec();
    if (!owner) return res.status(400).json({ message: 'Owner not found' });

    const ownerName = (owner.firstName || owner.lastName)
      ? `${owner.firstName || ''} ${owner.lastName || ''}`.trim()
      : (owner.fullName || owner.email);

    return res.json({
      email: collab.email,
      ownerName,
      companyName: owner.companyName || '',
      status: collab.status,
    });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to get invite info' });
  }
};

// PATCH /api/collab/access { id, accessType, departments }
exports.updateAccess = async (req, res) => {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) return res.status(401).json({ message: 'Unauthorized' });

    const id = (req.body && req.body.id) ? String(req.body.id).trim() : '';
    if (!id) return res.status(400).json({ message: 'Missing collaboration id' });

    const accessType = req.body?.accessType || 'admin';
    if (!['admin', 'department'].includes(accessType)) {
      return res.status(400).json({ message: 'accessType must be "admin" or "department"' });
    }

    let departments = req.body?.departments || [];
    if (!Array.isArray(departments)) departments = [];
    departments = departments.filter((d) => VALID_DEPARTMENTS.includes(d));

    // If department access, must have at least one department
    if (accessType === 'department' && departments.length === 0) {
      return res.status(400).json({ message: 'At least one department required for department access' });
    }

    const collab = await Collaboration.findOne({ _id: id, owner: ownerId }).exec();
    if (!collab) return res.status(404).json({ message: 'Collaboration not found' });

    collab.accessType = accessType;
    collab.departments = accessType === 'department' ? departments : [];
    await collab.save();

    return res.json({
      ok: true,
      collaboration: {
        id: String(collab._id),
        accessType: collab.accessType,
        departments: collab.departments,
      },
    });
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to update access' });
  }
};
