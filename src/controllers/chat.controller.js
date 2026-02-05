const Onboarding = require('../models/Onboarding');
const TeamMember = require('../models/TeamMember');
const Department = require('../models/Department');
const User = require('../models/User');
const CoreProject = require('../models/CoreProject');
const DepartmentProject = require('../models/DepartmentProject');
const Product = require('../models/Product');
const OrgPosition = require('../models/OrgPosition');
const Competitor = require('../models/Competitor');
const SwotEntry = require('../models/SwotEntry');
const FinancialBaseline = require('../models/FinancialBaseline');
const Collaboration = require('../models/Collaboration');
const { getWorkspaceFilter, getWorkspaceId } = require('../utils/workspaceQuery');
const { getWorkspaceFields } = require('../services/workspaceFieldService');

// Optional internal knowledge (Business Trainer)
let rag;
try {
  rag = require('../rag/index.js');
} catch (e) {
  rag = { initRag: async () => ({ ready: false, error: e }), retrieve: async () => [] };
}



// Local helper copied to avoid tight coupling to ai.controller internals
let openaiClient = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error('OPENAI_API_KEY is not configured');
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (!openaiClient) {
    const OpenAI = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// Simple JSON-safe parse
function tryParseJSON(text, fallback) {
  try {
    return JSON.parse(String(text || ''));
  } catch (_) {
    return fallback;
  }
}

// Planner: ask the model which facts to fetch from DB for this user request
// Allowed ops:
// - user.profile
// - business.profile
// - team.members.count
// - team.members.list { limit?: number }
// - departments.count
// - departments.list { limit?: number }
// - coreProjects.count
// - coreProjects.list { limit?: number }
// - deadlines.list { limit?: number }
async function planFacts(messages, contextText) {
  const client = getOpenAI();
  const system = [
    'You are an assistant that returns ONLY JSON to plan which facts to fetch from the database.',
    'Use the minimal set of operations needed to answer the latest user message.',
    'Allowed ops: user.profile | business.profile | team.members.count | team.members.list | departments.count | departments.list | coreProjects.count | coreProjects.list | deadlines.list.',
    'JSON schema: { "operations": Array<{ "op": string, "limit"?: number }> }',
    'Do NOT include any text outside JSON. Avoid redundant operations.',
  ].join(' ');
  const lastUser = (messages || []).slice().reverse().find((m) => m && m.role !== 'assistant');
  const content = [
    contextText ? '(Context provided; do not duplicate here).' : '',
    'User message:',
    String(lastUser?.content || '').slice(0, 1000),
  ].filter(Boolean).join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 120,
    messages: [ { role: 'system', content: system }, { role: 'user', content } ],
  });
  let text = String(resp.choices?.[0]?.message?.content || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) text = fence[1].trim();
  const j = tryParseJSON(text, { operations: [] });
  const ops = Array.isArray(j?.operations) ? j.operations : [];
  const allowed = new Set([
    'user.profile', 'business.profile',
    'team.members.count', 'team.members.list',
    'departments.count', 'departments.list',
    'coreProjects.count', 'coreProjects.list',
    'deadlines.list',
  ]);
  return ops
    .map((o) => ({ op: String(o?.op || '').trim(), limit: Number.isFinite(o?.limit) ? o.limit : undefined }))
    .filter((o) => allowed.has(o.op))
    .slice(0, 8);
}

async function executeFactsPlan({ userId, me, ob, teamMembers, teamMembersCount, departments, coreProjects, deptProjects, limitDefault = 20 }) {
  const facts = {};

  function deadlineItems() {
    // Build from new models only - no legacy fallback
    const parseDate = (s) => { const d = new Date(String(s||'')); return isNaN(d.getTime()) ? null : d; };
    const items = [];
    try {
      (deptProjects || []).forEach((u) => {
        const d = parseDate(u?.dueWhen); if (!d) return;
        const goal = String(u?.goal || '').trim();
        const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
        items.push({ when: d, label: [goal, u?.department && `Dept: ${u.department}`, owner && `Owner: ${owner}`].filter(Boolean).join(' | ') });
      });
    } catch {}
    try {
      (coreProjects || []).forEach((p) => {
        (Array.isArray(p?.deliverables) ? p.deliverables : []).forEach((d) => {
          const dt = parseDate(d?.dueWhen); if (!dt) return;
          const txt = String(d?.text || '').trim();
          items.push({ when: dt, label: [p?.title && `Project: ${String(p.title).trim()}`, txt].filter(Boolean).join(' | ') });
        });
      });
    } catch {}
    items.sort((x, y) => x.when - y.when);
    return items;
  }

  return {
    get user_profile() {
      const full = [String(me?.firstName||'').trim(), String(me?.lastName||'').trim()].filter(Boolean).join(' ') || String(me?.fullName||'').trim();
      return { name: full || undefined, email: me?.email || undefined, role: ob?.userProfile?.role || undefined };
    },
    get business_profile() {
      const bp = ob?.businessProfile || {};
      return { name: bp.businessName || me?.companyName || undefined, industry: bp.industry || undefined, location: [bp.city, bp.country].filter(Boolean).join(', ') || undefined };
    },
    get team_members_count() { return teamMembersCount || 0; },
    get team_members_list() { return (teamMembers || []).map((t)=>({ name: t?.name||'', role: t?.role||'', department: t?.department||'', email: t?.email||'' })); },
    get departments_count() { return (departments || []).length; },
    get departments_list() { return (departments || []).map((d)=>({ name: d?.name||'', status: d?.status||'', owner: d?.owner||'', dueDate: d?.dueDate||'' })); },
    get core_projects_count() {
      return (coreProjects || []).length;
    },
    get core_projects_list() {
      return (coreProjects || []).map((p) => ({
        title: String(p?.title||'').trim(),
        ownerName: p?.ownerName || '',
        dueWhen: p?.dueWhen || '',
        deliverables: Array.isArray(p?.deliverables) ? p.deliverables : []
      }));
    },
    get deadlines_list() { return deadlineItems(); },
  };
}

function buildContextText(ob, stats, extras, wsFields = {}, financialBaseline = null) {
  const bp = (ob && ob.businessProfile) || {};
  const up = (ob && ob.userProfile) || {};
  // Use workspace fields instead of ob.answers
  const a = wsFields || {};
  const fb = financialBaseline || {};
  const fallbackBiz = String(extras?.user?.companyName || '').trim();
  const userFullName = (String(up?.fullName || '').trim()) ||
    ([String(extras?.user?.firstName||'').trim(), String(extras?.user?.lastName||'').trim()].filter(Boolean).join(' ') || String(extras?.user?.fullName||'').trim());

  // Section: Business & User Profile
  const profileLines = [
    (bp.businessName || fallbackBiz) && `Business Name: ${bp.businessName || fallbackBiz}`,
    bp.businessWebsite && `Website: ${bp.businessWebsite}`,
    bp.industry && `Industry: ${bp.industry}`,
    bp.city && bp.country && `Location: ${bp.city}, ${bp.country}`,
    bp.ventureType && `Venture Type: ${bp.ventureType}`,
    bp.teamSize && `Team Size: ${bp.teamSize}`,
    bp.businessStage && `Stage: ${bp.businessStage}`,
    typeof bp.funding === 'boolean' && `Has Funding: ${bp.funding ? 'Yes' : 'No'}`,
    Array.isArray(bp.tools) && bp.tools.length > 0 && `Tools Used: ${bp.tools.join(', ')}`,
    bp.description && `Business Profile Description: ${String(bp.description).trim()}`,
    up.role && `User Role: ${up.role}`,
    userFullName && `User Name: ${userFullName}`,
    up.planningGoal && `Planning Goal: ${up.planningGoal}`,
    typeof up.builtPlanBefore === 'boolean' && `Has Built Plan Before: ${up.builtPlanBefore ? 'Yes' : 'No'}`,
    typeof stats?.teamMembersCount === 'number' && `Active Team Members: ${stats.teamMembersCount}`,
    typeof stats?.departmentsCount === 'number' && `Departments: ${stats.departmentsCount}`,
    typeof stats?.coreProjectsCount === 'number' && `Core Projects: ${stats.coreProjectsCount}`,
    typeof stats?.departmentalProjectsCount === 'number' && `Departmental Projects: ${stats.departmentalProjectsCount}`,
    typeof stats?.productsCount === 'number' && `Products/Services: ${stats.productsCount}`,
    typeof stats?.orgPositionsCount === 'number' && `Organization Positions: ${stats.orgPositionsCount}`,
    typeof stats?.competitorsCount === 'number' && stats.competitorsCount > 0 && `Competitors: ${stats.competitorsCount}`,
    typeof stats?.swotCount === 'number' && stats.swotCount > 0 && `SWOT Entries: ${stats.swotCount}`,
    typeof stats?.oneYearGoalsCount === 'number' && stats.oneYearGoalsCount > 0 && `1-Year Goals: ${stats.oneYearGoalsCount}`,
    typeof stats?.threeYearGoalsCount === 'number' && stats.threeYearGoalsCount > 0 && `3-5 Year Goals: ${stats.threeYearGoalsCount}`,
    typeof stats?.collaboratorsCount === 'number' && `Collaborators: ${stats.collaboratorsCount}`,
  ].filter(Boolean);
  const profileText = profileLines.length ? `Context about the business:\n- ${profileLines.join('\n- ')}` : '';

  // Section: Vision & Values
  const vvParts = [];
  if (a.ubp) vvParts.push(`UBP: ${String(a.ubp).trim()}`);
  if (a.purpose) vvParts.push(`Purpose: ${String(a.purpose).trim()}`);
  if (a.visionBhag) vvParts.push(`BHAG: ${String(a.visionBhag).trim()}`);
  if (a.vision1y) vvParts.push(`1-Year Goals: ${(String(a.vision1y).trim().split('\n').filter(Boolean).join('; '))}`);
  if (a.vision3y) vvParts.push(`3-5 Year Goals: ${(String(a.vision3y).trim().split('\n').filter(Boolean).join('; '))}`);
  if (a.valuesCore) vvParts.push(`Core Values: ${String(a.valuesCore).trim()}`);
  if (a.cultureFeeling) vvParts.push(`Culture: ${String(a.cultureFeeling).trim()}`);
  const vvText = vvParts.length ? `\n\nVision & Values:\n- ${vvParts.join('\n- ')}` : '';

  // Section: Market & Competition
  const marketLines = [];
  if (a.marketCustomer) marketLines.push(`Customer: ${String(a.marketCustomer).trim()}`);
  if (a.partnersDesc) marketLines.push(`Partners: ${String(a.partnersDesc).trim()}`);
  if (a.compNotes) marketLines.push(`Competitors Notes: ${String(a.compNotes).trim()}`);
  if (Array.isArray(a.competitorNames) && a.competitorNames.length) marketLines.push(`Competitor Names: ${a.competitorNames.map(String).join(', ')}`);
  const marketText = marketLines.length ? `\n\nMarket & Competition:\n- ${marketLines.join('\n- ')}` : '';

  // Section: Products & Services
  let productsText = '';
  try {
    const prods = Array.isArray(a.products) ? a.products : [];
    if (prods.length) {
      const lines = prods.map((p) => {
        const name = String(p?.product || '').trim();
        const desc = String(p?.description || '').trim();
        const pricing = [
          typeof p?.price !== 'undefined' && String(p.price || '').trim() && `Price: ${String(p.price).trim()}`,
          typeof p?.unitCost !== 'undefined' && String(p.unitCost || '').trim() && `Unit Cost: ${String(p.unitCost).trim()}`,
          typeof p?.pricing !== 'undefined' && String(p.pricing || '').trim() && `Pricing: ${String(p.pricing).trim()}`,
          typeof p?.monthlyVolume !== 'undefined' && String(p.monthlyVolume || '').trim() && `Monthly Volume: ${String(p.monthlyVolume).trim()}`,
        ].filter(Boolean).join(' | ');
        const bits = [name && `Product: ${name}`, desc && `Desc: ${desc}`, pricing].filter(Boolean);
        return bits.length ? '- ' + bits.join(' | ') : '';
      }).filter(Boolean);
      if (lines.length) productsText = `\n\nProducts & Services:\n${lines.join('\n')}`;
    }
  } catch {}

  // Section: Organization (positions/structure)
  let orgText = '';
  try {
    const org = Array.isArray(a.orgPositions) ? a.orgPositions : [];
    if (org.length) {
      const head = `Positions: ${org.length}`;
      const lines = org.slice(0, 50).map((o) => {
        const nm = String(o?.name || o?.position || '').trim();
        const pos = String(o?.position || '').trim();
        const dept = String(o?.department || '').trim();
        const bits = [nm, pos && `Role: ${pos}`, dept && `Dept: ${dept}`].filter(Boolean);
        return bits.length ? '- ' + bits.join(' | ') : '';
      }).filter(Boolean);
      orgText = `\n\nOrganization:\n- ${head}${lines.length ? `\n${lines.join('\n')}` : ''}`;
    }
  } catch {}

  // Section: Financial Snapshot (from FinancialBaseline model only)
  const finLines = [];
  let derivedText = '';
  try {
    const add = (label, v) => { if (typeof v !== 'undefined' && v !== null && String(v).trim() !== '' && v !== 0) finLines.push(`${label}: ${String(v).trim()}`); };
    const formatCurrency = (v) => v ? `$${Number(v).toLocaleString()}` : null;

    // Use FinancialBaseline data if available
    if (fb && fb.revenue) {
      add('Monthly Revenue', formatCurrency(fb.revenue.totalMonthlyRevenue));
      add('Monthly Delivery Costs', formatCurrency(fb.revenue.totalMonthlyDeliveryCost));
      add('Revenue Streams Count', fb.revenue.streamCount);
    }
    if (fb && fb.workRelatedCosts) {
      add('Work-Related Costs (Monthly)', formatCurrency(fb.workRelatedCosts.total));
      if (fb.workRelatedCosts.contractors) add('  - Contractors', formatCurrency(fb.workRelatedCosts.contractors));
      if (fb.workRelatedCosts.materials) add('  - Materials', formatCurrency(fb.workRelatedCosts.materials));
      if (fb.workRelatedCosts.commissions) add('  - Commissions', formatCurrency(fb.workRelatedCosts.commissions));
      if (fb.workRelatedCosts.shipping) add('  - Shipping', formatCurrency(fb.workRelatedCosts.shipping));
    }
    if (fb && fb.fixedCosts) {
      add('Fixed Costs (Monthly)', formatCurrency(fb.fixedCosts.total));
      if (fb.fixedCosts.salaries) add('  - Salaries', formatCurrency(fb.fixedCosts.salaries));
      if (fb.fixedCosts.rent) add('  - Rent', formatCurrency(fb.fixedCosts.rent));
      if (fb.fixedCosts.software) add('  - Software', formatCurrency(fb.fixedCosts.software));
      if (fb.fixedCosts.insurance) add('  - Insurance', formatCurrency(fb.fixedCosts.insurance));
      if (fb.fixedCosts.utilities) add('  - Utilities', formatCurrency(fb.fixedCosts.utilities));
      if (fb.fixedCosts.marketing) add('  - Marketing', formatCurrency(fb.fixedCosts.marketing));
    }
    if (fb && fb.cash) {
      add('Current Cash Balance', formatCurrency(fb.cash.currentBalance));
      if (fb.cash.expectedFunding) add('Expected Funding', formatCurrency(fb.cash.expectedFunding));
      if (fb.cash.fundingDate) add('Funding Expected Date', new Date(fb.cash.fundingDate).toLocaleDateString());
    }
    if (fb && fb.metrics) {
      add('Monthly Net Surplus/Deficit', formatCurrency(fb.metrics.monthlyNetSurplus));
      add('Gross Profit', formatCurrency(fb.metrics.grossProfit));
      add('Gross Margin %', fb.metrics.grossMarginPercent ? `${Math.round(fb.metrics.grossMarginPercent)}%` : null);
      add('Net Margin %', fb.metrics.netMarginPercent ? `${Math.round(fb.metrics.netMarginPercent)}%` : null);
      add('Monthly Burn Rate', fb.metrics.monthlyBurnRate ? formatCurrency(fb.metrics.monthlyBurnRate) : null);
      add('Cash Runway', fb.metrics.cashRunwayMonths !== null ? (fb.metrics.cashRunwayMonths >= 999 ? 'Infinite (profitable)' : `${fb.metrics.cashRunwayMonths} months`) : null);
      add('Break-Even Revenue', formatCurrency(fb.metrics.breakEvenRevenue));
    }

    // No legacy fallback - only use FinancialBaseline data
  } catch {}

  // Create finText from finLines
  const finText = finLines.length ? `\n\nFinancial Snapshot:\n- ${finLines.join('\n- ')}` : '';

  // Section: Core Projects (from new CoreProject model via extras)
  let coreProjectsText = '';
  try {
    const cps = Array.isArray(extras?.coreProjects) ? extras.coreProjects : [];
    if (cps.length) {
      const lines = cps.map((p) => {
        const title = String(p?.title || '').trim();
        const goal = String(p?.goal || '').trim();
        const kpi = String(p?.kpi || '').trim();
        const due = String(p?.dueWhen || '').trim();
        const owner = String(p?.ownerName || '').trim();
        const head = ['Project', title || goal].filter(Boolean).join(': ');
        const meta = [owner && `Owner: ${owner}`, kpi && `KPI: ${kpi}`, due && `Due: ${due}`].filter(Boolean).join(' | ');
        const dels = Array.isArray(p?.deliverables) ? p.deliverables : [];
        const dlines = dels.map((d) => {
          const txt = String(d?.text || '').trim();
          const dk = String(d?.kpi || '').trim();
          const dd = String(d?.dueWhen || '').trim();
          const done = d?.done ? 'Done' : '';
          const bits = [txt && `• ${txt}`, dk && `KPI: ${dk}`, dd && `Due: ${dd}`, done].filter(Boolean);
          return bits.length ? '  - ' + bits.join(' | ') : '';
        }).filter(Boolean);
        return ['- ' + head, meta && '  - ' + meta, ...dlines].filter(Boolean).join('\n');
      });
      coreProjectsText = `\n\nCore Projects:\n${lines.join('\n')}`;
    }
  } catch {}

  // Section: Action Plans by Department (from new DepartmentProject model via extras)
  let actionsText = '';
  try {
    const deptProjects = Array.isArray(extras?.deptProjects) ? extras.deptProjects : [];
    // Group by department
    const byDept = {};
    deptProjects.forEach((u) => {
      const dept = u?.department || 'Other';
      if (!byDept[dept]) byDept[dept] = [];
      byDept[dept].push(u);
    });
    const lines = [];
    Object.entries(byDept).forEach(([dept, arr]) => {
      const alines = (arr || []).map((u) => {
        const goal = String(u?.goal || '').trim();
        if (!goal) return '';
        const kpi = String(u?.kpi || '').trim();
        const m = String(u?.milestone || '').trim();
        const r = String(u?.resources || '').trim();
        const due = String(u?.dueWhen || '').trim();
        const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
        const bits = [goal, owner && `Owner: ${owner}`, m && `Milestone: ${m}`, kpi && `KPI: ${kpi}`, r && `Resources: ${r}`, due && `Due: ${due}`].filter(Boolean);
        return bits.length ? '  - ' + bits.join(' | ') : '';
      }).filter(Boolean);
      if (alines.length) {
        lines.push(`- Department: ${dept}`);
        lines.push(...alines);
      }
    });
    if (lines.length) actionsText = `\n\nAction Plans:\n${lines.join('\n')}`;
  } catch {}

  // Section: Team Members (active)
  let teamText = '';
  try {
    const tm = Array.isArray(extras?.teamMembers) ? extras.teamMembers : [];
    if (tm.length) {
      const lines = tm.map((t) => {
        const name = String(t?.name || '').trim();
        const role = String(t?.role || '').trim();
        const dept = String(t?.department || '').trim();
        const email = String(t?.email || '').trim();
        const bits = [name && `Name: ${name}`, role && `Role: ${role}`, dept && `Dept: ${dept}`, email && `Email: ${email}`].filter(Boolean);
        return bits.length ? '- ' + bits.join(' | ') : '';
      }).filter(Boolean);
      teamText = `\n\nTeam Members (Active):\n${lines.join('\n')}`;
    }
  } catch {}

  // Section: Departments
  let departmentsText = '';
  try {
    const deps = Array.isArray(extras?.departments) ? extras.departments : [];
    if (deps.length) {
      const lines = deps.slice(0, 12).map((d) => {
        const nm = String(d?.name || '').trim();
        const st = String(d?.status || '').trim();
        const due = String(d?.dueDate || '').trim();
        const owner = String(d?.owner || '').trim();
        const bits = [nm && `Dept: ${nm}`, owner && `Owner: ${owner}`, st && `Status: ${st}`, due && `Due: ${due}`].filter(Boolean);
        return bits.length ? '- ' + bits.join(' | ') : '';
      }).filter(Boolean);
      if (lines.length) departmentsText = `\n\nDepartments:\n${lines.join('\n')}`;
    }
  } catch {}

  // Section: Upcoming Deadlines (aggregated from new models via extras)
  let deadlinesText = '';
  try {
    const parseDate = (s) => {
      const t = String(s || '').trim();
      if (!t) return null;
      const d = new Date(t);
      return isNaN(d.getTime()) ? null : d;
    };
    const items = [];
    // From DepartmentProject model
    try {
      const deptProjects = Array.isArray(extras?.deptProjects) ? extras.deptProjects : [];
      deptProjects.forEach((u) => {
        const d = parseDate(u?.dueWhen);
        if (!d) return;
        const goal = String(u?.goal || u?.title || '').trim();
        const dept = u?.department || u?.departmentKey || '';
        const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
        items.push({ when: d, label: [goal, dept && `Dept: ${dept}`, owner && `Owner: ${owner}`].filter(Boolean).join(' | ') });
      });
    } catch {}
    // From CoreProject model deliverables
    try {
      const coreProjects = Array.isArray(extras?.coreProjects) ? extras.coreProjects : [];
      coreProjects.forEach((p) => {
        (Array.isArray(p?.deliverables) ? p.deliverables : []).forEach((d) => {
          const dt = parseDate(d?.dueWhen);
          if (!dt) return;
          const txt = String(d?.text || '').trim();
          items.push({ when: dt, label: [p?.title && `Project: ${String(p.title).trim()}`, txt].filter(Boolean).join(' | ') });
        });
      });
    } catch {}
    items.sort((x, y) => x.when - y.when);
    if (items.length) deadlinesText = `\n\nUpcoming Deadlines:\n- ${items.slice(0, 50).map((it) => `${it.when.toISOString().slice(0,10)} — ${it.label}`).join('\n- ')}`;
  } catch {}

  return [
    profileText,
    vvText,
    marketText,
    productsText,
    orgText,
    finText,
    derivedText,
    coreProjectsText,
    actionsText,
    teamText,
    departmentsText,
    deadlinesText,
  ].filter(Boolean).join('\n');
}

exports.respond = async (req, res) => {
  try {
    const raw = req.body?.messages;
    const wantDebug = (req?.query && String(req.query.debug||'') === '1') || (req.body && req.body.debug === true);
    const messages = Array.isArray(raw) ? raw : [];
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
    const ob = userId ? await Onboarding.findOne(wsFilter) : null;

    // Derive simple, real user stats to ground AI responses
    let stats = {};
    // Store fetched data from new CRUD models for use in tool calls
    let crudData = { coreProjects: [], deptProjects: [], products: [], orgPositions: [], competitors: [], swotEntries: [], collaborations: [] };
    try {
      if (userId) {
        const workspaceId = getWorkspaceId(req);
        const crudFilter = { user: userId, isDeleted: { $ne: true } };
        if (workspaceId) crudFilter.workspace = workspaceId;

        let [me, teamMembersCount, teamMembers, departments, coreProjects, deptProjects, products, orgPositions, competitors, swotEntries, collaborations] = await Promise.all([
          User.findById(userId).lean().exec(),
          TeamMember.countDocuments({ ...wsFilter, status: 'Active' }).exec(),
          TeamMember.find({ ...wsFilter, status: 'Active' }).select('name email role department status').limit(200).lean().exec(),
          Department.find(wsFilter).select('name status owner dueDate').limit(50).lean().exec(),
          // New CRUD models
          CoreProject.find(crudFilter).sort({ order: 1 }).lean(),
          DepartmentProject.find(crudFilter).sort({ order: 1 }).lean(),
          Product.find(crudFilter).sort({ order: 1 }).lean(),
          OrgPosition.find(crudFilter).sort({ order: 1 }).lean(),
          Competitor.find(crudFilter).sort({ order: 1 }).lean(),
          SwotEntry.find(crudFilter).sort({ order: 1 }).lean(),
          // Collaborators (people invited to the workspace)
          Collaboration.find({ owner: userId, status: 'accepted' }).populate('collaborator', 'firstName lastName email').lean(),
        ]);

        // Store for use in runTool
        crudData = { coreProjects: coreProjects || [], deptProjects: deptProjects || [], products: products || [], orgPositions: orgPositions || [], competitors: competitors || [], swotEntries: swotEntries || [], collaborations: collaborations || [] };

        // Read from Workspace.fields instead of Onboarding.answers
        const a = await getWorkspaceFields(workspaceId);
        // Prefer orgPositions from new OrgPosition model, fallback to workspace fields
        try {
          const org = orgPositions && orgPositions.length > 0 ? orgPositions : (Array.isArray(a.orgPositions) ? a.orgPositions : []);
          if (org.length) {
            const active = org.filter((p) => String(p?.status || 'Active').trim() === 'Active');
            teamMembers = active.map((p) => ({
              name: String(p?.name || '').trim(),
              email: String(p?.email || '').trim(),
              role: String(p?.position || p?.role || '').trim(),
              department: String(p?.department || '').trim(),
              status: 'Active',
            }));
            teamMembersCount = teamMembers.length;
          }
        } catch {}
        // Derive departments from DepartmentProject model only - no legacy fallback
        try {
          if ((!Array.isArray(departments) || departments.length === 0) && deptProjects && deptProjects.length > 0) {
            // Get unique departments from DepartmentProject
            const deptSet = new Set();
            deptProjects.forEach((p) => {
              const dk = String(p?.departmentKey || '').trim();
              if (dk) deptSet.add(dk);
            });
            const label = (k) => ({
              marketing: 'Marketing', sales: 'Sales', operations:'Operations and Service Delivery', financeAdmin:'Finance and Admin', peopleHR:'People and Human Resources', partnerships:'Partnerships and Alliances', technology:'Technology and Infrastructure', communityImpact:'ESG and Sustainability'
            }[k] || k);
            departments = Array.from(deptSet).map((k) => ({ name: label(k) }));
          }
        } catch {}

        // Use new CRUD models for counts only - no legacy fallback
        const coreProjectsCount = coreProjects.length;
        const departmentalProjectsCount = deptProjects.length;
        const productsCount = products.length;
        const orgPositionsCount = orgPositions.length;
        const competitorsCount = competitors.length;
        const swotCount = swotEntries.length;
        const collaboratorsCount = (collaborations || []).length;
        // Count 1-year goals
        const oneYearGoalsCount = String(a.vision1y || '').trim().split('\n').filter(Boolean).length;
        // Count 3-year goals
        const threeYearGoalsCount = String(a.vision3y || '').trim().split('\n').filter(Boolean).length;
        // Count departments
        const departmentsCount = (departments || []).length;
        stats = { teamMembersCount, departmentsCount, coreProjectsCount, departmentalProjectsCount, productsCount, orgPositionsCount, competitorsCount, swotCount, oneYearGoalsCount, threeYearGoalsCount, collaboratorsCount };

        // Fetch financial baseline data (use getOrCreate and sync to match financials page)
        let financialBaseline = null;
        try {
          const baseline = await FinancialBaseline.getOrCreate(userId, workspaceId);
          // Sync revenue from streams to ensure fresh data (like financials page does)
          await baseline.syncRevenueFromStreams();
          await baseline.save();
          financialBaseline = baseline.toObject();
        } catch {}

        // Build context with expanded extras (including new model data and financial baseline)
        const contextText = buildContextText(ob, stats, { teamMembers, departments, user: me, coreProjects, deptProjects }, a, financialBaseline);

        // No regex intercepts — use tool-calling planner pattern below

        // Optional: augment with internal business trainer snippets
        let ragText = '';
        try {
          if (process.env.RAG_ENABLE !== 'false') {
            const lastUser = messages.slice(-5).map((m)=>String(m?.content||'')).join(' \n ').slice(0, 500);
            const seed = [contextText, lastUser].filter(Boolean).join(' \n ');
            const results = await rag.retrieve(seed);
            if (results && results.length) ragText = 'Additional guidance from Business Trainer (internal knowledge):\n' + results.map((r)=>r.text).join('\n\n---\n\n');
          }
        } catch {}
        
        const todayDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const system = [
          'You are Plangenie, a strategic business advisor with deep expertise in business transformation, growth strategy, and operational excellence.',
          'Think like a trusted board advisor combined with a hands-on operator who understands the realities of building businesses.',
          `Today's date is ${todayDate}.`,
          'CRITICAL: Every response must demonstrate deep understanding of THIS specific business - their industry, stage, goals, challenges, and opportunities.',
          'Draw insights from their complete context: UVP, purpose, vision, SWOT analysis, competitive landscape, financials, team structure, and strategic projects.',
          'Be direct, confident, and strategic. Provide insights that could only apply to THIS business, not generic advice.',
          'Ground every answer in the provided business context and the conversation. Do not invent facts or numbers.',
          'IMPORTANT: Information from your previous responses in this conversation is valid context. Reference data you mentioned earlier when answering follow-ups.',
          'If a detail is missing from both the context AND conversation history, say what is missing and ask a concise follow-up question.',
          'When giving recommendations, explicitly connect them to the business\'s stated goals, competitive advantages, and strategic priorities.',
          'Treat any numeric counts in the context (e.g., Active Team Members) as the source of truth; do not contradict them.',
          'Prefer concrete, prioritized action items tied to their specific departments, projects, team members, KPIs, and deadlines.',
          'Never provide generic templates or boilerplate. Every recommendation must be tailored to this business.',
          'Never mention that you are an AI model.',
          'Never output example or placeholder names; only use names enumerated in the context or mentioned in prior conversation messages.',
          'If team member names are not in context, do not guess; state that they are not provided.',
        ].join(' ');

        const safeMsgs = messages
          .slice(-20)
          .map((m) => ({
            role: m?.role === 'assistant' ? 'assistant' : 'user',
            content: String(m?.content ?? '').slice(0, 4000),
          }));
        // TOOL CALLING: Let the model decide which DB-backed tools to call, then answer with verified facts
        const tools = [
          { type: 'function', function: { name: 'get_user_profile', description: 'Get user profile from onboarding (name, email, role, planning goal, planning preferences).', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_business_profile', description: 'Get business profile from onboarding (name, website, industry, stage, location, venture type, team size, funding status, tools, description).', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_team_members_count', description: 'Get count of active team members.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_team_members', description: 'List active team members.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 200 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_departments_count', description: 'Get count of departments.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_departments', description: 'List departments.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_core_projects_count', description: 'Get count of core strategic projects.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_core_projects', description: 'List core strategic projects.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 50 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_core_deliverables_count', description: 'Get count of active (not completed) deliverables under core strategic projects.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_deadlines', description: 'List upcoming deadlines.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 200 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_departmental_projects_count', description: 'Get count of departmental projects (action items assigned across all departments).', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_departmental_projects', description: 'List departmental projects (action items assigned to departments), including their deliverables.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 200 }, department: { type: 'string', description: 'Optional: filter by department key' } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_departmental_deliverables_count', description: 'Get count of active (not completed) deliverables under departmental projects.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_products', description: 'List products and services offered by the business.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 50 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_products_count', description: 'Get count of products/services.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_financial_snapshot', description: 'Get financial data including revenue, costs, cash, funding, margins.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_vision_and_goals', description: 'Get business vision, UBP (unique business proposition), purpose, and 1-year/3-5 year goals.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_values_and_culture', description: 'Get core values, culture, and character traits.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_market_info', description: 'Get market information including ideal customer, partners, competitors.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_org_positions', description: 'Get organizational structure and positions.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_overdue_tasks', description: 'Get tasks and deadlines that are past their due date (overdue).', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_upcoming_tasks', description: 'Get tasks and deadlines due in the future (not yet overdue).', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 }, days: { type: 'number', description: 'Optional: only include tasks due within this many days' } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_swot_analysis', description: 'Get SWOT analysis (strengths, weaknesses, opportunities, threats).', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_competitors', description: 'Get list of competitors with their advantages.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 20 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_collaborators', description: 'Get list of collaborators (people invited to collaborate on the workspace/team).', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 50 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_collaborators_count', description: 'Get count of collaborators on the team.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
        ];

        // 'a' contains workspace fields from above
        const aAns = a || {};
        const deadlineItems = () => {
          const parseDate = (s) => { const d = new Date(String(s||'')); return isNaN(d.getTime()) ? null : d; };
          const items = [];
          // Use new DepartmentProject model only - no legacy fallback
          try {
            (crudData.deptProjects || []).forEach((p) => {
              const d = parseDate(p?.dueWhen); if (!d) return;
              const goal = String(p?.title || '').trim();
              const owner = `${String(p?.firstName||'').trim()} ${String(p?.lastName||'').trim()}`.trim();
              const dept = p?.departmentKey || '';
              items.push({ when: d, label: [goal, dept && `Dept: ${dept}`, owner && `Owner: ${owner}`].filter(Boolean).join(' | ') });
              // Also add deliverables
              (Array.isArray(p?.deliverables) ? p.deliverables : []).forEach((del) => {
                const dt = parseDate(del?.dueWhen); if (!dt) return;
                const txt = String(del?.text || '').trim();
                items.push({ when: dt, label: [goal && `Project: ${goal}`, txt, owner && `Owner: ${owner}`].filter(Boolean).join(' | ') });
              });
            });
          } catch {}
          // Use new CoreProject model only - no legacy fallback
          try {
            (crudData.coreProjects || []).forEach((p) => {
              (Array.isArray(p?.deliverables) ? p.deliverables : []).forEach((d) => {
                const dt = parseDate(d?.dueWhen); if (!dt) return;
                const txt = String(d?.text || '').trim();
                items.push({ when: dt, label: [p?.title && `Project: ${String(p.title).trim()}`, txt].filter(Boolean).join(' | ') });
              });
            });
          } catch {}
          items.sort((x, y) => x.when - y.when);
          return items;
        };

        const runTool = (name, args) => {
          const limitNum = (v, def, max) => { const n = parseInt(v, 10); if (!Number.isFinite(n) || n <= 0) return def; return Math.min(n, max); };
          switch (name) {
            case 'get_user_profile': {
              const full = [String(me?.firstName||'').trim(), String(me?.lastName||'').trim()].filter(Boolean).join(' ') || String(me?.fullName||'').trim();
              const up = ob?.userProfile || {};
              return {
                name: full || up.fullName || undefined,
                email: me?.email || undefined,
                role: up.role || undefined,
                builtPlanBefore: up.builtPlanBefore,
                planningGoal: up.planningGoal || undefined,
                includePersonalPlanning: up.includePersonalPlanning,
                planningFor: up.planningFor || undefined,
              };
            }
            case 'get_business_profile': {
              const bp = ob?.businessProfile || {};
              return {
                name: bp.businessName || me?.companyName || undefined,
                website: bp.businessWebsite || undefined,
                industry: bp.industry || undefined,
                businessStage: bp.businessStage || undefined,
                location: [bp.city, bp.country].filter(Boolean).join(', ') || undefined,
                city: bp.city || undefined,
                country: bp.country || undefined,
                ventureType: bp.ventureType || undefined,
                teamSize: bp.teamSize || undefined,
                hasFunding: bp.funding,
                tools: Array.isArray(bp.tools) ? bp.tools : undefined,
                description: bp.description || undefined,
              };
            }
            case 'get_team_members_count': return { count: teamMembersCount || 0 };
            case 'get_team_members': { const limit = limitNum(args?.limit, 20, 200); return { list: (teamMembers || []).slice(0, limit).map((t)=>({ name: t?.name||'', role: t?.role||'', department: t?.department||'', email: t?.email||'' })) }; }
            case 'get_departments_count': return { count: (departments || []).length };
            case 'get_departments': { const limit = limitNum(args?.limit, 20, 100); return { list: (departments || []).slice(0, limit).map((d)=>({ name: d?.name||'', status: d?.status||'', owner: d?.owner||'', dueDate: d?.dueDate||'' })) }; }
            case 'get_core_projects_count': {
              // Use new CoreProject model only - no legacy fallback
              return { count: crudData.coreProjects?.length || 0 };
            }
            case 'get_core_projects': {
              const limit = limitNum(args?.limit, 10, 50);
              const list = [];
              // Use new CoreProject model only - no legacy fallback
              (crudData.coreProjects || []).forEach((p) => list.push({ title: String(p?.title||'').trim(), ownerName: p?.ownerName || '', dueWhen: p?.dueWhen || '', goal: p?.goal || '', priority: p?.priority || '', deliverables: Array.isArray(p?.deliverables) ? p.deliverables : [] }));
              return { list: list.slice(0, limit) };
            }
            case 'get_core_deliverables_count': {
              let count = 0;
              // Use new CoreProject model only - no legacy fallback
              (crudData.coreProjects || []).forEach((p) => {
                const dels = Array.isArray(p?.deliverables) ? p.deliverables : [];
                dels.forEach((d) => { if (!d?.done) count++; });
              });
              return { count };
            }
            case 'get_deadlines': { const limit = limitNum(args?.limit, 20, 200); return { list: deadlineItems().slice(0, limit).map((d)=>({ date: d.when.toISOString().slice(0,10), label: d.label })) }; }
            case 'get_departmental_projects_count': {
              // Use new DepartmentProject model only - no legacy fallback
              return { count: crudData.deptProjects?.length || 0 };
            }
            case 'get_departmental_projects': {
              const limit = limitNum(args?.limit, 20, 200);
              const filterDept = args?.department ? String(args.department).trim().toLowerCase() : null;
              const list = [];
              // Use new DepartmentProject model only - no legacy fallback
              (crudData.deptProjects || []).forEach((p) => {
                const dept = p?.departmentKey || '';
                if (filterDept && dept.toLowerCase() !== filterDept) return;
                const goal = String(p?.title || '').trim();
                if (!goal) return;
                list.push({
                  department: dept,
                  goal,
                  owner: `${String(p?.firstName||'').trim()} ${String(p?.lastName||'').trim()}`.trim() || undefined,
                  milestone: String(p?.milestone || '').trim() || undefined,
                  kpi: String(p?.kpi || '').trim() || undefined,
                  resources: String(p?.resources || '').trim() || undefined,
                  dueWhen: String(p?.dueWhen || '').trim() || undefined,
                  status: p?.status || undefined,
                  deliverables: Array.isArray(p?.deliverables) ? p.deliverables.map((d) => ({ text: String(d?.text || '').trim(), done: Boolean(d?.done), kpi: d?.kpi || undefined, dueWhen: d?.dueWhen || undefined })) : [],
                });
              });
              return { list: list.slice(0, limit) };
            }
            case 'get_departmental_deliverables_count': {
              let count = 0;
              // Use new DepartmentProject model only - no legacy fallback
              (crudData.deptProjects || []).forEach((p) => {
                const dels = Array.isArray(p?.deliverables) ? p.deliverables : [];
                dels.forEach((d) => { if (!d?.done) count++; });
              });
              return { count };
            }
            case 'get_products': {
              const limit = limitNum(args?.limit, 20, 50);
              // Use new Product model only - no legacy fallback
              return {
                list: (crudData.products || []).slice(0, limit).map((p) => ({
                  name: String(p?.name || '').trim() || undefined,
                  description: String(p?.description || '').trim() || undefined,
                  price: p?.price || undefined,
                  unitCost: p?.unitCost || undefined,
                  pricing: String(p?.pricing || '').trim() || undefined,
                  monthlyVolume: p?.monthlyVolume || undefined,
                  category: p?.category || undefined,
                }))
              };
            }
            case 'get_products_count': {
              // Use new Product model only - no legacy fallback
              return { count: (crudData.products || []).length };
            }
            case 'get_financial_snapshot': {
              // Use FinancialBaseline model data only (no legacy fallback)
              if (!financialBaseline) {
                return { message: 'No financial data available. Please set up financials in the Financials page.' };
              }
              return {
                // Revenue
                monthlyRevenue: financialBaseline.revenue?.totalMonthlyRevenue || 0,
                monthlyDeliveryCost: financialBaseline.revenue?.totalMonthlyDeliveryCost || 0,
                revenueStreamCount: financialBaseline.revenue?.streamCount || 0,
                // Work-related costs
                workRelatedCostsTotal: financialBaseline.workRelatedCosts?.total || 0,
                contractors: financialBaseline.workRelatedCosts?.contractors || 0,
                materials: financialBaseline.workRelatedCosts?.materials || 0,
                commissions: financialBaseline.workRelatedCosts?.commissions || 0,
                shipping: financialBaseline.workRelatedCosts?.shipping || 0,
                // Fixed costs
                fixedCostsTotal: financialBaseline.fixedCosts?.total || 0,
                salaries: financialBaseline.fixedCosts?.salaries || 0,
                rent: financialBaseline.fixedCosts?.rent || 0,
                software: financialBaseline.fixedCosts?.software || 0,
                insurance: financialBaseline.fixedCosts?.insurance || 0,
                utilities: financialBaseline.fixedCosts?.utilities || 0,
                marketing: financialBaseline.fixedCosts?.marketing || 0,
                // Cash
                currentCashBalance: financialBaseline.cash?.currentBalance || 0,
                expectedFunding: financialBaseline.cash?.expectedFunding || 0,
                fundingDate: financialBaseline.cash?.fundingDate || null,
                // Metrics
                monthlyNetSurplus: financialBaseline.metrics?.monthlyNetSurplus || 0,
                grossProfit: financialBaseline.metrics?.grossProfit || 0,
                grossMarginPercent: financialBaseline.metrics?.grossMarginPercent || 0,
                netMarginPercent: financialBaseline.metrics?.netMarginPercent || 0,
                monthlyBurnRate: financialBaseline.metrics?.monthlyBurnRate || 0,
                cashRunwayMonths: financialBaseline.metrics?.cashRunwayMonths,
                breakEvenRevenue: financialBaseline.metrics?.breakEvenRevenue || 0,
              };
            }
            case 'get_vision_and_goals': {
              const oneYearGoals = String(aAns.vision1y || '').trim().split('\n').filter(Boolean);
              const threeYearGoals = String(aAns.vision3y || '').trim().split('\n').filter(Boolean);
              return {
                ubp: String(aAns.ubp || '').trim() || undefined,
                purpose: String(aAns.purpose || '').trim() || undefined,
                bhag: String(aAns.visionBhag || '').trim() || undefined,
                oneYearGoals: oneYearGoals.length ? oneYearGoals : undefined,
                threeYearGoals: threeYearGoals.length ? threeYearGoals : undefined,
              };
            }
            case 'get_values_and_culture': {
              const keywords = Array.isArray(aAns.valuesCoreKeywords) ? aAns.valuesCoreKeywords : [];
              return {
                coreValues: String(aAns.valuesCore || '').trim() || undefined,
                culture: String(aAns.cultureFeeling || '').trim() || undefined,
                characterTraits: keywords.length ? keywords : undefined,
              };
            }
            case 'get_market_info': {
              // Use new Competitor model only - no legacy fallback
              const competitorNames = (crudData.competitors || []).map((c) => c.name).filter(Boolean);
              const competitorAdvantages = (crudData.competitors || []).map((c) => c.advantage).filter(Boolean);
              return {
                idealCustomer: String(aAns.marketCustomer || aAns.targetCustomer || '').trim() || undefined,
                partners: String(aAns.partnersDesc || aAns.partners || '').trim() || undefined,
                competitorNotes: String(aAns.compNotes || aAns.competitorsNotes || '').trim() || undefined,
                competitorNames: competitorNames.length ? competitorNames : undefined,
                competitorAdvantages: competitorAdvantages.length ? competitorAdvantages : undefined,
              };
            }
            case 'get_org_positions': {
              const limit = limitNum(args?.limit, 50, 100);
              // Use new OrgPosition model only - no legacy fallback
              return {
                list: (crudData.orgPositions || []).slice(0, limit).map((p) => ({
                  name: String(p?.name || '').trim() || undefined,
                  position: String(p?.position || p?.role || '').trim() || undefined,
                  department: String(p?.department || '').trim() || undefined,
                  email: String(p?.email || '').trim() || undefined,
                  status: String(p?.status || 'Active').trim(),
                }))
              };
            }
            case 'get_overdue_tasks': {
              const limit = limitNum(args?.limit, 20, 100);
              const now = new Date();
              now.setHours(0, 0, 0, 0); // Start of today
              const allItems = deadlineItems();
              const overdue = allItems.filter((item) => item.when < now);
              return {
                count: overdue.length,
                list: overdue.slice(0, limit).map((d) => ({
                  date: d.when.toISOString().slice(0, 10),
                  daysOverdue: Math.floor((now - d.when) / (1000 * 60 * 60 * 24)),
                  label: d.label
                }))
              };
            }
            case 'get_upcoming_tasks': {
              const limit = limitNum(args?.limit, 20, 100);
              const daysFilter = args?.days && Number.isFinite(args.days) ? args.days : null;
              const now = new Date();
              now.setHours(0, 0, 0, 0); // Start of today
              const allItems = deadlineItems();
              let upcoming = allItems.filter((item) => item.when >= now);
              if (daysFilter) {
                const cutoff = new Date(now);
                cutoff.setDate(cutoff.getDate() + daysFilter);
                upcoming = upcoming.filter((item) => item.when <= cutoff);
              }
              return {
                count: upcoming.length,
                list: upcoming.slice(0, limit).map((d) => ({
                  date: d.when.toISOString().slice(0, 10),
                  daysUntilDue: Math.floor((d.when - now) / (1000 * 60 * 60 * 24)),
                  label: d.label
                }))
              };
            }
            case 'get_swot_analysis': {
              // Use new SwotEntry model only - no legacy fallback (field is entryType, not type)
              const entries = crudData.swotEntries || [];
              const strengths = entries.filter((s) => s.entryType === 'strength').map((s) => s.text).filter(Boolean);
              const weaknesses = entries.filter((s) => s.entryType === 'weakness').map((s) => s.text).filter(Boolean);
              const opportunities = entries.filter((s) => s.entryType === 'opportunity').map((s) => s.text).filter(Boolean);
              const threats = entries.filter((s) => s.entryType === 'threat').map((s) => s.text).filter(Boolean);
              return {
                strengths: strengths.length ? strengths : undefined,
                weaknesses: weaknesses.length ? weaknesses : undefined,
                opportunities: opportunities.length ? opportunities : undefined,
                threats: threats.length ? threats : undefined,
                count: entries.length,
              };
            }
            case 'get_competitors': {
              const limit = limitNum(args?.limit, 10, 20);
              // Use new Competitor model only - no legacy fallback
              const competitors = crudData.competitors || [];
              return {
                count: competitors.length,
                list: competitors.slice(0, limit).map((c) => ({
                  name: String(c?.name || '').trim() || undefined,
                  advantage: String(c?.advantage || '').trim() || undefined,
                }))
              };
            }
            case 'get_collaborators': {
              const limit = limitNum(args?.limit, 20, 50);
              const collabs = crudData.collaborations || [];
              return {
                count: collabs.length,
                list: collabs.slice(0, limit).map((c) => {
                  const collab = c?.collaborator || {};
                  return {
                    name: [String(collab?.firstName || '').trim(), String(collab?.lastName || '').trim()].filter(Boolean).join(' ') || undefined,
                    email: String(c?.email || collab?.email || '').trim() || undefined,
                    accessType: c?.accessType || 'admin',
                    departments: Array.isArray(c?.departments) ? c.departments : [],
                    acceptedAt: c?.acceptedAt || undefined,
                  };
                })
              };
            }
            case 'get_collaborators_count': {
              return { count: (crudData.collaborations || []).length };
            }
            default: return {};
          }
        };

        let chatMessages = [
          { role: 'system', content: system },
          ...(contextText ? [{ role: 'system', content: contextText }] : []),
          ...(ragText ? [{ role: 'system', content: ragText }] : []),
          ...safeMsgs,
        ];
        const client = getOpenAI();
        const toolTrace = [];
        for (let i = 0; i < 3; i++) {
          const resp = await client.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0.2, max_tokens: 600, messages: chatMessages, tools, tool_choice: 'auto' });
          const msg = resp.choices?.[0]?.message;
          const toolCalls = msg?.tool_calls || [];
          if (toolCalls.length === 0) {
            const reply = String(msg?.content || '').trim() || 'I did not find an answer.';
            return res.json({ reply, ...(wantDebug ? { _debug: { contextText, rag: Boolean(ragText), tools: toolTrace } } : {}) });
          }
          chatMessages.push({ role: 'assistant', content: msg?.content || '', tool_calls: toolCalls });
          for (const tc of toolCalls) {
            const name = tc?.function?.name || '';
            const args = tryParseJSON(tc?.function?.arguments || '{}', {});
            const out = runTool(name, args);
            toolTrace.push({ name, args, out });
            chatMessages.push({ role: 'tool', tool_call_id: tc?.id, content: JSON.stringify(out) });
          }
        }
        const reply = 'I could not complete the tool-assisted response.';
        return res.json({ reply, ...(wantDebug ? { _debug: { contextText, rag: Boolean(ragText), note: 'tool loop exhausted' } } : {}) });
      }
    } catch (_) {
      // Non-fatal: if stats fail, continue without them
    }
    // If we couldn't gather expanded data (e.g., unauthenticated), fallback to minimal context
    const wsIdFallback = getWorkspaceId(req);
    const userIdFallback = req.user?.id;
    const wsFieldsFallback = wsIdFallback ? await getWorkspaceFields(wsIdFallback) : {};
    let financialBaselineFallback = null;
    try {
      if (userIdFallback && wsIdFallback) {
        const baseline = await FinancialBaseline.getOrCreate(userIdFallback, wsIdFallback);
        await baseline.syncRevenueFromStreams();
        await baseline.save();
        financialBaselineFallback = baseline.toObject();
      }
    } catch {}
    const contextText = buildContextText(ob, stats, {}, wsFieldsFallback, financialBaselineFallback);

    const todayDateFallback = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const system = [
      'You are Plangenie, a strategic business advisor with deep expertise in business transformation, growth strategy, and operational excellence.',
      'Think like a trusted board advisor combined with a hands-on operator who understands the realities of building businesses.',
      `Today's date is ${todayDateFallback}.`,
      'CRITICAL: Every response must demonstrate understanding of THIS specific business based on the context provided.',
      'Be direct, confident, and strategic. Provide insights tailored to their situation, not generic advice.',
      'Use provided context if relevant; never contradict it.',
      'IMPORTANT: Information from your previous responses in this conversation is valid context. Reference data you mentioned earlier when answering follow-ups.',
      'When giving recommendations, explicitly connect them to the business\'s context, goals, and priorities.',
      'Treat any numeric counts in the context (e.g., Active Team Members) as the source of truth; do not contradict them.',
      'Prefer concrete, prioritized action items tied to their specific departments, projects, team members, KPIs, and deadlines.',
      'Never provide generic templates or boilerplate. Every recommendation must be tailored to this business.',
      'Never mention that you are an AI model.',
      'Never output example or placeholder names; only use names enumerated in the context or mentioned in prior conversation messages.',
      'If team member names are not in context, do not guess; state that they are not provided.',
    ].join(' ');

    const safeMsgs = messages
      .slice(-20)
      .map((m) => ({
        role: m?.role === 'assistant' ? 'assistant' : 'user',
        content: String(m?.content ?? '').slice(0, 4000),
      }));

    const client = getOpenAI();
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        { role: 'system', content: system },
        ...(contextText ? [{ role: 'system', content: contextText }] : []),
        ...safeMsgs,
      ],
    });

    const reply = String(resp.choices?.[0]?.message?.content || '').trim() || 'I did not find an answer.';
    return res.json({ reply, ...(wantDebug ? { _debug: { contextText } } : {}) });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to respond';
    return res.status(500).json({ message });
  }
};
