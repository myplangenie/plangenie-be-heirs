const mongoose = require('mongoose');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const Collaboration = require('../models/Collaboration');
const SystemLog = require('../models/SystemLog');
const Onboarding = require('../models/Onboarding');
const Workspace = require('../models/Workspace');
const RevenueStream = require('../models/RevenueStream');
const FinancialBaseline = require('../models/FinancialBaseline');
const Department = require('../models/Department');
const Product = require('../models/Product');
const VisionGoal = require('../models/VisionGoal');
const Competitor = require('../models/Competitor');
const SwotEntry = require('../models/SwotEntry');
const OrgPosition = require('../models/OrgPosition');
const CoreProject = require('../models/CoreProject');
const DepartmentProject = require('../models/DepartmentProject');
const PromoCode = require('../models/PromoCode');
const { getWorkspaceFields } = require('../services/workspaceFieldService');

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
    departments,
    collaborationsAsOwner,
    collaborationsAsViewer,
    products,
    visionGoals,
    competitors,
    swotEntries,
    orgPositions,
    coreProjects,
    departmentProjects,
  ] = await Promise.all([
    Subscription.findOne({ user: id }).lean().exec(),
    Workspace.find({ user: id }).lean().exec(),
    Onboarding.find({ user: id }).lean().exec(),
    RevenueStream.find({ user: id }).lean().exec(),
    FinancialBaseline.find({ user: id }).lean().exec(),
    Department.find({ user: id }).lean().exec(),
    Collaboration.find({ owner: id }).populate('viewer', 'email fullName').lean().exec(),
    Collaboration.find({ viewer: id }).populate('owner', 'email fullName').lean().exec(),
    Product.find({ user: id, isDeleted: { $ne: true } }).sort({ order: 1 }).lean().exec(),
    VisionGoal.find({ user: id, isDeleted: { $ne: true } }).sort({ goalType: 1, order: 1 }).lean().exec(),
    Competitor.find({ user: id, isDeleted: { $ne: true } }).sort({ order: 1 }).lean().exec(),
    SwotEntry.find({ user: id, isDeleted: { $ne: true } }).sort({ entryType: 1, order: 1 }).lean().exec(),
    OrgPosition.find({ user: id, isDeleted: { $ne: true } }).sort({ order: 1 }).lean().exec(),
    CoreProject.find({ user: id, isDeleted: { $ne: true } }).sort({ order: 1 }).lean().exec(),
    DepartmentProject.find({ user: id, isDeleted: { $ne: true } }).sort({ departmentKey: 1, order: 1 }).lean().exec(),
  ]);

  // Build workspace map for onboarding data
  const workspaceMap = new Map(workspaces.map(w => [String(w._id), w]));

  // Fetch workspace fields for each workspace (for admin view)
  const workspaceFieldsMap = new Map();
  for (const ws of workspaces) {
    const fields = await getWorkspaceFields(ws._id);
    workspaceFieldsMap.set(String(ws._id), fields);
  }

  // Enrich onboarding data with workspace names and workspace fields
  const enrichedOnboardings = onboardings.map(ob => {
    const ws = ob.workspace ? workspaceMap.get(String(ob.workspace)) : null;
    // Read from Workspace.fields instead of Onboarding.answers
    const answers = ob.workspace ? workspaceFieldsMap.get(String(ob.workspace)) || {} : {};
    return {
      _id: String(ob._id),
      workspaceName: ws?.name || 'Unknown Workspace',
      workspaceWid: ws?.wid || null,
      userProfile: ob.userProfile,
      businessProfile: ob.businessProfile,
      onboardingCompleted: ob.onboardingCompleted,
      onboardingDetailCompleted: ob.onboardingDetailCompleted,
      // Workspace fields (scalar values)
      workspaceFields: {
        // Vision & Purpose
        ubp: answers.ubp || null,
        purpose: answers.purpose || null,
        bhag: answers.visionBhag || answers.bhag || null,
        missionStatement: answers.missionStatement || null,
        identitySummary: answers.identitySummary || null,
        // Values & Culture
        valuesCore: answers.valuesCore || null,
        cultureFeeling: answers.cultureFeeling || null,
        // Market
        targetCustomer: answers.marketCustomer || answers.targetCustomer || null,
        partners: answers.marketPartners || answers.partners || null,
        competitorsNotes: answers.competitorsNotes || answers.compNotes || null,
        // Financial inputs
        finSalesVolume: answers.finSalesVolume || null,
        finAvgUnitCost: answers.finAvgUnitCost || null,
        finTargetProfitMarginPct: answers.finTargetProfitMarginPct || null,
        finStartingCash: answers.finStartingCash || null,
        finFixedOperatingCosts: answers.finFixedOperatingCosts || null,
        finPayrollCost: answers.finPayrollCost || null,
        finMarketingSalesSpend: answers.finMarketingSalesSpend || null,
        finSalesGrowthPct: answers.finSalesGrowthPct || null,
      },
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
    teamMembers: orgPositions.map(tm => ({
      _id: String(tm._id),
      name: tm.name,
      email: tm.email,
      role: tm.position,
      department: tm.departmentLabel || tm.department,
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
    products: products.map(p => ({
      _id: String(p._id),
      name: p.name,
      description: p.description,
      pricing: p.pricing,
      price: p.price,
      unitCost: p.unitCost,
      monthlyVolume: p.monthlyVolume,
      order: p.order,
      workspaceId: p.workspace ? String(p.workspace) : null,
      createdAt: p.createdAt,
    })),
    visionGoals: visionGoals.map(vg => ({
      _id: String(vg._id),
      goalType: vg.goalType,
      text: vg.text,
      notes: vg.notes,
      status: vg.status,
      order: vg.order,
      workspaceId: vg.workspace ? String(vg.workspace) : null,
      createdAt: vg.createdAt,
    })),
    competitors: competitors.map(c => ({
      _id: String(c._id),
      name: c.name,
      advantage: c.advantage,
      website: c.website,
      notes: c.notes,
      threatLevel: c.threatLevel,
      order: c.order,
      workspaceId: c.workspace ? String(c.workspace) : null,
      createdAt: c.createdAt,
    })),
    swotEntries: swotEntries.map(s => ({
      _id: String(s._id),
      entryType: s.entryType,
      text: s.text,
      priority: s.priority,
      notes: s.notes,
      order: s.order,
      workspaceId: s.workspace ? String(s.workspace) : null,
      createdAt: s.createdAt,
    })),
    orgPositions: orgPositions.map(op => ({
      _id: String(op._id),
      position: op.position,
      role: op.role,
      name: op.name,
      department: op.department,
      parentId: op.parentId ? String(op.parentId) : null,
      order: op.order,
      workspaceId: op.workspace ? String(op.workspace) : null,
      createdAt: op.createdAt,
    })),
    coreProjects: coreProjects.map(cp => ({
      _id: String(cp._id),
      title: cp.title,
      description: cp.description,
      goal: cp.goal,
      cost: cp.cost,
      dueWhen: cp.dueWhen,
      priority: cp.priority,
      ownerId: cp.ownerId,
      ownerName: cp.ownerName,
      linkedGoals: cp.linkedGoals,
      departments: cp.departments,
      deliverables: cp.deliverables,
      order: cp.order,
      workspaceId: cp.workspace ? String(cp.workspace) : null,
      createdAt: cp.createdAt,
    })),
    departmentProjects: departmentProjects.map(dp => ({
      _id: String(dp._id),
      departmentKey: dp.departmentKey,
      title: dp.title,
      goal: dp.goal,
      milestone: dp.milestone,
      resources: dp.resources,
      dueWhen: dp.dueWhen,
      cost: dp.cost,
      firstName: dp.firstName,
      lastName: dp.lastName,
      ownerId: dp.ownerId,
      linkedCoreProject: dp.linkedCoreProject ? String(dp.linkedCoreProject) : null,
      linkedGoal: dp.linkedGoal,
      deliverables: dp.deliverables,
      order: dp.order,
      workspaceId: dp.workspace ? String(dp.workspace) : null,
      createdAt: dp.createdAt,
    })),
    summary: {
      workspaceCount: workspaces.length,
      revenueStreamCount: revenueStreams.length,
      teamMemberCount: orgPositions.length,
      departmentCount: departments.length,
      collaboratorCount: collaborationsAsOwner.length,
      viewingCount: collaborationsAsViewer.length,
      productCount: products.length,
      visionGoalCount: visionGoals.length,
      competitorCount: competitors.length,
      swotEntryCount: swotEntries.length,
      orgPositionCount: orgPositions.length,
      coreProjectCount: coreProjects.length,
      departmentProjectCount: departmentProjects.length,
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
        'OrgPosition',
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

exports.bulkDeleteUsers = async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: 'ids array is required' });
  }

  // Validate all IDs
  const invalidIds = ids.filter(id => !mongoose.Types.ObjectId.isValid(id));
  if (invalidIds.length > 0) {
    return res.status(400).json({ message: `Invalid IDs: ${invalidIds.join(', ')}` });
  }

  console.log(`[bulkDeleteUsers] Attempting to delete ${ids.length} users:`, ids);

  // First, verify which users actually exist
  const existingUsers = await User.find({ _id: { $in: ids } }).select('_id email').lean().exec();
  const existingIds = new Set(existingUsers.map(u => String(u._id)));

  console.log(`[bulkDeleteUsers] Found ${existingUsers.length} existing users out of ${ids.length} requested`);

  const results = { deleted: [], failed: [] };

  // Mark non-existent users as failed immediately
  for (const id of ids) {
    if (!existingIds.has(id)) {
      console.log(`[bulkDeleteUsers] User ${id} not found in database`);
      results.failed.push({ id, reason: 'Not found' });
    }
  }

  // Models to clean for each user
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
    'OrgPosition',
    'Department',
    'AgentCache',
    'PriorityCache',
    'ReviewSession',
    'Decision',
    'Assumption',
    'Scenario',
    'Plan',
    'PlanSection',
    'Product',
    'VisionGoal',
    'Competitor',
    'SwotEntry',
    'OrgPosition',
    'CoreProject',
    'DepartmentProject',
    'RevenueStream',
    'FinancialBaseline',
  ];

  // Only process users that exist
  for (const user of existingUsers) {
    const id = String(user._id);
    try {
      // Delete collaborations
      try {
        await Collaboration.deleteMany({ $or: [{ owner: id }, { viewer: id }, { collaborator: id }] });
      } catch {}

      // Delete all related data
      for (const modelName of modelsToClean) {
        try {
          const Model = require(`../models/${modelName}`);
          await Model.deleteMany({ user: id });
        } catch {}
      }

      // Delete the user
      await User.deleteOne({ _id: id });
      await log('User deleted (bulk)', 'warning', user.email, { userId: id });
      console.log(`[bulkDeleteUsers] Successfully deleted user ${id} (${user.email})`);
      results.deleted.push({ id, email: user.email });
    } catch (e) {
      console.error(`[bulkDeleteUsers] Error deleting user ${id}:`, e?.message || e);
      results.failed.push({ id, reason: e?.message || 'Unknown error' });
    }
  }

  return res.json({
    ok: true,
    deletedCount: results.deleted.length,
    failedCount: results.failed.length,
    deleted: results.deleted,
    failed: results.failed,
  });
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

// ==================== PROMO CODES ====================

// List all promo codes
exports.listPromoCodes = async (_req, res) => {
  try {
    const items = await PromoCode.find({}).sort({ createdAt: -1 }).lean().exec();
    const mapped = items.map((p) => ({
      _id: String(p._id),
      code: p.code,
      type: p.type,
      planType: p.planType,
      durationDays: p.durationDays,
      discountPercent: p.discountPercent,
      usageLimit: p.usageLimit,
      usageCount: p.usageCount,
      expiresAt: p.expiresAt,
      isActive: p.isActive,
      description: p.description,
      redemptionCount: p.redemptions?.length || 0,
      createdAt: p.createdAt,
    }));
    return res.json({ items: mapped });
  } catch (err) {
    console.error('listPromoCodes error:', err);
    return res.status(500).json({ message: 'Failed to list promo codes' });
  }
};

// Get a single promo code with redemptions
exports.getPromoCode = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }
    const promoCode = await PromoCode.findById(id)
      .populate('redemptions.user', 'email fullName firstName lastName')
      .lean()
      .exec();
    if (!promoCode) {
      return res.status(404).json({ message: 'Promo code not found' });
    }
    return res.json({
      promoCode: {
        ...promoCode,
        _id: String(promoCode._id),
        redemptions: (promoCode.redemptions || []).map((r) => ({
          user: r.user ? {
            _id: String(r.user._id),
            email: r.user.email,
            name: r.user.fullName || [r.user.firstName, r.user.lastName].filter(Boolean).join(' '),
          } : null,
          redeemedAt: r.redeemedAt,
        })),
      },
    });
  } catch (err) {
    console.error('getPromoCode error:', err);
    return res.status(500).json({ message: 'Failed to get promo code' });
  }
};

// Create a new promo code
exports.createPromoCode = async (req, res) => {
  try {
    const {
      code,
      type = 'free_trial',
      planType = 'Lite',
      durationDays = 14,
      discountPercent = 100,
      usageLimit = null,
      expiresAt = null,
      description = '',
    } = req.body;

    if (!code || !String(code).trim()) {
      return res.status(400).json({ message: 'Code is required' });
    }

    const normalizedCode = String(code).trim().toUpperCase();

    // Check if code already exists
    const existing = await PromoCode.findOne({ code: normalizedCode });
    if (existing) {
      return res.status(400).json({ message: 'A promo code with this name already exists' });
    }

    const promoCode = await PromoCode.create({
      code: normalizedCode,
      type,
      planType,
      durationDays: Number(durationDays) || 14,
      discountPercent: Number(discountPercent) || 100,
      usageLimit: usageLimit ? Number(usageLimit) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      description: String(description || '').trim(),
      isActive: true,
    });

    await log('Promo code created', 'info', `Code: ${normalizedCode}`, {
      promoCodeId: String(promoCode._id),
      type,
      planType,
      durationDays,
    });

    return res.json({
      ok: true,
      promoCode: {
        _id: String(promoCode._id),
        code: promoCode.code,
        type: promoCode.type,
        planType: promoCode.planType,
        durationDays: promoCode.durationDays,
        discountPercent: promoCode.discountPercent,
        usageLimit: promoCode.usageLimit,
        usageCount: promoCode.usageCount,
        expiresAt: promoCode.expiresAt,
        isActive: promoCode.isActive,
        description: promoCode.description,
        createdAt: promoCode.createdAt,
      },
    });
  } catch (err) {
    console.error('createPromoCode error:', err);
    return res.status(500).json({ message: 'Failed to create promo code' });
  }
};

// Update a promo code
exports.updatePromoCode = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }

    const promoCode = await PromoCode.findById(id);
    if (!promoCode) {
      return res.status(404).json({ message: 'Promo code not found' });
    }

    const {
      type,
      planType,
      durationDays,
      discountPercent,
      usageLimit,
      expiresAt,
      isActive,
      description,
    } = req.body;

    if (type !== undefined) promoCode.type = type;
    if (planType !== undefined) promoCode.planType = planType;
    if (durationDays !== undefined) promoCode.durationDays = Number(durationDays) || 14;
    if (discountPercent !== undefined) promoCode.discountPercent = Number(discountPercent) || 100;
    if (usageLimit !== undefined) promoCode.usageLimit = usageLimit ? Number(usageLimit) : null;
    if (expiresAt !== undefined) promoCode.expiresAt = expiresAt ? new Date(expiresAt) : null;
    if (isActive !== undefined) promoCode.isActive = Boolean(isActive);
    if (description !== undefined) promoCode.description = String(description || '').trim();

    await promoCode.save();

    await log('Promo code updated', 'info', `Code: ${promoCode.code}`, {
      promoCodeId: String(promoCode._id),
    });

    return res.json({
      ok: true,
      promoCode: {
        _id: String(promoCode._id),
        code: promoCode.code,
        type: promoCode.type,
        planType: promoCode.planType,
        durationDays: promoCode.durationDays,
        discountPercent: promoCode.discountPercent,
        usageLimit: promoCode.usageLimit,
        usageCount: promoCode.usageCount,
        expiresAt: promoCode.expiresAt,
        isActive: promoCode.isActive,
        description: promoCode.description,
        createdAt: promoCode.createdAt,
      },
    });
  } catch (err) {
    console.error('updatePromoCode error:', err);
    return res.status(500).json({ message: 'Failed to update promo code' });
  }
};

// Delete a promo code
exports.deletePromoCode = async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid id' });
    }

    const promoCode = await PromoCode.findById(id);
    if (!promoCode) {
      return res.status(404).json({ message: 'Promo code not found' });
    }

    await PromoCode.deleteOne({ _id: id });

    await log('Promo code deleted', 'warning', `Code: ${promoCode.code}`, {
      promoCodeId: id,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('deletePromoCode error:', err);
    return res.status(500).json({ message: 'Failed to delete promo code' });
  }
};
