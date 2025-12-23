const Journey = require('../models/Journey');
const ReviewSession = require('../models/ReviewSession');

function id(prefix='r_') { return `${prefix}${Math.random().toString(36).slice(2, 10)}`; }

// GET /api/journeys/:jid/reviews
exports.list = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const jid = String(req.params?.jid||'').trim();
    const j = await Journey.findOne({ user: userId, jid }).lean().exec();
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const items = await ReviewSession.find({ user: userId, journey: j._id }).sort({ startedAt: -1 }).lean().exec();
    return res.json({ items });
  } catch (err) { next(err); }
};

// POST /api/journeys/:jid/reviews  { cadence?, notes? }
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const jid = String(req.params?.jid||'').trim();
    const j = await Journey.findOne({ user: userId, jid }).lean().exec();
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    // Enforce plan limits per calendar month (UTC)
    try {
      const ent = require('../config/entitlements');
      const User = require('../models/User');
      const user = await User.findById(userId).lean().exec();
      const limit = ent.getLimit(user, 'reviewsPerMonth');
      if (limit && limit > 0) {
        const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
        const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth()+1, 1));
        const count = await ReviewSession.countDocuments({ user: userId, journey: j._id, createdAt: { $gte: start, $lt: end } });
        if (count >= limit) return res.status(402).json({ code: 'LIMIT_EXCEEDED', message: 'Monthly review limit reached', limitKey: 'reviewsPerMonth', limit, plan: ent.effectivePlan(user) });
      }
    } catch {}
    const payload = req.body || {};
    const doc = await ReviewSession.create({
      user: userId,
      journey: j._id,
      rid: id(),
      cadence: ['weekly','monthly','quarterly'].includes(String(payload.cadence)) ? String(payload.cadence) : 'weekly',
      notes: String(payload.notes || ''),
      attendees: Array.isArray(payload.attendees) ? payload.attendees.map(String) : [],
      actionItems: Array.isArray(payload.actionItems) ? payload.actionItems.map((ai) => ({ text: String(ai?.text||'').trim(), owner: String(ai?.owner||'').trim(), dueWhen: String(ai?.dueWhen||'').trim(), status: ['Not started','In progress','Completed'].includes(ai?.status) ? ai.status : 'Not started' })).filter((ai)=> ai.text) : [],
    });
    return res.status(201).json({ review: doc });
  } catch (err) { next(err); }
};

// GET /api/journeys/:jid/reviews/:rid
exports.get = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const jid = String(req.params?.jid||'').trim();
    const rid = String(req.params?.rid||'').trim();
    const j = await Journey.findOne({ user: userId, jid }).lean().exec();
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const doc = await ReviewSession.findOne({ user: userId, journey: j._id, rid }).lean().exec();
    if (!doc) return res.status(404).json({ message: 'Review not found' });
    return res.json({ review: doc });
  } catch (err) { next(err); }
};

// PATCH /api/journeys/:jid/reviews/:rid  { notes?, actionItems?, status? }
exports.patch = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const jid = String(req.params?.jid||'').trim();
    const rid = String(req.params?.rid||'').trim();
    const j = await Journey.findOne({ user: userId, jid }).lean().exec();
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const doc = await ReviewSession.findOne({ user: userId, journey: j._id, rid });
    if (!doc) return res.status(404).json({ message: 'Review not found' });
    const payload = req.body || {};
    if (typeof payload.notes !== 'undefined') doc.notes = String(payload.notes || '');
    if (Array.isArray(payload.attendees)) doc.attendees = payload.attendees.map(String);
    if (Array.isArray(payload.actionItems)) {
      doc.actionItems = payload.actionItems.map((ai) => ({ text: String(ai?.text||'').trim(), owner: String(ai?.owner||'').trim(), dueWhen: String(ai?.dueWhen||'').trim(), status: ['Not started','In progress','Completed'].includes(ai?.status) ? ai.status : 'Not started' })).filter((ai)=> ai.text);
    }
    if (typeof payload.status !== 'undefined') {
      const st = String(payload.status);
      if (['open','closed'].includes(st)) {
        doc.status = st;
        if (st === 'closed' && !doc.endedAt) doc.endedAt = new Date();
      }
    }
    await doc.save();
    return res.json({ review: doc });
  } catch (err) { next(err); }
};

