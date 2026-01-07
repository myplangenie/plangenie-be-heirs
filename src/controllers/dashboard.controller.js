const Dashboard = require('../models/Dashboard');
const Onboarding = require('../models/Onboarding');
const User = require('../models/User');
const { hasDepartmentRestriction, filterCompiledPlan, filterActionAssignments } = require('../utils/filterByDepartment');
const { getWorkspaceFilter, getWorkspaceId, addWorkspaceToDoc } = require('../utils/workspaceQuery');
const Notification = require('../models/Notification');
const NotificationSettings = require('../models/NotificationSettings');
const Department = require('../models/Department');
const Financials = require('../models/Financials');
const Plan = require('../models/Plan');
const PlanSection = require('../models/PlanSection');
const TeamMember = require('../models/TeamMember');
const nodeCrypto = require('crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { getR2Client } = require('../config/r2');
const ejs = require('ejs');
const path = require('path');

function ensureId(prefix = '') {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

// Shared helper to parse base64 data URLs for image uploads
function parseDataUrl(dataUrl) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const isBase64 = !!m[2];
  const data = m[3];
  try {
    const buf = isBase64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
    return { mime, buf };
  } catch (_) {
    return null;
  }
}

// Minimal dashboard doc helper: create empty doc only as needed, no seeded content
// Now workspace-aware
async function getOrCreate(userId, workspaceId = null) {
  const filter = { user: userId };
  if (workspaceId) filter.workspace = workspaceId;
  let doc = await Dashboard.findOne(filter);
  if (doc) return doc;
  const createData = { user: userId, summary: {} };
  if (workspaceId) createData.workspace = workspaceId;
  doc = await Dashboard.create(createData);
  return doc;
}

// Note: Insight item formatting is handled by OpenAI; avoid server-side prefixing.


// GET /api/dashboard/summary
exports.getSummary = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    // Pull latest onboarding answers to reflect user's inputs
    const ob = await Onboarding.findOne(wsFilter).lean().exec();
    const a = ob?.answers || {};
    const ubp = (a.ubp || ob?.vision?.ubp || '').trim();
    const purpose = String(a.purpose || '').trim();
    const oneYear = (a.vision1y || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const threeYear = (a.vision3y || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const vision = oneYear[0] || threeYear[0] || '';
    // Long-term Strategic Vision (BHAG) with robust fallbacks
    // Prefer explicit BHAG saved in answers; otherwise fall back to 3-year or 1-year goals
    let bhag = String(a.visionBhag || '').trim();
    if (!bhag) {
      const threeJoined = (threeYear || []).join('\n').trim();
      const oneJoined = (oneYear || []).join('\n').trim();
      bhag = threeJoined || oneJoined || vision;
    }
    const assignments = a.actionAssignments || {};
    const activePlans = Object.values(assignments || {})
      .flat()
      .map((u) => {
        const prog = Number(u?.progress);
        const derived = isFinite(prog)
          ? (prog >= 100 ? 'Completed' : (prog > 0 ? 'In progress' : 'Not started'))
          : 'Not started';
        const st = String(u?.status || derived).trim();
        return ({
          title: String(u?.title || '').trim(),
          owner: `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim(),
          milestone: String(u?.milestone || '').trim(),
          resources: String(u?.resources || '').trim(),
          cost: (() => { const raw = String(u?.cost || '').trim(); const m = raw.match(/([$£€]?\s?\d[\d,]*(?:\.\d+)?)/); return m ? m[1].replace(/\s/g,'') : raw.replace(/[^0-9.]/g,''); })(),
          kpi: String(u?.kpi || '').trim(),
          due: String(u?.dueWhen || '').trim(),
          status: st,
        });
      })
      .filter((p) => p.title)
      .slice(0, 12);
    // Basic finance chart from answers (first 6 months)
    function num(s) { if (s == null) return 0; const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }
    const growth = num(a.finSalesGrowthPct) / 100;
    const fixed = num(a.finFixedOperatingCosts) + num(a.finMarketingSalesSpend) + num(a.finPayrollCost);
    // Derive from products when explicit inputs aren't provided
    let totalVolFromProducts = 0, avgCostFromProducts = 0, avgPrice = 0;
    try {
      const list = Array.isArray(a.products) ? a.products : [];
      const nums = list.map((p)=>({ v: num(p.monthlyVolume), price: num(p.price ?? p.pricing), cost: num(p.unitCost) }));
      totalVolFromProducts = nums.reduce((sum, r)=> sum + (r.v||0), 0);
      const totalW = nums.reduce((sum, r)=> sum + (r.v||0), 0);
      const sumPrice = nums.reduce((sum, r)=> sum + ((r.price||0)*(r.v||0)), 0);
      const sumCost = nums.reduce((sum, r)=> sum + ((r.cost||0)*(r.v||0)), 0);
      avgPrice = totalW ? (sumPrice/totalW) : 0;
      avgCostFromProducts = totalW ? (sumCost/totalW) : 0;
    } catch {}
    const units0 = num(a.finSalesVolume) || totalVolFromProducts;
    const avgCost = num(a.finAvgUnitCost) || avgCostFromProducts;
    if (!avgPrice && avgCost) {
      const m = num(a.finTargetProfitMarginPct)/100; avgPrice = m < 0.99 ? (avgCost/(1-m||1)) : avgCost;
    }
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const chart = Array.from({length:6}, (_,i)=>{
      const units = units0 * Math.pow(1+growth, i);
      const revenue = units * (avgPrice||0);
      const cogs = units * (avgCost||0);
      const cost = cogs + fixed;
      const profit = revenue - cost;
      return { name: months[i], Revenue: Math.round(revenue/1000), Cost: Math.round(cost/1000), Profit: Math.round(Math.max(profit,0)/1000) };
    });
    // Departmental progress from assignments
    const departmentProgress = Object.entries(assignments || {}).map(([key, arr]) => {
      const filled = (arr||[]).filter((u) => (u && (u.goal||'').trim())).length;
      const progress = Math.min(100, Math.round(((filled || 0)/Math.max(1,(arr||[]).length))*100));
      return { name: key, percent: progress };
    });
    // Pull any previously generated insights saved for this user
    const dash = await Dashboard.findOne(wsFilter).lean().exec();
    const savedInsights = (dash && dash.summary && Array.isArray(dash.summary.insights)) ? dash.summary.insights : [];
    const savedSections = (dash && dash.summary && Array.isArray(dash.summary.insightSections)) ? dash.summary.insightSections : [];
    // Build team with simple responsibility note
    const org = Array.isArray(a.orgPositions) ? a.orgPositions : [];
    const domain = (p) => {
      const d = String(p?.department || '').trim();
      if (d) return d;
      const role = String(p?.position || '').trim();
      const m = role.match(/(marketing|sales|operations|service|finance|admin|people|human resources|hr|partnerships|alliances|technology|infrastructure|community|impact)/i);
      if (m) return m[0].replace(/\bhr\b/i, 'Human Resources').replace(/\bservice\b/i, 'Service Delivery');
      return role || 'their role';
    };
    const teamList = org.map((p) => {
      const dom = domain(p);
      const lower = String(dom).toLowerCase();
      const note = `In charge of ${dom} and everything that has to do with ${lower}`;
      return { name: p.name, role: p.position, note };
    });
    const summary = {
      kpis: { overdueTasks: 0, activeTeamMembers: Array.isArray(a.orgPositions)?a.orgPositions.length:0 },
      milestones: [],
      departmentProgress,
      financeChart: chart,
      activePlans,
      insights: savedInsights,
      insightSections: savedSections,
      snapshot: { vision, ubp, purpose, bhag },
      team: teamList,
    };
    // Compute readiness: Core Strategic Projects presence
    const coreProjectDetails = Array.isArray(a.coreProjectDetails) ? a.coreProjectDetails : [];
    const coreProjectsFlat = Array.isArray(a.coreProjects) ? a.coreProjects.filter((s)=> String(s||'').trim()) : [];
    const coreProjectsCount = coreProjectDetails.length || coreProjectsFlat.length || 0;
    const coreProjectsExist = coreProjectsCount > 0;
    return res.json({ summary, coreProjects: { exists: coreProjectsExist, count: coreProjectsCount } });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/financials/insights
exports.generateFinancialInsights = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne(wsFilter).lean().exec();
    const a = ob?.answers || {};
    // Derive context similar to getFinancials()
    function num(s) { if (s == null) return 0; const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }
    const growth = num(a.finSalesGrowthPct) / 100;
    let totalVolFromProducts = 0, avgCostFromProducts = 0, avgPrice = 0;
    try {
      const list = Array.isArray(a.products) ? a.products : [];
      const nums = list.map((p)=>({ v: num(p.monthlyVolume), price: num(p.price ?? p.pricing), cost: num(p.unitCost) }));
      totalVolFromProducts = nums.reduce((sum, r)=> sum + (r.v||0), 0);
      const totalW = nums.reduce((sum, r)=> sum + (r.v||0), 0);
      const sumPrice = nums.reduce((sum, r)=> sum + ((r.price||0)*(r.v||0)), 0);
      const sumCost = nums.reduce((sum, r)=> sum + ((r.cost||0)*(r.v||0)), 0);
      avgPrice = totalW ? (sumPrice/totalW) : 0;
      avgCostFromProducts = totalW ? (sumCost/totalW) : 0;
    } catch {}
    const units0 = num(a.finSalesVolume) || totalVolFromProducts;
    const avgCost = num(a.finAvgUnitCost) || avgCostFromProducts;
    const fixedOperating = num(a.finFixedOperatingCosts);
    const marketingSpend = num(a.finMarketingSalesSpend);
    const payrollCost = num(a.finPayrollCost);
    const fixed = fixedOperating + marketingSpend + payrollCost;
    if (!avgPrice && avgCost) {
      const m = num(a.finTargetProfitMarginPct)/100; avgPrice = m < 0.99 ? (avgCost/(1-m||1)) : avgCost;
    }
    // Month 1 estimates
    const revenueM1 = units0 * (avgPrice||0);
    const cogsM1 = units0 * (avgCost||0);
    const costM1 = cogsM1 + fixed;
    const profitM1 = revenueM1 - costM1;
    const startCash = num(a.finStartingCash);
    const fundAmt = num(a.finAdditionalFundingAmount);
    const monthlyBurn = Math.max(costM1 - revenueM1, 0);
    const runway = monthlyBurn > 0 ? Math.round((startCash + fundAmt) / monthlyBurn) : null;
    const nonce = (req.body && Object.prototype.hasOwnProperty.call(req.body, 'nonce')) ? String(req.body.nonce) : '';
    const contextText = [
      'Financial Context:',
      `Monthly units (initial): ${Math.round(units0)}`,
      `Avg price: ${Math.round(avgPrice)}`,
      `Avg unit cost: ${Math.round(avgCost)}`,
      `Fixed operating: ${Math.round(fixedOperating)}`,
      `Marketing spend: ${Math.round(marketingSpend)}`,
      `Payroll cost: ${Math.round(payrollCost)}`,
      `Projected Monthly Revenue (M1): ${Math.round(revenueM1)}`,
      `Projected Monthly Costs (M1): ${Math.round(costM1)}`,
      `Projected Net Profit (M1): ${Math.round(profitM1)}`,
      `Starting Cash: ${Math.round(startCash)}`,
      `Additional Funding: ${Math.round(fundAmt)}`,
      `Estimated Runway (months): ${runway ?? 'N/A'}`,
      `Growth rate (monthly): ${Math.round(growth*100)}%`,
    ]
      .concat(nonce ? [`Variation seed: ${nonce}`] : [])
      .join('\n');
    const ai = require('./ai.controller');
    const items = await ai.generateFinancialInsightsFromContext(contextText, 3);
    // Persist on dashboard summary so collaborators can read the same items
    try {
      const doc = await getOrCreate(userId);
      doc.summary = doc.summary || {};
      doc.summary.financialInsights = items;
      try { doc.markModified && doc.markModified('summary'); } catch {}
      await doc.save();
    } catch (_) {}
    return res.json({ items });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/financials/insights — return saved financial insights (owner context)
exports.getFinancialInsights = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const dash = await Dashboard.findOne(wsFilter).lean().exec();
    let items = [];
    try {
      if (dash && dash.summary && Array.isArray(dash.summary.financialInsights)) {
        items = dash.summary.financialInsights;
      }
      // Fallback to general insight sections (first section) if financial-specific not present
      if ((!items || items.length === 0) && dash && dash.summary && Array.isArray(dash.summary.insightSections)) {
        const first = dash.summary.insightSections[0];
        if (first && Array.isArray(first.items)) items = first.items.slice(0, 3);
      }
      // Final fallback to legacy summary.insights (flat)
      if ((!items || items.length === 0) && dash && dash.summary && Array.isArray(dash.summary.insights)) {
        items = dash.summary.insights.slice(0, 3);
      }
    } catch (_) {}
    return res.json({ items: Array.isArray(items) ? items : [] });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/insights
exports.getInsights = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const dash = await Dashboard.findOne(wsFilter).lean().exec();
    const sections = (dash && dash.summary && Array.isArray(dash.summary.insightSections)) ? dash.summary.insightSections : [];
    // Back-compat: if only flat insights exist, wrap into a single section
    let out = sections;
    if ((!out || out.length === 0) && dash && dash.summary && Array.isArray(dash.summary.insights) && dash.summary.insights.length) {
      out = [{ title: 'Recommendations', items: dash.summary.insights.slice(0, 3) }];
    }
    return res.json({ sections: out });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/insights/generate
// Generates insights from current action plans and saves them
exports.generateInsights = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const sectionTitle = String(req.body?.sectionTitle || '').trim();
    const ob = await Onboarding.findOne(wsFilter).lean().exec();
    const assignments = (ob && ob.answers && ob.answers.actionAssignments) ? ob.answers.actionAssignments : {};

    const ai = require('./ai.controller');
    const doc = await getOrCreate(userId);
    doc.summary = doc.summary || {};
    doc.summary.insightSections = Array.isArray(doc.summary.insightSections) ? doc.summary.insightSections : [];

    if (sectionTitle) {
      // Regenerate only one section
      let section;
      try {
        section = await ai.generateSingleInsightSectionForUser(userId, assignments, sectionTitle);
      } catch (err) {
        if (err && err.code === 'NO_API_KEY') {
          return res.status(500).json({ message: 'OpenAI API key not configured on server' });
        }
        const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate insights';
        return res.status(500).json({ message });
      }
      const idx = doc.summary.insightSections.findIndex((s) => String(s?.title || '').toLowerCase() === sectionTitle.toLowerCase());
      if (idx === -1) doc.summary.insightSections.push(section); else doc.summary.insightSections[idx] = section;
      // Maintain a flattened top-level insights (first items) for any legacy consumers
      doc.summary.insights = (doc.summary.insightSections[0]?.items || []).slice(0, 3);
      await doc.save();
      return res.json({ sections: doc.summary.insightSections });
    } else {
      // Generate full set
      let sections = [];
      try {
        sections = await ai.generateActionInsightSectionsForUser(userId, assignments, 2);
      } catch (err) {
        if (err && err.code === 'NO_API_KEY') {
          return res.status(500).json({ message: 'OpenAI API key not configured on server' });
        }
        const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate insights';
        return res.status(500).json({ message });
      }
      doc.summary.insightSections = sections;
      doc.summary.insights = (sections[0]?.items || []).slice(0, 3);
      await doc.save();
      return res.json({ sections });
    }
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/settings/members
// Create a new member inside Org Chart answers
exports.createMember = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { name, email, position, department, status, parentId } = req.body || {};
    const nm = String(name || '').trim();
    if (!nm) return res.status(400).json({ message: 'Name is required' });
    const ob = await Onboarding.findOne(wsFilter);
    if (!ob) return res.status(400).json({ message: 'Onboarding not initialized' });
    const a = ob.answers || {};
    const list = Array.isArray(a.orgPositions) ? a.orgPositions : [];
    const id = (nodeCrypto.randomUUID && nodeCrypto.randomUUID()) || (`m_${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const entry = {
      id,
      name: nm,
      email: typeof email === 'string' ? email : '',
      position: typeof position === 'string' ? position : '',
      department: typeof department === 'string' ? department : '',
      status: typeof status === 'string' ? status : 'Active',
      parentId: typeof parentId === 'string' && parentId.trim() ? parentId.trim() : null,
      role: '',
    };
    list.push(entry);
    ob.answers = { ...a, orgPositions: list };
    try { ob.markModified('answers'); } catch {}
    await ob.save();
    const member = {
      mid: id,
      name: entry.name,
      email: entry.email,
      position: entry.position,
      department: entry.department,
      status: entry.status,
    };
    return res.status(201).json({ member });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/strategy-canvas
exports.getStrategyCanvas = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne(wsFilter).lean().exec();
    const a = ob?.answers || {};
    const ubp = (a.ubp || ob?.vision?.ubp || '').trim();
    const oneYear = (a.vision1y || '').split('\n').map((s)=>s.trim()).filter(Boolean);
    const threeYear = (a.vision3y || '').split('\n').map((s)=>s.trim()).filter(Boolean);
    const purpose = String(a.purpose || '').trim();
    const summary = String(a.identitySummary || '').trim();
    const values = { core: String(a.valuesCore || '').trim(), culture: String(a.cultureFeeling || '').trim() };
    const swot = {
      strengths: String(a.swotStrengths || '').split('\n').map((s)=>s.trim()).filter(Boolean),
      weaknesses: String(a.swotWeaknesses || '').split('\n').map((s)=>s.trim()).filter(Boolean),
      opportunities: String(a.swotOpportunities || '').split('\n').map((s)=>s.trim()).filter(Boolean),
      threats: String(a.swotThreats || '').split('\n').map((s)=>s.trim()).filter(Boolean),
    };
    const goals = Object.values(a.actionAssignments || {})
      .flat()
      .map((u)=> String(u?.goal||'').trim())
      .filter(Boolean);
    return res.json({ canvas: { ubp, purpose, oneYear, threeYear, summary, goals, values, swot } });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/dashboard/strategy-canvas
// Allows direct editing of core canvas fields from the dashboard UI
exports.updateStrategyCanvas = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const patch = req.body || {};
    const ent = require('../config/entitlements');
    const User = require('../models/User');
    const user = await User.findById(userId).lean().exec();
    const ob = (await Onboarding.findOne(wsFilter)) || (await Onboarding.create(addWorkspaceToDoc({ user: userId }, req)));
    const a = ob.answers || {};
    // Update UBPs and horizons
    if (typeof patch.ubp !== 'undefined') {
      const v = String(patch.ubp || '');
      a.ubp = v;
      ob.vision = { ...(ob.vision || {}), ubp: v };
    }
    if (typeof patch.purpose !== 'undefined') {
      a.purpose = String(patch.purpose || '');
    }
    if (typeof patch.oneYear !== 'undefined') {
      a.vision1y = Array.isArray(patch.oneYear) ? patch.oneYear.map(String).join('\n') : String(patch.oneYear || '');
    }
    if (typeof patch.threeYear !== 'undefined') {
      a.vision3y = Array.isArray(patch.threeYear) ? patch.threeYear.map(String).join('\n') : String(patch.threeYear || '');
    }
    if (typeof patch.summary !== 'undefined') {
      a.identitySummary = String(patch.summary || '');
    }
    // Optionally accept explicit goals list (flat) to update action assignments
    if (Array.isArray(patch.goals)) {
      const limit = ent.getLimit(user, 'maxGoals');
      if (limit && patch.goals.length > limit) {
        return res.status(402).json({ code: 'LIMIT_EXCEEDED', message: 'Lite plan allows up to 3 goals', plan: ent.effectivePlan(user), limit, limitKey: 'maxGoals', upgradeTo: 'pro' });
      }
      const gg = patch.goals.map((g) => ({ goal: String(g || '') })).filter((g) => g.goal);
      // Persist under a neutral bucket to avoid losing department context; keep existing if empty
      const curr = a.actionAssignments || {};
      curr._canvas = gg; // special bucket; UI may treat separately
      a.actionAssignments = curr;
    }
    ob.answers = a;
    await ob.save();
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/plan/compiled
exports.saveCompiledPlan = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const cp = req.body || {};
    const ent = require('../config/entitlements');
    const user = await User.findById(userId).lean().exec();
    const plan = ent.effectivePlan(user);
    const ob = await Onboarding.findOne(wsFilter) || await Onboarding.create(addWorkspaceToDoc({ user: userId }, req));
    ob.userProfile = {
      ...(ob.userProfile || {}),
      ...(cp.userProfile || {}),
    };
    if (cp.businessProfile) {
      ob.businessProfile = {
        ...(ob.businessProfile || {}),
        businessName: cp.businessProfile.businessName || (ob.businessProfile && ob.businessProfile.businessName) || '',
        ventureType: cp.businessProfile.ventureType || (ob.businessProfile && ob.businessProfile.ventureType) || '',
      };
    }
    if (cp.vision) {
      ob.vision = { ...(ob.vision || {}), ubp: cp.vision.ubp || (ob.vision && ob.vision.ubp) || '' };
    }
    const a = ob.answers || {};
    // Vision & values
    if (cp.vision) {
      if (typeof cp.vision.oneYear !== 'undefined') a.vision1y = Array.isArray(cp.vision.oneYear) ? cp.vision.oneYear.join('\n') : String(cp.vision.oneYear || '');
      if (typeof cp.vision.threeYear !== 'undefined') a.vision3y = Array.isArray(cp.vision.threeYear) ? cp.vision.threeYear.join('\n') : String(cp.vision.threeYear || '');
      if (typeof cp.vision.ubp !== 'undefined') a.ubp = String(cp.vision.ubp || '');
      if (typeof cp.vision.purpose !== 'undefined') a.purpose = String(cp.vision.purpose || '');
    }
    if (cp.values) {
      if (typeof cp.values.core !== 'undefined') a.valuesCore = String(cp.values.core || '');
      if (typeof cp.values.culture !== 'undefined') a.cultureFeeling = String(cp.values.culture || '');
    }
    // Market
    if (cp.market) {
      if (typeof cp.market.customer !== 'undefined') a.marketCustomer = String(cp.market.customer || '');
      if (typeof cp.market.partners !== 'undefined') a.partnersDesc = String(cp.market.partners || '');
      if (typeof cp.market.competitors !== 'undefined') a.compNotes = String(cp.market.competitors || '');
      if (typeof cp.market.competitorNames !== 'undefined' && Array.isArray(cp.market.competitorNames)) a.competitorNames = cp.market.competitorNames.map(String);
    }
    // Products (preserve legacy pricing while accepting new structured fields)
    if (Array.isArray(cp.products)) a.products = cp.products.map((p)=>({
      product: String(p.product||''),
      description: String(p.description||''),
      pricing: typeof p.pricing !== 'undefined' ? String(p.pricing||'') : undefined,
      unitCost: typeof p.unitCost !== 'undefined' ? String(p.unitCost||'') : undefined,
      price: typeof p.price !== 'undefined' ? String(p.price||'') : undefined,
      monthlyVolume: typeof p.monthlyVolume !== 'undefined' ? String(p.monthlyVolume||'') : undefined,
    }));
    // Org (team members)
    if (Array.isArray(cp.org)) {
      a.orgPositions = cp.org.map((n)=>({ id: n.id || undefined, name: String(n.name||''), position: String(n.position||''), department: n.department || null, parentId: n.parentId || null, role: '' }));
    }
    // Financial
    if (cp.financial) {
      const f = cp.financial || {};
      a.finSalesVolume = String(f.salesVolume || a.finSalesVolume || '');
      a.finSalesGrowthPct = String(f.salesGrowthPct || a.finSalesGrowthPct || '');
      a.finAvgUnitCost = String(f.avgUnitCost || a.finAvgUnitCost || '');
      a.finFixedOperatingCosts = String(f.fixedOperatingCosts || a.finFixedOperatingCosts || '');
      a.finMarketingSalesSpend = String(f.marketingSalesSpend || a.finMarketingSalesSpend || '');
      a.finPayrollCost = String(f.payrollCost || a.finPayrollCost || '');
      a.finStartingCash = String(f.startingCash || a.finStartingCash || '');
      a.finAdditionalFundingAmount = String(f.additionalFundingAmount || a.finAdditionalFundingAmount || '');
      a.finAdditionalFundingMonth = String(f.additionalFundingMonth || a.finAdditionalFundingMonth || '');
      a.finPaymentCollectionDays = String(f.paymentCollectionDays || a.finPaymentCollectionDays || '');
      a.finTargetProfitMarginPct = String(f.targetProfitMarginPct || a.finTargetProfitMarginPct || '');
      a.finIsNonprofit = String(f.isNonprofit || a.finIsNonprofit || '');
    }
    // Core Strategic Projects
    if (Array.isArray(cp.coreProjects)) {
      const v = cp.coreProjects.map((s) => String(s || '')).filter((s) => s && s.trim());
      const limit = ent.getLimit(user, 'maxCoreProjects');
      if (limit && v.length > limit) {
        return res.status(402).json({ code: 'LIMIT_EXCEEDED', message: 'Lite plan allows up to 3 core projects', plan, limit, limitKey: 'maxCoreProjects', upgradeTo: 'pro' });
      }
      a.coreProjects = v;
    }
    // Core Strategic Projects (detailed: deliverables with completion)
    if (Array.isArray(cp.coreProjectDetails)) {
      try {
        const all = (cp.coreProjectDetails || []).map((p) => ({
  title: String((p && p.title) || '').trim(),
  goal: typeof p?.goal !== 'undefined' ? String(p.goal || '').trim() : undefined,
  kpi: typeof p?.kpi !== 'undefined' ? String(p.kpi || '').trim() : undefined,
  cost: typeof p?.cost !== 'undefined' ? String(p.cost || '').trim() : undefined,
  dueWhen: typeof p?.dueWhen !== 'undefined' ? String(p.dueWhen || '').trim() : undefined,
  priority: p?.priority ? String(p.priority) : undefined,
  ownerId: p?.ownerId ? String(p.ownerId) : undefined,
  ownerName: p?.ownerName ? String(p.ownerName) : undefined,
  linkedGoals: Array.isArray(p?.linkedGoals) ? p.linkedGoals.filter(g => typeof g === 'number') : undefined,
  departments: Array.isArray(p?.departments) ? p.departments.filter(d => typeof d === 'string') : undefined,
  relatedProjects: Array.isArray(p?.relatedProjects) ? p.relatedProjects.filter(r => typeof r === 'number') : undefined,
  deliverables: Array.isArray(p && p.deliverables)
    ? (p.deliverables || []).map((d) => ({
        text: String((d && d.text) || '').trim(),
        done: Boolean(d && d.done),
        kpi: typeof d?.kpi !== 'undefined' ? String(d.kpi || '').trim() : undefined,
        dueWhen: typeof d?.dueWhen !== 'undefined' ? String(d.dueWhen || '').trim() : undefined,
      }))
    : [],
})).filter((p) => p.title || (p.deliverables && p.deliverables.length));
        const limit = ent.getLimit(user, 'maxCoreProjects');
        if (limit && all.length > limit) {
          return res.status(402).json({ code: 'LIMIT_EXCEEDED', message: 'Lite plan allows up to 3 core projects', plan, limit, limitKey: 'maxCoreProjects', upgradeTo: 'pro' });
        }
        a.coreProjectDetails = all;
      } catch (_) {
        // ignore malformed payloads
      }
    }
    // Persist customizable action plan sections (user-defined department list with labels)
    if (Array.isArray(cp.actionSections)) {
      try {
        const norm = (cp.actionSections || []).map((s) => ({
          key: String(s && s.key || '').trim(),
          label: String(s && s.label || '').trim(),
        })).filter((s) => s.key);
        a.actionSections = norm;
      } catch {}
    }
    // Action plans (departmental)
    if (cp.actionPlans && typeof cp.actionPlans === 'object') {
      if (!require('../config/entitlements').hasFeature(user, 'departmentPlans')) {
        return res.status(402).json({ code: 'UPGRADE_REQUIRED', message: 'This feature requires Plan Genie Pro', feature: 'departmentPlans', plan, upgradeTo: 'pro' });
      }
      const norm = {};
      const deriveStatus = (prog) => {
        const n = Number(prog);
        if (isFinite(n)) {
          if (n >= 100) return 'Completed';
          if (n > 0) return 'In progress';
          return 'Not started';
        }
        return 'Not started';
      };
      Object.keys(cp.actionPlans).forEach((k) => {
        const arr = Array.isArray(cp.actionPlans[k]) ? cp.actionPlans[k] : [];
        norm[k] = arr.map((u) => ({
          ...u,
          status: u && u.status ? u.status : deriveStatus(u && (u.progress)),
          progress: (u && typeof u.progress === 'number') ? Math.max(0, Math.min(100, Math.round(u.progress))) : 0,
        }));
      });
      a.actionAssignments = norm;
    }
    ob.answers = a;
    try { ob.markModified && ob.markModified('answers'); } catch {}
    await ob.save();
    // Optionally sync user full name
    if (cp.userProfile && cp.userProfile.fullName) {
      try { await User.findByIdAndUpdate(userId, { fullName: cp.userProfile.fullName }); } catch {}
    }
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/plan/compiled
exports.getCompiledPlan = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    let ob = await Onboarding.findOne(wsFilter).lean().exec();
    if (!ob) {
      // Initialize a minimal onboarding document to ensure downstream consumers have data
      const created = await Onboarding.create(addWorkspaceToDoc({ user: userId, answers: {} }, req));
      ob = created.toObject();
    }
    const a = ob.answers || {};
    const plan = {
      userProfile: { fullName: (ob.userProfile && ob.userProfile.fullName) || '' },
      businessProfile: { businessName: (ob.businessProfile && ob.businessProfile.businessName) || '', ventureType: (ob.businessProfile && ob.businessProfile.ventureType) || '' },
      vision: { ubp: a.ubp || (ob.vision && ob.vision.ubp) || '', purpose: a.purpose || '', oneYear: (a.vision1y || '').split('\n').filter(Boolean), threeYear: (a.vision3y || '').split('\n').filter(Boolean) },
      values: { core: a.valuesCore || '', culture: a.cultureFeeling || '', traits: Array.isArray(a.valuesCoreKeywords) ? a.valuesCoreKeywords.filter((t)=> typeof t === 'string' && t.trim()).slice(0, 3) : [] },
      market: { customer: a.marketCustomer || '', partners: a.partnersDesc || '', competitors: a.compNotes || '', competitorNames: a.competitorNames || [] },
      products: Array.isArray(a.products) ? a.products : [],
      org: Array.isArray(a.orgPositions) ? a.orgPositions.map((p)=>({ id: p.id, name: p.name, position: p.position, department: p.department || null, parentId: p.parentId || null })) : [],
      financial: {
        salesVolume: a.finSalesVolume || '',
        salesGrowthPct: a.finSalesGrowthPct || '',
        avgUnitCost: a.finAvgUnitCost || '',
        fixedOperatingCosts: a.finFixedOperatingCosts || '',
        marketingSalesSpend: a.finMarketingSalesSpend || '',
        payrollCost: a.finPayrollCost || '',
        startingCash: a.finStartingCash || '',
        additionalFundingAmount: a.finAdditionalFundingAmount || '',
        additionalFundingMonth: a.finAdditionalFundingMonth || '',
        paymentCollectionDays: a.finPaymentCollectionDays || '',
        targetProfitMarginPct: a.finTargetProfitMarginPct || '',
        isNonprofit: a.finIsNonprofit || '',
      },
      actionPlans: a.actionAssignments || {},
      actionSections: Array.isArray(a.actionSections) ? a.actionSections.map((s)=>({ key: String(s && s.key || '').trim(), label: String(s && s.label || '').trim() })) : undefined,
      coreProjects: Array.isArray(a.coreProjects) ? a.coreProjects : [],
      coreProjectDetails: Array.isArray(a.coreProjectDetails) ? a.coreProjectDetails : [],
      generatedAt: new Date().toISOString(),
      version: '1.0',
    };
    // Apply department filtering for restricted collaborators
    if (hasDepartmentRestriction(req.user)) {
      const filtered = filterCompiledPlan(plan, req.user.allowedDepartments);
      return res.json({ plan: filtered });
    }
    return res.json({ plan });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/notifications
exports.getNotifications = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    // Build dynamic task notifications from onboarding action assignments
    const ob = await Onboarding.findOne(wsFilter).lean().exec();
    const a = ob?.answers || {};
    let assignments = a.actionAssignments || {};
    // Filter assignments for department-restricted collaborators
    if (hasDepartmentRestriction(req.user)) {
      assignments = filterActionAssignments(assignments, req.user.allowedDepartments);
    }
    const now = new Date();
    function rel(d) {
      try {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return '';
        const diff = Math.round((dt - now) / (24*60*60*1000));
        if (diff === 0) return 'today';
        if (diff > 0) return `in ${diff} day${diff===1?'':'s'}`;
        const n = Math.abs(diff);
        return `${n} day${n===1?'':'s'} ago`;
      } catch { return ''; }
    }
    function sev(d) {
      try {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return 'info';
        const diff = Math.round((dt - now) / (24*60*60*1000));
        if (diff < 0) return 'danger';
        if (diff <= 3) return 'warning';
        return 'info';
      } catch { return 'info'; }
    }
    const items = [];
    // Load persisted notifications (e.g., collaboration invites)
    try {
      const docs = await Notification.find(wsFilter).sort({ createdAt: -1 }).limit(50).lean().exec();
      for (const n of docs) {
        items.push({
          nid: n.nid,
          title: n.title,
          description: n.description,
          type: n.type || 'info',
          severity: n.severity || 'info',
          time: n.time || '',
          actions: Array.isArray(n.actions) ? n.actions : [],
          read: !!n.read,
          data: n.data || null,
        });
      }
    } catch (_e) {}
    // Helper: compute completion percent for an assignment item
    const pctForItem = (it) => {
      const v = Number(it?.progress);
      if (isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
      const st = String(it?.status || '').toLowerCase();
      if (/done|complete|completed/.test(st)) return 100;
      if (/in[ _-]*progress/.test(st)) return 50;
      if (/not[ _-]*started/.test(st)) return 0;
      return 0;
    };
    Object.entries(assignments || {}).forEach(([dept, arr]) => {
      (arr || []).forEach((u) => {
        const goal = String(u?.goal || '').trim();
        const due = String(u?.dueWhen || '').trim();
        if (!goal) return;
        // Overdue should only show if the plan is not at 100%
        const base = sev(due);
        const s = (pctForItem(u) >= 100) ? 'info' : base;
        items.push({
          nid: `${dept}-${goal}-${due}`.slice(0, 80),
          title: (s === 'danger' ? 'Overdue: ' : s === 'warning' ? 'Upcoming: ' : 'Task: ') + goal,
          description: dept ? `Department: ${dept}` : undefined,
          type: 'task',
          severity: s,
          time: due ? rel(due) : '',
          actions: [{ label: 'View task', kind: 'primary' }],
          read: false,
        });
      });
    });
    // Put collaboration items first, then others (stable within groups)
    const collab = items.filter((it) => String(it.type) === 'collaboration');
    const other = items.filter((it) => String(it.type) !== 'collaboration');
    const ordered = [...collab, ...other];
    const prefs = await NotificationSettings.findOne({ user: userId }).lean().exec();
    return res.json({ items: ordered, preferences: { frequency: prefs?.frequency || 'Real-time', tone: prefs?.tone || 'Professional' } });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/notifications/mark-all-read
exports.markAllRead = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    await Notification.updateMany({ ...wsFilter, read: false }, { $set: { read: true } }).exec();
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/dashboard/notifications/preferences
exports.updateNotificationPrefs = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { frequency, tone } = req.body || {};
    const prefs = await NotificationSettings.findOneAndUpdate(
      { user: userId },
      {
        $set: {
          frequency: typeof frequency === 'string' ? frequency : undefined,
          tone: typeof tone === 'string' ? tone : undefined,
        },
        $setOnInsert: { user: userId },
      },
      { new: true, upsert: true }
    ).lean();
    return res.json({ preferences: { frequency: prefs.frequency, tone: prefs.tone } });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/departments
exports.getDepartments = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const [ob, user] = await Promise.all([
      Onboarding.findOne(wsFilter).lean().exec(),
      User.findById(userId).lean().exec(),
    ]);
    const a = ob?.answers || {};
    const assignments = a.actionAssignments || {};
    const label = (k) => ({
      marketing: 'Marketing', sales: 'Sales', operations:'Operations and Service Delivery', financeAdmin:'Finance and Admin', peopleHR:'People and Human Resources', partnerships:'Partnerships and Alliances', technology:'Technology and Infrastructure', communityImpact:'ESG and Sustainability'
    }[k] || k);
    const parseDate = (s) => { const m=String(s||'').match(/\d{4}-\d{2}-\d{2}/); return m?m[0]:''; };
    // Helper: compute completion percent for an assignment item
    const pctForItem = (it) => {
      const v = Number(it?.progress);
      if (isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
      const st = String(it?.status || '').toLowerCase();
      if (/done|complete|completed/.test(st)) return 100;
      if (/in[ _-]*progress/.test(st)) return 50;
      if (/not[ _-]*started/.test(st)) return 0;
      return 0;
    };
    // Helper to derive status purely from progress thresholds
    const statusFromProgress = (p) => {
      if (p >= 80) return 'on-track';
      if (p >= 50) return 'in-progress';
      return 'at-risk';
    };
    const org = Array.isArray(a.orgPositions) ? a.orgPositions : [];
    const canon = (s) => String(s || '').trim().toLowerCase();
    // Determine the department universe from saved customizable sections if present;
    // otherwise derive only from assignments (do NOT expand from org positions to avoid noisy panels)
    const deptMap = new Map(); // key: canonical name -> { key?, name, dueDate? }
    const sections = Array.isArray(a.actionSections) && a.actionSections.length
      ? a.actionSections.map((s)=>({ key: String(s?.key||'').trim(), name: String(s?.label||'').trim() || label(String(s?.key||'')) })).filter((s)=>s.key)
      : null;
    if (sections && sections.length) {
      for (const s of sections) {
        const name = s.name || label(s.key);
        const arr = assignments[s.key] || [];
        const dates = (arr || [])
          .filter((u) => pctForItem(u) < 100)
          .map((u)=>parseDate(u?.dueWhen))
          .filter(Boolean)
          .sort();
        const dueDate = dates[0] || '-';
        deptMap.set(canon(name), { key: s.key, name, dueDate });
      }
    } else {
      for (const k of Object.keys(assignments || {})) {
        const name = label(k);
        const arr = assignments[k] || [];
        const dates = (arr || [])
          .filter((u) => pctForItem(u) < 100)
          .map((u)=>parseDate(u?.dueWhen))
          .filter(Boolean)
          .sort();
        const dueDate = dates[0] || '-';
        deptMap.set(canon(name), { key: k, name, dueDate });
      }
    }

    // Determine department heads from org chart
    const headFor = (deptName) => {
      const candidates = org.filter((p) => canon(p.department) === canon(deptName));
      if (!candidates.length) return null;
      // Prefer those whose parent is not in the same department (top of that dept)
      const byId = new Map((org || []).map((p) => [String(p.id || ''), p]));
      const isTopOfDept = (p) => {
        const parentId = p.parentId == null ? null : String(p.parentId);
        if (!parentId) return true;
        const parent = byId.get(parentId);
        if (!parent) return true;
        return canon(parent.department) !== canon(deptName);
      };
      const top = candidates.filter(isTopOfDept);
      const pool = top.length ? top : candidates;
      // Rank by title keywords
      const score = (title = '') => {
        const t = String(title).toLowerCase();
        if (/\bchief\b|\bvp\b|vice president/.test(t)) return 5;
        if (/head of|\bhead\b/.test(t)) return 4;
        if (/director/.test(t)) return 3;
        if (/lead/.test(t)) return 2;
        if (/manager/.test(t)) return 1;
        return 0;
      };
      const sorted = pool.slice().sort((a,b)=> score(b.position)-score(a.position));
      const pick = sorted[0] || pool[0];
      const name = `${pick?.name || ''}`.trim();
      return name || null;
    };
    // Fallback owner is the current logged-in user
    const fallbackOwner = (user?.fullName || '').trim() || '-';

    // Merge with stored Department overrides; progress is derived from action plan item progress/ statuses
    const stored = await Department.find(wsFilter).lean().exec();
    const byName = new Map((stored || []).map((d) => [d.name, d]));
    const departments = Array.from(deptMap.values()).map((r) => {
      const s = byName.get(r.name);
      // Derive progress from action assignment item progress (or fallback to status mapping)
      const deptKey = r.key || Object.keys(assignments || {}).find((k) => canon(label(k)) === canon(r.name));
      let progress = 0;
      if (deptKey && Array.isArray(assignments[deptKey])) {
        const arr = assignments[deptKey];
        const total = arr.length || 0;
        if (total > 0) {
          const sum = arr.reduce((acc, it) => acc + pctForItem(it), 0);
          progress = Math.round(sum / total);
        }
      }
      const owner = (s?.owner && String(s.owner).trim()) ? s.owner : (headFor(r.name) || fallbackOwner);
      // Due date is derived from action plan items (not editable)
      const dueDate = r.dueDate || '-';
      const status = statusFromProgress(progress);
      return { key: r.key, name: r.name, owner, dueDate, progress, status };
    });
    // Apply department filtering for restricted collaborators
    if (hasDepartmentRestriction(req.user)) {
      const filteredDepts = departments.filter((d) => req.user.allowedDepartments.includes(d.key));
      return res.json({ departments: filteredDepts });
    }
    return res.json({ departments });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/dashboard/departments
// Body: { name: string, owner?: string }
exports.updateDepartment = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { name, owner } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Department name is required' });
    }
    // Only owner is editable; ignore due date and progress edits
    const patch = {};
    if (typeof owner === 'string') patch.owner = owner;
    const doc = await Department.findOneAndUpdate(
      { user: userId, name },
      { $set: { name, user: userId, ...patch } },
      { new: true, upsert: true }
    ).lean().exec();
    // Compute owner consistent with GET (department head or fallback to current user)
    const [ob, user] = await Promise.all([
      Onboarding.findOne(wsFilter).lean().exec(),
      User.findById(userId).lean().exec(),
    ]);
    const a = ob?.answers || {};
    const org = Array.isArray(a.orgPositions) ? a.orgPositions : [];
    const canon = (s) => String(s || '').trim().toLowerCase();
    const headFor = (deptName) => {
      const candidates = org.filter((p) => canon(p.department) === canon(deptName));
      if (!candidates.length) return null;
      const byId = new Map((org || []).map((p) => [String(p.id || ''), p]));
      const isTopOfDept = (p) => {
        const parentId = p.parentId == null ? null : String(p.parentId);
        if (!parentId) return true;
        const parent = byId.get(parentId);
        if (!parent) return true;
        return canon(parent.department) !== canon(deptName);
      };
      const top = candidates.filter(isTopOfDept);
      const pool = top.length ? top : candidates;
      const score = (title = '') => {
        const t = String(title).toLowerCase();
        if (/\bchief\b|\bvp\b|vice president/.test(t)) return 5;
        if (/head of|\bhead\b/.test(t)) return 4;
        if (/director/.test(t)) return 3;
        if (/lead/.test(t)) return 2;
        if (/manager/.test(t)) return 1;
        return 0;
      };
      const sorted = pool.slice().sort((a,b)=> score(b.position)-score(a.position));
      const pick = sorted[0] || pool[0];
      const n = `${pick?.name || ''}`.trim();
      return n || null;
    };
    const fallbackOwner = (user?.fullName || '').trim() || '-';
    const ownerName = (doc.owner && String(doc.owner).trim()) ? doc.owner : (headFor(name) || fallbackOwner);
    // Derive progress from action assignments for this department
    const ab = ob?.answers || {};
    const assignments = ab.actionAssignments || {};
    const deptKey = Object.keys(assignments || {}).find((k) => canon(({ marketing: 'Marketing', sales: 'Sales', operations:'Operations and Service Delivery', financeAdmin:'Finance and Admin', peopleHR:'People and Human Resources', partnerships:'Partnerships and Alliances', technology:'Technology and Infrastructure', communityImpact:'ESG and Sustainability' }[k] || k)) === canon(name));
    let progress = 0;
    if (deptKey && Array.isArray(assignments[deptKey])) {
      const arr = assignments[deptKey];
      const total = arr.length || 0;
      if (total > 0) {
        const toPct = (it) => {
          const v = Number(it?.progress);
          if (isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
          const st = String(it?.status || '').toLowerCase();
          if (/done|complete|completed/.test(st)) return 100;
          if (/in[ _-]*progress/.test(st)) return 50;
          if (/not[ _-]*started/.test(st)) return 0;
          return 0;
        };
        const sum = arr.reduce((acc, it) => acc + toPct(it), 0);
        progress = Math.round(sum / total);
      }
    }
    const status = progress >= 80 ? 'on-track' : (progress >= 50 ? 'in-progress' : 'at-risk');
    // Derive due date from earliest incomplete item, consistent with GET
    const parseDate = (s) => { const m=String(s||'').match(/\d{4}-\d{2}-\d{2}/); return m?m[0]:''; };
    const pctForItem = (it) => {
      const v = Number(it?.progress);
      if (isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
      const st = String(it?.status || '').toLowerCase();
      if (/done|complete|completed/.test(st)) return 100;
      if (/in[ _-]*progress/.test(st)) return 50;
      if (/not[ _-]*started/.test(st)) return 0;
      return 0;
    };
    let dueDate = '-';
    if (deptKey && Array.isArray(assignments[deptKey])) {
      const arr = assignments[deptKey];
      const dates = arr.filter((u)=> pctForItem(u) < 100).map((u)=> parseDate(u?.dueWhen)).filter(Boolean).sort();
      dueDate = dates[0] || '-';
    }
    // Shape response consistent with GET
    return res.json({ department: { name: doc.name, owner: ownerName, dueDate, progress, status } });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/dashboard/action-assignments/status
// Body: { department?: string, key?: string, index: number, status: string }
// Accepts either a human department label (department) or canonical key (key)
exports.updateActionAssignmentStatus = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const deptLabel = String(req.body?.department || '').trim();
    const deptKeyIn = String(req.body?.key || '').trim();
    const index = Number(req.body?.index);
    const status = String(req.body?.status || '').trim();
    if (!isFinite(index) || index < 0) return res.status(400).json({ message: 'Valid index is required' });
    if (!status) return res.status(400).json({ message: 'Status is required' });
    const ob = await Onboarding.findOne(wsFilter);
    if (!ob) return res.status(404).json({ message: 'Onboarding not found' });
    ob.answers = ob.answers || {};
    const assignments = ob.answers.actionAssignments = ob.answers.actionAssignments || {};
    const canon = (s) => String(s || '').trim().toLowerCase();
    const labelFromKey = (k) => ({
      marketing: 'Marketing',
      sales: 'Sales',
      operations: 'Operations and Service Delivery',
      financeAdmin: 'Finance and Admin',
      peopleHR: 'People and Human Resources',
      partnerships: 'Partnerships and Alliances',
      technology: 'Technology and Infrastructure',
      communityImpact: 'ESG and Sustainability',
    }[k] || k);
    const keyFromLabel = (lab) => ({
      Marketing: 'marketing',
      Sales: 'sales',
      'Operations and Service Delivery': 'operations',
      'Finance and Admin': 'financeAdmin',
      'People and Human Resources': 'peopleHR',
      'Partnerships and Alliances': 'partnerships',
      'Technology and Infrastructure': 'technology',
      'ESG and Sustainability': 'communityImpact',
    }[lab] || null);
    // Resolve the correct key robustly (accept canonical key, label-as-key, or department label)
    const resolveDeptKey = () => {
      // 1) Exact key match
      if (deptKeyIn && assignments[deptKeyIn]) return deptKeyIn;
      // 2) If key is actually a label, map it
      if (deptKeyIn) {
        const k2 = keyFromLabel(deptKeyIn);
        if (k2 && assignments[k2]) return k2;
        // Case-insensitive key match
        const k3 = Object.keys(assignments).find((k) => canon(k) === canon(deptKeyIn));
        if (k3 && assignments[k3]) return k3;
      }
      // 3) Department label provided
      if (deptLabel) {
        if (assignments[deptLabel]) return deptLabel; // stored under label
        const k4 = keyFromLabel(deptLabel);
        if (k4 && assignments[k4]) return k4;
        // 4) Match by label-from-key comparison
        const found = Object.keys(assignments).find((k) => canon(labelFromKey(k)) === canon(deptLabel));
        if (found && assignments[found]) return found;
      }
      return null;
    };
    const deptKey = resolveDeptKey();
    if (!deptKey) return res.status(400).json({ message: 'Department not found in assignments' });
    const arr = Array.isArray(assignments[deptKey]) ? assignments[deptKey] : [];
    if (index >= arr.length) return res.status(400).json({ message: 'Index out of range' });
    const item = arr[index] || {};
    item.status = status;
    // Optionally sync numeric progress from status for consistency
    const s = String(status || '').toLowerCase();
    if (/done|complete|completed/.test(s)) item.progress = 100;
    else if (/in[ _-]*progress/.test(s)) item.progress = 50;
    else if (/not[ _-]*started/.test(s)) item.progress = 0;
    arr[index] = item;
    assignments[deptKey] = arr;
    try { ob.markModified && ob.markModified('answers'); } catch {}
    await ob.save();
    return res.json({ ok: true, item: { ...item, status } });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/dashboard/action-assignments/item
// Body: { key?: string; department?: string; index: number; patch: { firstName?, lastName?, title?, goal?, milestone?, resources?, cost?, kpi?, dueWhen?, progress? } }
exports.updateActionAssignmentItem = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { key, department, index, patch } = req.body || {};
    const idx = Number(index);
    if (!isFinite(idx) || idx < 0) {
      return res.status(400).json({ message: 'Invalid index' });
    }
    // Resolve to the actual key present in assignments
    const keyFromLabel = {
      Marketing: 'marketing',
      Sales: 'sales',
      'Operations and Service Delivery': 'operations',
      'Finance and Admin': 'financeAdmin',
      'People and Human Resources': 'peopleHR',
      'Partnerships and Alliances': 'partnerships',
      'Technology and Infrastructure': 'technology',
      'ESG and Sustainability': 'communityImpact',
    };

    const ob = await Onboarding.findOne(wsFilter);
    if (!ob) return res.status(404).json({ message: 'Not found' });
    const a = ob.answers || {};
    const curr = a.actionAssignments || {};
    const canon = (s) => String(s || '').trim().toLowerCase();
    const labelFromKey = (k) => ({
      marketing: 'Marketing',
      sales: 'Sales',
      operations: 'Operations and Service Delivery',
      financeAdmin: 'Finance and Admin',
      peopleHR: 'People and Human Resources',
      partnerships: 'Partnerships and Alliances',
      technology: 'Technology and Infrastructure',
      communityImpact: 'ESG and Sustainability',
    }[k] || k);
    const resolveKey = () => {
      // 1) Direct key match
      if (key && curr[key]) return key;
      // 2) If key is a label
      if (key && keyFromLabel[key]) {
        const k2 = keyFromLabel[key];
        if (curr[k2]) return k2;
      }
      // Case-insensitive direct match
      if (key) {
        const k3 = Object.keys(curr).find((kk) => canon(kk) === canon(key));
        if (k3 && curr[k3]) return k3;
      }
      // 3) Department label field provided
      if (department) {
        if (curr[department]) return department; // stored under label
        const k4 = keyFromLabel[department];
        if (k4 && curr[k4]) return k4;
        const found = Object.keys(curr).find((kk) => canon(labelFromKey(kk)) === canon(department));
        if (found && curr[found]) return found;
      }
      return null;
    };
    const k = resolveKey();
    if (!k) return res.status(400).json({ message: 'Missing or unknown key/department' });
    const list = Array.isArray(curr[k]) ? curr[k] : [];
    if (!list[idx]) return res.status(404).json({ message: 'Item not found' });
    const item = list[idx];
    const p = patch || {};
    const clampPct = (x) => {
      const n = Number(x);
      if (!isFinite(n)) return undefined;
      return Math.max(0, Math.min(100, Math.round(n)));
    };
    const nextItem = {
      ...item,
      ...(p.firstName !== undefined ? { firstName: String(p.firstName || '') } : {}),
      ...(p.lastName !== undefined ? { lastName: String(p.lastName || '') } : {}),
      ...(p.title !== undefined ? { title: String(p.title || '') } : {}),
      ...(p.goal !== undefined ? { goal: String(p.goal || '') } : {}),
      ...(p.milestone !== undefined ? { milestone: String(p.milestone || '') } : {}),
      ...(p.resources !== undefined ? { resources: String(p.resources || '') } : {}),
      ...(p.cost !== undefined ? { cost: String(p.cost || '') } : {}),
      ...(p.kpi !== undefined ? { kpi: String(p.kpi || '') } : {}),
      ...(p.dueWhen !== undefined ? { dueWhen: String(p.dueWhen || '') } : {}),
      ...(p.progress !== undefined ? (()=>{ const v = clampPct(p.progress); return v === undefined ? {} : { progress: v }; })() : {}),
      ...(p.linkedCoreProject !== undefined ? { linkedCoreProject: typeof p.linkedCoreProject === 'number' ? p.linkedCoreProject : undefined } : {}),
      ...(p.linkedGoal !== undefined ? { linkedGoal: typeof p.linkedGoal === 'number' ? p.linkedGoal : undefined } : {}),
      ...(p.deliverables !== undefined ? { deliverables: Array.isArray(p.deliverables) ? p.deliverables.map((d) => ({
        text: String(d?.text || ''),
        kpi: String(d?.kpi || ''),
        dueWhen: String(d?.dueWhen || ''),
        done: Boolean(d?.done),
      })) : [] } : {}),
    };
    // Derive status from progress if provided
    if (Object.prototype.hasOwnProperty.call(p, 'progress')) {
      const v = clampPct(p.progress);
      if (v !== undefined) {
        if (v >= 100) nextItem.status = 'Completed';
        else if (v > 0) nextItem.status = 'In progress';
        else nextItem.status = 'Not started';
      }
    }
    list[idx] = nextItem;
    curr[k] = list;
    a.actionAssignments = curr;
    ob.answers = a;
    try { ob.markModified && ob.markModified('answers'); } catch {}
    await ob.save();
    return res.json({ ok: true, item: nextItem, key: k, index: idx });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/financials
exports.getFinancials = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    // Load any saved assumptions for this user (current values)
    let savedAssumptions = {};
    try {
      const finDoc = await Financials.findOne(wsFilter).lean().exec();
      if (finDoc && Array.isArray(finDoc.assumptions)) {
        savedAssumptions = Object.fromEntries(finDoc.assumptions.map((r)=> [String(r.key||''), String(r.value||'')]));
      }
    } catch {}
    const ob = await Onboarding.findOne(wsFilter).lean().exec();
    const a = ob?.answers || {};
    function num(s) { if (s == null) return 0; const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }
    const growth = num(a.finSalesGrowthPct) / 100;
    // Derive from products when explicit inputs aren't provided
    let totalVolFromProducts = 0, avgCostFromProducts = 0, avgPrice = 0;
    try {
      const list = Array.isArray(a.products) ? a.products : [];
      const nums = list.map((p)=>({ v: num(p.monthlyVolume), price: num(p.price ?? p.pricing), cost: num(p.unitCost) }));
      totalVolFromProducts = nums.reduce((sum, r)=> sum + (r.v||0), 0);
      const totalW = nums.reduce((sum, r)=> sum + (r.v||0), 0);
      const sumPrice = nums.reduce((sum, r)=> sum + ((r.price||0)*(r.v||0)), 0);
      const sumCost = nums.reduce((sum, r)=> sum + ((r.cost||0)*(r.v||0)), 0);
      avgPrice = totalW ? (sumPrice/totalW) : 0;
      avgCostFromProducts = totalW ? (sumCost/totalW) : 0;
    } catch {}
    const units0 = num(a.finSalesVolume) || totalVolFromProducts;
    const avgCost = num(a.finAvgUnitCost) || avgCostFromProducts;
    const fixedOperating = num(a.finFixedOperatingCosts);
    const marketingSpend = num(a.finMarketingSalesSpend);
    const payrollCost = num(a.finPayrollCost);
    const fixed = fixedOperating + marketingSpend + payrollCost;
    const startCash = num(a.finStartingCash);
    const fundAmt = num(a.finAdditionalFundingAmount);
    const fundMonth = (()=>{ try { const [y,m]=String(a.finAdditionalFundingMonth||'').split('-').map(Number); return (m&&m>=1&&m<=12)?(m-1):-1; } catch { return -1; } })();
    const collectionDays = num(a.finPaymentCollectionDays);
    const lag = collectionDays >= 30 ? 1 : 0;
    if (!avgPrice && avgCost) {
      const m = num(a.finTargetProfitMarginPct)/100; avgPrice = m < 0.99 ? (avgCost/(1-m||1)) : avgCost;
    }
    // If required inputs are missing, return empty structures
    const required = units0 > 0 && (avgCost > 0 || (a.products && a.products.length)) && fixed >= 0;
    if (!required) {
      return res.json({ financials: { metrics: { monthlyRevenue: '', monthlyCosts: '', netProfit: '', burnRate: '' }, chart: [], revenueBars: [], cashflowBars: [], assumptions: [] } });
    }
    const months = Array.from({length:12}, (_,i)=>i);
    const series = months.map((i)=>{
      const units = units0 * Math.pow(1+growth, i);
      const revenue = units * (avgPrice||0);
      const cogs = units * (avgCost||0);
      const opex = fixed;
      const profit = revenue - (cogs + opex);
      return { revenue, cogs, opex, profit };
    });
    // cash flow with lag and funding
    let cash = startCash;
    const cashSeries = series.map((m, idx) => {
      const inflow = (idx - lag >= 0) ? series[idx - lag].revenue : 0;
      const outflow = m.cogs + m.opex;
      const fund = (idx === fundMonth ? fundAmt : 0);
      cash = cash + inflow - outflow + fund;
      return cash;
    });
    const monthLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // Revenue Performance: Projected (accrual) vs Actual (cash collected or explicit actuals)
    const actualOverrides = Array.isArray(a.finActualRevenue) ? a.finActualRevenue.map(num) : null;
    const projected = series.map((s)=> Math.round(s.revenue));
    const actual = series.map((_, idx) => {
      const fallback = Math.round((idx - lag >= 0 ? series[idx - lag].revenue : 0));
      if (actualOverrides && typeof actualOverrides[idx] === 'number' && isFinite(actualOverrides[idx])) return Math.round(actualOverrides[idx]);
      return fallback;
    });
    // Cost Structure Evolution (stacked): allow overrides via actual arrays
    const actualCogs = Array.isArray(a.finActualCogs) ? a.finActualCogs.map(num) : null;
    const actualMarketing = Array.isArray(a.finActualMarketing) ? a.finActualMarketing.map(num) : null;
    const actualPayroll = Array.isArray(a.finActualPayroll) ? a.finActualPayroll.map(num) : null;
    const actualFixed = Array.isArray(a.finActualFixed) ? a.finActualFixed.map(num) : null;
    const costEvolution = {
      months: monthLabels,
      cogs: months.map((i)=> Math.round((actualCogs && isFinite(actualCogs[i])) ? actualCogs[i] : (series[i]?.cogs || 0))),
      marketing: months.map((i)=> Math.round((actualMarketing && isFinite(actualMarketing[i])) ? actualMarketing[i] : (marketingSpend || 0))),
      payroll: months.map((i)=> Math.round((actualPayroll && isFinite(actualPayroll[i])) ? actualPayroll[i] : (payrollCost || 0))),
      fixed: months.map((i)=> Math.round((actualFixed && isFinite(actualFixed[i])) ? actualFixed[i] : (fixedOperating || 0))),
    };
    // Rotate month-based series so current month is first
    const curMonth = new Date().getMonth(); // 0-11
    const rotateBy = (arr, start) => {
      if (!Array.isArray(arr) || arr.length === 0) return arr;
      const n = arr.length;
      const k = ((start % n) + n) % n;
      return arr.slice(k).concat(arr.slice(0, k));
    };
    const monthLabelsRot = rotateBy(monthLabels, curMonth);
    const projectedRot = rotateBy(projected, curMonth);
    const actualRot = rotateBy(actual, curMonth);
    const costEvolutionRot = {
      months: monthLabelsRot,
      cogs: rotateBy(costEvolution.cogs, curMonth),
      marketing: rotateBy(costEvolution.marketing, curMonth),
      payroll: rotateBy(costEvolution.payroll, curMonth),
      fixed: rotateBy(costEvolution.fixed, curMonth),
    };
    // Revenue vs Cost vs Profit chart: reflect actuals when present (first 6 months) starting at current month
    const chart = monthLabelsRot.slice(0,6).map((n, i)=> {
      const rev = isFinite(actualRot[i]) ? actualRot[i] : Math.round(series[i]?.revenue||0);
      const cogsV = costEvolutionRot.cogs[i] || 0;
      const opexV = (costEvolutionRot.marketing[i]||0) + (costEvolutionRot.payroll[i]||0) + (costEvolutionRot.fixed[i]||0);
      const profitV = Math.max(0, rev - (cogsV + opexV));
      return { name:n, Revenue: Math.round(rev/1000), Cost: Math.round((cogsV+opexV)/1000), Profit: Math.round(profitV/1000) };
    });
    // Monthly snapshot numbers reflect the current month (post-rotation index 0)
    const monthlyRevenue = `$${Math.round(actualRot[0] || series[0]?.revenue || 0).toLocaleString()}`;
    const month0Costs = (costEvolutionRot.cogs[0]||0) + (costEvolutionRot.marketing[0]||0) + (costEvolutionRot.payroll[0]||0) + (costEvolutionRot.fixed[0]||0);
    const monthlyCosts = `$${Math.round(month0Costs).toLocaleString()}`;
    const month0Profit = (actualRot[0] || series[0]?.revenue || 0) - month0Costs;
    const netProfit = `$${Math.round(month0Profit).toLocaleString()}`;
    const burn = series[0]?.profit < 0 ? Math.max(0, Math.floor((startCash||0)/Math.max(1, -series[0].profit))) : 12;
    // KPIs
    // Defaults/assumptions for KPI engine (can be adjusted later through assumptions table)
    const assumeChurn = Math.max(0.001, Math.min(0.99, num(a.kpiChurnRate || '3')/100));
    const assumeACV = num(a.kpiAvgContractValue || (avgPrice || 0));
    const grossMargin = projected[0] > 0 ? Math.max(0, Math.min(0.99, (projected[0] - (series[0].cogs + payrollCost + marketingSpend + fixedOperating))/projected[0])) : 0.4;
    const newCustomers = assumeACV > 0 ? Math.max(1, Math.round(projected[0] / assumeACV)) : Math.max(1, Math.round(units0));
    const cacVal = newCustomers > 0 ? (marketingSpend / newCustomers) : 0;
    const ltvVal = assumeACV * grossMargin * (1/assumeChurn);
    const ltvCac = cacVal > 0 ? (ltvVal / cacVal) : 0;
    const breakevenIdx = series.findIndex((m)=> m.profit >= 0);
    const runwayIdx = cashSeries.findIndex((c)=> c <= 0);
    const delta = (arr) => {
      // quarter-over-quarter change between month 0 and month 3
      const a0 = arr[0];
      const a3 = arr[3] ?? arr[0];
      if (!isFinite(a0) || !isFinite(a3) || a3 === 0) return 0;
      return ((a0 - a3) / Math.abs(a3)) * 100;
    };
    const financials = {
      metrics: { monthlyRevenue, monthlyCosts, netProfit, burnRate: `${burn} months` },
      chart,
      revenueBars: rotateBy(series.slice(0,12).map((s)=>Math.round(s.revenue/1000)), curMonth),
      cashflowBars: rotateBy(cashSeries.slice(0,12).map((c)=>Math.round(c/1000)), curMonth),
      revPerf: { months: monthLabelsRot, projected: projectedRot, actual: actualRot },
      costEvolution: costEvolutionRot,
      kpis: {
        cac: { value: cacVal, deltaPct: delta(series.map(()=>marketingSpend)) },
        ltv: { value: ltvVal, deltaPct: 0 },
        ltvCacRatio: { value: ltvCac },
        breakeven: { month: breakevenIdx >= 0 ? (breakevenIdx+1) : null },
        runway: { months: runwayIdx >= 0 ? runwayIdx : burn },
      },
      assumptions: [
        { key: 'growth', assumption: 'Monthly Growth Rate', control: 'input', placeholder: 'e.g. 10%', ai: `${(growth*100||0).toFixed(1)}%`, aiClass: 'text-primary font-semibold', rationale: 'From your onboarding inputs', value: savedAssumptions['growth'] || '' },
        { key: 'margin', assumption: 'Target Profit Margin', control: 'input', placeholder: 'e.g. 15%', ai: `${(num(a.finTargetProfitMarginPct)||0).toFixed(1)}%`, aiClass: 'text-primary font-semibold', rationale: 'From your onboarding inputs', value: savedAssumptions['margin'] || '' },
        { key: 'churn', assumption: 'Customer Churn Rate', control: 'input', placeholder: 'e.g. 3%', ai: `${(assumeChurn*100).toFixed(1)}%`, aiClass: 'text-primary font-semibold', rationale: 'From your assumptions', value: savedAssumptions['churn'] || '' },
        { key: 'acv', assumption: 'Average Contract Value', control: 'input', placeholder: 'e.g. $500', ai: `$${Math.round(assumeACV).toLocaleString()}`, aiClass: 'text-primary font-semibold', rationale: 'From your assumptions or products', value: savedAssumptions['acv'] || '' },
        { key: 'revenueRecog', assumption: 'Revenue Recognition', control: 'select', placeholder: 'Monthly', ai: 'Monthly', aiClass: 'text-primary font-semibold', rationale: 'Standard monthly recognition', value: savedAssumptions['revenueRecog'] || '' },
      ],
    };
    return res.json({ financials });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/financials/assumptions
// Body: { rows: [{ key, value }] }
exports.saveFinancialAssumptions = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const map = new Map();
    rows.forEach((r)=>{ const k = String(r?.key || '').trim(); if (k) map.set(k, String(r?.value ?? '')); });
    // Upsert Financials doc for user; merge values by key
    const fin = await Financials.findOne(wsFilter) || await Financials.create({ user: userId, metrics:{}, chart:[], revenueBars:[], cashflowBars:[], assumptions:[] });
    const existing = new Map((fin.assumptions || []).map((r)=> [String(r.key||''), r]));
    // Update or insert
    map.forEach((val, key) => {
      if (existing.has(key)) { existing.get(key).value = val; }
      else existing.set(key, { key, value: val });
    });
    fin.assumptions = Array.from(existing.values());
    await fin.save();
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/plan/prose
exports.getPlanProse = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne(wsFilter).lean().exec();
    const prose = (ob && ob.answers && ob.answers.planProse) || {};
    return res.json({ prose: { executiveSummary: prose.executiveSummary || '', marketStatement: prose.marketStatement || '', financialStatement: prose.financialStatement || '', generatedAt: prose.generatedAt || null } });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/plan/prose/generate
// Body: { sections?: ['executive','market','financial'] }
exports.generatePlanProse = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne(wsFilter) || await Onboarding.create(addWorkspaceToDoc({ user: userId }, req));
    const a = ob.answers || {};
    const { sections } = req.body || {};
    const wantExecutive = !Array.isArray(sections) || sections.includes('executive');
    const wantMarket = !Array.isArray(sections) || sections.includes('market');
    const wantFinancial = !Array.isArray(sections) || sections.includes('financial');

    const ai = require('./ai.controller');
    const contextBase = (() => {
      const bp = ob.businessProfile || {};
      const parts = [
        bp.businessName && `Business Name: ${bp.businessName}`,
        bp.industry && `Industry: ${bp.industry}`,
        bp.ventureType && `Venture Type: ${bp.ventureType}`,
        bp.city && bp.country && `Location: ${bp.city}, ${bp.country}`,
        a.ubp && `UBP: ${a.ubp}`,
        a.purpose && `Purpose: ${a.purpose}`,
      ].filter(Boolean);
      return parts.length ? parts.join('\n') : '';
    })();

    // Executive Summary (Problem, Solution, Market, Opportunity)
    let executiveSummary = undefined;
    if (wantExecutive) {
      const bp = ob.businessProfile || {};
      const products = Array.isArray(a.products) ? a.products : [];
      const productLines = products
        .filter((p)=> String(p?.product||'').trim())
        .map((p)=> `- ${String(p.product).trim()} — ${String(p.description||'').trim()} | Price: ${String(p.price ?? p.pricing ?? '').trim()} | Volume: ${String(p.monthlyVolume ?? '').trim()}`)
        .join('\n');
      const competitorNames = Array.isArray(a.competitorNames) && a.competitorNames.length
        ? a.competitorNames.map((n)=> `- ${String(n||'').trim()}`).join('\n')
        : '';

      const execCtx = [
        contextBase,
        'VISION SNAPSHOT:',
        a.ubp && `UBP: ${a.ubp}`,
        a.purpose && `Purpose: ${a.purpose}`,
        '',
        'MARKET CONTEXT:',
        a.marketCustomer && `Customer: ${a.marketCustomer}`,
        a.compNotes && `Competition: ${a.compNotes}`,
        competitorNames && `Competitors (names):\n${competitorNames}`,
        '',
        productLines && `PRODUCTS:\n${productLines}`,
        '',
        'FINANCIAL HINTS (optional):',
        a.finSalesGrowthPct && `Monthly sales growth target (%): ${a.finSalesGrowthPct}`,
        a.finSalesVolume && `Initial monthly sales volume (units): ${a.finSalesVolume}`,
      ].filter(Boolean).join('\n');

      const instruction = [
        'Write an Executive Summary that a decision‑maker can read in under a minute.',
        'Focus on: 1) Problem, 2) Solution, 3) Market, 4) Opportunity.',
        'Guidelines:',
        '- 2–4 short paragraphs; plain language; no fluff.',
        '- Standalone summary — do not assume the reader saw any other sections.',
        '- If numeric hints exist (e.g., revenue/volume/growth), reference them qualitatively; do not invent external stats.',
        '- Output ONLY the final prose as plain text. No bullets or headings.',
      ].join('\n');

      try {
        executiveSummary = await ai.callOpenAIProse({ type: 'Executive Summary of Business Plan', input: instruction, contextText: execCtx, maxTokens: 500 });
      } catch (err) {
        if (err && err.code === 'NO_API_KEY') {
          // Leave undefined; downstream will fallback to simple template if necessary
        } else {
          throw err;
        }
      }
    }

    // Market and Opportunity Study generation from onboarding Market & Opportunity answers
    let marketStatement = undefined;
    if (wantMarket) {
      const bp = ob.businessProfile || {};
      const products = Array.isArray(a.products) ? a.products : [];
      const prodLines = products
        .filter((p)=> String(p?.product||'').trim())
        .map((p)=> `- ${String(p.product).trim()} — ${String(p.description||'').trim()}`)
        .join('\n');
      const oneYearGoals = String(a.vision1y || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s)=> `- ${s}`)
        .join('\n');
      const competitorNames = Array.isArray(a.competitorNames) && a.competitorNames.length
        ? a.competitorNames.map((n)=> `- ${n}`).join('\n')
        : '';
      const partnerPrefs = Array.isArray(a.partnerPrefs) && a.partnerPrefs.length
        ? a.partnerPrefs.map((n)=> `- ${n}`).join('\n')
        : '';

      const marketCtx = [
        'BUSINESS PROFILE INPUTS',
        bp.businessName && `Business name: ${bp.businessName}`,
        bp.industry && `Industry: ${bp.industry}`,
        (bp.city || bp.country) && `Geography/Region: ${[bp.city, bp.country].filter(Boolean).join(', ')}`,
        bp.description && `Short description: ${bp.description}`,
        oneYearGoals && `1-year goals:\n${oneYearGoals}`,
        prodLines && `Products and services:\n${prodLines}`,
        '',
        'MARKET STUDY INPUTS',
        a.autoMarket && `Main market served (auto vs manual): ${a.autoMarket}`,
        a.custType && `Customer type: ${a.custType}`,
        a.marketCustomer && `Market/Customer overview (free text): ${a.marketCustomer}`,
        '',
        'CUSTOMER INPUTS',
        a.marketCustomer && `Primary customer segment: ${a.marketCustomer}`,
        (bp.city || bp.country) && `Customer location (approx.): ${[bp.city, bp.country].filter(Boolean).join(', ')}`,
        '',
        'COMPETITOR INPUTS',
        competitorNames && `Direct competitors:\n${competitorNames}`,
        a.compNotes && `Competitive landscape notes: ${a.compNotes}`,
        '',
        'PARTNER INPUTS',
        typeof a.partnersYN !== 'undefined' && `Relies on partners: ${a.partnersYN}`,
        a.partnersDesc && `Existing partners: ${a.partnersDesc}`,
        partnerPrefs && `Desired future partners:\n${partnerPrefs}`,
        '',
        'OPPORTUNITY INPUTS',
        oneYearGoals && `1-year focus areas (goals):\n${oneYearGoals}`,
      ].filter(Boolean).join('\n');

      const studyInstruction = [
        'Using the structured information provided, produce a Market and Opportunity Study with clear sections.',
        'Write in a clear, confident tone. Use only user-supplied facts.',
        'Do not create statistics unless explicitly supplied; if numbers are missing, use qualitative descriptions only.',
        'Use numbered section headings and second-level subheadings where relevant (e.g., 2.1, 2.2).',
        'Within sections such as Industry context and trends, Competitors and alternatives, and Partnerships and ecosystem, include short bullet lists (3–6 items) where helpful.',
        'Convert raw bullet inputs into polished prose; include bullets only when they aid clarity. Do NOT include methodology or prompts in the output.',
        'Required sections (exact order), with suggested substructure:',
        '1. Market overview — scope of market served, positioning, immediate opportunity (1–2 paragraphs).',
        '2. Industry context and trends — 2.1 Industry state (concise), 2.2 Key trends (3–6 bullets), 2.3 Implications for the business (paragraph).',
        '3. Customer overview — 3.1 Primary segment (paragraph), 3.2 Secondary segments (bullets if any), 3.3 What they value (bullets).',
        '4. Customer problems and needs — pain points (3–6 bullets) and current workarounds (bullets if provided).',
        '5. Value proposition and market fit — begin with a detailed introductory paragraph that frames the value proposition and fit; then explain how offerings address needs and tie explicitly to user-provided products/services and goals.',
        '6. Market size and growth — qualitative description only unless the user provided numbers; do not fabricate.',
        '7. Competitors and alternatives — begin with a detailed introductory paragraph summarizing the competitive landscape; then cover direct competitors (bullets from user input), strengths vs. gaps (bullets), positioning (who serves which segment), and common alternatives.',
        '8. Partnerships and ecosystem — begin with a detailed introductory paragraph summarizing the partnership approach and ecosystem role; then list existing partners (from user input), desired partner types (bullets), and the roles partners can play.',
        '9. Market focus for the next 12 months — begin with a detailed introductory paragraph framing priorities for the next year; then list 3–6 focus areas linked to the user\'s 1‑year goals with brief rationale and expected result.',
      ].join('\n');

      marketStatement = await ai.callOpenAIProse({ type: 'Market and Opportunity Study', input: studyInstruction, contextText: marketCtx, maxTokens: 1400 });
    }

    // Financial section generation using client-provided prompt and headings
    let financialStatement = undefined;
    if (wantFinancial) {
      // Helper numeric parser
      function num(s) { if (s == null) return 0; const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }
      // Collect product-level inputs (monthly volumes, prices, unit costs)
      const list = Array.isArray(a.products) ? a.products : [];
      const productLines = list.map((p) => {
        const name = String(p?.product || 'Product').trim() || 'Product';
        const volStr = String(p?.monthlyVolume || '').trim();
        const priceStr = String(p?.price ?? p?.pricing ?? '').trim();
        const costStr = String(p?.unitCost ?? '').trim();
        const v = num(volStr);
        const pr = num(priceStr);
        const co = num(costStr);
        const monthlyRev = (v && pr) ? Math.round(v * pr) : null;
        const monthlyDirect = (v && co) ? Math.round(v * co) : null;
        const monthlyGross = (monthlyRev !== null && monthlyDirect !== null) ? Math.round(monthlyRev - monthlyDirect) : null;
        const parts = [
          `Projected sales (monthly): ${volStr || '(not provided)'}`,
          `Price per unit: ${priceStr || '(not provided)'}`,
          `Direct cost per unit: ${costStr || '(not provided)'}`,
          monthlyRev !== null ? `Approx. monthly revenue: ${monthlyRev}` : '',
          monthlyDirect !== null ? `Approx. monthly direct cost: ${monthlyDirect}` : '',
          monthlyGross !== null ? `Approx. monthly gross margin: ${monthlyGross}` : '',
        ].filter(Boolean);
        return `- ${name}: ${parts.join(' | ')}`;
      }).join('\n');
      // High-level financial inputs
      const fixedOperating = num(a.finFixedOperatingCosts);
      const marketingSpend = num(a.finMarketingSalesSpend);
      const payrollCost = num(a.finPayrollCost);
      const startCash = num(a.finStartingCash);
      const fundAmt = num(a.finAdditionalFundingAmount);
      const taxRate = null; // Not captured explicitly
      const staffCount = Array.isArray(a.orgPositions) ? a.orgPositions.length : null;
      const avgSalary = (staffCount && payrollCost) ? Math.round(payrollCost / staffCount) : null;
      const payDays = String(a.finPaymentCollectionDays || '').trim();
      // Derive simple metrics from supplied inputs (for AI reference only)
      // Average price/cost from products if available
      let totalW = 0, sumPrice = 0, sumCost = 0;
      try {
        const nums = list.map((p)=>({ v: num(p.monthlyVolume), price: num(p.price ?? p.pricing), cost: num(p.unitCost) }));
        totalW = nums.reduce((sum, r)=> sum + (r.v||0), 0);
        sumPrice = nums.reduce((sum, r)=> sum + ((r.price||0)*(r.v||0)), 0);
        sumCost = nums.reduce((sum, r)=> sum + ((r.cost||0)*(r.v||0)), 0);
      } catch {}
      const avgPrice = totalW ? (sumPrice/totalW) : 0;
      const avgCost = totalW ? (sumCost/totalW) : 0;
      const finCtx = [
        contextBase,
        'FINANCIAL INPUTS (user-supplied):',
        productLines && `Products:\n${productLines}`,
        (fixedOperating || a.finFixedOperatingCosts) && `Monthly operating expenses (total): ${a.finFixedOperatingCosts || fixedOperating}`,
        (payrollCost || a.finPayrollCost) && `Monthly staffing costs (total): ${a.finPayrollCost || payrollCost}`,
        (staffCount ? `Team size (approx.): ${staffCount}` : ''),
        (avgSalary ? `Avg monthly salary per staff (approx.): ${avgSalary}` : ''),
        a.finAdditionalFundingAmount && `Funding expected this year: ${a.finAdditionalFundingAmount}`,
        a.finStartingCash && `Opening cash balance: ${a.finStartingCash}`,
        a.finPaymentCollectionDays && `Payment timing assumption (days): ${a.finPaymentCollectionDays}`,
        '',
        'DERIVED (from user inputs; optional):',
        totalW ? `Approx. weighted avg unit price: ${Math.round(avgPrice)}` : '',
        totalW ? `Approx. weighted avg unit cost: ${Math.round(avgCost)}` : '',
      ].filter(Boolean).join('\n');

      const financialInstruction = [
        'Using the financial inputs provided by the user, generate a clear and comprehensive Financial Section for the Market and Opportunity Study.',
        'Use only the data supplied. Do not invent external statistics. Convert the raw inputs into a coherent narrative that explains revenue potential, cost structure, profitability, cash flow expectations, and funding position.',
        'Structure your output using the following headings (exact order). For each section, begin with a detailed introductory paragraph that frames the topic, then add second-level subheadings and concise bullet points where helpful:',
        '1. Financial overview',
        '2. Revenue model — begin with a detailed intro; then cover by product/service where applicable; include per‑product inline summaries when data permit.',
        '3. Direct costs and gross margin — begin with a detailed intro; then detail by product/service when data allow; avoid fabricated percentages.',
        '4. Operating costs — begin with a detailed intro; then break down major categories if available (fixed operating, marketing, tools, other).',
        '5. Staffing costs — begin with a detailed intro; then include team size (if known) and average monthly salary (if derivable), roles if provided.',
        '6. Cash flow and runway — begin with a detailed intro; provide qualitative narrative; discuss seasonality/timing if payment days provided.',
        '7. Funding position — begin with a detailed intro; explain role of planned funding (e.g., staffing, marketing, operations).',
        '8. Overall financial outlook — begin with a detailed intro; then interpretation, risks/opportunities, and near‑term priorities.',
        'If sufficient numeric detail is provided for products, include a small inline summary list per product (Name — monthly units × price → approx. monthly revenue; direct cost; gross margin). Otherwise, keep qualitative.',
        'Use clear paragraphs and simple language. Summarise insights and interpret what the numbers mean for the business. Write everything as if it will appear in a professional business plan. Do NOT include methodology or prompts in the output.',
      ].join('\n');

      financialStatement = await ai.callOpenAIProse({
        type: 'Financial Section of Market and Opportunity Study',
        contextText: finCtx,
        input: financialInstruction,
        maxTokens: 1400,
      });
    }

    ob.answers = a;
    ob.answers.planProse = {
      ...(a.planProse || {}),
      ...(typeof executiveSummary === 'string' ? { executiveSummary } : {}),
      ...(typeof marketStatement === 'string' ? { marketStatement } : {}),
      ...(typeof financialStatement === 'string' ? { financialStatement } : {}),
      generatedAt: new Date().toISOString(),
    };
    try { ob.markModified && ob.markModified('answers'); } catch {}
    await ob.save();
    return res.json({ prose: ob.answers.planProse });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/plan
exports.getPlan = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const [p, sectionsRaw] = await Promise.all([
      Plan.findOne(wsFilter).lean().exec(),
      PlanSection.find(wsFilter).sort({ order: 1, createdAt: 1 }).lean().exec(),
    ]);
    const sections = sectionsRaw.map((s) => ({ sid: s.sid, name: s.name, complete: s.complete }));
    return res.json({ plan: { sections, companyLogoUrl: (p && p.companyLogoUrl) || '' } });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/logo  { dataUrl }
exports.uploadCompanyLogo = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { dataUrl } = req.body || {};
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return res.status(400).json({ message: 'Invalid image payload' });
    const { mime, buf } = parsed;

    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);
    if (!allowed.has(mime)) return res.status(400).json({ message: 'Unsupported image type' });
    if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ message: 'Image too large (max 8MB)' });

    // Use a dedicated bucket for business logos; allow override via env
    const bucket = process.env.R2_LOGOS_BUCKET || process.env.LOGOS_BUCKET || 'business-logos';

    const s3 = getR2Client();
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    const key = `${Date.now()}.${ext}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: mime }));

    // Compose public URL using a dedicated base; defaults to logos.plangenie.com
    let base = (process.env.R2_LOGOS_PUBLIC_BASE_URL || process.env.LOGOS_PUBLIC_BASE_URL || 'https://logos.plangenie.com');
    if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
    base = base.replace(/\/$/, '');
    const url = `${base}/${key}`;

    // Save on the user's Plan document
    const updated = await Plan.findOneAndUpdate(
      { user: userId },
      { $set: { companyLogoUrl: url }, $setOnInsert: { user: userId } },
      { new: true, upsert: true }
    ).lean().exec();

    return res.json({ ok: true, url, plan: { companyLogoUrl: updated?.companyLogoUrl || url } });
  } catch (err) {
    return next(err);
  }
};

// GET /api/dashboard/plan/export/pdf
exports.exportPlanPdf = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Render the actual front‑end page so the PDF matches what users see
    const frontend = process.env.FRONTEND_ORIGIN || process.env.APP_WEB_URL || 'http://localhost:3000';
    const orgUrl = `${frontend}/dashboard/plan/org-only?orgOnly=1`;
    const mainUrl = `${frontend}/dashboard/plan?print=1&noOrg=1`;

    const authHeader = req.headers['authorization'] || '';
    const m = String(authHeader).match(/Bearer\s+(.+)/i);
    const token = m?.[1] || '';
    const viewAs = req.headers['x-view-as'] || '';

    const puppeteer = require('puppeteer');
    const fs = require('fs');
    const path = require('path');
    const resolveChromeExecutable = () => {
      const candidates = [];
      if (process.env.PUPPETEER_EXECUTABLE_PATH) candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
      try { candidates.push(puppeteer.executablePath()); } catch {}
      const cacheHints = [process.env.PUPPETEER_CACHE_DIR, path.join(process.cwd(), '.cache', 'puppeteer'), '/opt/render/.cache/puppeteer'];
      for (const base of cacheHints.filter(Boolean)) {
        try {
          const chromeRoot = path.join(base, 'chrome');
          const versions = fs.readdirSync(chromeRoot);
          for (const v of versions) {
            const bin = path.join(chromeRoot, v, 'chrome-linux64', 'chrome');
            candidates.push(bin);
          }
        } catch {}
      }
      for (const p of candidates) {
        try { if (p && fs.existsSync(p)) return p; } catch {}
      }
      return undefined;
    };
    const executablePath = resolveChromeExecutable();
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox'],
      executablePath,
    });
    try {
      const page = await browser.newPage();
      // Seed token (and view-as) into localStorage before any scripts run
      await page.evaluateOnNewDocument((t, va) => {
        try {
          localStorage.setItem('pg_token', String(t || ''));
          if (va) localStorage.setItem('pg_view_as', String(va));
        } catch {}
      }, token, viewAs);

      // Pass 1: capture org-only page
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 3 });
      await page.goto(orgUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      try { await page.emulateMediaType('screen'); } catch {}
      try { await page.waitForFunction('window.__PG_ORG_READY === true', { timeout: 8000 }); } catch {}
      let orgB64 = null;
      try {
        const elContainer = await page.$('#org-chart-print');
        if (elContainer) {
          let elTarget = await page.$('#org-chart-print [data-print-target="orgflow"]');
          if (!elTarget) elTarget = await page.$('#org-chart-print .react-flow__viewport');
          if (!elTarget) elTarget = await page.$('#org-chart-print .react-flow__renderer');
          if (!elTarget) elTarget = await page.$('#org-chart-print svg');
          if (!elTarget) elTarget = await page.$('#org-chart-print .react-flow');
          if (!elTarget) elTarget = elContainer;
          try { await elTarget.evaluate(node => node.scrollIntoView({ block: 'center' })); } catch {}
          try { orgB64 = await elTarget.screenshot({ type: 'png', omitBackground: false, encoding: 'base64' }); } catch {}
        }
      } catch {}

      // Pass 2: open main doc without org and inject image
      await page.goto(mainUrl, { waitUntil: 'networkidle0', timeout: 60000 });
      try { await page.emulateMediaType('screen'); } catch {}
      try { await page.waitForFunction('window.__PG_PRINT_READY === true', { timeout: 4000 }); } catch {}
      if (orgB64) {
        try {
          await page.evaluate((src) => {
            const host = document.querySelector('#org-chart-image-container');
            if (!host) return;
            while (host.firstChild) host.removeChild(host.firstChild);
            const img = document.createElement('img');
            try {
              const byteChars = atob(src);
              const len = byteChars.length;
              const bytes = new Uint8Array(len);
              for (let i = 0; i < len; i++) bytes[i] = byteChars.charCodeAt(i);
              const blob = new Blob([bytes], { type: 'image/png' });
              const url = URL.createObjectURL(blob);
              img.src = url;
            } catch {
              img.src = 'data:image/png;base64,' + src;
            }
            img.style.width = '100%';
            img.style.height = 'auto';
            img.style.display = 'block';
            try { img.style.pageBreakInside = 'avoid'; } catch {}
            try { img.style.breakInside = 'avoid'; } catch {}
            host.appendChild(img);
          }, orgB64);
        } catch {}
      }

      const pdf = await page.pdf({
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        margin: { top: '0.4in', bottom: '0.7in', left: '0.4in', right: '0.4in' },
        headerTemplate: `
          <div style="font-size:8px; color:#9CA3AF; width:100%; padding:4px 16px;">
            <!-- empty header to reserve space if needed -->
          </div>
        `,
        footerTemplate: `
          <div style="font-size:10px; color:#6B7280; width:100%; padding:6px 16px; display:flex; align-items:center; justify-content:flex-end;">
            <div style="font-family: Arial, sans-serif;">
              <span class="pageNumber"></span> / <span class="totalPages"></span>
            </div>
          </div>
        `,
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Business_Plan.pdf"');
      return res.send(Buffer.from(pdf));
    } finally {
      try { await browser.close(); } catch {}
    }
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/strategy-canvas/export/docx
exports.exportStrategyCanvasDocx = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne(wsFilter).lean().exec();
    const a = ob?.answers || {};
    const ubp = (a.ubp || ob?.vision?.ubp || '').trim();
    const purpose = String(a.purpose || '').trim();
    const oneYear = String(a.vision1y || '').split('\n').map((s)=>s.trim()).filter(Boolean);
    const threeYear = String(a.vision3y || '').split('\n').map((s)=>s.trim()).filter(Boolean);
    const summary = String(a.identitySummary || '').trim();

    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, TableOfContents, Header, Footer, PageNumber } = require('docx');
      const businessName = String(ob?.businessProfile?.businessName || 'Vision Board');
      const heading = (text, level = HeadingLevel.HEADING_2) => new Paragraph({ text: text || '', heading: level, spacing: { before: 240, after: 120 } });
      const p = (text) => new Paragraph({ children: [new TextRun({ text: String(text || ''), size: 22, color: '111111' })], spacing: { after: 120 } });
      const bulletsDocx = (arr) => (arr || []).filter(Boolean).map((t) => new Paragraph({ children: [new TextRun(String(t))], bullet: { level: 0 } }));
      const now = new Date().toLocaleDateString();
      const header = new Header({ children: [ new Paragraph({ children: [new TextRun({ text: businessName, size: 18, color: '666666' })] }) ] });
      const footer = new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ text: 'Page ' }), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun({ text: ' of ' }), new TextRun({ children: [PageNumber.TOTAL_PAGES] }) ] }) ] });
      const doc = new Document({
        features: { updateFields: true },
        styles: {
          default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { line: 276 } } } },
          paragraphStyles: [
            { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: '0B5394' }, paragraph: { spacing: { before: 480, after: 200 } } },
            { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '0B5394' }, paragraph: { spacing: { before: 360, after: 160 } } },
          ],
        },
        sections: [
          {
            headers: { default: header },
            footers: { default: footer },
            children: [
              heading('Vision Board', HeadingLevel.HEADING_1),
              new Paragraph({ text: `Generated ${now}`, spacing: { after: 240 } }),
              
              heading('Your Business Identity', HeadingLevel.HEADING_2),
              p('Unique Business Proposition (UBP):'),
              p(ubp || '—'),
              p('Purpose Statement:'),
              p(purpose || '—'),
              p('1-Year Goals:'),
              ...(bulletsDocx(oneYear)),
              p('3-Year Goals:'),
              ...(bulletsDocx(threeYear.length ? threeYear : oneYear)),
              p('Strategic Identity Summary:'),
              p(summary || '—'),
            ],
          },
        ],
      });
      const buffer = await Packer.toBuffer(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename="Strategy_Canvas.docx"');
      return res.send(Buffer.from(buffer));
    } catch (_e) {
      // Fallback: HTML to DOCX
      try {
        const htmlToDocx = require('html-to-docx');
        const esc = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#039;');
        const bullets = (arr) => (arr||[]).map((t)=>`<div>• ${esc(t)}</div>`).join('');
        const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Vision Board</title><style>body{font-family:Arial,Helvetica,sans-serif;color:#111}.box{border:1px solid #EAEAEA;border-radius:10px;background:#fff;padding:12px;margin:6px 0}</style></head><body><h2>Your Business Identity</h2><div class="box"><div class="label">Unique Business Proposition (UBP)</div>${esc(ubp||'—')}</div><div class="box"><div class="label">Purpose Statement</div>${esc(purpose||'—')}</div><div class="box"><div class="label">1‑Year Goals</div>${bullets(oneYear)}</div><div class="box"><div class="label">3‑Year Goals</div>${bullets(threeYear.length?threeYear:oneYear)}</div><div class="box"><div class="label">Strategic Identity Summary</div>${esc(summary||'—')}</div></body></html>`;
        const buffer = await htmlToDocx(html);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', 'attachment; filename="Strategy_Canvas.docx"');
        return res.send(Buffer.from(buffer));
      } catch (e2) {
        return res.status(500).json({ message: 'Word export unavailable' });
      }
    }
  } catch (err) { next(err); }
};

// GET /api/dashboard/strategy-canvas/export/pdf
exports.exportStrategyCanvasPdf = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const frontend = process.env.FRONTEND_ORIGIN || process.env.APP_WEB_URL || 'http://localhost:3000';
    const url = `${frontend}/dashboard/strategy-canvas/print?print=1`;
    const authHeader = req.headers['authorization'] || '';
    const m = String(authHeader).match(/Bearer\s+(.+)/i);
    const token = m?.[1] || '';
    const viewAs = req.headers['x-view-as'] || '';
    const puppeteer = require('puppeteer');
    const fs = require('fs');
    const path = require('path');
    const resolveChromeExecutable = () => {
      const candidates = [];
      if (process.env.PUPPETEER_EXECUTABLE_PATH) candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
      try { candidates.push(puppeteer.executablePath()); } catch {}
      const cacheHints = [process.env.PUPPETEER_CACHE_DIR, path.join(process.cwd(), '.cache', 'puppeteer'), '/opt/render/.cache/puppeteer'];
      for (const base of cacheHints.filter(Boolean)) {
        try {
          const chromeRoot = path.join(base, 'chrome');
          const versions = fs.readdirSync(chromeRoot);
          for (const v of versions) {
            const bin = path.join(chromeRoot, v, 'chrome-linux64', 'chrome');
            candidates.push(bin);
          }
        } catch {}
      }
      for (const p of candidates) {
        try { if (p && fs.existsSync(p)) return p; } catch {}
      }
      return undefined;
    };
    const executablePath = resolveChromeExecutable();
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox'],
      executablePath,
    });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument((t, va) => {
        try { localStorage.setItem('pg_token', String(t || '')); if (va) localStorage.setItem('pg_view_as', String(va)); } catch {}
      }, token, viewAs);
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.emulateMediaType('screen').catch(()=>{});
      try { await page.waitForFunction('window.__PG_PRINT_READY === true', { timeout: 5000 }); } catch {}
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, margin: { top: '0.4in', bottom: '0.6in', left: '0.5in', right: '0.5in' } });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Strategy_Canvas.pdf"');
      return res.send(Buffer.from(pdf));
    } finally { try { await browser.close(); } catch {} }
  } catch (err) { next(err); }
};

// GET /api/dashboard/departments/export/docx
exports.exportDepartmentsDocx = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne(wsFilter).lean().exec();
    const a = ob?.answers || {};
    const assignments = a.actionAssignments || {};
    const label = (k) => ({ marketing:'Marketing',sales:'Sales',operations:'Operations and Service Delivery',financeAdmin:'Finance and Admin',peopleHR:'People and Human Resources',partnerships:'Partnerships and Alliances',technology:'Technology and Infrastructure',communityImpact:'ESG and Sustainability' }[k] || k);
    const parseDate = (s) => { const m=String(s||'').match(/\d{4}-\d{2}-\d{2}/); return m?m[0]:''; };
    const pctForItem = (it) => { const v = Number(it?.progress); if (isFinite(v)) return Math.max(0, Math.min(100, Math.round(v))); const st = String(it?.status || '').toLowerCase(); if (/done|complete|completed/.test(st)) return 100; if (/in[ _-]*progress/.test(st)) return 50; if (/not[ _-]*started/.test(st)) return 0; return 0; };
    const statusFromProgress = (p) => { if (p >= 80) return 'on-track'; if (p >= 50) return 'in-progress'; return 'at-risk'; };
    // Build department list
    const rows = [];
    Object.keys(assignments || {}).forEach((key) => {
      const name = label(key);
      const list = assignments[key] || [];
      const owners = (list||[]).map((u)=> `${u.firstName||''} ${u.lastName||''}`.trim()).filter(Boolean);
      const owner = owners[0] || '-';
      const dueDate = (list||[]).map((u)=>parseDate(u?.dueWhen)).filter(Boolean).sort()[0] || '-';
      const progVals = (list||[]).map((u)=>pctForItem(u));
      const progress = progVals.length ? Math.round(progVals.reduce((a,b)=>a+b,0)/progVals.length) : 0;
      const status = statusFromProgress(progress);
      rows.push({ name, owner, dueDate, progress, status });
    });
    // DOCX
    try {
      const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, TableLayoutType, HeadingLevel, Header, Footer, AlignmentType, PageNumber } = require('docx');
      const businessName = String(ob?.businessProfile?.businessName || 'Strategic Planning');
      const p = (text)=> new Paragraph({ children: [new TextRun(String(text||''))] });
      const tHead = new TableRow({ tableHeader: true, children: ['Department','Owner','Due Date','Progress','Status'].map((h)=> new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })) });
      const tBody = rows.map((r)=> new TableRow({ children: [r.name,r.owner,r.dueDate,`${r.progress}%`,r.status].map((v)=> new TableCell({ children: [p(v)] })) }));
      const table = new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [tHead, ...tBody], layout: TableLayoutType.FIXED });
      const header = new Header({ children: [ new Paragraph({ children: [new TextRun({ text: businessName, size: 18, color: '666666' })] }) ] });
      const footer = new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ text: 'Page ' }), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun({ text: ' of ' }), new TextRun({ children: [PageNumber.TOTAL_PAGES] }) ] }) ] });
      const doc = new Document({
        styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
        sections: [{ headers: { default: header }, footers: { default: footer }, children: [ new Paragraph({ text: 'Strategic Planning', heading: HeadingLevel.HEADING_1 }), table ] }]
      });
      const buffer = await Packer.toBuffer(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename="Departments.docx"');
      return res.send(Buffer.from(buffer));
    } catch (_e) {
      const htmlToDocx = require('html-to-docx');
      const esc = (s)=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const rowsHtml = rows.map((r)=>`<tr><td>${esc(r.name)}</td><td>${esc(r.owner)}</td><td>${esc(r.dueDate)}</td><td>${r.progress}%</td><td>${esc(r.status)}</td></tr>`).join('');
      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>Departments</title><style>body{font-family:Arial,Helvetica,sans-serif;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #EAEAEA;padding:8px;text-align:left}</style></head><body><h2>Strategic Planning</h2><table><thead><tr><th>Department</th><th>Owner</th><th>Due Date</th><th>Progress</th><th>Status</th></tr></thead><tbody>${rowsHtml}</tbody></table></body></html>`;
      const buffer = await htmlToDocx(html);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename="Departments.docx"');
      return res.send(Buffer.from(buffer));
    }
  } catch (err) { next(err); }
};

// GET /api/dashboard/departments/export/pdf
exports.exportDepartmentsPdf = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const frontend = process.env.FRONTEND_ORIGIN || process.env.APP_WEB_URL || 'http://localhost:3000';
    const url = `${frontend}/dashboard/departments/print?print=1`;
    const authHeader = req.headers['authorization'] || '';
    const m = String(authHeader).match(/Bearer\s+(.+)/i);
    const token = m?.[1] || '';
    const viewAs = req.headers['x-view-as'] || '';
    const puppeteer = require('puppeteer');
    const fs = require('fs');
    const path = require('path');
    const resolveChromeExecutable = () => {
      const candidates = [];
      if (process.env.PUPPETEER_EXECUTABLE_PATH) candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
      try { candidates.push(puppeteer.executablePath()); } catch {}
      const cacheHints = [process.env.PUPPETEER_CACHE_DIR, path.join(process.cwd(), '.cache', 'puppeteer'), '/opt/render/.cache/puppeteer'];
      for (const base of cacheHints.filter(Boolean)) {
        try {
          const chromeRoot = path.join(base, 'chrome');
          const versions = fs.readdirSync(chromeRoot);
          for (const v of versions) {
            const bin = path.join(chromeRoot, v, 'chrome-linux64', 'chrome');
            candidates.push(bin);
          }
        } catch {}
      }
      for (const p of candidates) {
        try { if (p && fs.existsSync(p)) return p; } catch {}
      }
      return undefined;
    };
    const executablePath = resolveChromeExecutable();
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox','--disable-setuid-sandbox'],
      executablePath,
    });
    try {
      const page = await browser.newPage();
      await page.evaluateOnNewDocument((t, va) => { try { localStorage.setItem('pg_token', String(t||'')); if (va) localStorage.setItem('pg_view_as', String(va)); } catch {} }, token, viewAs);
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
      await page.emulateMediaType('screen').catch(()=>{});
      try { await page.waitForFunction('window.__PG_PRINT_READY === true', { timeout: 5000 }); } catch {}
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, margin: { top: '0.4in', bottom: '0.6in', left: '0.5in', right: '0.5in' } });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Departments.pdf"');
      return res.send(Buffer.from(pdf));
    } finally { try { await browser.close(); } catch {} }
  } catch (err) { next(err); }
};

// GET /api/dashboard/plan/export/docx
exports.exportPlanDocx = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // Load logo URL if any
    let logoUrl = '';
    try {
      const planDoc = await Plan.findOne(wsFilter).lean().exec();
      logoUrl = String(planDoc?.companyLogoUrl || '');
    } catch {}

    // Build plan data (same structure as getCompiledPlan)
    const ob = (await Onboarding.findOne(wsFilter).lean().exec()) || {};
    const a = ob.answers || {};

    // Load FinancialSnapshot for new financial data
    const workspaceId = getWorkspaceId(req);
    const snapshot = await financialSnapshotService.getOrCreate(userId, workspaceId);

    const plan = {
      businessProfile: { businessName: (ob.businessProfile && ob.businessProfile.businessName) || '' },
      vision: { ubp: a.ubp || (ob.vision && ob.vision.ubp) || '', purpose: a.purpose || '', oneYear: (a.vision1y || '').split('\n').filter(Boolean), threeYear: (a.vision3y || '').split('\n').filter(Boolean) },
      values: { core: a.valuesCore || '', culture: a.cultureFeeling || '' },
      market: { customer: a.marketCustomer || '', partners: a.partnersDesc || '', competitors: a.compNotes || '', competitorNames: a.competitorNames || [] },
      products: Array.isArray(a.products) ? a.products : [],
      org: Array.isArray(a.orgPositions) ? a.orgPositions.map((p)=>({ id: p.id, name: p.name, position: p.position, department: p.department || null, parentId: p.parentId || null })) : [],
      financialSnapshot: snapshot ? {
        revenue: snapshot.revenue || {},
        costs: snapshot.costs || {},
        cash: snapshot.cash || {},
        metrics: snapshot.metrics || {},
      } : null,
      actionPlans: a.actionAssignments || {},
      coreProjects: Array.isArray(a.coreProjects) ? a.coreProjects : [],
      coreProjectDetails: Array.isArray(a.coreProjectDetails) ? a.coreProjectDetails : [],
    };

    // Load generated prose sections (Market Study and Financials) for richer content parity with UI/PDF
    const prose = (a && a.planProse) || {};
    const execProse = typeof prose.executiveSummary === 'string' ? prose.executiveSummary : '';
    const marketProse = typeof prose.marketStatement === 'string' ? prose.marketStatement : '';
    const financialProse = typeof prose.financialStatement === 'string' ? prose.financialStatement : '';

    // Optionally capture Org Chart as an image using the same approach as PDF
    let orgB64 = null;
    try {
      const frontend = process.env.FRONTEND_ORIGIN || process.env.APP_WEB_URL || 'http://localhost:3000';
      const orgUrl = `${frontend}/dashboard/plan/org-only?orgOnly=1`;
      const authHeader = req.headers['authorization'] || '';
      const m = String(authHeader).match(/Bearer\s+(.+)/i);
      const token = m?.[1] || '';
      const viewAs = req.headers['x-view-as'] || '';
      const puppeteer = require('puppeteer');
      const fs = require('fs');
      const path = require('path');
      const resolveChromeExecutable = () => {
        const candidates = [];
        if (process.env.PUPPETEER_EXECUTABLE_PATH) candidates.push(process.env.PUPPETEER_EXECUTABLE_PATH);
        try { candidates.push(puppeteer.executablePath()); } catch {}
        const cacheHints = [process.env.PUPPETEER_CACHE_DIR, path.join(process.cwd(), '.cache', 'puppeteer'), '/opt/render/.cache/puppeteer'];
        for (const base of cacheHints.filter(Boolean)) {
          try {
            const chromeRoot = path.join(base, 'chrome');
            const versions = fs.readdirSync(chromeRoot);
            for (const v of versions) {
              const bin = path.join(chromeRoot, v, 'chrome-linux64', 'chrome');
              candidates.push(bin);
            }
          } catch {}
        }
        for (const p of candidates) {
          try { if (p && fs.existsSync(p)) return p; } catch {}
        }
        return undefined;
      };
      const executablePath = resolveChromeExecutable();
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox'],
        executablePath,
      });
      try {
        const page = await browser.newPage();
        await page.evaluateOnNewDocument((t, va) => {
          try { localStorage.setItem('pg_token', String(t || '')); if (va) localStorage.setItem('pg_view_as', String(va)); } catch {}
        }, token, viewAs);
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 3 });
        await page.goto(orgUrl, { waitUntil: 'networkidle0', timeout: 60000 });
        try { await page.emulateMediaType('screen'); } catch {}
        try { await page.waitForFunction('window.__PG_ORG_READY === true', { timeout: 8000 }); } catch {}
        try {
          const elContainer = await page.$('#org-chart-print');
          if (elContainer) {
            let elTarget = await page.$('#org-chart-print [data-print-target="orgflow"]');
            if (!elTarget) elTarget = await page.$('#org-chart-print .react-flow__viewport');
            if (!elTarget) elTarget = await page.$('#org-chart-print .react-flow__renderer');
            if (!elTarget) elTarget = await page.$('#org-chart-print svg');
            if (!elTarget) elTarget = await page.$('#org-chart-print .react-flow');
            if (!elTarget) elTarget = elContainer;
            try { await elTarget.evaluate(node => node.scrollIntoView({ block: 'center' })); } catch {}
            try { orgB64 = await elTarget.screenshot({ type: 'png', omitBackground: false, encoding: 'base64' }); } catch {}
          }
        } catch {}
      } finally {
        try { await browser.close(); } catch {}
      }
    } catch {}

    // First attempt: generate a well-formatted DOCX using the 'docx' library
    try {
      const {
        Document,
        Packer,
        Paragraph,
        TextRun,
        HeadingLevel,
        AlignmentType,
        Table,
        TableRow,
        TableCell,
        WidthType,
        Footer,
        Header,
        PageNumber,
        ImageRun,
        TableOfContents,
        convertInchesToTwip,
        TableLayoutType,
      } = require('docx');

      const businessName = String(plan.businessProfile?.businessName || 'Business Plan');
      const today = new Date();
      const dateStr = today.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

      const heading = (text, level = HeadingLevel.HEADING_2) => new Paragraph({ text: text || '', heading: level, spacing: { before: 240, after: 120 } });
      const p = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text: String(text || ''), size: 22, color: '111111' })], spacing: { after: 120 }, ...opts });
      const bulletsDocx = (arr) => (arr || []).filter(Boolean).map((t) => new Paragraph({ children: [new TextRun(String(t))], bullet: { level: 0 } }));
      // Convert plain-text prose into paragraphs + bullets (lines starting with '-', '*', or '•')
      const proseToDocx = (text) => {
        const paras = [];
        if (!text || typeof text !== 'string') return paras;
        const lines = String(text).replace(/\r\n/g, '\n').split('\n');
        let buffer = [];
        const flushBuffer = () => {
          if (!buffer.length) return;
          const t = buffer.join(' ').trim();
          if (t) paras.push(p(t));
          buffer = [];
        };
        for (const raw of lines) {
          const line = String(raw || '').trimEnd();
          if (!line.trim()) { flushBuffer(); continue; }
          if (/^[\-\*•]\s+/.test(line)) {
            flushBuffer();
            paras.push(new Paragraph({ children: [new TextRun(line.replace(/^[\-\*•]\s+/, ''))], bullet: { level: 0 } }));
          } else {
            // Paragraph text; preserve soft line-breaks by buffering consecutive lines
            buffer.push(line.trim());
          }
        }
        flushBuffer();
        return paras;
      };

      // Try to fetch the logo image for embedding on the cover
      let logoBuf = null;
      if (logoUrl) {
        try {
          const resp = await fetch(logoUrl);
          if (resp && resp.ok) {
            const ab = await resp.arrayBuffer();
            logoBuf = Buffer.from(ab);
          }
        } catch {}
      }

      const coverChildren = [];
      if (logoBuf) {
        // Preserve aspect ratio while fitting within a reasonable max box
        let wPx = 260, hPx = 60;
        try {
          const sizeOf = require('image-size');
          const dim = sizeOf(logoBuf);
          const naturalW = Math.max(1, Number(dim?.width || 1));
          const naturalH = Math.max(1, Number(dim?.height || 1));
          const maxW = 600;
          const maxH = 150;
          const scale = Math.min(maxW / naturalW, maxH / naturalH, 1);
          wPx = Math.max(1, Math.round(naturalW * scale));
          hPx = Math.max(1, Math.round(naturalH * scale));
        } catch {}
        coverChildren.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ data: logoBuf, transformation: { width: wPx, height: hPx } })],
        }));
      } else if (logoUrl) {
        coverChildren.push(new Paragraph({ children: [new TextRun({ text: 'Logo: ' + logoUrl, italics: true, color: '666666' })], alignment: AlignmentType.CENTER }));
      }
      coverChildren.unshift(new Paragraph({
        children: [
          new TextRun({ text: businessName, size: 48, bold: true, color: '0B5394' }),
          new TextRun({ text: '\nBusiness Plan', size: 32, color: '0B5394' }),
          new TextRun({ text: `\n${dateStr}`, size: 22, color: '666666' }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { before: 720, after: 720 },
      }));

      const header = new Header({ children: [ new Paragraph({ children: [new TextRun({ text: businessName, size: 18, color: '666666' })] }) ] });
      const footer = new Footer({ children: [ new Paragraph({ alignment: AlignmentType.RIGHT, children: [ new TextRun({ text: 'Page ' }), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun({ text: ' of ' }), new TextRun({ children: [PageNumber.TOTAL_PAGES] }) ] }) ] });

      // Compute full content width (~page width minus margins)
      const margin = 1080; // 0.75in
      const contentWidth = convertInchesToTwip(8.5) - (margin * 2);

      // Products table
      const productRows = [];
      productRows.push(new TableRow({ tableHeader: true, children: ['Product/Service','Description','Unit Cost','Price','Monthly Volume'].map((h)=> new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })] })) }));
      (plan.products || []).forEach((pItem) => {
        productRows.push(new TableRow({ children: [ pItem.product || '—', pItem.description || '—', pItem.unitCost || pItem.pricing || '—', pItem.price || pItem.pricing || '—', pItem.monthlyVolume || '—' ].map((v)=> new TableCell({ children: [p(String(v))] })) }));
      });
      if (productRows.length === 1) productRows.push(new TableRow({ children: [new TableCell({ children: [p('—')], columnSpan: 5 })] }));
      const pW1 = Math.floor(contentWidth * 0.18);
      const pW2 = Math.floor(contentWidth * 0.34);
      const pW3 = Math.floor(contentWidth * 0.16);
      const pW4 = Math.floor(contentWidth * 0.16);
      const pW5 = Math.max(0, contentWidth - (pW1 + pW2 + pW3 + pW4));
      const productsTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: productRows,
        layout: TableLayoutType.FIXED,
      });

      // Financials table (2 columns) - using new FinancialSnapshot structure
      const fs = plan.financialSnapshot || {};
      const fmtCurrency = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n !== 0 ? `$${n.toLocaleString()}` : '—';
      };
      const fmtPct = (v) => {
        const n = Number(v);
        return Number.isFinite(n) && n !== 0 ? `${n}%` : '—';
      };
      const fmtFundingDate = () => {
        const m = fs.cash?.fundingMonth;
        const y = fs.cash?.fundingYear;
        if (!m || !y) return '—';
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${months[m - 1] || m} ${y}`;
      };
      const finPairs = [
        ['Monthly Revenue', fmtCurrency(fs.revenue?.monthlyRevenue)],
        ['Revenue Growth Rate', fmtPct(fs.revenue?.revenueGrowthPct)],
        ['Recurring Revenue', fs.revenue?.isRecurring ? `Yes (${fmtPct(fs.revenue?.recurringPct)})` : 'No'],
        ['Monthly Costs', fmtCurrency(fs.costs?.monthlyCosts)],
        ['Fixed Costs', fmtCurrency(fs.costs?.fixedCosts)],
        ['Variable Costs', fmtPct(fs.costs?.variableCostsPct)],
        ['Biggest Cost Category', fs.costs?.biggestCostCategory || '—'],
        ['Current Cash', fmtCurrency(fs.cash?.currentCash)],
        ['Monthly Burn Rate', fmtCurrency(fs.cash?.monthlyBurn)],
        ['Expected Funding', fmtCurrency(fs.cash?.expectedFunding)],
        ['Funding Date', fmtFundingDate()],
        ['Net Profit', fmtCurrency(fs.metrics?.netProfit)],
        ['Profit Margin', fmtPct(fs.metrics?.profitMarginPct)],
        ['Months of Runway', fs.metrics?.monthsOfRunway != null ? `${fs.metrics.monthsOfRunway} months` : '—'],
        ['Break-Even Month', fs.metrics?.breakEvenMonth != null ? `Month ${fs.metrics.breakEvenMonth}` : '—'],
      ];
      const finRows = finPairs.map(([k,v]) => new TableRow({ children: [ new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: k, bold: true })] })] }), new TableCell({ children: [p(v)] }) ] }));
      const finW1 = Math.floor(contentWidth * 0.45);
      const finW2 = contentWidth - finW1;
      const financialsTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: finRows,
        layout: TableLayoutType.FIXED,
      });

      // Org content
      let orgContent = [];
      if (orgB64) {
        try { const buf = Buffer.from(orgB64, 'base64'); orgContent.push(new Paragraph({ children: [new ImageRun({ data: buf, transformation: { width: 600, height: 400 } })] })); } catch { orgContent.push(p('Organizational Chart image could not be embedded.')); }
      } else if ((plan.org || []).length) {
        orgContent = (plan.org || []).map((n) => new Paragraph({ children: [new TextRun(`${n.name || ''} — ${n.position || ''}${n.department ? ` (${n.department})` : ''}`)], bullet: { level: 0 } }));
      } else { orgContent = [p('—')]; }

      // Departmental projects
      const order = ['marketing','sales','operations','financeAdmin','peopleHR','partnerships','technology','communityImpact'];
      const labelFor = (key) => {
        const map = {
          marketing: 'Marketing',
          sales: 'Sales',
          operations: 'Operations and Service Delivery',
          financeAdmin: 'Finance and Admin',
          peopleHR: 'People and Human Resources',
          partnerships: 'Partnerships and Alliances',
          technology: 'Technology and Infrastructure',
          communityImpact: 'ESG and Sustainability',
        };
        if (map[key]) return map[key];
        return String(key || '')
          .replace(/[-_]+/g, ' ')
          .replace(/\b\w/g, (m) => m.toUpperCase());
      };
      const assignments = plan.actionPlans || {};
      const sections = [...order, ...Object.keys(assignments).filter((k)=> !order.includes(k))];
      const projectsContent = [];
      sections.forEach((dept) => {
        const items = assignments[dept] || [];
        if (!items.length) return;
        projectsContent.push(heading(String(labelFor(dept) || 'Department'), HeadingLevel.HEADING_3));
        items.forEach((u, idx) => {
          const owner = `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—';
          projectsContent.push(new Paragraph({ children: [ new TextRun({ text: `${idx+1}. ${u.goal || '—'}`, bold: true }) ] }));
          projectsContent.push(p(`Owner: ${owner}`));
          if (u.milestone) projectsContent.push(p(`Milestone: ${u.milestone}`));
          if (u.resources) projectsContent.push(p(`Resources: ${u.resources}`));
          if (u.kpi) projectsContent.push(p(`KPI: ${u.kpi}`));
          if (u.dueWhen) projectsContent.push(p(`Due: ${u.dueWhen}`));
        });
      });

      const doc = new Document({
        features: { updateFields: true },
        styles: {
          default: { document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { line: 276 } } } },
          paragraphStyles: [
            { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: '0B5394' }, paragraph: { spacing: { before: 480, after: 200 } } },
            { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '0B5394' }, paragraph: { spacing: { before: 360, after: 160 } } },
            { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, color: '1F4E79' }, paragraph: { spacing: { before: 240, after: 120 } } },
          ],
        },
        sections: [
          {
            properties: { page: { size: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
            headers: { default: header },
            footers: { default: footer },
            children: [
              ...coverChildren,
              new Paragraph({ children: [new TextRun({ break: 1 })] }),
              
              new Paragraph({ children: [new TextRun({ break: 1 })] }),
      heading('Business Plan', HeadingLevel.HEADING_1),
      // Executive Summary — prefer AI-generated prose if available
      heading('Executive Summary'),
      ...(() => {
        if (execProse && execProse.trim()) {
          const lines = String(execProse).split(/\n+/).map((s)=> s.trim()).filter(Boolean);
          return lines.length ? proseToDocx(lines.join('\n\n')) : [p(execProse)];
        }
        // Fallback: minimal structured summary
        const paras = [];
        const company = (plan.businessProfile?.businessName || '').trim();
        const ventureType = (plan.businessProfile?.ventureType || '').trim();
        const ubp = (plan.vision?.ubp || '').trim();
        const purpose = (plan.vision?.purpose || '').trim();
        const customer = (plan.market?.customer || '').trim();
        const competitors = Array.isArray(plan.market?.competitorNames) ? plan.market?.competitorNames.filter(Boolean) : [];
        const products = Array.isArray(plan.products) ? plan.products : [];
        const productNames = products.map((p)=> String(p?.name || p?.title || p?.product || p?.service || '').trim()).filter(Boolean).slice(0,3);
        const toNum = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g,'')); return Number.isFinite(n) ? n : 0; };
        const revenue0 = products.reduce((a, p)=> a + toNum(p?.price ?? p?.pricing) * toNum(p?.monthlyVolume), 0);
        const growthPct = toNum(plan.financialSnapshot?.revenue?.revenueGrowthPct);
        const problemText = (() => {
          if (customer && purpose) return `${customer} often lack a simple, reliable way to "${purpose}"`;
          if (customer) return `${customer} face a clear operational and planning gap`;
          if (purpose) return `Organizations struggle to "${purpose}" efficiently`;
          return 'The intended customers face a clear pain point that existing options do not address well';
        })();
        paras.push(new Paragraph({ children: [ new TextRun({ text: 'Problem: ', bold: true }), new TextRun({ text: problemText }) ] }));
        const solCore = ubp || (productNames.length ? `We offer ${productNames.join(', ')}` : 'We provide a focused solution');
        const solTail = ventureType ? ` as a ${ventureType.toLowerCase()} offering` : '';
        const solutionText = `${company || 'Our business'} ${solCore.replace(/^we\s+/i,'We ')}${solTail}.`;
        paras.push(new Paragraph({ children: [ new TextRun({ text: 'Solution: ', bold: true }), new TextRun({ text: solutionText }) ] }));
        const compNote = competitors.length ? `${competitors.length} notable competitor${competitors.length===1?'':'s'}` : 'limited direct alternatives';
        const marketText = customer ? `Primary market: ${customer}. Competitive context: ${compNote}.` : `Primary market defined with ${compNote}.`;
        paras.push(new Paragraph({ children: [ new TextRun({ text: 'Market: ', bold: true }), new TextRun({ text: marketText }) ] }));
        const oppPieces = [];
        if (revenue0 > 0) oppPieces.push(`Initial monthly revenue potential ~$${Math.round(revenue0).toLocaleString()}`);
        if (Number.isFinite(growthPct) && growthPct > 0) oppPieces.push(`early growth target ${Math.round(growthPct)}%/mo`);
        const oppText = oppPieces.length ? `${oppPieces.join('; ')}. Clear path to traction via near‑term priorities and focused go‑to‑market.` : 'Clear path to traction via near‑term priorities and focused go‑to‑market.';
        paras.push(new Paragraph({ children: [ new TextRun({ text: 'Opportunity: ', bold: true }), new TextRun({ text: oppText }) ] }));
        return paras;
      })(),
      heading('Vision'),
              p('Unique Business Proposition (UBP):'),
              p(plan.vision?.ubp || '—'),
              p('Purpose Statement:'),
              p(plan.vision?.purpose || '—'),
              p('1-Year Goals:'),
              ...(bulletsDocx(plan.vision?.oneYear)),
              p('3-Year Goals:'),
              ...(bulletsDocx(plan.vision?.threeYear)),

              new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true }),
              heading('Values and Culture'),
              p('Core Values:'),
              p(plan.values?.core || '—'),
              ...((Array.isArray(plan.values?.traits) && plan.values?.traits.length)
                ? [p('Character Traits:'), ...bulletsDocx(plan.values?.traits)]
                : []),
              p('Culture and Behaviors:'),
              p(plan.values?.culture || '—'),

              new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true }),
              heading('Market Study'),
              ...(marketProse ? proseToDocx(marketProse) : []),
              p('Ideal Customer Profile:'),
              p(plan.market?.customer || '—'),
              p('Partners and Ecosystem:'),
              p(plan.market?.partners || '—'),
              p('Competitors and Positioning:'),
              p(plan.market?.competitors || '—'),
              ...((plan.market?.competitorNames || []).length ? [p('Competitor Names:'), ...bulletsDocx(plan.market?.competitorNames)] : []),

              new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true }),
      heading('Products and Services'),
      productsTable,

      new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true }),
      heading('Organizational Structure'),
      ...orgContent,

      new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true }),
      ...(financialProse ? [heading('Financials'), ...proseToDocx(financialProse)] : []),
      heading('Financial Forecasting Inputs'),
      financialsTable,

      new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true }),
      heading('Core Strategic Projects'),
      ...(() => {
        const details = Array.isArray(plan.coreProjectDetails) ? plan.coreProjectDetails : [];
        const titles = Array.isArray(plan.coreProjects) ? plan.coreProjects : [];
        const list = details.length ? details : titles.map((t)=>({ title: t, deliverables: [] }));
        if (!list.length) return [p('No core strategic projects captured.')];
        const paras = [];
        list.forEach((pr, i) => {
          paras.push(new Paragraph({ children: [ new TextRun({ text: `${i+1}. ${pr.title || '—'}`, bold: true }) ] }));
          if (pr.goal) paras.push(p(`Goal: ${pr.goal}`));
          if (pr.ownerName) paras.push(p(`Owner: ${pr.ownerName}`));
          if (pr.priority) paras.push(p(`Priority: ${pr.priority}`));
          if (pr.cost) paras.push(p(`Cost: ${pr.cost}`));
          if (pr.dueWhen) paras.push(p(`Due: ${pr.dueWhen}`));
          if (Array.isArray(pr.deliverables) && pr.deliverables.length) {
            pr.deliverables.forEach((d)=> {
              const bits = [String(d?.text||'—')];
              if (d?.kpi) bits.push(`(KPI: ${String(d.kpi)})`);
              if (d?.dueWhen) bits.push(`(Due: ${String(d.dueWhen)})`);
              paras.push(new Paragraph({ children: [new TextRun(bits.join(' '))], bullet: { level: 0 } }));
            });
          }
        });
        return paras;
      })(),

      new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true }),
      heading('Departmental Projects'),
      ...(projectsContent.length ? projectsContent : [p('—')]),
            ],
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', 'attachment; filename=\"Business_Plan.docx\"');
      return res.send(Buffer.from(buffer));
    } catch (_docxErr) {
      // If docx generator is unavailable, fall through to the HTML-based fallback below
    }

    // Helpers mirroring the frontend export utils
    const escapeHtml = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');
    const wrapBasicHtml = (title, bodyInnerHtml, extraStyle) => `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>body{font-family:Arial, Helvetica, sans-serif;color:#111}h2{font-size:20px;margin:24px 0 12px}h3{font-size:16px;margin:16px 0 8px}.box{border:1px solid #EAEAEA;border-radius:10px;background:#fff;padding:12px;margin:6px 0}.label{font-weight:700;margin-bottom:6px}.pill{display:inline-block;border:1px solid #BDE7CB;background:#E9F9EF;color:#2F8C4C;border-radius:12px;font-size:10px;padding:2px 6px}ul{margin:0;padding-left:20px}li{margin:4px 0}table{border-collapse:collapse;width:100%}td,th{border:1px solid #EAEAEA;padding:8px;text-align:left}${extraStyle || ''}</style></head><body>${bodyInnerHtml}</body></html>`;

    const bullets = (arr) => (arr || [])
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => `<div style="margin:4px 0">• ${escapeHtml(t)}</div>`) 
      .join('');
    const list = (arr) => (arr || [])
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => `<li>${escapeHtml(t)}</li>`) 
      .join('');
    const products = (plan.products || [])
      .map((p) => `<tr><td>${escapeHtml(p.product || 'Unnamed')}</td><td>${escapeHtml(p.description || '—')}</td><td>${escapeHtml(p.unitCost || p.pricing || '—')}</td><td>${escapeHtml(p.price || p.pricing || '—')}</td><td>${escapeHtml(p.monthlyVolume || '—')}</td></tr>`)
      .join('');
    const orgList = (plan.org || [])
      .map((n) => `<li>${escapeHtml(n.name || '')} — ${escapeHtml(n.position || '')}${n.department ? ` (${escapeHtml(n.department)})` : ''}</li>`) 
      .join('');
    const order = [ 'marketing','sales','operations','financeAdmin','peopleHR','partnerships','technology','communityImpact' ];
    const labelFor = (key) => {
      const map = {
        marketing: 'Marketing',
        sales: 'Sales',
        operations: 'Operations and Service Delivery',
        financeAdmin: 'Finance and Admin',
        peopleHR: 'People and Human Resources',
        partnerships: 'Partnerships and Alliances',
        technology: 'Technology and Infrastructure',
        communityImpact: 'Sustainability',
      };
      if (map[key]) return map[key];
      return String(key || '')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase());
    };
    const assignments = plan.actionPlans || {};
    const sections = [...order, ...Object.keys(assignments).filter((k)=> !order.includes(k))];
    const plansHtml = sections.map((key) => {
      const users = assignments[key] || [];
      const items = users.map((u) => {
        const owner = `${u.firstName || ''} ${u.lastName || ''}`.trim() || '—';
        return `<div class="box"><div style="font-weight:600">${escapeHtml(owner)}</div><div style="font-size:12px;border-top:1px solid #eee;padding-top:6px;margin-top:6px">${escapeHtml(u.goal || '—')}</div><div style="font-size:12px;color:#333;margin-top:6px"><b>Milestone:</b> ${escapeHtml(u.milestone || '—')}</div><div style="font-size:12px;color:#333"><b>Resources:</b> ${escapeHtml(u.resources || '—')}</div><div style="font-size:12px;color:#333"><b>KPI:</b> ${escapeHtml(u.kpi || '—')}</div><div style="font-size:12px;color:#333"><b>Due:</b> ${escapeHtml(u.dueWhen || '—')}</div></div>`;
      }).join('');
      return `<div class="box"><div style="font-weight:700">${escapeHtml(labelFor(key))}</div>${items || '<div style="font-size:12px;color:#666">No actions captured.</div>'}</div>`;
    }).join('');

    // Core Strategic Projects HTML
    const coreList = (Array.isArray(plan.coreProjectDetails) && plan.coreProjectDetails.length)
      ? plan.coreProjectDetails
      : (Array.isArray(plan.coreProjects) ? plan.coreProjects.map((t)=>({ title: String(t||'').trim(), deliverables: [] })) : []);
    const coreHtml = coreList.length
      ? coreList.map((p, i) => {
          const del = (Array.isArray(p?.deliverables) ? p.deliverables : [])
            .map((d) => `<li>${escapeHtml(String(d?.text || '—'))}${d?.kpi ? ` <span style=\"color:#666\">(KPI: ${escapeHtml(String(d.kpi))})</span>` : ''}${d?.dueWhen ? ` <span style=\"color:#666\">(Due: ${escapeHtml(String(d.dueWhen))})</span>` : ''}</li>`)
            .join('');
          const goal = p?.goal ? `<div style=\"font-size:12px;color:#333\"><b>Goal:</b> ${escapeHtml(String(p.goal))}</div>` : '';
          const owner = p?.ownerName ? `<div style=\"font-size:12px;color:#333\"><b>Owner:</b> ${escapeHtml(String(p.ownerName))}</div>` : '';
          const due = p?.dueWhen ? `<div style=\"font-size:12px;color:#333\"><b>Due:</b> ${escapeHtml(String(p.dueWhen))}</div>` : '';
          const cost = p?.cost ? `<div style=\"font-size:12px;color:#333\"><b>Cost:</b> ${escapeHtml(String(p.cost))}</div>` : '';
          return `<div class=\"box\"><div style=\"font-weight:600\">${i+1}. ${escapeHtml(String(p?.title || '—'))}</div>${goal}${owner}${due}${cost}${del ? `<ul>${del}</ul>` : ''}</div>`;
        }).join('')
      : '<div class=\"box\">No core strategic projects captured.</div>';

    const logoBlock = logoUrl 
      ? `<div style="text-align:center;margin:12px 0"><img src="${escapeHtml(logoUrl)}" style="max-height:120px;max-width:600px;object-fit:contain" alt="Business Logo"/></div>`
      : '';
    const orgBlock = orgB64
      ? `<div><img src="data:image/png;base64,${orgB64}" style="width:100%;height:auto;display:block" alt="Org Chart"/></div>`
      : (orgList ? `<ul>${orgList}</ul>` : '—');

    const execSummaryHtml = (() => {
      const esc = escapeHtml;
      if (execProse && execProse.trim()) {
        return `<div class="box"><div class="label">Executive Summary</div><div>${esc(execProse).replace(/\n/g,'<br/>')}</div></div>`;
      }
      const company = (plan.businessProfile?.businessName || '').trim();
      const ventureType = (plan.businessProfile?.ventureType || '').trim();
      const ubp = (plan.vision?.ubp || '').trim();
      const purpose = (plan.vision?.purpose || '').trim();
      const customer = (plan.market?.customer || '').trim();
      const competitors = Array.isArray(plan.market?.competitorNames) ? plan.market?.competitorNames.filter(Boolean) : [];
      const products = Array.isArray(plan.products) ? plan.products : [];
      const productNames = products.map((p)=> String(p?.name || p?.title || p?.product || p?.service || '').trim()).filter(Boolean).slice(0,3);
      const toNum = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g,'')); return Number.isFinite(n) ? n : 0; };
      const revenue0 = products.reduce((a, p)=> a + toNum(p?.price ?? p?.pricing) * toNum(p?.monthlyVolume), 0);
      const growthPct = toNum(plan.financialSnapshot?.revenue?.revenueGrowthPct);

      const problemText = (() => {
        if (customer && purpose) return `${esc(customer)} often lack a simple, reliable way to "${esc(purpose)}"`;
        if (customer) return `${esc(customer)} face a clear operational and planning gap`;
        if (purpose) return `Organizations struggle to "${esc(purpose)}" efficiently`;
        return 'The intended customers face a clear pain point that existing options do not address well';
      })();
      const solCore = ubp || (productNames.length ? `We offer ${productNames.map(esc).join(', ')}` : 'We provide a focused solution');
      const solTail = ventureType ? ` as a ${esc(ventureType.toLowerCase())} offering` : '';
      const solutionText = `${esc(company || 'Our business')} ${esc(solCore.replace(/^we\s+/i,'We '))}${solTail}.`;
      const compNote = competitors.length ? `${competitors.length} notable competitor${competitors.length===1?'':'s'}` : 'limited direct alternatives';
      const marketText = customer ? `Primary market: ${esc(customer)}. Competitive context: ${esc(compNote)}.` : `Primary market defined with ${esc(compNote)}.`;
      const oppPieces = [];
      if (revenue0 > 0) oppPieces.push(`Initial monthly revenue potential ~$${Math.round(revenue0).toLocaleString()}`);
      if (Number.isFinite(growthPct) && growthPct > 0) oppPieces.push(`early growth target ${Math.round(growthPct)}%/mo`);
      const oppText = oppPieces.length ? `${oppPieces.join('; ')}. Clear path to traction via near‑term priorities and focused go‑to‑market.` : 'Clear path to traction via near‑term priorities and focused go‑to‑market.';

      return `
        <div class="box">
          <div class="label">Executive Summary</div>
          <div><b>Problem:</b> ${problemText}</div>
          <div><b>Solution:</b> ${solutionText}</div>
          <div><b>Market:</b> ${marketText}</div>
          <div><b>Opportunity:</b> ${esc(oppText)}</div>
        </div>
      `;
    })();
    const html = wrapBasicHtml(
      'Business Plan',
      `
      <h2>Business Plan</h2>
      ${logoBlock}
      ${execSummaryHtml}
      <div class="box"><div class="label">Unique Business Proposition (UBP)</div>${escapeHtml(plan.vision?.ubp || '')}</div>
      <div class="box"><div class="label">Purpose Statement</div>${escapeHtml(plan.vision?.purpose || '')}</div>
      <div class="box"><div class="label">1‑Year Goals</div>${bullets(plan.vision?.oneYear)}</div>
      <div class="box"><div class="label">3‑Year Goals</div>${bullets(plan.vision?.threeYear)}</div>
      <h3>Values and Culture</h3>
      <div class="box"><div class="label">Core Values</div>${escapeHtml(plan.values?.core || '')}</div>
      ${Array.isArray(plan.values?.traits) && plan.values?.traits.length ? `<div class="box"><div class="label">Character Traits</div><ul>${(plan.values?.traits || []).map((t)=>`<li>${escapeHtml(t)}</li>`).join('')}</ul></div>` : ''}
      <div class="box"><div class="label">Culture and Behaviors</div>${escapeHtml(plan.values?.culture || '')}</div>
      <h3>Market Study</h3>
      ${marketProse ? `<div class="box"><div class="label">Market and Opportunity Study</div><div>${escapeHtml(marketProse).replace(/\n/g,'<br/>')}</div></div>` : ''}
      <div class="box"><div class="label">Ideal Customer Profile</div>${escapeHtml(plan.market?.customer || '')}</div>
      <div class="box"><div class="label">Partners and Ecosystem</div>${escapeHtml(plan.market?.partners || '')}</div>
      <div class="box"><div class="label">Competitors and Positioning</div>${escapeHtml(plan.market?.competitors || '')}</div>
      ${(plan.market?.competitorNames || []).length ? `<div class="box"><div class="label">Competitor Names</div><ul>${list(plan.market?.competitorNames)}</ul></div>` : ''}
      <h3>Products and Services</h3>
      <div class="box"><table><thead><tr><th>Product/Service</th><th>Description</th><th>Unit Cost</th><th>Price</th><th>Monthly Volume</th></tr></thead><tbody>${products || '<tr><td colspan="5">—</td></tr>'}</tbody></table></div>
      <h3>Organizational Structure</h3>
      <div class="box">${orgBlock}</div>
      <h3>Core Strategic Projects</h3>
      ${coreHtml}
      ${financialProse ? `<h3>Financials</h3><div class="box"><div class="label">Financial Section</div><div>${escapeHtml(financialProse).replace(/\n/g,'<br/>')}</div></div>` : ''}
      <h3>Financial Forecasting</h3>
      ${(() => {
        const fs = plan.financialSnapshot || {};
        const fmtCurrency = (v) => {
          const n = Number(v);
          return Number.isFinite(n) && n !== 0 ? '$' + n.toLocaleString() : '—';
        };
        const fmtPct = (v) => {
          const n = Number(v);
          return Number.isFinite(n) && n !== 0 ? n + '%' : '—';
        };
        const fmtFundingDate = () => {
          const m = fs.cash?.fundingMonth;
          const y = fs.cash?.fundingYear;
          if (!m || !y) return '—';
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          return (months[m - 1] || m) + ' ' + y;
        };
        return [
          ['Monthly Revenue', fmtCurrency(fs.revenue?.monthlyRevenue)],
          ['Revenue Growth Rate', fmtPct(fs.revenue?.revenueGrowthPct)],
          ['Recurring Revenue', fs.revenue?.isRecurring ? 'Yes (' + fmtPct(fs.revenue?.recurringPct) + ')' : 'No'],
          ['Monthly Costs', fmtCurrency(fs.costs?.monthlyCosts)],
          ['Fixed Costs', fmtCurrency(fs.costs?.fixedCosts)],
          ['Variable Costs', fmtPct(fs.costs?.variableCostsPct)],
          ['Biggest Cost Category', fs.costs?.biggestCostCategory || '—'],
          ['Current Cash', fmtCurrency(fs.cash?.currentCash)],
          ['Monthly Burn Rate', fmtCurrency(fs.cash?.monthlyBurn)],
          ['Expected Funding', fmtCurrency(fs.cash?.expectedFunding)],
          ['Funding Date', fmtFundingDate()],
          ['Net Profit', fmtCurrency(fs.metrics?.netProfit)],
          ['Profit Margin', fmtPct(fs.metrics?.profitMarginPct)],
          ['Months of Runway', fs.metrics?.monthsOfRunway != null ? fs.metrics.monthsOfRunway + ' months' : '—'],
          ['Break-Even Month', fs.metrics?.breakEvenMonth != null ? 'Month ' + fs.metrics.breakEvenMonth : '—'],
        ].map(([label, value]) => '<div class="box"><div class="label">' + escapeHtml(label) + '</div>' + escapeHtml(value) + '</div>').join('');
      })()}
      <h3>Departmental Projects</h3>
      ${plansHtml}
      `
    );

    // Convert HTML to .docx
    let buffer = null;
    try {
      const htmlToDocx = require('html-to-docx');
      buffer = await htmlToDocx(html, null, {
        page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } }, // ~0.5in margins (in twips)
      });
    } catch (e) {
      // Dependency missing or conversion failed
      return res.status(500).json({ message: 'Word export unavailable. Please install html-to-docx on the server.' });
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', 'attachment; filename="Business_Plan.docx"');
    return res.send(Buffer.from(buffer));
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/products
exports.getProducts = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne(wsFilter).lean().exec();
    const items = Array.isArray(ob?.answers?.products) ? ob.answers.products : [];
    return res.json({ items });
  } catch (err) {
    next(err);
  }
};

// PUT /api/dashboard/products
exports.saveProducts = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const inItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = inItems.map((p) => ({
      product: String(p?.product || ''),
      description: String(p?.description || ''),
      pricing: typeof p?.pricing !== 'undefined' ? String(p?.pricing || '') : undefined,
      unitCost: typeof p?.unitCost !== 'undefined' ? String(p?.unitCost || '') : undefined,
      price: typeof p?.price !== 'undefined' ? String(p?.price || '') : undefined,
      monthlyVolume: typeof p?.monthlyVolume !== 'undefined' ? String(p?.monthlyVolume || '') : undefined,
    }));
    const ob = await Onboarding.findOne(wsFilter);
    if (!ob) return res.status(400).json({ message: 'Onboarding not initialized' });
    ob.answers = ob.answers || {};
    ob.answers.products = items;
    // answers is a Mixed type; mark it modified so Mongoose persists nested changes
    try { ob.markModified && ob.markModified('answers'); } catch {}
    // Auto-populate financial inputs
    function num(s) { if (s == null) return 0; const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }
    const nums = items.map((p)=>({ v: num(p.monthlyVolume), price: num(p.price ?? p.pricing), cost: num(p.unitCost) }));
    const totalVol = nums.reduce((sum, r)=> sum + (r.v||0), 0);
    const totalW = nums.reduce((sum, r)=> sum + (r.v||0), 0);
    const sumPrice = nums.reduce((sum, r)=> sum + ((r.price||0)*(r.v||0)), 0);
    const sumCost = nums.reduce((sum, r)=> sum + ((r.cost||0)*(r.v||0)), 0);
    const avgCost = totalW ? (sumCost/totalW) : 0;
    const avgPrice = totalW ? (sumPrice/totalW) : 0;
    const marginPct = (avgPrice > 0) ? Math.max(0, Math.round(((avgPrice - avgCost)/avgPrice)*100)) : 0;
    if (totalVol > 0) ob.answers.finSalesVolume = String(totalVol);
    if (avgCost > 0) ob.answers.finAvgUnitCost = String(Math.round(avgCost));
    if (marginPct > 0) ob.answers.finTargetProfitMarginPct = String(marginPct);
    await ob.save();
    return res.json({ ok: true, items });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/financials/recalculate
exports.recalculateFinancials = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    // No heavy compute is needed here as GET /financials derives on the fly. This exists for future background tasks.
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/financials/actuals
// Accepts arrays for monthly actuals to override projections in charts
// Body: { revenue?: number[], cogs?: number[], marketing?: number[], payroll?: number[], fixed?: number[] }
exports.saveFinancialActuals = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { revenue, cogs, marketing, payroll, fixed, month } = req.body || {};
    const ob = await Onboarding.findOne(wsFilter) || await Onboarding.create(addWorkspaceToDoc({ user: userId }, req));
    ob.answers = ob.answers || {};
    function normArr(arr) {
      if (!Array.isArray(arr)) return undefined;
      return arr.map((v)=>{
        const n = Number(v);
        return isFinite(n) ? n : 0;
      }).slice(0, 12);
    }
    // If a single month patch is provided, update only that index
    const mIdx = (typeof month === 'number' && isFinite(month)) ? (month >= 1 && month <= 12 ? month - 1 : month) : null;
    if (mIdx !== null && mIdx >= 0 && mIdx <= 11) {
      const ensure = (key) => { ob.answers[key] = Array.isArray(ob.answers[key]) ? ob.answers[key] : Array.from({length:12}, ()=>undefined); return ob.answers[key]; };
      const setIf = (key, val) => { if (val !== undefined && val !== null && val !== '') { const arr = ensure(key); const n = Number(val); arr[mIdx] = isFinite(n) ? n : 0; } };
      setIf('finActualRevenue', revenue);
      setIf('finActualCogs', cogs);
      setIf('finActualMarketing', marketing);
      setIf('finActualPayroll', payroll);
      setIf('finActualFixed', fixed);
    } else {
      // Bulk arrays mode
      const revArr = normArr(revenue);
      const cogsArr = normArr(cogs);
      const mktArr = normArr(marketing);
      const payArr = normArr(payroll);
      const fixArr = normArr(fixed);
      if (revArr) ob.answers.finActualRevenue = revArr;
      if (cogsArr) ob.answers.finActualCogs = cogsArr;
      if (mktArr) ob.answers.finActualMarketing = mktArr;
      if (payArr) ob.answers.finActualPayroll = payArr;
      if (fixArr) ob.answers.finActualFixed = fixArr;
    }
    await ob.save();
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/financials/import
// Body: { csv: string } with columns: Month, Revenue, CashCollected, DirectCost, FixedCost, MarketingCost, PayrollCost, FundingIn, NewCustomers
exports.importFinancialsCSV = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const csv = String(req.body?.csv || '').trim();
    if (!csv) return res.status(400).json({ message: 'CSV text is required' });
    const lines = csv.split(/\r?\n/).filter((l)=> l.trim().length > 0);
    if (lines.length < 2) return res.status(400).json({ message: 'CSV requires a header and at least one row' });
    const header = lines[0].split(',').map((h)=>h.trim());
    const idx = (name) => header.findIndex((h)=> h.toLowerCase() === name.toLowerCase());
    const idxMonth = idx('Month');
    const idxRevenue = idx('Revenue');
    const idxCash = idx('CashCollected');
    const idxDirect = idx('DirectCost');
    const idxFixed = idx('FixedCost');
    const idxMkt = idx('MarketingCost');
    const idxPayroll = idx('PayrollCost');
    const idxFunding = idx('FundingIn');
    const idxNewCust = idx('NewCustomers');
    function parseMonth(s) {
      const t = String(s||'').trim();
      const mnames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      const lower = t.toLowerCase();
      const nameIdx = mnames.findIndex((n)=> lower.startsWith(n));
      if (nameIdx >= 0) return nameIdx;
      const num = parseInt(t, 10);
      if (isFinite(num) && num >= 1 && num <= 12) return num - 1;
      return null;
    }
    const arr = (len=12)=> Array.from({length:len}, ()=>undefined);
    const actualRevenue = arr();
    const actualCogs = arr();
    const actualMkt = arr();
    const actualPayroll = arr();
    const actualFixed = arr();
    const funding = arr();
    const newCust = arr();
    let updates = 0;
    for (let i=1;i<lines.length;i++){
      const cols = lines[i].split(',');
      const midx = parseMonth(cols[idxMonth] || '');
      if (midx === null) continue;
      const num = (v)=>{ const n = parseFloat(String(v).replace(/[^0-9.\-]/g,'')); return isFinite(n) ? n : undefined; };
      const cashVal = idxCash >= 0 ? num(cols[idxCash]) : undefined;
      const revVal = idxRevenue >= 0 ? num(cols[idxRevenue]) : undefined;
      actualRevenue[midx] = (cashVal !== undefined ? cashVal : (revVal !== undefined ? revVal : actualRevenue[midx]));
      if (idxDirect >= 0) actualCogs[midx] = num(cols[idxDirect]);
      if (idxMkt >= 0) actualMkt[midx] = num(cols[idxMkt]);
      if (idxPayroll >= 0) actualPayroll[midx] = num(cols[idxPayroll]);
      if (idxFixed >= 0) actualFixed[midx] = num(cols[idxFixed]);
      if (idxFunding >= 0) funding[midx] = num(cols[idxFunding]);
      if (idxNewCust >= 0) newCust[midx] = num(cols[idxNewCust]);
      updates++;
    }
    const ob = await Onboarding.findOne(wsFilter) || await Onboarding.create(addWorkspaceToDoc({ user: userId }, req));
    ob.answers = ob.answers || {};
    const setIfAny = (key, arr) => { if (arr.some((v)=> typeof v === 'number')) ob.answers[key] = arr; };
    setIfAny('finActualRevenue', actualRevenue);
    setIfAny('finActualCogs', actualCogs);
    setIfAny('finActualMarketing', actualMkt);
    setIfAny('finActualPayroll', actualPayroll);
    setIfAny('finActualFixed', actualFixed);
    // Store for future if needed
    setIfAny('finActualFunding', funding);
    setIfAny('finActualNewCustomers', newCust);
    await ob.save();
    return res.json({ ok: true, rows: updates });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/plan/sections
exports.addPlanSection = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ message: 'Section name is required' });
    const count = await PlanSection.countDocuments(wsFilter);
    const section = await PlanSection.create({ user: userId, sid: ensureId('s_'), name: String(name).trim(), complete: 0, order: count });
    return res.status(201).json({ section: { sid: section.sid, name: section.name, complete: section.complete } });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/dashboard/plan/sections/:sid
exports.deletePlanSection = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { sid } = req.params;
    const result = await PlanSection.deleteOne({ user: userId, sid }).exec();
    return res.json({ ok: true, removed: result.deletedCount > 0 });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/settings
exports.getSettings = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const [user, ob] = await Promise.all([
      User.findById(userId).lean().exec(),
      Onboarding.findOne(wsFilter).exec(),
    ]);
    const profile = {
      fullName: user?.fullName || '',
      email: user?.email || '',
      jobTitle: (user?.jobTitle && user.jobTitle.trim()) || (ob?.userProfile?.role || ''),
      phone: user?.phone || '',
    };
    const a = ob?.answers || {};
    let members = [];
    try {
      const org = Array.isArray(a.orgPositions) ? a.orgPositions : [];
      // Normalize: ensure each org position has a stable id
      let changed = false;
      for (const p of org) {
        if (!p.id) { p.id = (nodeCrypto.randomUUID && nodeCrypto.randomUUID()) || (`m_${Date.now()}_${Math.random().toString(16).slice(2)}`); changed = true; }
      }
      if (changed) { ob.answers = { ...a, orgPositions: org }; try { ob.markModified('answers'); } catch {} await ob.save().catch(()=>{}); }
      members = org.map((p) => ({
        mid: String(p.id || `${(p.position||'').slice(0,8)}-${(p.name||'').slice(0,8)}`),
        name: p.name || '',
        email: p.email || '',
        position: p.position || '',
        department: p.department || '',
        status: p.status || 'Active',
      }));
    } catch {}
    // Fallback: read any members from TeamMember collection (no seeding)
    if (!members.length) {
      const membersRaw = await TeamMember.find(wsFilter).lean().exec();
      members = membersRaw.map((m) => ({ mid: m.mid, name: m.name, email: m.email, position: m.role, department: m.department, status: m.status }));
    }
    // Prefer stored first/last name; fallback to split from fullName
    const parts = (profile.fullName || '').trim().split(/\s+/);
    const firstName = (user?.firstName || '').trim() || parts[0] || '';
    const lastName = (user?.lastName || '').trim() || parts.slice(1).join(' ');
    // Filter team members for department-restricted collaborators
    let filteredMembers = members;
    if (hasDepartmentRestriction(req.user)) {
      filteredMembers = members.filter((m) => req.user.allowedDepartments.includes(m.department));
    }
    return res.json({ profile: { ...profile, firstName, lastName }, members: filteredMembers });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/dashboard/settings/profile
exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { fullName, firstName, lastName, email, jobTitle, phone } = req.body || {};
    const update = {};
    const fn = typeof firstName === 'string' ? firstName.trim() : '';
    const ln = typeof lastName === 'string' ? lastName.trim() : '';
    // Update explicit fields
    if (typeof firstName === 'string') update.firstName = fn;
    if (typeof lastName === 'string') update.lastName = ln;
    // Compute fullName consistently from first/last if provided; otherwise allow fullName override
    if (typeof firstName === 'string' || typeof lastName === 'string') {
      update.fullName = [fn, ln].filter(Boolean).join(' ').trim();
    } else if (typeof fullName === 'string') {
      const f = String(fullName || '').trim();
      update.fullName = f;
      // Also backfill first/last when only fullName is provided
      const parts = f.split(/\s+/);
      update.firstName = parts[0] || '';
      update.lastName = parts.slice(1).join(' ');
    }
    if (typeof email === 'string') update.email = email; // optional, may be disabled in UI
    if (typeof jobTitle === 'string') update.jobTitle = jobTitle;
    if (typeof phone === 'string') update.phone = phone;
    const user = await User.findByIdAndUpdate(userId, update, { new: true }).lean();
    return res.json({ profile: { fullName: user.fullName, firstName: user.firstName || '', lastName: user.lastName || '', email: user.email, jobTitle: user.jobTitle || '', phone: user.phone || '' } });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/dashboard/settings/members/:mid
// Update fields for a team member sourced from the Org Chart (Onboarding answers)
exports.updateMember = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { mid } = req.params;
    const patch = req.body || {};

    const ob = await Onboarding.findOne(wsFilter);
    if (!ob) return res.json({ member: null });
    const a = ob.answers || {};
    let list = Array.isArray(a.orgPositions) ? a.orgPositions : [];
    const idx = list.findIndex((p) => {
      const id = String(p.id || '');
      if (id && id === String(mid)) return true;
      const fallback = `${String(p.position || '').slice(0, 8)}-${String(p.name || '').slice(0, 8)}`;
      return String(fallback) === String(mid);
    });
    if (idx === -1) {
      // Fallback: update seeded TeamMember if org member not found
      const patchDB = {};
      if (typeof patch.name === 'string') patchDB.name = patch.name;
      if (typeof patch.email === 'string') patchDB.email = patch.email;
      if (typeof patch.position === 'string') patchDB.role = patch.position;
      if (typeof patch.department === 'string') patchDB.department = patch.department;
      if (typeof patch.status === 'string') patchDB.status = patch.status;
      const m = await TeamMember.findOneAndUpdate({ user: userId, mid }, { $set: patchDB }, { new: true }).lean();
      const member = m ? { mid: m.mid, name: m.name, email: m.email, position: m.role, department: m.department, status: m.status } : null;
      return res.json({ member });
    }
    const curr = list[idx] || {};
    const next = { ...curr };
    if (typeof patch.name === 'string') next.name = patch.name;
    if (typeof patch.email === 'string') next.email = patch.email;
    if (typeof patch.position === 'string') next.position = patch.position;
    // Back-compat: if "role" provided, map to position
    if (typeof patch.role === 'string') next.position = patch.role;
    if (typeof patch.department === 'string') next.department = patch.department;
    if (typeof patch.status === 'string') next.status = patch.status;
    if (!next.id) { next.id = (nodeCrypto.randomUUID && nodeCrypto.randomUUID()) || (`m_${Date.now()}_${Math.random().toString(16).slice(2)}`); }
    list[idx] = next;
    ob.answers = { ...a, orgPositions: list };
    try { ob.markModified('answers'); } catch {}
    await ob.save();
    const member = {
      mid: String(next.id || mid),
      name: next.name || '',
      email: next.email || '',
      position: next.position || '',
      department: next.department || '',
      status: next.status || 'Active',
    };
    return res.json({ member });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/dashboard/settings/members/:mid
// Remove member from Org Chart answers; if not found, remove from seeded TeamMember
exports.deleteMember = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { mid } = req.params;
    const ob = await Onboarding.findOne(wsFilter);
    if (ob && ob.answers && Array.isArray(ob.answers.orgPositions)) {
      const before = ob.answers.orgPositions.length;
      ob.answers.orgPositions = ob.answers.orgPositions.filter((p) => {
        const id = String(p.id || '');
        if (id && id === String(mid)) return false;
        const fallback = `${String(p.position || '').slice(0, 8)}-${String(p.name || '').slice(0, 8)}`;
        if (String(fallback) === String(mid)) return false;
        return true;
      });
      try { ob.markModified('answers'); } catch {}
      await ob.save();
      return res.json({ ok: true, removed: before !== ob.answers.orgPositions.length });
    }
    const result = await TeamMember.deleteOne({ user: userId, mid }).exec();
    return res.json({ ok: true, removed: result.deletedCount > 0 });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/dashboard/settings/members/sample
// Remove seeded sample members (e.g., Sarah Johnson) for the current user
exports.purgeSampleMembers = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    // Delete known seeded entries by email or name match
    const result = await TeamMember.deleteMany({
      user: userId,
      $or: [
        { email: 'sarah@plangenie.com' },
        { name: { $regex: /^sarah\s+johnson$/i } },
      ],
    }).exec();
    return res.json({ ok: true, removed: result.deletedCount || 0 });
  } catch (err) {
    next(err);
  }
};

// =============================================================================
// FINANCIAL SNAPSHOT (Financial Clarity Feature)
// =============================================================================
const financialSnapshotService = require('../services/financialSnapshotService');

// GET /api/dashboard/financial-snapshot
exports.getFinancialSnapshot = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const snapshot = await financialSnapshotService.getOrCreate(userId, workspaceId);

    // Get products from onboarding and calculate derived revenue
    const products = await financialSnapshotService.getProductsFromOnboarding(userId, workspaceId);
    const productsRevenue = financialSnapshotService.calculateRevenueFromProducts(products);

    return res.json({ snapshot, productsRevenue });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/dashboard/financial-snapshot/:section
exports.updateFinancialSection = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { section } = req.params;
    if (!['revenue', 'costs', 'cash'].includes(section)) {
      return res.status(400).json({ message: 'Invalid section. Must be revenue, costs, or cash.' });
    }
    const snapshot = await financialSnapshotService.updateSection(userId, workspaceId, section, req.body);
    return res.json({ snapshot });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/financial-snapshot/health-tiles
exports.getHealthTiles = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const tiles = await financialSnapshotService.getHealthTiles(userId, workspaceId);
    return res.json({ tiles });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/financial-snapshot/decision-support
exports.getDecisionSupport = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const decisions = await financialSnapshotService.getDecisionSupport(userId, workspaceId);
    return res.json({ decisions });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/financial-snapshot/complete-onboarding
exports.completeFinancialOnboarding = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const snapshot = await financialSnapshotService.completeOnboarding(userId, workspaceId);
    return res.json({ ok: true, snapshot });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/financial-snapshot/sync
exports.syncFinancialFromOnboarding = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    const workspaceId = getWorkspaceId(req);
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const snapshot = await financialSnapshotService.syncFromOnboarding(userId, workspaceId);
    return res.json({ ok: true, snapshot });
  } catch (err) {
    next(err);
  }
};
