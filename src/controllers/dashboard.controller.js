const Dashboard = require('../models/Dashboard');
const Onboarding = require('../models/Onboarding');
const User = require('../models/User');
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

function buildSeed(userId, ob) {
  const ubp = ob?.vision?.ubp || 'Simplifying business strategy through intelligent automation';
  const vision = 'To become a leading business in…';
  return {
    user: userId,
    summary: {
      kpis: { overdueTasks: 4, activeTeamMembers: 4 },
      milestones: [
        { label: 'Q1 Product Launch', due: 'Mar 12, 2025' },
        { label: 'Budget review', due: 'Apr 21, 2025' },
        { label: 'Team retro', due: 'Apr 30, 2025' },
      ],
      departmentProgress: [
        { name: 'Engineering', percent: 87 },
        { name: 'Marketing', percent: 69 },
        { name: 'Sales', percent: 62 },
      ],
      financeChart: [
        { name: 'Jan', Revenue: 10, Cost: 7 },
        { name: 'Feb', Revenue: 10, Cost: 7 },
        { name: 'Mar', Revenue: 10, Cost: 7 },
        { name: 'Apr', Revenue: 19, Cost: 15 },
        { name: 'May', Revenue: 10, Cost: 7 },
        { name: 'Jun', Revenue: 19, Cost: 15 },
      ],
      activePlans: [
        { title: 'Increase qualified inbound leads by 25%', status: 'In progress', owner: 'Sarah Fredrick' },
        { title: 'Launch revised website by October 1', status: 'Completed', owner: 'Sarah Fredrick' },
        { title: 'Reduce churn to < 3%', status: 'On track', owner: 'Sarah Fredrick' },
        { title: 'Improve NPS to 45', status: 'In progress', owner: 'Sarah Fredrick' },
      ],
      insights: [
        '35% increase in demand for AI business tools',
        '30% increase in demand for AI business tools',
        'Lower CPC across performance channels this week',
      ],
      snapshot: { vision, ubp },
      team: [
        { name: 'Gabriel Thompson', role: 'CEO', note: 'In charge of marketing and everything that has to do…' },
        { name: 'Gabriel Thompson', role: 'COO', note: 'In charge of marketing and everything that has to do…' },
        { name: 'Gabriel Thompson', role: 'CTO', note: 'In charge of marketing and everything that has to do…' },
        { name: 'Gabriel Thompson', role: 'CFO', note: 'In charge of marketing and everything that has to do…' },
      ],
    },
  };
}

async function seedDefaults(userId) {
  const ob = await Onboarding.findOne({ user: userId }).lean().exec();
  const seed = buildSeed(userId, ob);
  const doc = await Dashboard.create(seed);
  return doc;
}

async function getOrCreate(userId) {
  const existing = await Dashboard.findOne({ user: userId });
  if (existing) return existing;
  // Upsert to avoid race conditions across concurrent requests
  const ob = await Onboarding.findOne({ user: userId }).lean().exec();
  const seed = buildSeed(userId, ob);
  const doc = await Dashboard.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: seed },
    { new: true, upsert: true }
  );
  return doc;
}

// Seed helpers for new domain collections (run on first access)
async function ensureSeedNotifications(userId) {
  const count = await Notification.countDocuments({ user: userId });
  if (count > 0) return;
  await Notification.insertMany([
    {
      user: userId,
      nid: ensureId('n_'),
      title: 'Overdue: Update Q2 Marketing Strategy',
      description: 'This task was due yesterday. Department: Marketing | Owner: Emily Davis',
      type: 'task',
      severity: 'danger',
      time: '2 hours ago',
      actions: [{ label: 'View task', kind: 'primary' }],
      read: false,
    },
    {
      user: userId,
      nid: ensureId('n_'),
      title: 'Task Due in 2 Days: Financial Report Q1',
      description: 'Department: Finance | Progress: 75% | Owner: Mike Chen',
      type: 'task',
      severity: 'warning',
      time: '2 hours ago',
      actions: [{ label: 'View progress', kind: 'primary' }],
      read: false,
    },
    {
      user: userId,
      nid: ensureId('n_'),
      title: 'Sarah Johnson commented on Marketing Plan',
      description: "Great progress on the social media strategy! Let's discuss the influencer partnerships in tomorrow's meeting.",
      type: 'collaboration',
      severity: 'success',
      time: '2 hours ago',
      read: false,
    },
  ]);
  await NotificationSettings.findOneAndUpdate(
    { user: userId },
    { $setOnInsert: { user: userId, frequency: 'Real-time', tone: 'Professional' } },
    { upsert: true }
  );
}

async function ensureSeedDepartments(userId) {
  const count = await Department.countDocuments({ user: userId });
  if (count > 0) return;
  await Department.insertMany([
    { user: userId, name: 'Marketing', owner: 'Emily Davis', dueDate: 'March 31, 2025', progress: 75, status: 'on-track' },
    { user: userId, name: 'Sales', owner: 'Emily Davis', dueDate: 'March 31, 2025', progress: 75, status: 'in-progress' },
    { user: userId, name: 'Technology', owner: 'Emily Davis', dueDate: 'March 31, 2025', progress: 75, status: 'at-risk' },
  ]);
}

async function ensureSeedFinancials(userId) {
  const existing = await Financials.findOne({ user: userId });
  if (existing) return existing;
  return Financials.create({
    user: userId,
    metrics: {
      monthlyRevenue: '$120,540',
      monthlyCosts: '$74,320',
      netProfit: '$46,220',
      burnRate: '14 months',
    },
    chart: [
      { name: 'Jan', Revenue: 10, Cost: 7, Profit: 8 },
      { name: 'Feb', Revenue: 10, Cost: 7, Profit: 8 },
      { name: 'Mar', Revenue: 10, Cost: 7, Profit: 8 },
      { name: 'Apr', Revenue: 19, Cost: 15, Profit: 16 },
      { name: 'May', Revenue: 10, Cost: 7, Profit: 8 },
      { name: 'Jun', Revenue: 19, Cost: 15, Profit: 16 },
    ],
    revenueBars: [42, 48, 55, 61, 58, 66, 74, 80, 78, 85, 92, 96],
    cashflowBars: [12, 22, 16, 28, 24, 36, 40, 32, 44, 48, 38, 52],
    assumptions: [
      { key: 'growth', assumption: 'Monthly Growth Rate', control: 'input', placeholder: 'e.g 10%', ai: '12%', aiClass: 'text-emerald-600 font-semibold', rationale: 'Based on current market momentum and product-market fit' },
      { key: 'churn', assumption: 'Customer Churn Rate', control: 'input', placeholder: 'e.g 10%', ai: '3%', aiClass: 'text-amber-600 font-semibold', rationale: 'Based on current market momentum and product-market fit' },
      { key: 'acv', assumption: 'Average Contract Value', control: 'input', placeholder: 'e.g $1200', ai: '$1,450', aiClass: 'text-primary font-semibold', rationale: 'Based on current market momentum and product-market fit' },
      { key: 'margin', assumption: 'Operating Margin Target', control: 'input', placeholder: 'e.g 30%', ai: '30%', aiClass: 'text-primary font-semibold', rationale: 'Based on current market momentum and product-market fit' },
      { key: 'recognition', assumption: 'Revenue Recognition', control: 'select', placeholder: '', ai: 'Monthly', aiClass: 'text-primary font-semibold', rationale: 'Based on current market momentum and product-market fit' },
    ],
  });
}

async function ensureSeedPlan(userId) {
  let plan = await Plan.findOne({ user: userId });
  if (!plan) plan = await Plan.create({ user: userId, companyLogoUrl: '' });
  const count = await PlanSection.countDocuments({ user: userId });
  if (count === 0) {
    await PlanSection.insertMany([
      { user: userId, sid: ensureId('s_'), name: 'Executive Summary', complete: 90, order: 0 },
      { user: userId, sid: ensureId('s_'), name: 'Company Overview', complete: 100, order: 1 },
      { user: userId, sid: ensureId('s_'), name: 'Vision & Mission', complete: 100, order: 2 },
      { user: userId, sid: ensureId('s_'), name: 'Market Analysis', complete: 100, order: 3 },
      { user: userId, sid: ensureId('s_'), name: 'Products & Services', complete: 90, order: 4 },
    ]);
  }
  return plan;
}


// GET /api/dashboard/summary
exports.getSummary = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    // Pull latest onboarding answers to reflect user's inputs
    const ob = await Onboarding.findOne({ user: userId }).lean().exec();
    const a = ob?.answers || {};
    const ubp = (a.ubp || ob?.vision?.ubp || '').trim();
    const purpose = String(a.purpose || '').trim();
    const oneYear = (a.vision1y || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const threeYear = (a.vision3y || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const vision = oneYear[0] || threeYear[0] || '';
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
    const dash = await Dashboard.findOne({ user: userId }).lean().exec();
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
      snapshot: { vision, ubp, purpose },
      team: teamList,
    };
    return res.json({ summary });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/financials/insights
exports.generateFinancialInsights = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne({ user: userId }).lean().exec();
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
    ].join('\n');
    const ai = require('./ai.controller');
    const items = await ai.generateFinancialInsightsFromContext(contextText, 3);
    return res.json({ items });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/insights
exports.getInsights = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const dash = await Dashboard.findOne({ user: userId }).lean().exec();
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const sectionTitle = String(req.body?.sectionTitle || '').trim();
    const ob = await Onboarding.findOne({ user: userId }).lean().exec();
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { name, email, position, department, status, parentId } = req.body || {};
    const nm = String(name || '').trim();
    if (!nm) return res.status(400).json({ message: 'Name is required' });
    const ob = await Onboarding.findOne({ user: userId });
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne({ user: userId }).lean().exec();
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const patch = req.body || {};
    const ent = require('../config/entitlements');
    const User = require('../models/User');
    const user = await User.findById(userId).lean().exec();
    const ob = (await Onboarding.findOne({ user: userId })) || (await Onboarding.create({ user: userId }));
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
        return res.status(402).json({ code: 'LIMIT_EXCEEDED', message: 'Lite plan allows up to 3 goals', plan: ent.effectivePlan(user), limit, limitKey: 'maxGoals', upgradeTo: 'premium' });
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const cp = req.body || {};
    const ent = require('../config/entitlements');
    const user = await User.findById(userId).lean().exec();
    const plan = ent.effectivePlan(user);
    const ob = await Onboarding.findOne({ user: userId }) || await Onboarding.create({ user: userId });
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
        return res.status(402).json({ code: 'LIMIT_EXCEEDED', message: 'Lite plan allows up to 3 core projects', plan, limit, limitKey: 'maxCoreProjects', upgradeTo: 'premium' });
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
          return res.status(402).json({ code: 'LIMIT_EXCEEDED', message: 'Lite plan allows up to 3 core projects', plan, limit, limitKey: 'maxCoreProjects', upgradeTo: 'premium' });
        }
        a.coreProjectDetails = all;
      } catch (_) {
        // ignore malformed payloads
      }
    }
    // Action plans (departmental)
    if (cp.actionPlans && typeof cp.actionPlans === 'object') {
      if (!require('../config/entitlements').hasFeature(user, 'departmentPlans')) {
        return res.status(402).json({ code: 'UPGRADE_REQUIRED', message: 'Departmental plans are Premium', feature: 'departmentPlans', plan, upgradeTo: 'premium' });
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    let ob = await Onboarding.findOne({ user: userId }).lean().exec();
    if (!ob) {
      // Initialize a minimal onboarding document to ensure downstream consumers have data
      const created = await Onboarding.create({ user: userId, answers: {} });
      ob = created.toObject();
    }
    const a = ob.answers || {};
    const plan = {
      userProfile: { fullName: (ob.userProfile && ob.userProfile.fullName) || '' },
      businessProfile: { businessName: (ob.businessProfile && ob.businessProfile.businessName) || '', ventureType: (ob.businessProfile && ob.businessProfile.ventureType) || '' },
      vision: { ubp: a.ubp || (ob.vision && ob.vision.ubp) || '', purpose: a.purpose || '', oneYear: (a.vision1y || '').split('\n').filter(Boolean), threeYear: (a.vision3y || '').split('\n').filter(Boolean) },
      values: { core: a.valuesCore || '', culture: a.cultureFeeling || '' },
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
      coreProjects: Array.isArray(a.coreProjects) ? a.coreProjects : [],
      coreProjectDetails: Array.isArray(a.coreProjectDetails) ? a.coreProjectDetails : [],
      generatedAt: new Date().toISOString(),
      version: '1.0',
    };
    return res.json({ plan });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/notifications
exports.getNotifications = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    // Build dynamic task notifications from onboarding action assignments
    const ob = await Onboarding.findOne({ user: userId }).lean().exec();
    const a = ob?.answers || {};
    const assignments = a.actionAssignments || {};
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
      const docs = await Notification.find({ user: userId }).sort({ createdAt: -1 }).limit(50).lean().exec();
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    await Notification.updateMany({ user: userId, read: false }, { $set: { read: true } }).exec();
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/dashboard/notifications/preferences
exports.updateNotificationPrefs = async (req, res, next) => {
  try {
    const userId = req.user?.id;
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const [ob, user] = await Promise.all([
      Onboarding.findOne({ user: userId }).lean().exec(),
      User.findById(userId).lean().exec(),
    ]);
    const a = ob?.answers || {};
    const assignments = a.actionAssignments || {};
    const label = (k) => ({
      marketing: 'Marketing', sales: 'Sales', operations:'Operations & Service Delivery', financeAdmin:'Finance & Admin', peopleHR:'People & Human Resources', partnerships:'Partnerships & Alliances', technology:'Technology & Infrastructure', communityImpact:'ESG & Sustainability'
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
    // Build a unified list of department names from assignments and org chart entries
    const deptMap = new Map(); // key: canonical name -> { name, dueDate? }
    // From assignments: prefer human label mapping
    for (const k of Object.keys(assignments || {})) {
      const name = label(k);
      const arr = assignments[k] || [];
      // Use the nearest due date among INCOMPLETE items (skip 100% complete)
      const dates = (arr || [])
        .filter((u) => pctForItem(u) < 100)
        .map((u)=>parseDate(u?.dueWhen))
        .filter(Boolean)
        .sort();
      const dueDate = dates[0] || '-';
      const ck = canon(name);
      if (!deptMap.has(ck)) deptMap.set(ck, { name, dueDate });
      else {
        const curr = deptMap.get(ck);
        if (!curr.dueDate && dueDate) curr.dueDate = dueDate;
      }
    }
    // From org chart: any typed department names
    for (const p of org) {
      const name = String(p.department || '').trim();
      if (!name) continue;
      const ck = canon(name);
      if (!deptMap.has(ck)) deptMap.set(ck, { name, dueDate: '-' });
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
    const stored = await Department.find({ user: userId }).lean().exec();
    const byName = new Map((stored || []).map((d) => [d.name, d]));
    const departments = Array.from(deptMap.values()).map((r) => {
      const s = byName.get(r.name);
      // Derive progress from action assignment item progress (or fallback to status mapping)
      const deptKey = Object.keys(assignments || {}).find((k) => canon(label(k)) === canon(r.name));
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
      return { name: r.name, owner, dueDate, progress, status };
    });
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
      Onboarding.findOne({ user: userId }).lean().exec(),
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
    const deptKey = Object.keys(assignments || {}).find((k) => canon(({ marketing: 'Marketing', sales: 'Sales', operations:'Operations & Service Delivery', financeAdmin:'Finance & Admin', peopleHR:'People & Human Resources', partnerships:'Partnerships & Alliances', technology:'Technology & Infrastructure', communityImpact:'ESG & Sustainability' }[k] || k)) === canon(name));
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const deptLabel = String(req.body?.department || '').trim();
    const deptKeyIn = String(req.body?.key || '').trim();
    const index = Number(req.body?.index);
    const status = String(req.body?.status || '').trim();
    if (!isFinite(index) || index < 0) return res.status(400).json({ message: 'Valid index is required' });
    if (!status) return res.status(400).json({ message: 'Status is required' });
    const ob = await Onboarding.findOne({ user: userId });
    if (!ob) return res.status(404).json({ message: 'Onboarding not found' });
    ob.answers = ob.answers || {};
    const assignments = ob.answers.actionAssignments = ob.answers.actionAssignments || {};
    const canon = (s) => String(s || '').trim().toLowerCase();
    const labelFromKey = (k) => ({
      marketing: 'Marketing',
      sales: 'Sales',
      operations: 'Operations & Service Delivery',
      financeAdmin: 'Finance & Admin',
      peopleHR: 'People & Human Resources',
      partnerships: 'Partnerships & Alliances',
      technology: 'Technology & Infrastructure',
      communityImpact: 'ESG & Sustainability',
    }[k] || k);
    const keyFromLabel = (lab) => ({
      Marketing: 'marketing',
      Sales: 'sales',
      'Operations & Service Delivery': 'operations',
      'Finance & Admin': 'financeAdmin',
      'People & Human Resources': 'peopleHR',
      'Partnerships & Alliances': 'partnerships',
      'Technology & Infrastructure': 'technology',
      'ESG & Sustainability': 'communityImpact',
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
      'Operations & Service Delivery': 'operations',
      'Finance & Admin': 'financeAdmin',
      'People & Human Resources': 'peopleHR',
      'Partnerships & Alliances': 'partnerships',
      'Technology & Infrastructure': 'technology',
      'ESG & Sustainability': 'communityImpact',
    };

    const ob = await Onboarding.findOne({ user: userId });
    if (!ob) return res.status(404).json({ message: 'Not found' });
    const a = ob.answers || {};
    const curr = a.actionAssignments || {};
    const canon = (s) => String(s || '').trim().toLowerCase();
    const labelFromKey = (k) => ({
      marketing: 'Marketing',
      sales: 'Sales',
      operations: 'Operations & Service Delivery',
      financeAdmin: 'Finance & Admin',
      peopleHR: 'People & Human Resources',
      partnerships: 'Partnerships & Alliances',
      technology: 'Technology & Infrastructure',
      communityImpact: 'ESG & Sustainability',
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    // Load any saved assumptions for this user (current values)
    let savedAssumptions = {};
    try {
      const finDoc = await Financials.findOne({ user: userId }).lean().exec();
      if (finDoc && Array.isArray(finDoc.assumptions)) {
        savedAssumptions = Object.fromEntries(finDoc.assumptions.map((r)=> [String(r.key||''), String(r.value||'')]));
      }
    } catch {}
    const ob = await Onboarding.findOne({ user: userId }).lean().exec();
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const map = new Map();
    rows.forEach((r)=>{ const k = String(r?.key || '').trim(); if (k) map.set(k, String(r?.value ?? '')); });
    // Upsert Financials doc for user; merge values by key
    const fin = await Financials.findOne({ user: userId }) || await Financials.create({ user: userId, metrics:{}, chart:[], revenueBars:[], cashflowBars:[], assumptions:[] });
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne({ user: userId }).lean().exec();
    const prose = (ob && ob.answers && ob.answers.planProse) || {};
    return res.json({ prose: { marketStatement: prose.marketStatement || '', financialStatement: prose.financialStatement || '', generatedAt: prose.generatedAt || null } });
  } catch (err) {
    next(err);
  }
};

// POST /api/dashboard/plan/prose/generate
// Body: { sections?: ['market','financial'] }
exports.generatePlanProse = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne({ user: userId }) || await Onboarding.create({ user: userId });
    const a = ob.answers || {};
    const { sections } = req.body || {};
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
        '6. Capital expenditure — begin with a detailed intro; note purpose if user described it; otherwise state as not provided.',
        '7. Cash flow and runway — begin with a detailed intro; provide qualitative narrative; discuss seasonality/timing if payment days provided.',
        '8. Funding position — begin with a detailed intro; explain role of planned funding (e.g., staffing, marketing, operations, capex).',
        '9. Tax assumptions — begin with a detailed intro; note if not provided; do not infer rates.',
        '10. Overall financial outlook — begin with a detailed intro; then interpretation, risks/opportunities, and near‑term priorities.',
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const plan = await ensureSeedPlan(userId);
    const [p, sectionsRaw] = await Promise.all([
      plan || Plan.findOne({ user: userId }).lean().exec(),
      PlanSection.find({ user: userId }).sort({ order: 1, createdAt: 1 }).lean().exec(),
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
    await ensureSeedPlan(userId);
    const updated = await Plan.findOneAndUpdate(
      { user: userId },
      { companyLogoUrl: url },
      { new: true }
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    // 1) Gather plan data (reuse compiled plan assembly)
    // Ensure plan exists (for logo URL); then load Onboarding answers for compiled plan
    const planDoc = await ensureSeedPlan(userId);
    const planRecord = await Plan.findOne({ user: userId }).lean().exec();
    let ob = await Onboarding.findOne({ user: userId }).lean().exec();
    if (!ob) {
      const created = await Onboarding.create({ user: userId, answers: {} });
      ob = created.toObject();
    }
    const a = ob.answers || {};
    const compiled = {
      userProfile: { fullName: (ob.userProfile && ob.userProfile.fullName) || '' },
      businessProfile: {
        businessName: (ob.businessProfile && ob.businessProfile.businessName) || '',
        ventureType: (ob.businessProfile && ob.businessProfile.ventureType) || '',
      },
      vision: {
        ubp: a.ubp || (ob.vision && ob.vision.ubp) || '',
        purpose: a.purpose || '',
        oneYear: (a.vision1y || '').split('\n').filter(Boolean),
        threeYear: (a.vision3y || '').split('\n').filter(Boolean),
      },
      values: { core: a.valuesCore || '', culture: a.cultureFeeling || '' },
      market: {
        customer: a.marketCustomer || '',
        partners: a.partnersDesc || '',
        competitors: a.compNotes || '',
        competitorNames: a.competitorNames || [],
      },
      products: Array.isArray(a.products) ? a.products : [],
      org: Array.isArray(a.orgPositions)
        ? a.orgPositions.map((p) => ({
            id: p.id,
            name: p.name,
            position: p.position,
            department: p.department || null,
            parentId: p.parentId || null,
          }))
        : [],
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
      },
      prose: a.planProse || {},
    };

    // Optional: refresh prose when requested (best-effort)
    const refresh = String(req.query.refreshProse || '').toLowerCase();
    if (refresh === '1' || refresh === 'true') {
      try {
        // Call the existing generation logic through module without refactor
        const ai = require('./ai.controller');
        // Build minimal contexts like generatePlanProse does
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
        // Market study
        let marketStatement = null;
        try {
          const products = Array.isArray(a.products) ? a.products : [];
          const prodLines = products.filter((p) => String(p?.product || '').trim()).map((p) => `- ${String(p.product).trim()} — ${String(p.description || '').trim()}`).join('\n');
          const oneYearGoals = String(a.vision1y || '')
            .split('\n').map((s) => s.trim()).filter(Boolean).map((s) => `- ${s}`).join('\n');
          const competitorNames = Array.isArray(a.competitorNames) && a.competitorNames.length ? a.competitorNames.map((n) => `- ${n}`).join('\n') : '';
          const partnerPrefs = Array.isArray(a.partnerPrefs) && a.partnerPrefs.length ? a.partnerPrefs.map((n) => `- ${n}`).join('\n') : '';
          const marketCtx = [
            'BUSINESS PROFILE INPUTS',
            contextBase,
            oneYearGoals && `1-year goals:\n${oneYearGoals}`,
            prodLines && `Products and services:\n${prodLines}`,
            '',
            'MARKET STUDY INPUTS',
            a.marketCustomer && `Market/Customer overview (free text): ${a.marketCustomer}`,
            competitorNames && `Direct competitors:\n${competitorNames}`,
            a.compNotes && `Competitive landscape notes: ${a.compNotes}`,
            partnerPrefs && `Desired future partners:\n${partnerPrefs}`,
          ].filter(Boolean).join('\n');
          const studyInstruction = [
            'Using the structured information provided, produce a Market and Opportunity Study with clear sections.',
            'Write in a clear, confident tone. Use only user-supplied facts.',
            'Use numbered section headings and second-level subheadings where relevant; include short bullet lists (3–6 items) where natural.',
          ].join('\n');
          marketStatement = await ai.callOpenAIProse({ type: 'Market and Opportunity Study', input: studyInstruction, contextText: marketCtx, maxTokens: 1200 });
        } catch {}
        // Financial narrative
        let financialStatement = null;
        try {
          const finCtx = [
            contextBase,
            'FINANCIAL INPUTS (user-supplied):',
            a.finFixedOperatingCosts && `Monthly operating expenses (total): ${a.finFixedOperatingCosts}`,
            a.finMarketingSalesSpend && `Monthly marketing & sales spend: ${a.finMarketingSalesSpend}`,
            a.finPayrollCost && `Monthly staffing costs (total): ${a.finPayrollCost}`,
            a.finStartingCash && `Opening cash balance: ${a.finStartingCash}`,
          ].filter(Boolean).join('\n');
          const financialInstruction = [
            'Using the financial inputs provided by the user, generate a clear and comprehensive Financial Section.',
            'Use only the data supplied. Do not invent external statistics. Keep the narrative professional and concise.',
          ].join('\n');
          financialStatement = await ai.callOpenAIProse({ type: 'Financial Section', input: financialInstruction, contextText: finCtx, maxTokens: 900 });
        } catch {}
        const prose = {
          ...(compiled.prose || {}),
          ...(typeof marketStatement === 'string' ? { marketStatement } : {}),
          ...(typeof financialStatement === 'string' ? { financialStatement } : {}),
          generatedAt: new Date().toISOString(),
        };
        // Persist back to onboarding answers for reuse
        await Onboarding.updateOne({ user: userId }, { $set: { 'answers.planProse': prose } }).exec();
        compiled.prose = prose;
      } catch {}
    }

    // 2) Render template to HTML
    const templatePath = path.join(__dirname, '..', 'views', 'plan-export.ejs');
    const html = await ejs.renderFile(templatePath, {
      title: 'Business Plan',
      businessName: (ob.businessProfile && ob.businessProfile.businessName) || '',
      preparedBy: (compiled.userProfile && compiled.userProfile.fullName) || '',
      logoUrl: (planRecord && planRecord.companyLogoUrl) || '',
      ubp: compiled.vision.ubp,
      purpose: compiled.vision.purpose,
      oneYearGoals: compiled.vision.oneYear,
      threeYearGoals: compiled.vision.threeYear,
      valuesCore: compiled.values.core,
      valuesCulture: compiled.values.culture,
      marketCustomer: compiled.market.customer,
      marketPartners: compiled.market.partners,
      marketCompetitors: compiled.market.competitors,
      competitorNames: compiled.market.competitorNames,
      products: compiled.products,
      org: compiled.org,
      fin: compiled.financial,
      prose: compiled.prose,
    });

    // 3) Generate PDF via Puppeteer
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
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

// GET /api/dashboard/products
exports.getProducts = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne({ user: userId }).lean().exec();
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
    const ob = await Onboarding.findOne({ user: userId });
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { revenue, cogs, marketing, payroll, fixed, month } = req.body || {};
    const ob = await Onboarding.findOne({ user: userId }) || await Onboarding.create({ user: userId });
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
    const ob = await Onboarding.findOne({ user: userId }) || await Onboarding.create({ user: userId });
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { name } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ message: 'Section name is required' });
    await ensureSeedPlan(userId);
    const count = await PlanSection.countDocuments({ user: userId });
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const [user, ob] = await Promise.all([
      User.findById(userId).lean().exec(),
      Onboarding.findOne({ user: userId }).exec(),
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
      const membersRaw = await TeamMember.find({ user: userId }).lean().exec();
      members = membersRaw.map((m) => ({ mid: m.mid, name: m.name, email: m.email, position: m.role, department: m.department, status: m.status }));
    }
    // Prefer stored first/last name; fallback to split from fullName
    const parts = (profile.fullName || '').trim().split(/\s+/);
    const firstName = (user?.firstName || '').trim() || parts[0] || '';
    const lastName = (user?.lastName || '').trim() || parts.slice(1).join(' ');
    return res.json({ profile: { ...profile, firstName, lastName }, members });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/dashboard/settings/profile
exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user?.id;
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { mid } = req.params;
    const patch = req.body || {};

    const ob = await Onboarding.findOne({ user: userId });
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
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const { mid } = req.params;
    const ob = await Onboarding.findOne({ user: userId });
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
