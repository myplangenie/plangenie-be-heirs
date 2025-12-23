const Journey = require('../models/Journey');
const Assumption = require('../models/Assumption');
const Scenario = require('../models/Scenario');

function id(prefix='a_') { return `${prefix}${Math.random().toString(36).slice(2,10)}`; }
const NUM = (v) => { const n = parseFloat(String(v||'').replace(/[^0-9.\-]/g,'')); return isFinite(n) ? n : 0; };

async function resolveJourney(userId, jid) {
  const j = await Journey.findOne({ user: userId, jid }).lean().exec();
  return j;
}

// GET /api/journeys/:jid/assumptions?category=
exports.list = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const j = await resolveJourney(userId, String(req.params?.jid||'').trim());
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const q = { user: userId, journey: j._id };
    const cat = String(req.query?.category || '').trim();
    if (cat) q.category = cat;
    const items = await Assumption.find(q).sort({ createdAt: -1 }).lean().exec();
    return res.json({ items });
  } catch (err) { next(err); }
};

// POST /api/journeys/:jid/assumptions { key, label?, category?, unit?, value }
exports.create = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const jid = String(req.params?.jid||'').trim();
    const j = await resolveJourney(userId, jid);
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const key = String(req.body?.key || '').trim();
    const value = String(req.body?.value || '').trim();
    if (!key) return res.status(400).json({ message: 'Key is required' });
    const label = String(req.body?.label || '').trim() || key;
    const category = ['revenue','cost','headcount','pricing','other'].includes(req.body?.category) ? req.body.category : 'other';
    const unit = String(req.body?.unit || '').trim();
    const aid = id();
    const doc = await Assumption.create({ user: userId, journey: j._id, aid, key, label, category, unit, currentValue: value, history: [{ version: 1, value, changedBy: String(userId) }] });
    return res.status(201).json({ assumption: doc });
  } catch (err) { next(err); }
};

// GET /api/journeys/:jid/assumptions/:aid
exports.get = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const j = await resolveJourney(userId, String(req.params?.jid||'').trim());
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const aid = String(req.params?.aid||'').trim();
    const doc = await Assumption.findOne({ user: userId, journey: j._id, aid }).lean().exec();
    if (!doc) return res.status(404).json({ message: 'Assumption not found' });
    return res.json({ assumption: doc });
  } catch (err) { next(err); }
};

// PATCH /api/journeys/:jid/assumptions/:aid { value?, label?, unit?, category? }
exports.patch = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const j = await resolveJourney(userId, String(req.params?.jid||'').trim());
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const aid = String(req.params?.aid||'').trim();
    const doc = await Assumption.findOne({ user: userId, journey: j._id, aid });
    if (!doc) return res.status(404).json({ message: 'Assumption not found' });
    const p = req.body || {};
    if (typeof p.label !== 'undefined') doc.label = String(p.label||'');
    if (typeof p.unit !== 'undefined') doc.unit = String(p.unit||'');
    if (typeof p.category !== 'undefined' && ['revenue','cost','headcount','pricing','other'].includes(p.category)) doc.category = p.category;
    if (typeof p.value !== 'undefined') {
      const newVal = String(p.value||'');
      const ver = (doc.history && doc.history.length ? (Math.max(...doc.history.map((h)=> Number(h.version)||0)) + 1) : 1);
      doc.currentValue = newVal;
      doc.history = (doc.history || []).concat([{ version: ver, value: newVal, changedBy: String(userId), changedAt: new Date() }]);
    }
    await doc.save();
    return res.json({ assumption: doc });
  } catch (err) { next(err); }
};

// GET /api/journeys/:jid/assumptions/:aid/history
exports.history = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const j = await resolveJourney(userId, String(req.params?.jid||'').trim());
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const aid = String(req.params?.aid||'').trim();
    const doc = await Assumption.findOne({ user: userId, journey: j._id, aid }).lean().exec();
    if (!doc) return res.status(404).json({ message: 'Assumption not found' });
    return res.json({ history: Array.isArray(doc.history) ? doc.history : [] });
  } catch (err) { next(err); }
};

// GET /api/journeys/:jid/assumptions/summary?sid=
exports.summary = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const j = await resolveJourney(userId, String(req.params?.jid||'').trim());
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const sid = String(req.query?.sid || '').trim();
    const [assumptions, scenario] = await Promise.all([
      Assumption.find({ user: userId, journey: j._id }).lean().exec(),
      sid ? Scenario.findOne({ user: userId, journey: j._id, sid }).lean().exec() : null,
    ]);
    const map = new Map((assumptions||[]).map((a)=> [String(a.key), a]));
    const override = new Map();
    if (scenario && Array.isArray(scenario.overrides)) {
      for (const o of scenario.overrides) override.set(String(o.assumptionKey), String(o.value||''));
    }
    const get = (key, fallbackKey) => {
      const k = map.get(String(key)) || (fallbackKey ? map.get(String(fallbackKey)) : null);
      if (!k) return 0;
      const val = override.has(String(key)) ? override.get(String(key)) : k.currentValue;
      return NUM(val);
    };
    // Simple model
    const salesVol = get('salesVolume');
    const price = get('pricePerUnit','price');
    const unitCost = get('avgUnitCost');
    const fixed = get('fixedOperatingCosts','fixedCosts');
    const marketing = get('marketingSpend');
    const payroll = get('payrollCost');
    const growthPct = get('growthRatePct')/100;
    const startingCash = get('startingCash');
    const additionalFunding = get('additionalFundingAmount','additionalFunding');

    const revenue0 = salesVol * price;
    const cogs0 = salesVol * unitCost;
    const costs0 = cogs0 + fixed + marketing + payroll;
    const profit0 = revenue0 - costs0;
    const monthlyBurn = Math.max(costs0 - revenue0, 0);
    const runwayMonths = monthlyBurn > 0 ? Math.round((startingCash + additionalFunding) / monthlyBurn) : null;

    // Project 12 months
    const months = Array.from({length: 12}, (_, i) => i);
    let vol = salesVol;
    let cash = startingCash + additionalFunding;
    const series = months.map((i) => {
      if (i>0) vol = vol * (1 + (isFinite(growthPct) ? growthPct : 0));
      const revenue = vol * price;
      const cogs = vol * unitCost;
      const costs = cogs + fixed + marketing + payroll;
      const profit = revenue - costs;
      cash += profit;
      return { month: i+1, revenue: Math.round(revenue), costs: Math.round(costs), profit: Math.round(profit), cash: Math.round(cash) };
    });
    return res.json({ summary: {
      monthly: { revenue: Math.round(revenue0), costs: Math.round(costs0), profit: Math.round(profit0) },
      runwayMonths: runwayMonths == null ? null : runwayMonths,
      projection: series,
    }});
  } catch (err) { next(err); }
};

// Scenarios
// GET /api/journeys/:jid/scenarios
exports.listScenarios = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const j = await resolveJourney(userId, String(req.params?.jid||'').trim());
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const items = await Scenario.find({ user: userId, journey: j._id }).lean().exec();
    return res.json({ items });
  } catch (err) { next(err); }
};

// POST /api/journeys/:jid/scenarios { name, overrides? }
exports.createScenario = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const j = await resolveJourney(userId, String(req.params?.jid||'').trim());
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    // Gating
    try {
      const ent = require('../config/entitlements');
      const User = require('../models/User');
      const user = await User.findById(userId).lean().exec();
      if (!ent.hasFeature(user, 'assumptionScenarios')) {
        return res.status(402).json({ code: 'UPGRADE_REQUIRED', message: 'Scenarios are available on Pro plan', plan: ent.effectivePlan(user) });
      }
    } catch {}
    const name = String(req.body?.name||'').trim();
    if (!name) return res.status(400).json({ message: 'Name is required' });
    const sid = `s_${Math.random().toString(36).slice(2,10)}`;
    const overrides = Array.isArray(req.body?.overrides) ? req.body.overrides.map((o)=> ({ assumptionKey: String(o?.assumptionKey||'').trim(), value: String(o?.value||'').trim() })).filter((o)=> o.assumptionKey) : [];
    const doc = await Scenario.create({ user: userId, journey: j._id, sid, name, isBaseline: false, overrides });
    return res.status(201).json({ scenario: doc });
  } catch (err) { next(err); }
};

// PATCH /api/journeys/:jid/scenarios/:sid { name?, isBaseline?, overrides? }
exports.patchScenario = async (req, res, next) => {
  try {
    const userId = req.user?.id; if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const j = await resolveJourney(userId, String(req.params?.jid||'').trim());
    if (!j) return res.status(404).json({ message: 'Journey not found' });
    const sid = String(req.params?.sid||'').trim();
    const doc = await Scenario.findOne({ user: userId, journey: j._id, sid });
    if (!doc) return res.status(404).json({ message: 'Scenario not found' });
    const p = req.body || {};
    if (typeof p.name !== 'undefined') doc.name = String(p.name||'');
    if (Array.isArray(p.overrides)) doc.overrides = p.overrides.map((o)=> ({ assumptionKey: String(o?.assumptionKey||'').trim(), value: String(o?.value||'').trim() })).filter((o)=> o.assumptionKey);
    if (typeof p.isBaseline !== 'undefined') {
      const v = !!p.isBaseline;
      doc.isBaseline = v;
      if (v) await Scenario.updateMany({ user: userId, journey: j._id, _id: { $ne: doc._id } }, { $set: { isBaseline: false } });
    }
    await doc.save();
    return res.json({ scenario: doc });
  } catch (err) { next(err); }
};

