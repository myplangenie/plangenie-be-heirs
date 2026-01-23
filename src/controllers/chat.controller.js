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
const { getWorkspaceFilter, getWorkspaceId } = require('../utils/workspaceQuery');

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

async function executeFactsPlan({ userId, me, ob, teamMembers, teamMembersCount, departments, limitDefault = 20 }) {
  const a = (ob && ob.answers) || {};
  const facts = {};

  function deadlineItems() {
    // Mirrors the aggregation in buildContextText
    const parseDate = (s) => { const d = new Date(String(s||'')); return isNaN(d.getTime()) ? null : d; };
    const items = [];
    try {
      Object.entries(a.actionAssignments || {}).forEach(([dept, arr]) => {
        (arr || []).forEach((u) => {
          const d = parseDate(u?.dueWhen); if (!d) return;
          const goal = String(u?.goal || '').trim();
          const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
          items.push({ when: d, label: [goal, dept && `Dept: ${dept}`, owner && `Owner: ${owner}`].filter(Boolean).join(' | ') });
        });
      });
    } catch {}
    try {
      (Array.isArray(a.coreProjectDetails) ? a.coreProjectDetails : []).forEach((p) => {
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
      if (Array.isArray(a?.coreProjectDetails) && a.coreProjectDetails.length) return a.coreProjectDetails.length;
      if (Array.isArray(a?.coreProjects)) return a.coreProjects.length; return 0;
    },
    get core_projects_list() {
      const list = [];
      if (Array.isArray(a?.coreProjectDetails) && a.coreProjectDetails.length) {
        a.coreProjectDetails.forEach((p) => list.push({ title: String(p?.title||'').trim(), ownerName: p?.ownerName || '', dueWhen: p?.dueWhen || '', deliverables: Array.isArray(p?.deliverables) ? p.deliverables : [] }));
      } else if (Array.isArray(a?.coreProjects)) {
        a.coreProjects.forEach((t) => list.push({ title: String(t||'').trim() }));
      }
      return list;
    },
    get deadlines_list() { return deadlineItems(); },
  };
}

function buildContextText(ob, stats, extras) {
  const bp = (ob && ob.businessProfile) || {};
  const up = (ob && ob.userProfile) || {};
  const a = (ob && ob.answers) || {};
  const fallbackBiz = String(extras?.user?.companyName || '').trim();
  const userFullName = (String(up?.fullName || '').trim()) ||
    ([String(extras?.user?.firstName||'').trim(), String(extras?.user?.lastName||'').trim()].filter(Boolean).join(' ') || String(extras?.user?.fullName||'').trim());

  // Section: Business & User Profile
  const profileLines = [
    (bp.businessName || fallbackBiz) && `Business Name: ${bp.businessName || fallbackBiz}`,
    bp.industry && `Industry: ${bp.industry}`,
    bp.city && bp.country && `Location: ${bp.city}, ${bp.country}`,
    bp.ventureType && `Venture Type: ${bp.ventureType}`,
    bp.teamSize && `Team Size: ${bp.teamSize}`,
    bp.businessStage && `Stage: ${bp.businessStage}`,
    bp.description && `Business Profile Description: ${String(bp.description).trim()}`,
    up.role && `User Role: ${up.role}`,
    userFullName && `User Name: ${userFullName}`,
    typeof stats?.teamMembersCount === 'number' && `Active Team Members: ${stats.teamMembersCount}`,
    typeof stats?.departmentsCount === 'number' && `Departments: ${stats.departmentsCount}`,
    typeof stats?.coreProjectsCount === 'number' && `Core Projects: ${stats.coreProjectsCount}`,
    typeof stats?.departmentalProjectsCount === 'number' && `Departmental Projects: ${stats.departmentalProjectsCount}`,
    typeof stats?.productsCount === 'number' && `Products/Services: ${stats.productsCount}`,
    typeof stats?.orgPositionsCount === 'number' && `Organization Positions: ${stats.orgPositionsCount}`,
    typeof stats?.competitorsCount === 'number' && stats.competitorsCount > 0 && `Competitors: ${stats.competitorsCount}`,
    typeof stats?.swotCount === 'number' && stats.swotCount > 0 && `SWOT Entries: ${stats.swotCount}`,
    typeof stats?.oneYearGoalsCount === 'number' && stats.oneYearGoalsCount > 0 && `1-Year Goals: ${stats.oneYearGoalsCount}`,
    typeof stats?.threeYearGoalsCount === 'number' && stats.threeYearGoalsCount > 0 && `3-Year Goals: ${stats.threeYearGoalsCount}`,
  ].filter(Boolean);
  const profileText = profileLines.length ? `Context about the business:\n- ${profileLines.join('\n- ')}` : '';

  // Section: Vision & Values
  const vvParts = [];
  if (a.ubp) vvParts.push(`UBP: ${String(a.ubp).trim()}`);
  if (a.purpose) vvParts.push(`Purpose: ${String(a.purpose).trim()}`);
  if (a.visionBhag) vvParts.push(`BHAG: ${String(a.visionBhag).trim()}`);
  if (a.vision1y) vvParts.push(`1-Year Goals: ${(String(a.vision1y).trim().split('\n').filter(Boolean).join('; '))}`);
  if (a.vision3y) vvParts.push(`3-Year Goals: ${(String(a.vision3y).trim().split('\n').filter(Boolean).join('; '))}`);
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

  // Section: Financial Snapshot
  const finLines = [];
  try {
    const add = (label, v) => { if (typeof v !== 'undefined' && String(v).trim() !== '') finLines.push(`${label}: ${String(v).trim()}`); };
    add('Projected Sales Volume (M1)', a.finSalesVolume);
    add('Projected Sales Growth %', a.finSalesGrowthPct);
    add('Average Unit Cost', a.finAvgUnitCost);
    add('Fixed Operating Costs (M1)', a.finFixedOperatingCosts);
    add('Marketing/Sales Spend (M1)', a.finMarketingSalesSpend);
    add('Payroll Cost (M1)', a.finPayrollCost);
    add('Starting Cash', a.finStartingCash);
    add('Additional Funding Amount', a.finAdditionalFundingAmount);
    add('Additional Funding Month', a.finAdditionalFundingMonth);
    add('Payment Collection Days', a.finPaymentCollectionDays);
    add('Target Profit Margin %', a.finTargetProfitMarginPct);
    add('Nonprofit', a.finIsNonprofit);
  } catch {}
  const finText = finLines.length ? `\n\nFinancial Snapshot:\n- ${finLines.join('\n- ')}` : '';

  // Section: Derived Metrics (computed from provided numbers)
  let derivedText = '';
  try {
    const num = (v) => {
      const s = String(v ?? '').replace(/[^0-9.\-]/g, '').trim();
      const n = parseFloat(s);
      return isFinite(n) ? n : 0;
    };
    const vol = num(a.finSalesVolume);
    const avgUnitCost = num(a.finAvgUnitCost);
    const fixed = num(a.finFixedOperatingCosts);
    const mkt = num(a.finMarketingSalesSpend);
    const pay = num(a.finPayrollCost);
    const cash = num(a.finStartingCash);
    const targetMarginPct = num(a.finTargetProfitMarginPct);
    const burnMonthly = Math.max(0, fixed + mkt + pay);
    const runwayMonths = burnMonthly > 0 ? (cash / burnMonthly) : 0;
    const derived = [];
    if (burnMonthly > 0) derived.push(`Monthly Burn (approx): ${Math.round(burnMonthly)}`);
    if (cash > 0 && burnMonthly > 0) derived.push(`Runway (months): ${Math.max(0, Math.round(runwayMonths * 10) / 10)}`);
    if (vol > 0 && avgUnitCost > 0) derived.push(`Unit Cost: ${Math.round(avgUnitCost)} (Volume: ${Math.round(vol)})`);
    if (targetMarginPct > 0) derived.push(`Target Gross Margin %: ${Math.round(targetMarginPct)}`);
    if (derived.length) derivedText = `\n\nDerived Metrics (approx):\n- ${derived.join('\n- ')}`;
  } catch {}

  // Section: Core Projects (detailed)
  let coreProjectsText = '';
  try {
    const cps = Array.isArray(a.coreProjectDetails) ? a.coreProjectDetails : [];
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
    } else if (Array.isArray(a.coreProjects) && a.coreProjects.length) {
      coreProjectsText = `\n\nCore Projects:\n- ${a.coreProjects.map((s)=>String(s||'').trim()).filter(Boolean).join('\n- ')}`;
    }
  } catch {}

  // Section: Action Plans by Department (all items)
  let actionsText = '';
  try {
    const assignments = a.actionAssignments || {};
    const lines = [];
    Object.entries(assignments).forEach(([dept, arr]) => {
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

  // Section: Upcoming Deadlines (aggregated)
  let deadlinesText = '';
  try {
    const parseDate = (s) => {
      const t = String(s || '').trim();
      if (!t) return null;
      const d = new Date(t);
      return isNaN(d.getTime()) ? null : d;
    };
    const items = [];
    // From action assignments
    try {
      Object.entries(a.actionAssignments || {}).forEach(([dept, arr]) => {
        (arr || []).forEach((u) => {
          const d = parseDate(u?.dueWhen);
          if (!d) return;
          const goal = String(u?.goal || '').trim();
          const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
          items.push({ when: d, label: [goal, dept && `Dept: ${dept}`, owner && `Owner: ${owner}`].filter(Boolean).join(' | ') });
        });
      });
    } catch {}
    // From core project deliverables
    try {
      (Array.isArray(a.coreProjectDetails) ? a.coreProjectDetails : []).forEach((p) => {
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
    let crudData = { coreProjects: [], deptProjects: [], products: [], orgPositions: [], competitors: [], swotEntries: [] };
    try {
      if (userId) {
        const workspaceId = getWorkspaceId(req);
        const crudFilter = { user: userId, isDeleted: { $ne: true } };
        if (workspaceId) crudFilter.workspace = workspaceId;

        let [me, teamMembersCount, teamMembers, departments, coreProjects, deptProjects, products, orgPositions, competitors, swotEntries] = await Promise.all([
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
        ]);

        // Store for use in runTool
        crudData = { coreProjects: coreProjects || [], deptProjects: deptProjects || [], products: products || [], orgPositions: orgPositions || [], competitors: competitors || [], swotEntries: swotEntries || [] };

        const a = (ob && ob.answers) || {};
        // Prefer orgPositions from new OrgPosition model, fallback to answers
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
        // Derive departments from DepartmentProject model or fallback
        try {
          const canon = (s) => String(s || '').trim().toLowerCase();
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
          } else if (!Array.isArray(departments) || departments.length === 0) {
            const label = (k) => ({
              marketing: 'Marketing', sales: 'Sales', operations:'Operations and Service Delivery', financeAdmin:'Finance and Admin', peopleHR:'People and Human Resources', partnerships:'Partnerships and Alliances', technology:'Technology and Infrastructure', communityImpact:'ESG and Sustainability'
            }[k] || k);
            const list = [];
            if (Array.isArray(a.actionSections) && a.actionSections.length) {
              a.actionSections.forEach((s)=>{ const nm = String(s?.label || '').trim() || label(String(s?.key||'')); if (nm) list.push({ name: nm }); });
            } else {
              Object.keys(a.actionAssignments || {}).forEach((k)=> { const nm = label(k); if (nm) list.push({ name: nm }); });
            }
            const uniq = Array.from(new Map(list.map((d)=> [canon(d.name), d])).values());
            departments = uniq;
          }
        } catch {}

        // Use new CRUD models for counts, fallback to answers
        const coreProjectsCount = coreProjects.length > 0 ? coreProjects.length : (Array.isArray(a?.coreProjectDetails) ? a.coreProjectDetails.length : (Array.isArray(a?.coreProjects) ? a.coreProjects.length : 0));
        const departmentalProjectsCount = deptProjects.length > 0 ? deptProjects.length : (() => { let c = 0; Object.values(a.actionAssignments || {}).forEach((arr) => { if (Array.isArray(arr)) c += arr.length; }); return c; })();
        const productsCount = products.length > 0 ? products.length : (Array.isArray(a.products) ? a.products.length : 0);
        const orgPositionsCount = orgPositions.length > 0 ? orgPositions.length : (Array.isArray(a.orgPositions) ? a.orgPositions.length : 0);
        const competitorsCount = competitors.length;
        const swotCount = swotEntries.length;
        // Count 1-year goals
        const oneYearGoalsCount = String(a.vision1y || '').trim().split('\n').filter(Boolean).length;
        // Count 3-year goals
        const threeYearGoalsCount = String(a.vision3y || '').trim().split('\n').filter(Boolean).length;
        // Count departments
        const departmentsCount = (departments || []).length;
        stats = { teamMembersCount, departmentsCount, coreProjectsCount, departmentalProjectsCount, productsCount, orgPositionsCount, competitorsCount, swotCount, oneYearGoalsCount, threeYearGoalsCount };
        // Build context with expanded extras
        const contextText = buildContextText(ob, stats, { teamMembers, departments, user: me });

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
          'You are Plangenie, a helpful business planning copilot.',
          `Today's date is ${todayDate}.`,
          'Be concise, human, and specific. Avoid buzzwords.',
          'Ground every answer in the provided business context and the conversation. Do not invent facts or numbers.',
          'If a detail is missing from context, say what is missing and ask a concise follow-up question.',
          'When giving recommendations, explicitly reference the business name and/or industry when known.',
          'Treat any numeric counts in the context (e.g., Active Team Members) as the source of truth; do not contradict them.',
          'Prefer concrete, prioritized bullet points tied to departments, projects, team members, KPIs, and upcoming deadlines from the context.',
          'Do not provide generic templates or boilerplate. Keep advice specific to this business.',
          'Never mention that you are an AI model.',
          'Never output example or placeholder names; only use names enumerated in the context.',
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
          { type: 'function', function: { name: 'get_user_profile', description: 'Get user profile (name, email, role).', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_business_profile', description: 'Get business profile (name, industry, location).', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
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
          { type: 'function', function: { name: 'get_vision_and_goals', description: 'Get business vision, UBP (unique business proposition), purpose, and 1-year/3-year goals.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_values_and_culture', description: 'Get core values, culture, and character traits.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_market_info', description: 'Get market information including ideal customer, partners, competitors.', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_org_positions', description: 'Get organizational structure and positions.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_overdue_tasks', description: 'Get tasks and deadlines that are past their due date (overdue).', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_upcoming_tasks', description: 'Get tasks and deadlines due in the future (not yet overdue).', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 100 }, days: { type: 'number', description: 'Optional: only include tasks due within this many days' } }, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_swot_analysis', description: 'Get SWOT analysis (strengths, weaknesses, opportunities, threats).', parameters: { type: 'object', properties: {}, additionalProperties: false } } },
          { type: 'function', function: { name: 'get_competitors', description: 'Get list of competitors with their advantages.', parameters: { type: 'object', properties: { limit: { type: 'number', minimum: 1, maximum: 20 } }, additionalProperties: false } } },
        ];

        const aAns = (ob && ob.answers) || {};
        const deadlineItems = () => {
          const parseDate = (s) => { const d = new Date(String(s||'')); return isNaN(d.getTime()) ? null : d; };
          const items = [];
          // Use new DepartmentProject model with fallback to answers
          try {
            if (crudData.deptProjects && crudData.deptProjects.length > 0) {
              crudData.deptProjects.forEach((p) => {
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
            } else {
              Object.entries(aAns.actionAssignments || {}).forEach(([dept, arr]) => {
                (arr || []).forEach((u) => {
                  const d = parseDate(u?.dueWhen); if (!d) return;
                  const goal = String(u?.goal || '').trim();
                  const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
                  items.push({ when: d, label: [goal, dept && `Dept: ${dept}`, owner && `Owner: ${owner}`].filter(Boolean).join(' | ') });
                });
              });
            }
          } catch {}
          // Use new CoreProject model with fallback to answers
          try {
            if (crudData.coreProjects && crudData.coreProjects.length > 0) {
              crudData.coreProjects.forEach((p) => {
                (Array.isArray(p?.deliverables) ? p.deliverables : []).forEach((d) => {
                  const dt = parseDate(d?.dueWhen); if (!dt) return;
                  const txt = String(d?.text || '').trim();
                  items.push({ when: dt, label: [p?.title && `Project: ${String(p.title).trim()}`, txt].filter(Boolean).join(' | ') });
                });
              });
            } else {
              (Array.isArray(aAns.coreProjectDetails) ? aAns.coreProjectDetails : []).forEach((p) => {
                (Array.isArray(p?.deliverables) ? p.deliverables : []).forEach((d) => {
                  const dt = parseDate(d?.dueWhen); if (!dt) return;
                  const txt = String(d?.text || '').trim();
                  items.push({ when: dt, label: [p?.title && `Project: ${String(p.title).trim()}`, txt].filter(Boolean).join(' | ') });
                });
              });
            }
          } catch {}
          items.sort((x, y) => x.when - y.when);
          return items;
        };

        const runTool = (name, args) => {
          const limitNum = (v, def, max) => { const n = parseInt(v, 10); if (!Number.isFinite(n) || n <= 0) return def; return Math.min(n, max); };
          switch (name) {
            case 'get_user_profile': {
              const full = [String(me?.firstName||'').trim(), String(me?.lastName||'').trim()].filter(Boolean).join(' ') || String(me?.fullName||'').trim();
              return { name: full || undefined, email: me?.email || undefined, role: ob?.userProfile?.role || undefined };
            }
            case 'get_business_profile': { const bp = ob?.businessProfile || {}; return { name: bp.businessName || me?.companyName || undefined, industry: bp.industry || undefined, location: [bp.city, bp.country].filter(Boolean).join(', ') || undefined }; }
            case 'get_team_members_count': return { count: teamMembersCount || 0 };
            case 'get_team_members': { const limit = limitNum(args?.limit, 20, 200); return { list: (teamMembers || []).slice(0, limit).map((t)=>({ name: t?.name||'', role: t?.role||'', department: t?.department||'', email: t?.email||'' })) }; }
            case 'get_departments_count': return { count: (departments || []).length };
            case 'get_departments': { const limit = limitNum(args?.limit, 20, 100); return { list: (departments || []).slice(0, limit).map((d)=>({ name: d?.name||'', status: d?.status||'', owner: d?.owner||'', dueDate: d?.dueDate||'' })) }; }
            case 'get_core_projects_count': {
              // Use new CoreProject model with fallback
              if (crudData.coreProjects && crudData.coreProjects.length > 0) return { count: crudData.coreProjects.length };
              let count = 0; if (Array.isArray(aAns?.coreProjectDetails) && aAns.coreProjectDetails.length) count = aAns.coreProjectDetails.length; else if (Array.isArray(aAns?.coreProjects)) count = aAns.coreProjects.length; return { count };
            }
            case 'get_core_projects': {
              const limit = limitNum(args?.limit, 10, 50);
              const list = [];
              // Use new CoreProject model with fallback
              if (crudData.coreProjects && crudData.coreProjects.length > 0) {
                crudData.coreProjects.forEach((p) => list.push({ title: String(p?.title||'').trim(), ownerName: p?.ownerName || '', dueWhen: p?.dueWhen || '', goal: p?.goal || '', priority: p?.priority || '', deliverables: Array.isArray(p?.deliverables) ? p.deliverables : [] }));
              } else if (Array.isArray(aAns?.coreProjectDetails) && aAns.coreProjectDetails.length) {
                aAns.coreProjectDetails.forEach((p) => list.push({ title: String(p?.title||'').trim(), ownerName: p?.ownerName || '', dueWhen: p?.dueWhen || '', deliverables: Array.isArray(p?.deliverables) ? p.deliverables : [] }));
              } else if (Array.isArray(aAns?.coreProjects)) {
                aAns.coreProjects.forEach((t) => list.push({ title: String(t||'').trim() }));
              }
              return { list: list.slice(0, limit) };
            }
            case 'get_core_deliverables_count': {
              let count = 0;
              // Use new CoreProject model with fallback
              const projects = (crudData.coreProjects && crudData.coreProjects.length > 0) ? crudData.coreProjects : (Array.isArray(aAns?.coreProjectDetails) ? aAns.coreProjectDetails : []);
              projects.forEach((p) => {
                const dels = Array.isArray(p?.deliverables) ? p.deliverables : [];
                dels.forEach((d) => { if (!d?.done) count++; });
              });
              return { count };
            }
            case 'get_deadlines': { const limit = limitNum(args?.limit, 20, 200); return { list: deadlineItems().slice(0, limit).map((d)=>({ date: d.when.toISOString().slice(0,10), label: d.label })) }; }
            case 'get_departmental_projects_count': {
              // Use new DepartmentProject model with fallback
              if (crudData.deptProjects && crudData.deptProjects.length > 0) return { count: crudData.deptProjects.length };
              const assignments = aAns.actionAssignments || {};
              let count = 0;
              Object.values(assignments).forEach((arr) => {
                if (Array.isArray(arr)) count += arr.length;
              });
              return { count };
            }
            case 'get_departmental_projects': {
              const limit = limitNum(args?.limit, 20, 200);
              const filterDept = args?.department ? String(args.department).trim().toLowerCase() : null;
              const list = [];
              // Use new DepartmentProject model with fallback
              if (crudData.deptProjects && crudData.deptProjects.length > 0) {
                crudData.deptProjects.forEach((p) => {
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
              } else {
                const assignments = aAns.actionAssignments || {};
                Object.entries(assignments).forEach(([dept, arr]) => {
                  if (filterDept && dept.toLowerCase() !== filterDept) return;
                  (arr || []).forEach((u) => {
                    const goal = String(u?.goal || '').trim();
                    if (!goal) return;
                    list.push({
                      department: dept,
                      goal,
                      owner: `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim() || undefined,
                      milestone: String(u?.milestone || '').trim() || undefined,
                      kpi: String(u?.kpi || '').trim() || undefined,
                      resources: String(u?.resources || '').trim() || undefined,
                      dueWhen: String(u?.dueWhen || '').trim() || undefined,
                      deliverables: Array.isArray(u?.deliverables) ? u.deliverables.map((d) => ({ text: String(d?.text || '').trim(), done: Boolean(d?.done), kpi: d?.kpi || undefined, dueWhen: d?.dueWhen || undefined })) : [],
                    });
                  });
                });
              }
              return { list: list.slice(0, limit) };
            }
            case 'get_departmental_deliverables_count': {
              let count = 0;
              // Use new DepartmentProject model with fallback
              if (crudData.deptProjects && crudData.deptProjects.length > 0) {
                crudData.deptProjects.forEach((p) => {
                  const dels = Array.isArray(p?.deliverables) ? p.deliverables : [];
                  dels.forEach((d) => { if (!d?.done) count++; });
                });
              } else {
                const assignments = aAns.actionAssignments || {};
                Object.values(assignments).forEach((arr) => {
                  if (!Array.isArray(arr)) return;
                  arr.forEach((u) => {
                    const dels = Array.isArray(u?.deliverables) ? u.deliverables : [];
                    dels.forEach((d) => { if (!d?.done) count++; });
                  });
                });
              }
              return { count };
            }
            case 'get_products': {
              const limit = limitNum(args?.limit, 20, 50);
              // Use new Product model with fallback
              if (crudData.products && crudData.products.length > 0) {
                return {
                  list: crudData.products.slice(0, limit).map((p) => ({
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
              const products = Array.isArray(aAns.products) ? aAns.products : [];
              return {
                list: products.slice(0, limit).map((p) => ({
                  name: String(p?.product || '').trim() || undefined,
                  description: String(p?.description || '').trim() || undefined,
                  price: p?.price || undefined,
                  unitCost: p?.unitCost || undefined,
                  pricing: String(p?.pricing || '').trim() || undefined,
                  monthlyVolume: p?.monthlyVolume || undefined,
                }))
              };
            }
            case 'get_products_count': {
              // Use new Product model with fallback
              if (crudData.products && crudData.products.length > 0) return { count: crudData.products.length };
              const products = Array.isArray(aAns.products) ? aAns.products : [];
              return { count: products.length };
            }
            case 'get_financial_snapshot': {
              return {
                salesVolume: aAns.finSalesVolume || undefined,
                salesGrowthPct: aAns.finSalesGrowthPct || undefined,
                avgUnitCost: aAns.finAvgUnitCost || undefined,
                fixedOperatingCosts: aAns.finFixedOperatingCosts || undefined,
                marketingSalesSpend: aAns.finMarketingSalesSpend || undefined,
                payrollCost: aAns.finPayrollCost || undefined,
                startingCash: aAns.finStartingCash || undefined,
                additionalFundingAmount: aAns.finAdditionalFundingAmount || undefined,
                additionalFundingMonth: aAns.finAdditionalFundingMonth || undefined,
                paymentCollectionDays: aAns.finPaymentCollectionDays || undefined,
                targetProfitMarginPct: aAns.finTargetProfitMarginPct || undefined,
                isNonprofit: aAns.finIsNonprofit || undefined,
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
              // Use new Competitor model with fallback
              let competitorNames = [];
              let competitorAdvantages = [];
              if (crudData.competitors && crudData.competitors.length > 0) {
                competitorNames = crudData.competitors.map((c) => c.name).filter(Boolean);
                competitorAdvantages = crudData.competitors.map((c) => c.advantage).filter(Boolean);
              } else {
                competitorNames = Array.isArray(aAns.competitorNames) ? aAns.competitorNames : [];
              }
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
              // Use new OrgPosition model with fallback
              if (crudData.orgPositions && crudData.orgPositions.length > 0) {
                return {
                  list: crudData.orgPositions.slice(0, limit).map((p) => ({
                    name: String(p?.name || '').trim() || undefined,
                    position: String(p?.position || p?.role || '').trim() || undefined,
                    department: String(p?.department || '').trim() || undefined,
                    email: String(p?.email || '').trim() || undefined,
                    status: String(p?.status || 'Active').trim(),
                  }))
                };
              }
              const org = Array.isArray(aAns.orgPositions) ? aAns.orgPositions : [];
              return {
                list: org.slice(0, limit).map((p) => ({
                  name: String(p?.name || '').trim() || undefined,
                  position: String(p?.position || '').trim() || undefined,
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
              // Use new SwotEntry model with fallback to answers (field is entryType, not type)
              if (crudData.swotEntries && crudData.swotEntries.length > 0) {
                const strengths = crudData.swotEntries.filter((s) => s.entryType === 'strength').map((s) => s.text).filter(Boolean);
                const weaknesses = crudData.swotEntries.filter((s) => s.entryType === 'weakness').map((s) => s.text).filter(Boolean);
                const opportunities = crudData.swotEntries.filter((s) => s.entryType === 'opportunity').map((s) => s.text).filter(Boolean);
                const threats = crudData.swotEntries.filter((s) => s.entryType === 'threat').map((s) => s.text).filter(Boolean);
                return {
                  strengths: strengths.length ? strengths : undefined,
                  weaknesses: weaknesses.length ? weaknesses : undefined,
                  opportunities: opportunities.length ? opportunities : undefined,
                  threats: threats.length ? threats : undefined,
                  count: crudData.swotEntries.length,
                };
              }
              // Fallback to answers
              return {
                strengths: aAns.swotStrengths ? String(aAns.swotStrengths).trim().split('\n').filter(Boolean) : undefined,
                weaknesses: aAns.swotWeaknesses ? String(aAns.swotWeaknesses).trim().split('\n').filter(Boolean) : undefined,
                opportunities: aAns.swotOpportunities ? String(aAns.swotOpportunities).trim().split('\n').filter(Boolean) : undefined,
                threats: aAns.swotThreats ? String(aAns.swotThreats).trim().split('\n').filter(Boolean) : undefined,
              };
            }
            case 'get_competitors': {
              const limit = limitNum(args?.limit, 10, 20);
              // Use new Competitor model with fallback
              if (crudData.competitors && crudData.competitors.length > 0) {
                return {
                  count: crudData.competitors.length,
                  list: crudData.competitors.slice(0, limit).map((c) => ({
                    name: String(c?.name || '').trim() || undefined,
                    advantage: String(c?.advantage || '').trim() || undefined,
                  }))
                };
              }
              // Fallback to answers
              const competitorNames = Array.isArray(aAns.competitorNames) ? aAns.competitorNames : [];
              return {
                count: competitorNames.length,
                list: competitorNames.slice(0, limit).map((name) => ({ name: String(name).trim() }))
              };
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
    const contextText = buildContextText(ob, stats, {});

    const todayDateFallback = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const system = [
      'You are Plangenie, a helpful business planning copilot.',
      `Today's date is ${todayDateFallback}.`,
      'Be concise, human, and specific. Avoid buzzwords.',
      'Use provided context if relevant; never contradict it.',
      'When giving recommendations, explicitly reference the business name and/or industry when known.',
      'Treat any numeric counts in the context (e.g., Active Team Members) as the source of truth; do not contradict them.',
      'Prefer concrete, prioritized bullet points tied to departments, projects, team members, KPIs, and upcoming deadlines from the context.',
      'Do not provide generic templates or boilerplate. Keep advice specific to this business.',
      'Never mention that you are an AI model.',
      'Never output example or placeholder names; only use names enumerated in the context.',
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
