const mongoose = require('mongoose');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Collaboration = require('../models/Collaboration');
const SystemLog = require('../models/SystemLog');
const Onboarding = require('../models/Onboarding');
const Workspace = require('../models/Workspace');
const RevenueStream = require('../models/RevenueStream');
const FinancialBaseline = require('../models/FinancialBaseline');
const TeamMember = require('../models/TeamMember');
const Department = require('../models/Department');

function toName(u) {
  const name = (u.fullName && String(u.fullName).trim()) || [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || undefined;
}

async function log(event, severity = 'info', details = '', meta = undefined) {
  try { await SystemLog.create({ event, severity, details, meta }); } catch {}
}

exports.me = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  return res.json({ user: user.toSafeJSON() });
};

exports.overview = async (_req, res) => {
  const totalUsers = await User.countDocuments({});
  const now = new Date();
  const activeSince = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const activeUsers = await User.countDocuments({ lastActiveAt: { $gte: activeSince } });
  const sevenDays = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const newSignups = await User.countDocuments({ createdAt: { $gte: sevenDays } });

  const trials = await Subscription.countDocuments({ planType: 'Trial' });
  const paid = await Subscription.countDocuments({ planType: { $in: ['Pro','Enterprise'] }, paymentStatus: 'active' });
  const denom = trials + paid;
  const conversionRate = denom > 0 ? paid / denom : 0;

  // Growth series: last 8 weeks
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = new Date(now.getTime() - (7 * i) * 24 * 60 * 60 * 1000);
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start, end };
  }).reverse();
  const growthSeries = [];
  for (const w of weeks) {
    const count = await User.countDocuments({ createdAt: { $lt: w.end } });
    growthSeries.push({ date: w.end.toISOString(), count });
  }

  const inactiveUsers = Math.max(0, totalUsers - activeUsers);
  const recent = await User.find({}).sort({ createdAt: -1 }).limit(5).lean().exec();
  const recentUsers = recent.map((u) => ({ _id: String(u._id), name: toName(u) || '', email: u.email, createdAt: u.createdAt }));

  return res.json({
    totalUsers,
    activeUsers,
    newSignups,
    conversionRate,
    growthSeries,
    activeBreakdown: { active: activeUsers, inactive: inactiveUsers },
    recentUsers,
  });
};

exports.listUsers = async (req, res) => {
  const { status, q, planType } = req.query || {};
  const and = [];
  if (status === 'suspended') and.push({ status: 'suspended' });
  if (status === 'active') and.push({ status: 'active' });
  if (status === 'inactive') {
    const activeSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    and.push({ $or: [ { lastActiveAt: { $lt: activeSince } }, { lastActiveAt: { $exists: false } } ] });
  }
  if (q && String(q).trim()) {
    const s = String(q).trim();
    and.push({ $or: [ { email: { $regex: s, $options: 'i' } }, { fullName: { $regex: s, $options: 'i' } }, { firstName: { $regex: s, $options: 'i' } }, { lastName: { $regex: s, $options: 'i' } } ] });
  }
  let where = and.length ? { $and: and } : {};

  // Optional planType filter
  if (planType && ['Free','Trial','Pro','Enterprise'].includes(String(planType))) {
    const subRows = await Subscription.find({ planType: String(planType) }).select('user').lean().exec();
    const ids = subRows.map((s) => s.user).filter(Boolean);
    where = { $and: [ where, { _id: { $in: ids } } ] };
  }

  const users = await User.find(where).sort({ createdAt: -1 }).limit(500).lean().exec();
  const userIds = users.map((u) => u._id);
  const subs = await Subscription.find({ user: { $in: userIds } }).lean().exec();
  const subMap = new Map(subs.map((s) => [String(s.user), s]));

  const items = users.map((u) => ({
    _id: String(u._id),
    fullName: u.fullName,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    companyName: u.companyName,
    lastActiveAt: u.lastActiveAt,
    status: u.status,
    onboardingDone: !!u.onboardingDone,
    // onboardingDetailCompleted is now per-workspace (stored in Onboarding model)
    planType: subMap.get(String(u._id))?.planType || 'Free',
  }));
  return res.json({ items });
};

exports.getUser = async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid id' });
  const user = await User.findById(id).lean().exec();
  if (!user) return res.status(404).json({ message: 'Not found' });
  const sub = await Subscription.findOne({ user: id }).lean().exec();
  return res.json({ user: { ...user, _id: String(user._id), subscription: sub ? { planType: sub.planType, renewalDate: sub.renewalDate, paymentStatus: sub.paymentStatus, amountCents: sub.amountCents } : null } });
};

/**
 * Get comprehensive user data - all related records across models
 */
exports.getUserFullData = async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'Invalid id' });

  const user = await User.findById(id).lean().exec();
  if (!user) return res.status(404).json({ message: 'Not found' });

  // Fetch all related data in parallel
  const [
    subscription,
    workspaces,
    onboardings,
    revenueStreams,
    financialBaselines,
    teamMembers,
    departments,
    collaborationsAsOwner,
    collaborationsAsViewer,
  ] = await Promise.all([
    Subscription.findOne({ user: id }).lean().exec(),
    Workspace.find({ user: id }).lean().exec(),
    Onboarding.find({ user: id }).lean().exec(),
    RevenueStream.find({ user: id }).lean().exec(),
    FinancialBaseline.find({ user: id }).lean().exec(),
    TeamMember.find({ user: id }).lean().exec(),
    Department.find({ user: id }).lean().exec(),
    Collaboration.find({ owner: id }).populate('viewer', 'email fullName').lean().exec(),
    Collaboration.find({ viewer: id }).populate('owner', 'email fullName').lean().exec(),
  ]);

  // Build workspace map for onboarding data
  const workspaceMap = new Map(workspaces.map(w => [String(w._id), w]));

  // Enrich onboarding data with workspace names
  const enrichedOnboardings = onboardings.map(ob => {
    const ws = ob.workspace ? workspaceMap.get(String(ob.workspace)) : null;
    return {
      ...ob,
      _id: String(ob._id),
      workspaceName: ws?.name || 'Unknown Workspace',
      workspaceWid: ws?.wid || null,
    };
  });

  // Format response
  return res.json({
    user: {
      _id: String(user._id),
      email: user.email,
      fullName: user.fullName,
      firstName: user.firstName,
      lastName: user.lastName,
      companyName: user.companyName,
      status: user.status,
      isVerified: user.isVerified,
      isAdmin: user.isAdmin,
      isCollaborator: user.isCollaborator,
      onboardingDone: user.onboardingDone,
      lastActiveAt: user.lastActiveAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
    subscription: subscription ? {
      _id: String(subscription._id),
      planType: subscription.planType,
      billingCycle: subscription.billingCycle,
      paymentStatus: subscription.paymentStatus,
      renewalDate: subscription.renewalDate,
      amountCents: subscription.amountCents,
      stripeCustomerId: subscription.stripeCustomerId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      trialEndsAt: subscription.trialEndsAt,
      createdAt: subscription.createdAt,
    } : null,
    workspaces: workspaces.map(w => ({
      _id: String(w._id),
      wid: w.wid,
      name: w.name,
      defaultWorkspace: w.defaultWorkspace,
      lastActivityAt: w.lastActivityAt,
      createdAt: w.createdAt,
    })),
    onboardings: enrichedOnboardings,
    revenueStreams: revenueStreams.map(rs => ({
      _id: String(rs._id),
      name: rs.name,
      type: rs.type,
      description: rs.description,
      isActive: rs.isActive,
      metrics: rs.normalized || rs.metrics || {},
      stability: rs.normalized?.stability || 'moderate',
      workspaceId: rs.workspace ? String(rs.workspace) : null,
      createdAt: rs.createdAt,
    })),
    financialBaselines: financialBaselines.map(fb => ({
      _id: String(fb._id),
      workRelatedCosts: fb.workRelatedCosts,
      fixedCosts: fb.fixedCosts,
      cash: fb.cash,
      metrics: fb.metrics,
      workspaceId: fb.workspace ? String(fb.workspace) : null,
      createdAt: fb.createdAt,
      updatedAt: fb.updatedAt,
    })),
    teamMembers: teamMembers.map(tm => ({
      _id: String(tm._id),
      name: tm.name,
      email: tm.email,
      role: tm.role,
      department: tm.department,
      status: tm.status,
      workspaceId: tm.workspace ? String(tm.workspace) : null,
    })),
    departments: departments.map(d => ({
      _id: String(d._id),
      name: d.name,
      status: d.status,
      owner: d.owner,
      dueDate: d.dueDate,
      progress: d.progress,
      workspaceId: d.workspace ? String(d.workspace) : null,
    })),
    collaborations: {
      asOwner: collaborationsAsOwner.map(c => ({
        _id: String(c._id),
        viewerEmail: c.viewer?.email || c.email,
        viewerName: c.viewer?.fullName || null,
        status: c.status,
        permissions: c.permissions,
        createdAt: c.createdAt,
      })),
      asViewer: collaborationsAsViewer.map(c => ({
        _id: String(c._id),
        ownerEmail: c.owner?.email || null,
        ownerName: c.owner?.fullName || null,
        status: c.status,
        permissions: c.permissions,
        createdAt: c.createdAt,
      })),
    },
    summary: {
      workspaceCount: workspaces.length,
      revenueStreamCount: revenueStreams.length,
      teamMemberCount: teamMembers.length,
      departmentCount: departments.length,
      collaboratorCount: collaborationsAsOwner.length,
      viewingCount: collaborationsAsViewer.length,
    },
  });
};

exports.updateUserStatus = async (req, res) => {
  const id = req.params.id;
  const status = String(req.body?.status || '').trim();
  if (!['active','suspended'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
  const user = await User.findByIdAndUpdate(id, { status }, { new: true });
  if (!user) return res.status(404).json({ message: 'Not found' });
  await log('User status updated', 'info', `${user.email} -> ${status}`, { userId: String(user._id), status });
  return res.json({ ok: true, status: user.status });
};

exports.deleteUser = async (req, res) => {
  const id = req.params.id;
  // Perform cascading cleanup in a best-effort manner
  const session = await User.startSession();
  try {
    await session.withTransaction(async () => {
      const user = await User.findById(id).session(session);
      if (!user) return res.status(404).json({ message: 'Not found' });

      // Delete collaborations where this user is the owner, or the collaborator/viewer
      try {
        await Collaboration.deleteMany({ $or: [{ owner: id }, { viewer: id }, { collaborator: id }] }).session(session);
      } catch {}

      // Delete all related data - best effort cleanup
      // Each model is loaded dynamically to avoid import issues if some don't exist
      const modelsToClean = [
        'Onboarding',
        'Notification',
        'NotificationSettings',
        'Subscription',
        'SubscriptionHistory',
        'RefreshToken',
        'Workspace',
        'Journey',
        'Dashboard',
        'Financials',
        'FinancialSnapshot',
        'TeamMember',
        'Department',
        'AgentCache',
        'PriorityCache',
        'ReviewSession',
        'Decision',
        'Assumption',
        'Scenario',
        'Plan',
        'PlanSection',
      ];

      for (const modelName of modelsToClean) {
        try {
          const Model = require(`../models/${modelName}`);
          await Model.deleteMany({ user: id }).session(session);
        } catch (_modelErr) {
          // Model might not exist or other non-fatal error - continue
        }
      }

      // Finally delete the user
      await User.deleteOne({ _id: id }).session(session);
      await log('User deleted', 'warning', user.email, { userId: String(user._id) });
      return res.json({ ok: true });
    });
  } catch (e) {
    return res.status(500).json({ message: e?.message || 'Failed to delete user' });
  } finally {
    session.endSession();
  }
};

exports.subscriptions = async (_req, res) => {
  const items = await Subscription.find({}).populate('user', 'email fullName firstName lastName').lean().exec();
  const totalPaid = items.filter((s) => (s.planType === 'Pro' || s.planType === 'Enterprise') && s.paymentStatus === 'active').length;
  const trials = items.filter((s) => s.planType === 'Trial').length;
  const denom = totalPaid + trials;
  const conversionRate = denom > 0 ? totalPaid / denom : 0;
  const estMonthlyRevenueCents = items.filter((s)=> s.paymentStatus === 'active').reduce((a, s) => a + (s.amountCents || 0), 0);
  const mapped = items.map((s) => ({
    _id: String(s._id),
    user: { _id: String(s.user?._id || ''), email: s.user?.email || '', name: toName(s.user || {}) },
    planType: s.planType,
    renewalDate: s.renewalDate,
    paymentStatus: s.paymentStatus,
    amountCents: s.amountCents,
  }));
  return res.json({ totalPaid, trials, conversionRate, estMonthlyRevenueCents, items: mapped });
};

exports.logs = async (_req, res) => {
  const items = await SystemLog.find({}).sort({ time: -1 }).limit(200).lean().exec();
  const mapped = items.map((l) => ({ _id: String(l._id), time: l.time || l.createdAt, event: l.event, severity: l.severity, details: l.details }));
  return res.json({ items: mapped });
};
