const Workspace = require('../models/Workspace');
const Decision = require('../models/Decision');

function id(prefix='d_') { return `${prefix}${Math.random().toString(36).slice(2, 10)}`; }

// GET /api/workspaces/:wid/decisions?status=&tag=&q=
exports.list = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid||'').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });
    const where = { user: userId, workspace: ws._id };
    const status = String(req.query?.status||'').trim();
    const tag = String(req.query?.tag||'').trim();
    const q = String(req.query?.q||'').trim();
    if (status && ['proposed','approved','rejected'].includes(status)) where.status = status;
    if (tag) where.tags = tag;
    let cursor = Decision.find(where).sort({ decidedAt: -1 });
    if (q) cursor = cursor.where({ title: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
    const items = await cursor.lean().exec();
    return res.json({ items });
  } catch (err) { next(err); }
};

// POST /api/workspaces/:wid/decisions { title, status?, rationale?, tags?, targets?, impacts? }
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid||'').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });
    // Enforce monthly limit for Lite
    try {
      const ent = require('../config/entitlements');
      const User = require('../models/User');
      const user = await User.findById(userId).lean().exec();
      const limit = ent.getLimit(user, 'decisionsPerMonth');
      if (limit && limit > 0) {
        const start = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
        const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth()+1, 1));
        const count = await Decision.countDocuments({ user: userId, workspace: ws._id, createdAt: { $gte: start, $lt: end } });
        if (count >= limit) return res.status(402).json({ code: 'LIMIT_EXCEEDED', message: 'Monthly decision limit reached', limitKey: 'decisionsPerMonth', limit, plan: ent.effectivePlan(user) });
      }
    } catch {}
    const p = req.body || {};
    const title = String(p.title||'').trim();
    if (!title) return res.status(400).json({ message: 'Title is required' });
    const doc = await Decision.create({
      user: userId,
      workspace: ws._id,
      did: id(),
      title,
      context: String(p.context||'').trim(),
      rationale: String(p.rationale||'').trim(),
      decidedAt: p.decidedAt ? new Date(p.decidedAt) : new Date(),
      decidedBy: String(p.decidedBy||'').trim(),
      status: ['proposed','approved','rejected'].includes(p.status) ? p.status : 'approved',
      tags: Array.isArray(p.tags) ? p.tags.map(String).filter(Boolean) : [],
      targets: Array.isArray(p.targets) ? p.targets.map((t)=>({ type: ['goal','project','assumption','other'].includes(t?.type)? t.type : 'project', ref: t?.ref || {}, label: String(t?.label||'').trim() })) : [],
      impacts: Array.isArray(p.impacts) ? p.impacts.map((im)=>({ assumptionKey: String(im?.assumptionKey||'').trim(), oldValue: String(im?.oldValue||'').trim(), newValue: String(im?.newValue||'').trim(), note: String(im?.note||'').trim() })).filter((im)=> im.assumptionKey) : [],
    });
    return res.status(201).json({ decision: doc });
  } catch (err) { next(err); }
};

// GET /api/workspaces/:wid/decisions/:did
exports.get = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid||'').trim();
    const did = String(req.params?.did||'').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });
    const doc = await Decision.findOne({ user: userId, workspace: ws._id, did }).lean().exec();
    if (!doc) return res.status(404).json({ message: 'Decision not found' });
    return res.json({ decision: doc });
  } catch (err) { next(err); }
};

// PATCH /api/workspaces/:wid/decisions/:did
exports.patch = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const wid = String(req.params?.wid||'').trim();
    const did = String(req.params?.did||'').trim();
    const ws = await Workspace.findOne({ user: userId, wid }).lean().exec();
    if (!ws) return res.status(404).json({ message: 'Workspace not found' });
    const doc = await Decision.findOne({ user: userId, workspace: ws._id, did });
    if (!doc) return res.status(404).json({ message: 'Decision not found' });
    const p = req.body || {};
    if (typeof p.title !== 'undefined') doc.title = String(p.title||'').trim();
    if (typeof p.context !== 'undefined') doc.context = String(p.context||'').trim();
    if (typeof p.rationale !== 'undefined') doc.rationale = String(p.rationale||'').trim();
    if (typeof p.decidedAt !== 'undefined') doc.decidedAt = p.decidedAt ? new Date(p.decidedAt) : doc.decidedAt;
    if (typeof p.decidedBy !== 'undefined') doc.decidedBy = String(p.decidedBy||'').trim();
    if (typeof p.status !== 'undefined' && ['proposed','approved','rejected'].includes(p.status)) doc.status = p.status;
    if (Array.isArray(p.tags)) doc.tags = p.tags.map(String).filter(Boolean);
    if (Array.isArray(p.targets)) doc.targets = p.targets.map((t)=>({ type: ['goal','project','assumption','other'].includes(t?.type)? t.type : 'project', ref: t?.ref || {}, label: String(t?.label||'').trim() }));
    if (Array.isArray(p.impacts)) doc.impacts = p.impacts.map((im)=>({ assumptionKey: String(im?.assumptionKey||'').trim(), oldValue: String(im?.oldValue||'').trim(), newValue: String(im?.newValue||'').trim(), note: String(im?.note||'').trim() })).filter((im)=> im.assumptionKey);
    await doc.save();
    return res.json({ decision: doc });
  } catch (err) { next(err); }
};

