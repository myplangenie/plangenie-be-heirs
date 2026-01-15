const WorkspaceMember = require('../models/WorkspaceMember');
const Workspace = require('../models/Workspace');
const User = require('../models/User');
const { Resend } = require('resend');

// Helper to check if user has required role in workspace
async function checkWorkspaceRole(userId, workspaceId, requiredRole = 'viewer') {
  const member = await WorkspaceMember.findOne({
    workspace: workspaceId,
    user: userId,
    status: 'active',
  }).lean();

  if (!member) {
    // Check if user is the workspace owner (legacy support)
    const workspace = await Workspace.findById(workspaceId).lean();
    if (workspace && String(workspace.user) === String(userId)) {
      return { isOwner: true, role: 'owner', member: null };
    }
    return null;
  }

  const levels = { viewer: 1, contributor: 2, admin: 3, owner: 4 };
  if ((levels[member.role] || 0) >= (levels[requiredRole] || 0)) {
    return { isOwner: false, role: member.role, member };
  }
  return null;
}

// GET /api/workspaces/:wid/members
exports.listMembers = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const wid = String(req.params?.wid || '').trim();
    const workspace = await Workspace.findOne({ wid }).lean();
    if (!workspace) return res.status(404).json({ message: 'Workspace not found' });

    // Check if user has access to this workspace
    const access = await checkWorkspaceRole(userId, workspace._id, 'viewer');
    if (!access) return res.status(403).json({ message: 'Access denied' });

    // Get all members
    const members = await WorkspaceMember.find({ workspace: workspace._id })
      .populate('user', 'firstName lastName fullName email avatarUrl')
      .populate('invitedBy', 'firstName lastName fullName email')
      .sort({ role: 1, createdAt: 1 })
      .lean();

    // If current user is workspace owner (legacy) and not in members, add them
    const isLegacyOwner = String(workspace.user) === String(userId);
    const ownerInMembers = members.some((m) => String(m.user?._id) === String(userId) && m.role === 'owner');

    let finalMembers = members;
    if (isLegacyOwner && !ownerInMembers) {
      const ownerUser = await User.findById(userId).select('firstName lastName fullName email avatarUrl').lean();
      finalMembers = [
        {
          _id: 'legacy-owner',
          workspace: workspace._id,
          user: ownerUser,
          email: ownerUser?.email,
          role: 'owner',
          status: 'active',
          isLegacyOwner: true,
        },
        ...members,
      ];
    }

    return res.json({ members: finalMembers });
  } catch (err) {
    next(err);
  }
};

// POST /api/workspaces/:wid/members/invite
exports.inviteMember = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const wid = String(req.params?.wid || '').trim();
    const workspace = await Workspace.findOne({ wid }).lean();
    if (!workspace) return res.status(404).json({ message: 'Workspace not found' });

    // Only admins and owners can invite
    const access = await checkWorkspaceRole(userId, workspace._id, 'admin');
    if (!access) return res.status(403).json({ message: 'Only admins can invite members' });

    const { email, role = 'viewer' } = req.body || {};
    const normalizedEmail = String(email || '').toLowerCase().trim();

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      return res.status(400).json({ message: 'Valid email is required' });
    }

    // Validate role
    const validRoles = ['admin', 'contributor', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be admin, contributor, or viewer' });
    }

    // Check if already a member
    const existing = await WorkspaceMember.findOne({
      workspace: workspace._id,
      email: normalizedEmail,
    });

    if (existing) {
      if (existing.status === 'active') {
        return res.status(409).json({ message: 'User is already a member of this workspace' });
      }
      if (existing.status === 'pending') {
        return res.status(409).json({ message: 'Invite already sent to this email' });
      }
      // If removed or declined, allow re-invite by updating existing record
      existing.status = 'pending';
      existing.role = role;
      existing.inviteToken = WorkspaceMember.generateInviteToken();
      existing.inviteTokenExpires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      existing.invitedBy = userId;
      existing.invitedAt = new Date();
      await existing.save();

      // Send invite email
      await sendInviteEmail(existing, workspace, userId);

      return res.json({ member: existing, message: 'Invite resent' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail }).select('_id').lean();

    // Create new member record
    const inviteToken = WorkspaceMember.generateInviteToken();
    const member = await WorkspaceMember.create({
      workspace: workspace._id,
      user: existingUser?._id || null,
      email: normalizedEmail,
      role,
      status: 'pending',
      inviteToken,
      inviteTokenExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      invitedBy: userId,
      invitedAt: new Date(),
    });

    // Send invite email
    await sendInviteEmail(member, workspace, userId);

    return res.status(201).json({ member, message: 'Invite sent' });
  } catch (err) {
    next(err);
  }
};

// Helper to send invite email
async function sendInviteEmail(member, workspace, invitedByUserId) {
  try {
    const inviter = await User.findById(invitedByUserId).select('firstName lastName fullName email').lean();
    const inviterName = inviter?.fullName || `${inviter?.firstName || ''} ${inviter?.lastName || ''}`.trim() || 'Someone';

    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const appUrl = process.env.FRONTEND_URL || 'https://app.plangenie.ai';
    const inviteUrl = `${appUrl}/workspace-invite?token=${member.inviteToken}`;

    await resend.emails.send({
      from,
      to: member.email,
      subject: `You've been invited to join ${workspace.name} on Plan Genie`,
      html: `
        <p>Hi,</p>
        <p><strong>${inviterName}</strong> has invited you to join <strong>${workspace.name}</strong> on Plan Genie as a <strong>${member.role}</strong>.</p>
        <p>Click the button below to accept the invitation:</p>
        <p style="margin: 24px 0;">
          <a href="${inviteUrl}" style="background-color: #1D4374; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
            Accept Invitation
          </a>
        </p>
        <p>Or copy and paste this link: ${inviteUrl}</p>
        <p>This invitation expires in 7 days.</p>
        <p>Best,<br>The Plan Genie Team</p>
      `,
      text: `${inviterName} has invited you to join ${workspace.name} on Plan Genie as a ${member.role}. Accept the invitation: ${inviteUrl}`,
    });
  } catch (err) {
    console.error('[inviteMember] Failed to send invite email:', err?.message || err);
  }
}

// PATCH /api/workspaces/:wid/members/:memberId/role
exports.updateMemberRole = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const wid = String(req.params?.wid || '').trim();
    const memberId = String(req.params?.memberId || '').trim();
    const workspace = await Workspace.findOne({ wid }).lean();
    if (!workspace) return res.status(404).json({ message: 'Workspace not found' });

    // Only admins and owners can change roles
    const access = await checkWorkspaceRole(userId, workspace._id, 'admin');
    if (!access) return res.status(403).json({ message: 'Only admins can change member roles' });

    const { role } = req.body || {};
    const validRoles = ['admin', 'contributor', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const member = await WorkspaceMember.findOne({
      _id: memberId,
      workspace: workspace._id,
    });

    if (!member) return res.status(404).json({ message: 'Member not found' });

    // Cannot change owner's role
    if (member.role === 'owner') {
      return res.status(403).json({ message: 'Cannot change workspace owner role' });
    }

    // Cannot promote to owner
    if (role === 'owner') {
      return res.status(403).json({ message: 'Cannot promote to owner' });
    }

    member.role = role;
    await member.save();

    return res.json({ member, message: 'Role updated' });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/workspaces/:wid/members/:memberId
exports.removeMember = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const wid = String(req.params?.wid || '').trim();
    const memberId = String(req.params?.memberId || '').trim();
    const workspace = await Workspace.findOne({ wid }).lean();
    if (!workspace) return res.status(404).json({ message: 'Workspace not found' });

    // Only admins and owners can remove members
    const access = await checkWorkspaceRole(userId, workspace._id, 'admin');
    if (!access) return res.status(403).json({ message: 'Only admins can remove members' });

    const member = await WorkspaceMember.findOne({
      _id: memberId,
      workspace: workspace._id,
    });

    if (!member) return res.status(404).json({ message: 'Member not found' });

    // Cannot remove owner
    if (member.role === 'owner') {
      return res.status(403).json({ message: 'Cannot remove workspace owner' });
    }

    member.status = 'removed';
    await member.save();

    return res.json({ message: 'Member removed' });
  } catch (err) {
    next(err);
  }
};

// POST /api/workspace-invite/accept
exports.acceptInvite = async (req, res, next) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ message: 'Invite token is required' });

    const member = await WorkspaceMember.findOne({
      inviteToken: token,
      status: 'pending',
    });

    if (!member) {
      return res.status(404).json({ message: 'Invalid or expired invite' });
    }

    if (member.inviteTokenExpires && member.inviteTokenExpires < new Date()) {
      return res.status(400).json({ message: 'Invite has expired' });
    }

    // If user is logged in, use their ID
    const userId = req.user?.id;
    if (userId) {
      const user = await User.findById(userId).select('email').lean();
      if (user && user.email.toLowerCase() !== member.email.toLowerCase()) {
        return res.status(400).json({ message: 'This invite was sent to a different email address' });
      }
      member.user = userId;
    } else if (!member.user) {
      // User not logged in and no user linked - they need to sign up first
      return res.status(400).json({
        message: 'Please sign up or log in first',
        requiresAuth: true,
        email: member.email,
      });
    }

    member.status = 'active';
    member.acceptedAt = new Date();
    member.inviteToken = null;
    member.inviteTokenExpires = null;
    await member.save();

    const workspace = await Workspace.findById(member.workspace).select('wid name').lean();

    return res.json({
      message: 'Invite accepted',
      workspace: workspace,
      role: member.role,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/workspace-invite/info?token=xxx
exports.getInviteInfo = async (req, res, next) => {
  try {
    const token = req.query?.token;
    if (!token) return res.status(400).json({ message: 'Token is required' });

    const member = await WorkspaceMember.findOne({
      inviteToken: token,
      status: 'pending',
    }).populate('invitedBy', 'firstName lastName fullName');

    if (!member) {
      return res.status(404).json({ message: 'Invalid or expired invite' });
    }

    if (member.inviteTokenExpires && member.inviteTokenExpires < new Date()) {
      return res.status(400).json({ message: 'Invite has expired' });
    }

    const workspace = await Workspace.findById(member.workspace).select('name description industry').lean();

    return res.json({
      workspace: workspace,
      role: member.role,
      email: member.email,
      invitedBy: member.invitedBy,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/workspaces/:wid/members/:memberId/ai-permissions
exports.getMemberAIPermissions = async (req, res, next) => {
  try {
    const memberId = String(req.params?.memberId || '').trim();

    const member = await WorkspaceMember.findById(memberId)
      .select('role permissions user email')
      .populate('user', 'firstName lastName fullName email')
      .lean();

    if (!member) return res.status(404).json({ message: 'Member not found' });

    // Calculate effective permissions based on role and overrides
    const roleDefault = member.role !== 'viewer';
    const canUseAI = member.permissions?.canUseAI ?? roleDefault;

    const aiFeatures = member.permissions?.aiFeatures || {};
    const effectiveFeatures = {
      visionSuggestions: aiFeatures.visionSuggestions ?? canUseAI,
      valueSuggestions: aiFeatures.valueSuggestions ?? canUseAI,
      swotAnalysis: aiFeatures.swotAnalysis ?? canUseAI,
      marketAnalysis: aiFeatures.marketAnalysis ?? canUseAI,
      financialSuggestions: aiFeatures.financialSuggestions ?? canUseAI,
      actionPlanSuggestions: aiFeatures.actionPlanSuggestions ?? canUseAI,
      coreProjectSuggestions: aiFeatures.coreProjectSuggestions ?? canUseAI,
    };

    return res.json({
      member: {
        _id: member._id,
        user: member.user,
        email: member.email,
        role: member.role,
      },
      aiPermissions: {
        canUseAI: member.permissions?.canUseAI, // raw value (may be null)
        aiFeatures: member.permissions?.aiFeatures || {},
      },
      effective: {
        canUseAI,
        aiFeatures: effectiveFeatures,
      },
      roleDefault,
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/workspaces/:wid/members/:memberId/ai-permissions
exports.updateMemberAIPermissions = async (req, res, next) => {
  try {
    const memberId = String(req.params?.memberId || '').trim();

    const member = await WorkspaceMember.findById(memberId);
    if (!member) return res.status(404).json({ message: 'Member not found' });

    // Cannot modify owner's permissions
    if (member.role === 'owner') {
      return res.status(403).json({ message: 'Cannot modify owner permissions' });
    }

    const { canUseAI, aiFeatures } = req.body || {};

    // Initialize permissions object if needed
    member.permissions = member.permissions || {};

    // Update master AI toggle (can be true, false, or null to reset to role default)
    if (canUseAI !== undefined) {
      member.permissions.canUseAI = canUseAI === null ? undefined : canUseAI;
    }

    // Update individual AI features
    if (aiFeatures && typeof aiFeatures === 'object') {
      member.permissions.aiFeatures = member.permissions.aiFeatures || {};

      const allowedFeatures = [
        'visionSuggestions',
        'valueSuggestions',
        'swotAnalysis',
        'marketAnalysis',
        'financialSuggestions',
        'actionPlanSuggestions',
        'coreProjectSuggestions',
      ];

      for (const key of allowedFeatures) {
        if (aiFeatures[key] !== undefined) {
          member.permissions.aiFeatures[key] = aiFeatures[key] === null ? undefined : aiFeatures[key];
        }
      }
    }

    member.markModified('permissions');
    await member.save();

    // Return updated permissions
    const roleDefault = member.role !== 'viewer';
    const effectiveCanUseAI = member.permissions?.canUseAI ?? roleDefault;

    return res.json({
      message: 'AI permissions updated',
      aiPermissions: {
        canUseAI: member.permissions?.canUseAI,
        aiFeatures: member.permissions?.aiFeatures || {},
      },
      effective: {
        canUseAI: effectiveCanUseAI,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports.checkWorkspaceRole = checkWorkspaceRole;
