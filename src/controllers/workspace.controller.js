const Workspace = require('../models/Workspace');
const Onboarding = require('../models/Onboarding');
const User = require('../models/User');
const Subscription = require('../models/Subscription');
const PriorityCache = require('../models/PriorityCache');
const AgentCache = require('../models/AgentCache');
const Department = require('../models/Department');
const TeamMember = require('../models/TeamMember');
const Notification = require('../models/Notification');
const Assumption = require('../models/Assumption');
const Scenario = require('../models/Scenario');
const Decision = require('../models/Decision');
const ReviewSession = require('../models/ReviewSession');
const CoreProject = require('../models/CoreProject');
const DepartmentProject = require('../models/DepartmentProject');
const scoringService = require('../services/scoringService');
const riskService = require('../services/riskService');
const { recalculateForUserWorkspace } = require('../jobs/recalculatePriorities');
const OpenAI = require('openai');
const crypto = require('crypto');

function ensureId(prefix = 'ws_') {
  return `${prefix}${crypto.randomBytes(6).toString('hex')}`;
}

// GET /api/workspaces
exports.list = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    let items = await Workspace.find({ user: userId }).sort({ defaultWorkspace: -1, createdAt: -1 }).lean().exec();

    // Auto-create workspace for existing users who don't have one
    if (items.length === 0) {
      try {
        // Try to get business name from onboarding or user
        const [ob, user] = await Promise.all([
          Onboarding.findOne({ user: userId }).lean().exec(),
          User.findById(userId).lean().exec(),
        ]);
        const businessName = ob?.businessProfile?.businessName || user?.companyName || `${user?.firstName || 'My'}'s Workspace`;
        const industry = ob?.businessProfile?.industry || '';

        const wid = ensureId();
        const workspace = await Workspace.create({
          user: userId,
          wid,
          name: businessName,
          industry,
          defaultWorkspace: true,
        });
        items = [workspace.toObject()];
      } catch (autoCreateErr) {
        console.error('[workspace.list] Auto-create failed:', autoCreateErr?.message || autoCreateErr);
      }
    }

    // Enrich items with onboarding status
    const workspaceIds = items.map(w => w._id);
    const onboardings = await Onboarding.find({
      user: userId,
      workspace: { $in: workspaceIds }
    }).select('workspace onboardingDetailCompleted businessProfile').lean().exec();

    const onboardingMap = {};
    onboardings.forEach(ob => {
      onboardingMap[String(ob.workspace)] = ob;
    });

    // Add computed fields to each workspace
    items = items.map(ws => {
      const ob = onboardingMap[String(ws._id)];
      const onboardingComplete = !!ob?.onboardingDetailCompleted;

      // Compute display status: onboarding (if not complete), or actual status
      let displayStatus = ws.status || 'active';
      if (!onboardingComplete && ws.status === 'active') {
        displayStatus = 'onboarding';
      }

      // Try to get industry from onboarding if not set on workspace
      // If industry is "other", use industryOther value instead
      const bpIndustry = ob?.businessProfile?.industry;
      const resolvedIndustry = bpIndustry === 'other' && ob?.businessProfile?.industryOther
        ? ob.businessProfile.industryOther
        : bpIndustry;
      const industry = ws.industry || resolvedIndustry || '';

      return {
        ...ws,
        industry,
        displayStatus,
        onboardingComplete,
        lastActivityAt: ws.lastActivityAt || ws.updatedAt || ws.createdAt,
      };
    });

    return res.json({ items });
  } catch (err) {
    next(err);
  }
};

// POST /api/workspaces  { name, description? }
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    if (!name) return res.status(400).json({ message: 'Name is required' });

    // Check workspace slot limits
    try {
      const ent = require('../config/entitlements');
      const user = await User.findById(userId).lean().exec();
      const subscription = await Subscription.findOne({ user: userId }).lean().exec();

      // Get workspace limit from slots or fall back to plan-based limit
      const limit = ent.getWorkspaceLimit(user, subscription);
      const usedSlots = await Workspace.countDocuments({ user: userId });
      const availableSlots = Math.max(0, limit - usedSlots);

      if (usedSlots >= limit) {
        return res.status(402).json({
          code: 'WORKSPACE_SLOTS_EXHAUSTED',
          message: 'Purchase additional workspace slots to create more workspaces',
          slots: {
            total: limit,
            used: usedSlots,
            available: availableSlots,
            included: subscription?.workspaceSlots?.included || 1,
            purchased: subscription?.workspaceSlots?.purchased || 0,
          },
          plan: ent.effectivePlan(user),
        });
      }
    } catch (limitErr) {
      console.error('[workspace.create] Limit check error:', limitErr?.message || limitErr);
    }
    const wid = ensureId();
    const count = await Workspace.countDocuments({ user: userId });
    const doc = await Workspace.create({ user: userId, wid, name, description, defaultWorkspace: count === 0 });
    return res.status(201).json({ workspace: doc });
  } catch (err) {
    next(err);
  }
};

// GET /api/workspaces/:wid
exports.get = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid || '').trim();
    const doc = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!doc) return res.status(404).json({ message: 'Workspace not found' });
    return res.json({ workspace: doc });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/workspaces/:wid  { name?, description?, industry?, status?, defaultWorkspace?, reviewCadence? }
exports.patch = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid || '').trim();
    const doc = await Workspace.findOne({ user: userId, wid });
    if (!doc) return res.status(404).json({ message: 'Workspace not found' });

    const { name, description, industry, status, defaultWorkspace, reviewCadence } = req.body || {};
    if (typeof name !== 'undefined') doc.name = String(name || '');
    if (typeof description !== 'undefined') doc.description = String(description || '');
    if (typeof industry !== 'undefined') doc.industry = String(industry || '');
    if (typeof status !== 'undefined') {
      const validStatuses = ['active', 'paused', 'archived'];
      const newStatus = String(status || 'active');
      if (validStatuses.includes(newStatus)) {
        doc.status = newStatus;
      }
    }
    if (reviewCadence && typeof reviewCadence === 'object') {
      doc.reviewCadence = { ...doc.reviewCadence.toObject?.() || doc.reviewCadence || {}, ...reviewCadence };
    }
    if (defaultWorkspace === true) {
      // unset others for this user
      await Workspace.updateMany({ user: userId, _id: { $ne: doc._id } }, { $set: { defaultWorkspace: false } });
      doc.defaultWorkspace = true;
    }

    // Update last activity timestamp
    doc.lastActivityAt = new Date();

    await doc.save();
    return res.json({ workspace: doc });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/workspaces/:wid
exports.delete = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid || '').trim();

    const doc = await Workspace.findOne({ user: userId, wid });
    if (!doc) return res.status(404).json({ message: 'Workspace not found' });

    // Prevent deleting the default workspace if it's the only one
    const workspaceCount = await Workspace.countDocuments({ user: userId });
    if (workspaceCount === 1) {
      return res.status(400).json({ message: 'Cannot delete your only workspace. Create another workspace first.' });
    }

    const workspaceId = doc._id;

    // Delete all associated data
    await Promise.all([
      Onboarding.deleteMany({ user: userId, workspace: workspaceId }),
      PriorityCache.deleteMany({ user: userId, workspace: workspaceId }),
      AgentCache.deleteMany({ user: userId, workspace: workspaceId }),
      Department.deleteMany({ user: userId, workspace: workspaceId }),
      TeamMember.deleteMany({ user: userId, workspace: workspaceId }),
      Notification.deleteMany({ user: userId, workspace: workspaceId }),
      Assumption.deleteMany({ user: userId, workspace: workspaceId }),
      Scenario.deleteMany({ workspace: workspaceId }),
      Decision.deleteMany({ user: userId, workspace: workspaceId }),
      ReviewSession.deleteMany({ user: userId, workspace: workspaceId }),
    ]);

    // Delete the workspace itself
    await Workspace.deleteOne({ _id: workspaceId });

    // If deleted workspace was default, set another as default
    if (doc.defaultWorkspace) {
      const nextDefault = await Workspace.findOne({ user: userId }).sort({ createdAt: -1 });
      if (nextDefault) {
        nextDefault.defaultWorkspace = true;
        await nextDefault.save();
      }
    }

    return res.json({ ok: true, message: 'Workspace and all associated data deleted successfully' });
  } catch (err) {
    next(err);
  }
};

// POST /api/workspaces/:wid/touch
// Update lastActivityAt when user accesses workspace (e.g., on login/select)
exports.touch = async (req, res, next) => {
  try {
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ wid });
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    ws.lastActivityAt = new Date();
    await ws.save();

    return res.json({ ok: true, lastActivityAt: ws.lastActivityAt });
  } catch (err) {
    next(err);
  }
};

// GET /api/workspaces/:wid/this-week
exports.thisWeek = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });
    const ob = await Onboarding.findOne({ user: userId, workspace: ws._id }).lean().exec();
    const a = ob?.answers || {};

    const parseDue = (s) => {
      const str = String(s || '').trim();
      if (!str) return null;
      const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      let dt = null;
      if (m) dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      else { const t = Date.parse(str); dt = isNaN(t) ? null : new Date(t); }
      return dt && !isNaN(dt.getTime()) ? dt : null;
    };
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in14 = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Fetch from DepartmentProject model only - no legacy fallback
    const deptProjects = await DepartmentProject.find({ workspace: ws._id, isDeleted: false }).lean();
    const activeItems = deptProjects.map((u, idx) => ({ ...u, _key: u.department, _index: idx }));

    const allDeliverables = activeItems.map((u) => {
      const due = parseDue(u?.dueWhen);
      const prog = Number(u?.progress);
      const stat = String(u?.status || '').toLowerCase();
      const isDone = (Number.isFinite(prog) && prog >= 100) || /(done|complete|completed)/.test(stat);
      return {
        title: u.title || u.goal || 'Untitled',
        owner: `${u.firstName || ''} ${u.lastName || ''}`.trim() || undefined,
        dueWhen: due,
        rawDue: String(u?.dueWhen || ''),
        isDone,
      };
    });

    const overdue = allDeliverables.filter((d) => d.dueWhen && d.dueWhen < today && !d.isDone);
    const upcoming = allDeliverables.filter((d) => d.dueWhen && d.dueWhen >= today && d.dueWhen <= in14 && !d.isDone);
    const sortByDue = (arr) => arr.slice().sort((a, b) => (a.dueWhen?.getTime() || 0) - (b.dueWhen?.getTime() || 0));
    const topUpcoming = sortByDue(upcoming).slice(0, 5).map((d) => ({ title: d.title, due: d.rawDue, owner: d.owner }));

    // Next review date (very light heuristic from cadence)
    const cadence = ws.reviewCadence || { weekly: true, dayOfWeek: 1 };
    let nextReview = null;
    if (cadence.weekly) {
      const dow = Number(cadence.dayOfWeek || 1); // default Mon
      const currDow = today.getDay();
      const delta = ((dow - currDow + 7) % 7) || 7;
      const when = new Date(today.getTime() + delta * 24 * 60 * 60 * 1000);
      nextReview = when.toISOString().slice(0, 10);
    }

    // Simple focus project: earliest upcoming or most overdue
    const focus = (sortByDue(upcoming)[0] || sortByDue(overdue)[0]) || null;
    const focusProject = focus ? { title: focus.title, due: focus.rawDue, owner: focus.owner } : null;

    return res.json({
      thisWeek: {
        overdueCount: overdue.length,
        upcoming: topUpcoming,
        nextReview: nextReview ? { date: nextReview } : null,
        focusProject,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/workspaces/:wid/decision-strip
exports.getDecisionStrip = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    // Get cache and check various data sources to see if recalculation is needed
    let cache = await PriorityCache.findOne({ user: userId, workspace: ws._id }).lean();

    // Check timestamps from all data sources that affect priorities
    const [ob, latestCoreProject, latestDeptProject] = await Promise.all([
      Onboarding.findOne({ user: userId, workspace: ws._id }).select('updatedAt').lean(),
      CoreProject.findOne({ workspace: ws._id, isDeleted: false }).sort({ updatedAt: -1 }).select('updatedAt').lean(),
      DepartmentProject.findOne({ workspace: ws._id, isDeleted: false }).sort({ updatedAt: -1 }).select('updatedAt').lean(),
    ]);

    // Recalculate if:
    // 1. Cache doesn't exist
    // 2. Onboarding was updated after cache was calculated (data changed)
    // 3. CoreProject was updated after cache was calculated
    // 4. DepartmentProject was updated after cache was calculated
    // 5. Cache is older than 1 hour (force refresh)
    // 6. Cache was calculated on a different day (priorities are date-sensitive)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const cacheTime = cache?.calculatedAt ? new Date(cache.calculatedAt) : null;
    const obUpdatedTime = ob?.updatedAt ? new Date(ob.updatedAt) : null;
    const coreProjectUpdatedTime = latestCoreProject?.updatedAt ? new Date(latestCoreProject.updatedAt) : null;
    const deptProjectUpdatedTime = latestDeptProject?.updatedAt ? new Date(latestDeptProject.updatedAt) : null;

    // Check if cache was calculated on a different day (date changed since last calculation)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cacheDay = cacheTime ? new Date(cacheTime) : null;
    if (cacheDay) cacheDay.setHours(0, 0, 0, 0);
    const isDifferentDay = cacheDay && cacheDay.getTime() < today.getTime();

    const needsRecalc = !cache ||
      !cacheTime ||
      isDifferentDay ||
      cacheTime < oneHourAgo ||
      (obUpdatedTime && obUpdatedTime > cacheTime) ||
      (coreProjectUpdatedTime && coreProjectUpdatedTime > cacheTime) ||
      (deptProjectUpdatedTime && deptProjectUpdatedTime > cacheTime);

    if (needsRecalc) {
      await recalculateForUserWorkspace(userId, ws._id);
      cache = await PriorityCache.findOne({ user: userId, workspace: ws._id }).lean();
    }

    if (!cache) {
      return res.json({
        decisionStrip: {
          summary: 'No priorities calculated yet. Complete your onboarding to see insights.',
          weeklyFocus: [],
          upcomingItems: [],
          monthlyThrust: null,
          risks: [],
          clusters: [],
          generatedAt: new Date().toISOString(),
        },
      });
    }

    // Apply collaborator filtering
    try {
      const isCollab = !!req.user?.viewerId;
      if (isCollab && cache) {
        const accessType = String(req.user?.accessType || '').toLowerCase();
        const viewerId = String(req.user.viewerId);
        let viewerName = '';
        try {
          const User = require('../models/User');
          const u = await User.findById(viewerId).select('firstName lastName fullName').lean();
          if (u) viewerName = ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || (u.fullName || '');
        } catch {}
        const nameLower = String(viewerName || '').trim().toLowerCase();
        const ownerMatches = (it) => String(it?.owner || '').trim().toLowerCase() === nameLower;
        const inAllowedDept = (it) => {
          const allowed = Array.isArray(req.user?.allowedDepartments) ? req.user.allowedDepartments : [];
          const key = (it && it.source && it.source.department) ? String(it.source.department) : '';
          return allowed.length > 0 && key && allowed.includes(key);
        };
        if (accessType === 'limited') {
          // Contributors: show only items assigned to them
          const filterItems = (arr) => Array.isArray(arr) ? arr.filter(ownerMatches) : [];
          cache.weeklyTop3 = filterItems(cache.weeklyTop3);
          cache.upcomingItems = filterItems(cache.upcomingItems);
        } else if (accessType === 'admin') {
          // Admin collaborators: contextual view — items they own OR items in their department(s)
          const filterItems = (arr) => Array.isArray(arr) ? arr.filter((it) => ownerMatches(it) || inAllowedDept(it)) : [];
          const w3 = filterItems(cache.weeklyTop3);
          const up = filterItems(cache.upcomingItems);
          // Use filtered sets if not empty; otherwise keep universal
          if (w3.length > 0) cache.weeklyTop3 = w3;
          if (up.length > 0) cache.upcomingItems = up;
        }
        // clusters contain suggestions; leave as-is
      }
    } catch (_) {}

    // Generate AI summary using OpenAI
    let summary = '';
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey) {
        const openai = new OpenAI({ apiKey });

        const prompt = buildSummaryPrompt(cache.weeklyTop3, cache.monthlyThrust, cache.risks);
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 150,
          temperature: 0.7,
        });

        summary = completion.choices?.[0]?.message?.content?.trim() || '';
      }
    } catch (aiErr) {
      console.error('[getDecisionStrip] AI summary error:', aiErr?.message || aiErr);
    }

    // Fallback summary if AI fails
    if (!summary) {
      summary = buildFallbackSummary(cache.weeklyTop3, cache.monthlyThrust, cache.risks);
    }

    return res.json({
      decisionStrip: {
        summary,
        weeklyFocus: cache.weeklyTop3 || [],
        upcomingItems: cache.upcomingItems || [],
        monthlyThrust: cache.monthlyThrust || null,
        risks: cache.risks || [],
        clusters: cache.clusters || [],
        generatedAt: cache.calculatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/workspaces/:wid/roadmap
exports.getRoadmap = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    // Fetch from new collections only - no legacy fallback
    const [coreProjects, deptProjects] = await Promise.all([
      CoreProject.findActiveByWorkspace(ws._id).lean(),
      DepartmentProject.findActiveByWorkspace(ws._id).lean(),
    ]);

    // Calculate time range: 1 year past, 2 years future (to allow full roadmap navigation)
    const now = new Date();
    const rangeStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const rangeEnd = new Date(now.getFullYear() + 2, now.getMonth(), 0);

    const parseDate = (s) => {
      const str = String(s || '').trim();
      if (!str) return null;
      const d = new Date(str);
      return isNaN(d.getTime()) ? null : d;
    };

    const isInRange = (dateStr) => {
      const d = parseDate(dateStr);
      if (!d) return false;
      return d >= rangeStart && d <= rangeEnd;
    };

    // Extract milestones from core projects
    const milestones = [];

    // Extract deliverables from projects
    const deliverables = [];

    // Process CoreProject collection
    coreProjects.forEach((p) => {
      const projectTitle = String(p?.title || '').trim();
      const projectId = p._id.toString();

      // Add project as a milestone if it has a due date
      if (isInRange(p.dueWhen)) {
        milestones.push({
          title: projectTitle,
          date: p.dueWhen,
          type: 'project',
          projectId,
          completed: false,
        });
      }

      // Add deliverables
      const pDeliverables = Array.isArray(p?.deliverables) ? p.deliverables : [];
      pDeliverables.forEach((d) => {
        if (!isInRange(d?.dueWhen)) return;
        const text = String(d?.text || '').trim();
        if (!text) return;
        deliverables.push({
          title: text,
          date: d.dueWhen,
          projectTitle,
          completed: !!d.done,
          type: 'deliverable',
          source: { coreProjectId: projectId, deliverableId: d._id?.toString() },
        });
      });
    });

    // Process DepartmentProject collection
    deptProjects.forEach((assignment) => {
      const dept = assignment.departmentKey;
      const projectTitle = String(assignment?.title || assignment?.goal || '').trim();
      const projectId = assignment._id.toString();
      const projectOwner = [assignment?.firstName, assignment?.lastName].filter(Boolean).join(' ').trim();

      // Add the departmental project itself if it has a due date in range
      if (isInRange(assignment?.dueWhen)) {
        deliverables.push({
          title: projectTitle,
          date: assignment.dueWhen,
          owner: projectOwner,
          department: dept,
          completed: false,
          type: 'goal',
          source: { deptProjectId: projectId },
        });
      }

      // Add deliverables from this departmental project
      const deptDeliverables = Array.isArray(assignment?.deliverables) ? assignment.deliverables : [];
      deptDeliverables.forEach((d) => {
        if (!isInRange(d?.dueWhen)) return;
        const deliverableText = String(d?.text || '').trim();
        if (!deliverableText) return;

        deliverables.push({
          title: deliverableText,
          date: d.dueWhen,
          projectTitle,
          owner: d.ownerName || projectOwner,
          department: dept,
          completed: !!d.done,
          type: 'deliverable',
          source: { deptProjectId: projectId, deliverableId: d._id?.toString() },
        });
      });
    });

    // Sort by date
    milestones.sort((a, b) => new Date(a.date) - new Date(b.date));
    deliverables.sort((a, b) => new Date(a.date) - new Date(b.date));

    return res.json({
      roadmap: {
        timeRange: {
          start: rangeStart.toISOString().slice(0, 10),
          end: rangeEnd.toISOString().slice(0, 10),
        },
        milestones,
        deliverables,
        today: now.toISOString().slice(0, 10),
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/workspaces/:wid/dismiss-suggestion
exports.dismissSuggestion = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const { itemTitle } = req.body || {};
    if (!itemTitle) return res.status(400).json({ message: 'itemTitle is required' });

    // Add to dismissed list in cache
    await PriorityCache.findOneAndUpdate(
      { user: userId, workspace: ws._id },
      { $addToSet: { 'userOverrides.dismissed': itemTitle } },
      { upsert: true }
    );

    return res.json({ success: true, message: 'Suggestion dismissed' });
  } catch (err) {
    next(err);
  }
};

// Snooze a suggestion for X days
exports.snoozeSuggestion = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const { itemTitle, snoozeDays } = req.body || {};
    if (!itemTitle) return res.status(400).json({ message: 'itemTitle is required' });

    const days = Number(snoozeDays) || 1;
    const snoozeUntil = new Date();
    snoozeUntil.setDate(snoozeUntil.getDate() + days);

    // Add to snoozed list in cache with expiry
    await PriorityCache.findOneAndUpdate(
      { user: userId, workspace: ws._id },
      {
        $push: {
          'userOverrides.snoozed': {
            itemTitle,
            snoozeUntil: snoozeUntil.toISOString(),
            snoozedAt: new Date().toISOString(),
          },
        },
      },
      { upsert: true }
    );

    return res.json({ success: true, message: `Snoozed for ${days} day${days > 1 ? 's' : ''}`, snoozeUntil: snoozeUntil.toISOString() });
  } catch (err) {
    next(err);
  }
};

// POST /api/workspaces/:wid/ai-suggestions
// Generate AI-powered suggestions for priority management
exports.getAISuggestions = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    // Get onboarding data for context
    const ob = await Onboarding.findOne({ user: userId, workspace: ws._id }).lean().exec();
    const answers = ob?.answers || {};

    // Get cached priorities
    const cache = await PriorityCache.findOne({ user: userId, workspace: ws._id }).lean();

    // Build context for AI - use weeklyTop3, fallback to upcomingItems if empty
    let priorities = cache?.weeklyTop3 || [];
    const hasWeeklyItems = priorities.length > 0;
    if (!hasWeeklyItems && cache?.upcomingItems?.length > 0) {
      priorities = cache.upcomingItems;
    }
    const today = new Date();

    // Filter out items that had recent actions (within the last 24 hours)
    const recentActions = cache?.recentActions || [];
    const oneDayAgo = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const recentlyHandledSources = recentActions
      .filter(a => a.timestamp && new Date(a.timestamp) > oneDayAgo)
      .map(a => a.source);

    // Helper to check if sources match
    const sourceMatches = (s1, s2) => {
      if (!s1 || !s2) return false;
      if (s1.type !== s2.type) return false;
      if (s1.type === 'project') return s1.projectIndex === s2.projectIndex;
      if (s1.type === 'deliverable') return s1.projectIndex === s2.projectIndex && s1.deliverableIndex === s2.deliverableIndex;
      if (s1.type === 'goal') return s1.department === s2.department && s1.goalIndex === s2.goalIndex;
      if (s1.type === 'dept_deliverable') return s1.department === s2.department && s1.goalIndex === s2.goalIndex && s1.deliverableIndex === s2.deliverableIndex;
      return false;
    };

    // Filter out recently handled items
    priorities = priorities.filter(p => {
      return !recentlyHandledSources.some(rs => sourceMatches(p.source, rs));
    });

    // Build a summary of current state for AI
    const prioritySummary = priorities.map((p, i) => {
      const dueDate = p.dueWhen ? new Date(p.dueWhen) : null;
      const daysUntil = dueDate ? Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24)) : null;
      const status = daysUntil !== null
        ? (daysUntil < 0 ? `${Math.abs(daysUntil)} days overdue` : (daysUntil === 0 ? 'due today' : `due in ${daysUntil} days`))
        : 'no due date';
      return `${i + 1}. "${p.title}" - ${status} (score: ${p.totalScore || 0})`;
    }).join('\n');

    // Check for issues to suggest
    const overdueItems = priorities.filter(p => {
      const due = p.dueWhen ? new Date(p.dueWhen) : null;
      return due && due < today;
    });

    const itemsDueSoon = priorities.filter(p => {
      const due = p.dueWhen ? new Date(p.dueWhen) : null;
      if (!due) return false;
      const days = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
      return days >= 0 && days <= 3;
    });

    // Build AI prompt
    const contextType = hasWeeklyItems ? 'weekly priorities' : 'upcoming priorities';
    const prompt = `You are a strategic execution advisor who helps leaders focus on the highest-impact activities. Think like a chief of staff who understands what drives results - helping prioritize ruthlessly and identify execution risks before they become problems. Analyze the user's ${contextType} and provide actionable suggestions.

Current ${contextType}:
${prioritySummary || 'No priorities found'}

Overdue items: ${overdueItems.length}
Items due in next 3 days: ${itemsDueSoon.length}
${!hasWeeklyItems ? 'Note: No items due this week. Showing upcoming items instead.' : ''}
Today's date: ${today.toISOString().split('T')[0]}

Based on this, provide 1-3 specific, actionable suggestions. For each suggestion, respond in this exact JSON format:
{
  "suggestions": [
    {
      "itemTitle": "exact title of the item",
      "action": "reschedule" or "complete" or "reprioritize",
      "reason": "brief explanation why this action is recommended",
      "newDate": "YYYY-MM-DD format if action is reschedule, otherwise omit"
    }
  ]
}

Rules:
- Only suggest "reschedule" for overdue items or items with unrealistic deadlines
- Only suggest "complete" if an item seems like it might already be done based on context
- Use "reprioritize" to suggest focusing on something specific or to start working on upcoming items early
- Keep reasons concise (under 20 words)
- If there are upcoming items but nothing urgent, suggest which one to start working on first
- Only return empty suggestions array if there are truly no items to work on
- For reschedule, suggest a realistic new date (usually 3-7 days from today)`;

    let suggestions = [];

    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.json({ suggestions: [] });
      }

      const OpenAI = require('openai');
      const openai = new OpenAI({ apiKey });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 500,
        temperature: 0.7,
        response_format: { type: 'json_object' },
      });

      const content = completion.choices?.[0]?.message?.content?.trim();
      if (content) {
        const parsed = JSON.parse(content);
        suggestions = parsed.suggestions || [];

        // Enrich suggestions with source info for actionability
        suggestions = suggestions.map(s => {
          // Find the matching priority item to get source info
          const match = priorities.find(p =>
            p.title?.toLowerCase() === s.itemTitle?.toLowerCase() ||
            p.title?.toLowerCase().includes(s.itemTitle?.toLowerCase()) ||
            s.itemTitle?.toLowerCase().includes(p.title?.toLowerCase())
          );

          return {
            ...s,
            source: match?.source || null,
            itemTitle: match?.title || s.itemTitle, // Use exact title from data
          };
        }).filter(s => s.source); // Only return suggestions we can act on
      }
    } catch (aiErr) {
      console.error('[getAISuggestions] AI error:', aiErr?.message || aiErr);
      // Return empty suggestions on error rather than failing
    }

    return res.json({ suggestions });
  } catch (err) {
    next(err);
  }
};

// Helper: Build prompt for AI summary
function buildSummaryPrompt(weeklyTop3, monthlyThrust, risks) {
  const lines = ['Generate a brief, actionable 1-2 sentence summary for a business planner based on:'];

  if (weeklyTop3?.length) {
    lines.push(`Weekly priorities: ${weeklyTop3.map((i) => i.title).join(', ')}`);
  }

  if (monthlyThrust?.title) {
    lines.push(`Monthly focus: ${monthlyThrust.title}`);
  }

  const overdueRisks = (risks || []).filter((r) => r.type === 'overdue');
  if (overdueRisks.length) {
    lines.push(`Overdue items: ${overdueRisks.length}`);
  }

  const clusteringRisks = (risks || []).filter((r) => r.type === 'clustering');
  if (clusteringRisks.length) {
    lines.push(`Clustering warnings: ${clusteringRisks.length}`);
  }

  lines.push('Keep it professional, concise, and focused on what to do next. No emojis.');

  return lines.join('\n');
}

// Helper: Build fallback summary without AI
function buildFallbackSummary(weeklyTop3, monthlyThrust, risks) {
  const parts = [];

  if (weeklyTop3?.length) {
    parts.push(`Focus on ${weeklyTop3.length} key priorities this week`);
  }

  const overdueCount = (risks || []).filter((r) => r.type === 'overdue').length;
  if (overdueCount) {
    parts.push(`${overdueCount} item${overdueCount > 1 ? 's' : ''} need${overdueCount === 1 ? 's' : ''} attention`);
  }

  if (monthlyThrust?.title) {
    parts.push(`monthly focus: ${monthlyThrust.title}`);
  }

  return parts.length > 0
    ? parts.join('. ') + '.'
    : 'Complete your onboarding to get personalized insights.';
}

// GET /api/workspaces/:wid/ai-settings
// Get workspace AI settings
exports.getAISettings = async (req, res, next) => {
  try {
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ wid }).select('aiSettings').lean();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    // Return settings with defaults if not set
    const aiSettings = ws.aiSettings || {
      enabled: true,
      features: {
        visionSuggestions: true,
        valueSuggestions: true,
        swotAnalysis: true,
        marketAnalysis: true,
        financialSuggestions: true,
        actionPlanSuggestions: true,
        coreProjectSuggestions: true,
      },
    };

    return res.json({ aiSettings });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/workspaces/:wid/ai-settings
// Update workspace AI settings (admin only)
exports.updateAISettings = async (req, res, next) => {
  try {
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ wid });
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const { enabled, features } = req.body || {};

    // Update enabled toggle
    if (typeof enabled === 'boolean') {
      ws.aiSettings = ws.aiSettings || {};
      ws.aiSettings.enabled = enabled;
    }

    // Update individual features
    if (features && typeof features === 'object') {
      ws.aiSettings = ws.aiSettings || {};
      ws.aiSettings.features = ws.aiSettings.features || {};

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
        if (typeof features[key] === 'boolean') {
          ws.aiSettings.features[key] = features[key];
        }
      }
    }

    ws.markModified('aiSettings');
    await ws.save();

    return res.json({ aiSettings: ws.aiSettings });
  } catch (err) {
    next(err);
  }
};

// GET /api/workspaces/:wid/notification-preferences
// Get workspace notification preferences
exports.getNotificationPreferences = async (req, res, next) => {
  try {
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ wid }).select('notificationPreferences').lean();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    // Return preferences with defaults if not set
    const notificationPreferences = {
      email: {
        weeklyDigest: ws.notificationPreferences?.email?.weeklyDigest ?? true,
        dailyWish: ws.notificationPreferences?.email?.dailyWish ?? true,
        reviewReminders: ws.notificationPreferences?.email?.reviewReminders ?? true,
        deadlineAlerts: ws.notificationPreferences?.email?.deadlineAlerts ?? true,
        teamActivity: ws.notificationPreferences?.email?.teamActivity ?? true,
      },
      emailFrequency: {
        digest: ws.notificationPreferences?.emailFrequency?.digest || 'weekly',
        dailyWish: ws.notificationPreferences?.emailFrequency?.dailyWish || 'weekly',
        reviewReminders: ws.notificationPreferences?.emailFrequency?.reviewReminders || 'weekly',
        deadlineAlerts: ws.notificationPreferences?.emailFrequency?.deadlineAlerts || 'daily',
        teamActivity: ws.notificationPreferences?.emailFrequency?.teamActivity || 'weekly',
      },
      inApp: {
        taskUpdates: ws.notificationPreferences?.inApp?.taskUpdates ?? true,
        reviewReminders: ws.notificationPreferences?.inApp?.reviewReminders ?? true,
        deadlineAlerts: ws.notificationPreferences?.inApp?.deadlineAlerts ?? true,
        teamActivity: ws.notificationPreferences?.inApp?.teamActivity ?? true,
        aiInsights: ws.notificationPreferences?.inApp?.aiInsights ?? true,
      },
      timing: {
        digestDay: ws.notificationPreferences?.timing?.digestDay ?? 5,
        digestHour: ws.notificationPreferences?.timing?.digestHour ?? 9,
        quietHoursStart: ws.notificationPreferences?.timing?.quietHoursStart ?? null,
        quietHoursEnd: ws.notificationPreferences?.timing?.quietHoursEnd ?? null,
      },
    };

    return res.json({ notificationPreferences });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/workspaces/:wid/notification-preferences
// Update workspace notification preferences (admin only)
exports.updateNotificationPreferences = async (req, res, next) => {
  try {
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ wid });
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const { email, emailFrequency, inApp, timing } = req.body || {};

    // Initialize if needed
    ws.notificationPreferences = ws.notificationPreferences || {};

    // Update email preferences (boolean on/off)
    if (email && typeof email === 'object') {
      ws.notificationPreferences.email = ws.notificationPreferences.email || {};
      const allowedEmailPrefs = ['weeklyDigest', 'dailyWish', 'reviewReminders', 'deadlineAlerts', 'teamActivity'];
      for (const key of allowedEmailPrefs) {
        if (typeof email[key] === 'boolean') {
          ws.notificationPreferences.email[key] = email[key];
        }
      }
    }

    // Update email frequency preferences (daily, weekly, monthly, never)
    if (emailFrequency && typeof emailFrequency === 'object') {
      ws.notificationPreferences.emailFrequency = ws.notificationPreferences.emailFrequency || {};
      const allowedFrequencyPrefs = ['digest', 'dailyWish', 'reviewReminders', 'deadlineAlerts', 'teamActivity'];
      const validFrequencies = ['daily', 'weekly', 'monthly', 'never'];
      for (const key of allowedFrequencyPrefs) {
        if (typeof emailFrequency[key] === 'string' && validFrequencies.includes(emailFrequency[key])) {
          ws.notificationPreferences.emailFrequency[key] = emailFrequency[key];
        }
      }
    }

    // Update in-app preferences
    if (inApp && typeof inApp === 'object') {
      ws.notificationPreferences.inApp = ws.notificationPreferences.inApp || {};
      const allowedInAppPrefs = ['taskUpdates', 'reviewReminders', 'deadlineAlerts', 'teamActivity', 'aiInsights'];
      for (const key of allowedInAppPrefs) {
        if (typeof inApp[key] === 'boolean') {
          ws.notificationPreferences.inApp[key] = inApp[key];
        }
      }
    }

    // Update timing preferences
    if (timing && typeof timing === 'object') {
      ws.notificationPreferences.timing = ws.notificationPreferences.timing || {};

      if (typeof timing.digestDay === 'number' && timing.digestDay >= 0 && timing.digestDay <= 6) {
        ws.notificationPreferences.timing.digestDay = timing.digestDay;
      }
      if (typeof timing.digestHour === 'number' && timing.digestHour >= 0 && timing.digestHour <= 23) {
        ws.notificationPreferences.timing.digestHour = timing.digestHour;
      }
      if (timing.quietHoursStart === null || (typeof timing.quietHoursStart === 'number' && timing.quietHoursStart >= 0 && timing.quietHoursStart <= 23)) {
        ws.notificationPreferences.timing.quietHoursStart = timing.quietHoursStart;
      }
      if (timing.quietHoursEnd === null || (typeof timing.quietHoursEnd === 'number' && timing.quietHoursEnd >= 0 && timing.quietHoursEnd <= 23)) {
        ws.notificationPreferences.timing.quietHoursEnd = timing.quietHoursEnd;
      }
    }

    ws.markModified('notificationPreferences');
    await ws.save();

    // Return with defaults applied
    const notificationPreferences = {
      email: {
        weeklyDigest: ws.notificationPreferences?.email?.weeklyDigest ?? true,
        dailyWish: ws.notificationPreferences?.email?.dailyWish ?? true,
        reviewReminders: ws.notificationPreferences?.email?.reviewReminders ?? true,
        deadlineAlerts: ws.notificationPreferences?.email?.deadlineAlerts ?? true,
        teamActivity: ws.notificationPreferences?.email?.teamActivity ?? true,
      },
      emailFrequency: {
        digest: ws.notificationPreferences?.emailFrequency?.digest || 'weekly',
        dailyWish: ws.notificationPreferences?.emailFrequency?.dailyWish || 'weekly',
        reviewReminders: ws.notificationPreferences?.emailFrequency?.reviewReminders || 'weekly',
        deadlineAlerts: ws.notificationPreferences?.emailFrequency?.deadlineAlerts || 'daily',
        teamActivity: ws.notificationPreferences?.emailFrequency?.teamActivity || 'weekly',
      },
      inApp: {
        taskUpdates: ws.notificationPreferences?.inApp?.taskUpdates ?? true,
        reviewReminders: ws.notificationPreferences?.inApp?.reviewReminders ?? true,
        deadlineAlerts: ws.notificationPreferences?.inApp?.deadlineAlerts ?? true,
        teamActivity: ws.notificationPreferences?.inApp?.teamActivity ?? true,
        aiInsights: ws.notificationPreferences?.inApp?.aiInsights ?? true,
      },
      timing: {
        digestDay: ws.notificationPreferences?.timing?.digestDay ?? 5,
        digestHour: ws.notificationPreferences?.timing?.digestHour ?? 9,
        quietHoursStart: ws.notificationPreferences?.timing?.quietHoursStart ?? null,
        quietHoursEnd: ws.notificationPreferences?.timing?.quietHoursEnd ?? null,
      },
    };

    return res.json({ notificationPreferences });
  } catch (err) {
    next(err);
  }
};

// GET /api/workspaces/:wid/export-settings
// Get workspace export settings
exports.getExportSettings = async (req, res, next) => {
  try {
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ wid }).select('exportSettings').lean();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    // Return settings with defaults if not set
    const exportSettings = ws.exportSettings || {
      enabled: true,
      formats: {
        pdf: true,
        docx: true,
        csv: true,
      },
      minRole: null,
      content: {
        plan: true,
        strategyCanvas: true,
        departments: true,
        financials: true,
      },
    };

    return res.json({ exportSettings });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/workspaces/:wid/export-settings
// Update workspace export settings (admin only)
exports.updateExportSettings = async (req, res, next) => {
  try {
    const wid = String(req.params?.wid || '').trim();
    const ws = await Workspace.findOne({ wid });
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });

    const { enabled, formats, minRole, content } = req.body || {};

    // Initialize if needed
    ws.exportSettings = ws.exportSettings || {};

    // Update enabled toggle
    if (typeof enabled === 'boolean') {
      ws.exportSettings.enabled = enabled;
    }

    // Update format controls
    if (formats && typeof formats === 'object') {
      ws.exportSettings.formats = ws.exportSettings.formats || {};
      const allowedFormats = ['pdf', 'docx', 'csv'];
      for (const key of allowedFormats) {
        if (typeof formats[key] === 'boolean') {
          ws.exportSettings.formats[key] = formats[key];
        }
      }
    }

    // Update minimum role requirement
    if (minRole !== undefined) {
      const allowedRoles = ['viewer', 'contributor', 'admin', 'owner', null];
      if (allowedRoles.includes(minRole)) {
        ws.exportSettings.minRole = minRole;
      }
    }

    // Update content controls
    if (content && typeof content === 'object') {
      ws.exportSettings.content = ws.exportSettings.content || {};
      const allowedContent = ['plan', 'strategyCanvas', 'departments', 'financials'];
      for (const key of allowedContent) {
        if (typeof content[key] === 'boolean') {
          ws.exportSettings.content[key] = content[key];
        }
      }
    }

    ws.markModified('exportSettings');
    await ws.save();

    return res.json({ exportSettings: ws.exportSettings });
  } catch (err) {
    next(err);
  }
};
