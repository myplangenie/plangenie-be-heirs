const Journey = require('../models/Journey');
const Onboarding = require('../models/Onboarding');
const DepartmentProject = require('../models/DepartmentProject');

function ensureId(prefix = 'j_') {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

// GET /api/journeys
exports.list = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const items = await Journey.find({ user: userId }).sort({ defaultJourney: -1, createdAt: -1 }).lean().exec();
    return res.json({ items });
  } catch (err) {
    next(err);
  }
};

// POST /api/journeys  { name, description? }
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    if (!name) return res.status(400).json({ message: 'Name is required' });
    // Simple plan limit: allow 1 free journey
    try {
      const ent = require('../config/entitlements');
      const User = require('../models/User');
      const user = await User.findById(userId).lean().exec();
      const limit = ent.getLimit(user, 'maxJourneys') || 0;
      if (limit > 0) {
        const count = await Journey.countDocuments({ user: userId });
        if (count >= limit) return res.status(402).json({ code: 'LIMIT_EXCEEDED', message: 'Upgrade to create more Journeys', limitKey: 'maxJourneys', limit, plan: ent.effectivePlan(user) });
      }
    } catch {}
    const jid = ensureId();
    const count = await Journey.countDocuments({ user: userId });
    const doc = await Journey.create({ user: userId, jid, name, description, defaultJourney: count === 0 });
    return res.status(201).json({ journey: doc });
  } catch (err) {
    next(err);
  }
};

// GET /api/journeys/:jid
exports.get = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const jid = String(req.params?.jid || '').trim();
    const doc = await Journey.findOne({ user: userId, jid }).lean().exec();
    if (!doc) return res.status(404).json({ message: 'Journey not found' });
    return res.json({ journey: doc });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/journeys/:jid  { name?, description?, status?, defaultJourney?, reviewCadence? }
exports.patch = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const jid = String(req.params?.jid || '').trim();
    const doc = await Journey.findOne({ user: userId, jid });
    if (!doc) return res.status(404).json({ message: 'Journey not found' });

    const { name, description, status, defaultJourney, reviewCadence } = req.body || {};
    if (typeof name !== 'undefined') doc.name = String(name || '');
    if (typeof description !== 'undefined') doc.description = String(description || '');
    if (typeof status !== 'undefined') doc.status = String(status || 'active');
    if (reviewCadence && typeof reviewCadence === 'object') {
      doc.reviewCadence = { ...doc.reviewCadence.toObject?.() || doc.reviewCadence || {}, ...reviewCadence };
    }
    if (defaultJourney === true) {
      // unset others for this user
      await Journey.updateMany({ user: userId, _id: { $ne: doc._id } }, { $set: { defaultJourney: false } });
      doc.defaultJourney = true;
    }
    await doc.save();
    return res.json({ journey: doc });
  } catch (err) {
    next(err);
  }
};

// GET /api/journeys/:jid/this-week
exports.thisWeek = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const jid = String(req.params?.jid || '').trim();
    const j = await Journey.findOne({ user: userId, jid }).lean().exec();
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const ob = await Onboarding.findOne({ user: userId }).lean().exec();
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
    const deptProjects = await DepartmentProject.find({ user: userId, isDeleted: false }).lean();
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
    const cadence = j.reviewCadence || { weekly: true, dayOfWeek: 1 };
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
