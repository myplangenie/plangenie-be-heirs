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

function ensureId(prefix = '') {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
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

async function ensureSeedTeamMembers(userId) {
  const count = await TeamMember.countDocuments({ user: userId });
  if (count > 0) return;
  await TeamMember.insertMany([
    { user: userId, mid: ensureId('m_'), name: 'Sarah Johnson', email: 'sarah@company.com', role: 'Editor', department: 'Operations', status: 'Active' },
    { user: userId, mid: ensureId('m_'), name: 'Sarah Johnson', email: 'sarah@company.com', role: 'Editor', department: 'Operations', status: 'Inactive' },
    { user: userId, mid: ensureId('m_'), name: 'Sarah Johnson', email: 'sarah@company.com', role: 'Editor', department: 'Operations', status: 'Inactive' },
    { user: userId, mid: ensureId('m_'), name: 'Sarah Johnson', email: 'sarah@company.com', role: 'Editor', department: 'Operations', status: 'Active' },
  ]);
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
    const oneYear = (a.vision1y || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const threeYear = (a.vision3y || '').split('\n').map((s) => s.trim()).filter(Boolean);
    const vision = oneYear[0] || threeYear[0] || '';
    const assignments = a.actionAssignments || {};
    const activePlans = Object.values(assignments || {})
      .flat()
      .map((u) => ({ title: (u && u.goal) || '' }))
      .filter((p) => p.title)
      .slice(0, 6);
    // Basic finance chart from answers (first 6 months)
    function num(s) { if (s == null) return 0; const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }
    const units0 = num(a.finSalesVolume);
    const growth = num(a.finSalesGrowthPct) / 100;
    const avgCost = num(a.finAvgUnitCost);
    const fixed = num(a.finFixedOperatingCosts) + num(a.finMarketingSalesSpend) + num(a.finPayrollCost);
    let avgPrice = 0;
    try {
      const prices = (a.products || []).map((p) => num(p.pricing)).filter((n) => n > 0);
      if (prices.length) avgPrice = prices.reduce((x,y)=>x+y,0)/prices.length;
    } catch {}
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
    const summary = {
      kpis: { overdueTasks: 0, activeTeamMembers: Array.isArray(a.orgPositions)?a.orgPositions.length:0 },
      milestones: [],
      departmentProgress,
      financeChart: chart,
      activePlans,
      insights: [],
      snapshot: { vision, ubp },
      team: (a.orgPositions || []).map((p) => ({ name: p.name, role: p.position, note: '' })),
    };
    return res.json({ summary });
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
    const goals = Object.values(a.actionAssignments || {})
      .flat()
      .map((u)=> String(u?.goal||'').trim())
      .filter(Boolean);
    return res.json({ canvas: { ubp, oneYear, threeYear, goals } });
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
    Object.entries(assignments || {}).forEach(([dept, arr]) => {
      (arr || []).forEach((u) => {
        const goal = String(u?.goal || '').trim();
        const due = String(u?.dueWhen || '').trim();
        if (!goal) return;
        const s = sev(due);
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
    const prefs = await NotificationSettings.findOne({ user: userId }).lean().exec();
    return res.json({ items, preferences: { frequency: prefs?.frequency || 'Real-time', tone: prefs?.tone || 'Professional' } });
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
    const ob = await Onboarding.findOne({ user: userId }).lean().exec();
    const a = ob?.answers || {};
    const assignments = a.actionAssignments || {};
    const label = (k) => ({
      marketing: 'Marketing', sales: 'Sales', operations:'Operations & Service Delivery', financeAdmin:'Finance & Admin', peopleHR:'People & Human Resources', partnerships:'Partnerships & Alliances', technology:'Technology & Infrastructure', communityImpact:'Community & Impact'
    }[k] || k);
    const parseDate = (s) => { const m=String(s||'').match(/\d{4}-\d{2}-\d{2}/); return m?m[0]:''; };
    const now = new Date();
    const departments = Object.keys(assignments || {}).map((k) => {
      const arr = (assignments[k] || []);
      const owner = (arr[0] ? `${arr[0].firstName||''} ${arr[0].lastName||''}`.trim() : '') || '-';
      const dates = arr.map((u)=>parseDate(u?.dueWhen)).filter(Boolean).sort();
      const dueDate = dates[0] || '-';
      const filled = arr.filter((u)=> (u?.goal||'').trim()).length;
      const progress = Math.min(100, Math.round(((filled||0)/Math.max(1,arr.length))*100));
      let status = 'in-progress';
      if (progress >= 60) status = 'on-track';
      if (progress === 0) status = 'at-risk';
      // If earliest due is past today and progress is low, mark at-risk
      try { if (dueDate && progress < 50) { const d=new Date(dueDate); if (d < now) status = 'at-risk'; } } catch {}
      return { name: label(k), owner, dueDate, progress, status };
    });
    return res.json({ departments });
  } catch (err) {
    next(err);
  }
};

// GET /api/dashboard/financials
exports.getFinancials = async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const ob = await Onboarding.findOne({ user: userId }).lean().exec();
    const a = ob?.answers || {};
    function num(s) { if (s == null) return 0; const n = parseFloat(String(s).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }
    const units0 = num(a.finSalesVolume);
    const growth = num(a.finSalesGrowthPct) / 100;
    const avgCost = num(a.finAvgUnitCost);
    const fixed = num(a.finFixedOperatingCosts) + num(a.finMarketingSalesSpend) + num(a.finPayrollCost);
    const startCash = num(a.finStartingCash);
    const fundAmt = num(a.finAdditionalFundingAmount);
    const fundMonth = (()=>{ try { const [y,m]=String(a.finAdditionalFundingMonth||'').split('-').map(Number); return (m&&m>=1&&m<=12)?(m-1):-1; } catch { return -1; } })();
    const collectionDays = num(a.finPaymentCollectionDays);
    const lag = collectionDays >= 30 ? 1 : 0;
    let avgPrice = 0;
    try {
      const prices = (a.products || []).map((p) => num(p.pricing)).filter((n) => n > 0);
      if (prices.length) avgPrice = prices.reduce((x,y)=>x+y,0)/prices.length;
    } catch {}
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
    const chart = ['Jan','Feb','Mar','Apr','May','Jun'].map((n, i)=> ({ name:n, Revenue: Math.round(series[i]?.revenue/1000)||0, Cost: Math.round((series[i]?.cogs+series[i]?.opex)/1000)||0, Profit: Math.round(Math.max(series[i]?.profit||0,0)/1000) }));
    const monthlyRevenue = `$${Math.round(series[0]?.revenue||0).toLocaleString()}`;
    const monthlyCosts = `$${Math.round((series[0]?.cogs||0)+(series[0]?.opex||0)).toLocaleString()}`;
    const netProfit = `$${Math.round(series[0]?.profit||0).toLocaleString()}`;
    const burn = series[0]?.profit < 0 ? Math.max(0, Math.floor((startCash||0)/Math.max(1, -series[0].profit))) : 12;
    const financials = {
      metrics: { monthlyRevenue, monthlyCosts, netProfit, burnRate: `${burn} months` },
      chart,
      revenueBars: series.slice(0,12).map((s)=>Math.round(s.revenue/1000)),
      cashflowBars: cashSeries.slice(0,12).map((c)=>Math.round(c/1000)),
      assumptions: [
        { key: 'growth', assumption: 'Monthly Growth Rate', control: 'input', placeholder: 'e.g. 10%', ai: `${(growth*100||0).toFixed(1)}%`, aiClass: 'text-primary font-semibold', rationale: 'From your onboarding inputs' },
        { key: 'margin', assumption: 'Target Profit Margin', control: 'input', placeholder: 'e.g. 15%', ai: `${(num(a.finTargetProfitMarginPct)||0).toFixed(1)}%`, aiClass: 'text-primary font-semibold', rationale: 'From your onboarding inputs' },
      ],
    };
    return res.json({ financials });
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
      Onboarding.findOne({ user: userId }).lean().exec(),
    ]);
    const profile = {
      fullName: user?.fullName || '',
      email: user?.email || '',
      jobTitle: user?.jobTitle || '',
      phone: user?.phone || '',
    };
    const a = ob?.answers || {};
    let members = [];
    try {
      const org = Array.isArray(a.orgPositions) ? a.orgPositions : [];
      members = org.map((p) => ({
        mid: String(p.id || `${(p.position||'').slice(0,8)}-${(p.name||'').slice(0,8)}`),
        name: p.name || '',
        email: p.email || '',
        position: p.position || '',
        department: p.department || '',
        status: p.status || 'Active',
      }));
    } catch {}
    // Fallback to seeded members only if org chart is empty
    if (!members.length) {
      await ensureSeedTeamMembers(userId);
      const membersRaw = await TeamMember.find({ user: userId }).lean().exec();
      members = membersRaw.map((m) => ({ mid: m.mid, name: m.name, email: m.email, role: m.role, department: m.department, status: m.status }));
    }
    // Split name for convenience for clients
    const parts = (profile.fullName || '').trim().split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ');
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
    if (fn || ln) update.fullName = [fn, ln].filter(Boolean).join(' ');
    if (!update.fullName && typeof fullName === 'string') update.fullName = fullName;
    if (typeof email === 'string') update.email = email; // optional, may be disabled in UI
    if (typeof jobTitle === 'string') update.jobTitle = jobTitle;
    if (typeof phone === 'string') update.phone = phone;
    const user = await User.findByIdAndUpdate(userId, update, { new: true }).lean();
    return res.json({ profile: { fullName: user.fullName, email: user.email, jobTitle: user.jobTitle || '', phone: user.phone || '' } });
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
    const idx = list.findIndex((p) => String(p.id || '') === String(mid));
    if (idx === -1) {
      // Fallback: update seeded TeamMember if org member not found
      const m = await TeamMember.findOneAndUpdate({ user: userId, mid }, { $set: patch }, { new: true }).lean();
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
    list[idx] = next;
    ob.answers = { ...a, orgPositions: list };
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
      ob.answers.orgPositions = ob.answers.orgPositions.filter((p) => String(p.id || '') !== String(mid));
      await ob.save();
      return res.json({ ok: true, removed: before !== ob.answers.orgPositions.length });
    }
    const result = await TeamMember.deleteOne({ user: userId, mid }).exec();
    return res.json({ ok: true, removed: result.deletedCount > 0 });
  } catch (err) {
    next(err);
  }
};
