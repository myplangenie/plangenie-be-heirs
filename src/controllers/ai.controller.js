const Onboarding = require('../models/Onboarding');
const User = require('../models/User');
const TeamMember = require('../models/TeamMember');
const Department = require('../models/Department');
const { getWorkspaceFilter } = require('../utils/workspaceQuery');
let rag;
try {
  rag = require('../rag/index.js');
} catch (e) {
  rag = { initRag: async () => ({ ready: false, error: e }), retrieve: async () => [] };
}

// Lazy-load OpenAI to avoid crashing if not installed during dev
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

function buildContextText(ob) {
  if (!ob) return '';
  const bp = ob.businessProfile || {};
  const up = ob.userProfile || {};
  const fields = [
    bp.businessName && `Business Name: ${bp.businessName}`,
    bp.industry && `Industry: ${bp.industry}`,
    bp.city && bp.country && `Location: ${bp.city}, ${bp.country}`,
    bp.ventureType && `Venture Type: ${bp.ventureType}`,
    bp.teamSize && `Team Size: ${bp.teamSize}`,
    bp.businessStage && `Stage: ${bp.businessStage}`,
    bp.description && `Business Profile Description: ${bp.description}`,
    up.role && `User Role: ${up.role}`,
  ].filter(Boolean);
  return fields.length ? `Context about the business:\n- ${fields.join('\n- ')}` : '';
}

function buildAnswersContext(ob) {
  try {
    const a = (ob && ob.answers) || {};
    const bp = (ob && ob.businessProfile) || {};
    const up = (ob && ob.userProfile) || {};
    const lines = [];

    // Business Profile from initial onboarding
    if (bp.businessName) lines.push(`Business Name: ${String(bp.businessName).trim()}`);
    const industry = bp.industry === 'Other' && bp.industryOther ? bp.industryOther : bp.industry;
    if (industry) lines.push(`Industry: ${industry}`);
    if (bp.city && bp.country) lines.push(`Location: ${bp.city}, ${bp.country}`);
    if (bp.ventureType) lines.push(`Venture Type: ${bp.ventureType}`);
    if (bp.teamSize) lines.push(`Team Size: ${bp.teamSize}`);
    if (bp.businessStage) lines.push(`Stage: ${bp.businessStage}`);
    if (bp.description) lines.push(`Business Description: ${String(bp.description).trim()}`);
    if (bp.funding) lines.push(`Has Funding: Yes`);
    if (Array.isArray(bp.tools) && bp.tools.length) lines.push(`Tools Used: ${bp.tools.join(', ')}`);

    // User Profile from initial onboarding
    const userRole = up.role === 'Other' && up.roleOther ? up.roleOther : up.role;
    if (userRole) lines.push(`User Role: ${userRole}`);
    if (up.planningFor) lines.push(`Planning For: ${up.planningFor}`);
    const planningGoal = up.planningGoal === 'other' && up.planningGoalOther ? up.planningGoalOther : up.planningGoal;
    if (planningGoal) lines.push(`Planning Goal: ${planningGoal}`);
    if (up.builtPlanBefore) lines.push(`Has Built Plan Before: ${up.builtPlanBefore}`);
    if (up.includePersonalPlanning) lines.push(`Include Personal Planning: Yes`);

    // Vision & Values
    if (a.ubp) lines.push(`UBP: ${String(a.ubp).trim()}`);
    if (a.purpose) lines.push(`Purpose: ${String(a.purpose).trim()}`);
    if (a.visionBhag) lines.push(`Long-Term Strategic Vision (BHAG): ${String(a.visionBhag).trim()}`);
    if (a.vision1y) lines.push(`1-Year Goals: ${(String(a.vision1y).trim().split('\n').filter(Boolean).join('; '))}`);
    if (a.vision3y) lines.push(`3-Year Goals: ${(String(a.vision3y).trim().split('\n').filter(Boolean).join('; '))}`);
    if (a.valuesCore) lines.push(`Core Values: ${String(a.valuesCore).trim()}`);
    if (a.cultureFeeling) lines.push(`Culture & Behaviors: ${String(a.cultureFeeling).trim()}`);
    // SWOT
    if (a.swotStrengths) lines.push(`Strengths: ${String(a.swotStrengths).trim()}`);
    if (a.swotWeaknesses) lines.push(`Weaknesses: ${String(a.swotWeaknesses).trim()}`);
    if (a.swotOpportunities) lines.push(`Opportunities: ${String(a.swotOpportunities).trim()}`);
    if (a.swotThreats) lines.push(`Threats: ${String(a.swotThreats).trim()}`);
    // Market & Competition
    if (a.marketCustomer) lines.push(`Target Customer: ${String(a.marketCustomer).trim()}`);
    if (a.custType) lines.push(`Customer Type: ${String(a.custType).trim()}`);
    if (a.partnersDesc) lines.push(`Partners: ${String(a.partnersDesc).trim()}`);
    if (a.compNotes) lines.push(`Competitor Notes: ${String(a.compNotes).trim()}`);
    if (Array.isArray(a.competitorNames) && a.competitorNames.length) {
      lines.push(`Competitors: ${a.competitorNames.slice(0, 8).join(', ')}`);
    }
    if (Array.isArray(a.competitorAdvantages) && a.competitorAdvantages.length) {
      lines.push(`Competitive Advantages: ${a.competitorAdvantages.slice(0, 8).join(', ')}`);
    }
    // Products with full details
    if (Array.isArray(a.products) && a.products.length) {
      const productLines = a.products.slice(0, 10).map((p) => {
        const parts = [
          p?.product && `Name: ${String(p.product).trim()}`,
          p?.description && `Desc: ${String(p.description).trim()}`,
          p?.price && `Price: $${p.price}`,
          p?.unitCost && `Cost: $${p.unitCost}`,
          p?.monthlyVolume && `Monthly Volume: ${p.monthlyVolume}`,
        ].filter(Boolean);
        return parts.length ? parts.join(' | ') : '';
      }).filter(Boolean);
      if (productLines.length) lines.push(`Products/Services: ${productLines.join('; ')}`);
    }
    // Financial summary
    if (a.finStartingCash) lines.push(`Starting Cash: $${a.finStartingCash}`);
    if (a.finSalesVolume) lines.push(`Monthly Sales Volume: ${a.finSalesVolume} units`);
    if (a.finAvgUnitCost) lines.push(`Avg Unit Cost: $${a.finAvgUnitCost}`);
    if (a.finFixedOperatingCosts) lines.push(`Monthly Fixed Costs: $${a.finFixedOperatingCosts}`);
    if (a.finPayrollCost) lines.push(`Monthly Payroll: $${a.finPayrollCost}`);
    if (a.finMarketingSalesSpend) lines.push(`Marketing Spend: $${a.finMarketingSalesSpend}/month`);
    if (a.finTargetProfitMarginPct) lines.push(`Target Margin: ${a.finTargetProfitMarginPct}%`);
    if (a.finSalesGrowthPct) lines.push(`Expected Sales Growth: ${a.finSalesGrowthPct}%`);
    if (a.finAdditionalFundingAmount) lines.push(`Additional Funding Expected: $${a.finAdditionalFundingAmount}`);
    if (a.finIsNonprofit) lines.push(`Organization Type: Non-profit`);
    return lines.length ? `\n\nUser-provided answers:\n- ${lines.join('\n- ')}` : '';
  } catch (_) {
    return '';
  }
}

// Build a richer, user-aware context for Core Strategic Project suggestions
// Includes: Onboarding profile, fallback to User.companyName, key onboarding answers,
// existing core projects, departments summary, and active team members (limited).
async function buildCoreProjectContextForUser(userId, workspaceId = null) {
  try {
    const wsFilter = { user: userId };
    if (workspaceId) wsFilter.workspace = workspaceId;
    const [ob, user, departments, teamMembers] = await Promise.all([
      userId ? Onboarding.findOne(wsFilter) : null,
      userId ? User.findById(userId) : null,
      userId ? Department.find(wsFilter).select('name status owner dueDate').limit(50).lean().exec() : [],
      userId ? TeamMember.find({ ...wsFilter, status: 'Active' }).select('name role department email status').limit(200).lean().exec() : [],
    ]);

    // Profile section (with fallback business name)
    const bp = (ob && ob.businessProfile) || {};
    const up = (ob && ob.userProfile) || {};
    const businessName = String(bp.businessName || user?.companyName || '').trim();

    // Determine user role (use roleOther if role is "Other")
    const userRole = up.role === 'Other' && up.roleOther ? up.roleOther : up.role;

    // Determine industry (use industryOther if industry is "Other")
    const industry = bp.industry === 'Other' && bp.industryOther ? bp.industryOther : bp.industry;

    // Build profile lines with all onboarding data
    const profileLines = [
      businessName && `Business Name: ${businessName}`,
      industry && `Industry: ${industry}`,
      bp.city && bp.country && `Location: ${bp.city}, ${bp.country}`,
      bp.ventureType && `Venture Type: ${bp.ventureType}`,
      bp.teamSize && `Team Size: ${bp.teamSize}`,
      bp.businessStage && `Stage: ${bp.businessStage}`,
      bp.description && `Business Description: ${bp.description}`,
      bp.funding && `Has Funding: Yes`,
      // User profile fields from initial onboarding
      userRole && `User Role: ${userRole}`,
      up.planningFor && `Planning For: ${up.planningFor}`,
      up.planningGoal && `Planning Goal: ${up.planningGoal === 'other' && up.planningGoalOther ? up.planningGoalOther : up.planningGoal}`,
      up.builtPlanBefore && `Has Built Plan Before: ${up.builtPlanBefore}`,
      up.includePersonalPlanning && `Include Personal Planning: Yes`,
      // Tools information
      Array.isArray(bp.tools) && bp.tools.length && `Tools Used: ${bp.tools.join(', ')}`,
    ].filter(Boolean);
    const profileText = profileLines.length ? `Context about the business:\n- ${profileLines.join('\n- ')}` : '';

    // Vision & Values snapshot
    const answers = (ob && ob.answers) || {};
    const vvParts = [];
    if (answers.ubp) vvParts.push(`UBP: ${String(answers.ubp).trim()}`);
    if (answers.purpose) vvParts.push(`Purpose: ${String(answers.purpose).trim()}`);
    if (answers.visionBhag) vvParts.push(`BHAG: ${String(answers.visionBhag).trim()}`);
    if (answers.vision1y) vvParts.push(`1-Year Goals: ${String(answers.vision1y).trim().split('\n').filter(Boolean).join('; ')}`);
    if (answers.vision3y) vvParts.push(`3-Year Goals: ${String(answers.vision3y).trim().split('\n').filter(Boolean).join('; ')}`);
    if (answers.valuesCore) vvParts.push(`Core Values: ${String(answers.valuesCore).trim()}`);
    if (answers.cultureFeeling) vvParts.push(`Culture & Behaviors: ${String(answers.cultureFeeling).trim()}`);
    const vvText = vvParts.length ? `\n\nVision & Values:\n- ${vvParts.join('\n- ')}` : '';

    // SWOT Analysis
    const swotLines = [];
    if (answers.swotStrengths) swotLines.push(`Strengths: ${String(answers.swotStrengths).trim()}`);
    if (answers.swotWeaknesses) swotLines.push(`Weaknesses: ${String(answers.swotWeaknesses).trim()}`);
    if (answers.swotOpportunities) swotLines.push(`Opportunities: ${String(answers.swotOpportunities).trim()}`);
    if (answers.swotThreats) swotLines.push(`Threats: ${String(answers.swotThreats).trim()}`);
    const swotText = swotLines.length ? `\n\nSWOT Analysis:\n- ${swotLines.join('\n- ')}` : '';

    // Market & Competition
    const marketLines = [];
    if (answers.marketCustomer) marketLines.push(`Target Customer: ${String(answers.marketCustomer).trim()}`);
    if (answers.custType) marketLines.push(`Customer Type: ${String(answers.custType).trim()}`);
    if (answers.partnersDesc) marketLines.push(`Partners: ${String(answers.partnersDesc).trim()}`);
    if (answers.compNotes) marketLines.push(`Competitors Notes: ${String(answers.compNotes).trim()}`);
    if (Array.isArray(answers.competitorNames) && answers.competitorNames.length) {
      const names = answers.competitorNames.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8).join(', ');
      if (names) marketLines.push(`Competitor Names: ${names}`);
    }
    if (Array.isArray(answers.competitorAdvantages) && answers.competitorAdvantages.length) {
      const advantages = answers.competitorAdvantages.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8).join(', ');
      if (advantages) marketLines.push(`Competitive Advantages: ${advantages}`);
    }
    const marketText = marketLines.length ? `\n\nMarket & Competition:\n- ${marketLines.join('\n- ')}` : '';

    // Products & Services
    let productsText = '';
    try {
      if (Array.isArray(answers.products) && answers.products.length) {
        const productLines = answers.products.slice(0, 10).map((p) => {
          const parts = [
            p?.product && `Name: ${String(p.product).trim()}`,
            p?.description && `Desc: ${String(p.description).trim()}`,
            p?.price && `Price: $${p.price}`,
            p?.unitCost && `Cost: $${p.unitCost}`,
            p?.monthlyVolume && `Monthly Volume: ${p.monthlyVolume}`,
          ].filter(Boolean);
          return parts.length ? '- ' + parts.join(' | ') : '';
        }).filter(Boolean);
        if (productLines.length) productsText = `\n\nProducts & Services:\n${productLines.join('\n')}`;
      }
    } catch {}

    // Financial Overview
    const finLines = [];
    if (answers.finStartingCash) finLines.push(`Starting Cash: $${answers.finStartingCash}`);
    if (answers.finSalesVolume) finLines.push(`Monthly Sales Volume: ${answers.finSalesVolume} units`);
    if (answers.finAvgUnitCost) finLines.push(`Avg Unit Cost: $${answers.finAvgUnitCost}`);
    if (answers.finFixedOperatingCosts) finLines.push(`Fixed Operating Costs: $${answers.finFixedOperatingCosts}/month`);
    if (answers.finPayrollCost) finLines.push(`Payroll Cost: $${answers.finPayrollCost}/month`);
    if (answers.finMarketingSalesSpend) finLines.push(`Marketing Spend: $${answers.finMarketingSalesSpend}/month`);
    if (answers.finTargetProfitMarginPct) finLines.push(`Target Profit Margin: ${answers.finTargetProfitMarginPct}%`);
    if (answers.finSalesGrowthPct) finLines.push(`Expected Sales Growth: ${answers.finSalesGrowthPct}%`);
    if (answers.finAdditionalFundingAmount) finLines.push(`Additional Funding Expected: $${answers.finAdditionalFundingAmount}`);
    if (answers.finIsNonprofit) finLines.push(`Organization Type: Non-profit`);
    const finText = finLines.length ? `\n\nFinancial Overview:\n- ${finLines.join('\n- ')}` : '';

    // Existing Core Strategic Projects (to avoid duplicates and leverage context)
    let coreProjectsText = '';
    try {
      if (Array.isArray(answers.coreProjectDetails) && answers.coreProjectDetails.length) {
        const lines = answers.coreProjectDetails.slice(0, 5).map((p) => {
          const head = [String(p?.title || '').trim(), p?.ownerName && `Owner: ${String(p.ownerName).trim()}`].filter(Boolean).join(' — ');
          const dlines = (Array.isArray(p?.deliverables) ? p.deliverables : []).slice(0, 3).map((d) => {
            const txt = String(d?.text || '').trim();
            const kpi = String(d?.kpi || '').trim();
            const due = String(d?.dueWhen || '').trim();
            const bits = [txt && `• ${txt}`, kpi && `KPI: ${kpi}`, due && `Due: ${due}`].filter(Boolean);
            return bits.length ? '  - ' + bits.join(' | ') : '';
          }).filter(Boolean);
          return ['- ' + head, ...dlines].filter(Boolean).join('\n');
        }).filter(Boolean);
        if (lines.length) coreProjectsText = `\n\nExisting Core Strategic Projects:\n${lines.join('\n')}`;
      } else if (Array.isArray(answers.coreProjects) && answers.coreProjects.length) {
        coreProjectsText = `\n\nExisting Core Strategic Projects:\n- ${answers.coreProjects.map((s)=>String(s||'').trim()).filter(Boolean).slice(0, 8).join('\n- ')}`;
      }
    } catch {}

    // Departments summary
    let departmentsText = '';
    try {
      const lines = (departments || []).slice(0, 8).map((d) => {
        const nm = String(d?.name || '').trim();
        const st = String(d?.status || '').trim();
        const due = String(d?.dueDate || '').trim();
        const bits = [nm && `Dept: ${nm}`, st && `Status: ${st}`, due && `Due: ${due}`].filter(Boolean);
        return bits.length ? '- ' + bits.join(' | ') : '';
      }).filter(Boolean);
      if (lines.length) departmentsText = `\n\nDepartments:\n${lines.join('\n')}`;
    } catch {}

    // Team members (active)
    let teamText = '';
    try {
      const lines = (teamMembers || []).slice(0, 12).map((t) => {
        const name = String(t?.name || '').trim();
        const role = String(t?.role || '').trim();
        const dept = String(t?.department || '').trim();
        const bits = [name && `Name: ${name}`, role && `Role: ${role}`, dept && `Dept: ${dept}`].filter(Boolean);
        return bits.length ? '- ' + bits.join(' | ') : '';
      }).filter(Boolean);
      if (lines.length) teamText = `\n\nTeam Members (Active):\n${lines.join('\n')}`;
    } catch {}

    return [profileText, vvText, swotText, marketText, productsText, finText, coreProjectsText, departmentsText, teamText].filter(Boolean).join('\n\n');
  } catch (_) {
    return '';
  }
}

// Simple web search helper (SERPAPI or Bing). Returns [{ title, url }]
async function webSearch(query, num = 5) {
  const out = [];
  try {
    if (process.env.SERPAPI_API_KEY) {
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('engine', 'google');
      url.searchParams.set('q', query);
      url.searchParams.set('num', String(num));
      url.searchParams.set('api_key', process.env.SERPAPI_API_KEY);
      const r = await fetch(url, { method: 'GET' });
      const j = await r.json();
      const org = j.organic_results || [];
      for (const it of org) {
        const title = (it.title || '').trim();
        const link = (it.link || '').trim();
        if (!title || !link) continue;
        if (/top|best|vs|compare|review|blog|news|wikipedia/i.test(title)) continue;
        out.push({ title: title.replace(/\s*[|\-].*$/, '').trim(), url: link });
      }
    } else if (process.env.BING_SUBSCRIPTION_KEY) {
      const r = await fetch('https://api.bing.microsoft.com/v7.0/search?q=' + encodeURIComponent(query), {
        headers: { 'Ocp-Apim-Subscription-Key': process.env.BING_SUBSCRIPTION_KEY },
      });
      const j = await r.json();
      const web = j.webPages?.value || [];
      for (const it of web) {
        const title = (it.name || '').trim();
        const link = (it.url || '').trim();
        if (!title || !link) continue;
        if (/top|best|vs|compare|review|blog|news|wikipedia/i.test(title)) continue;
        out.push({ title: title.replace(/\s*[|\-].*$/, '').trim(), url: link });
      }
    }
  } catch (_) {}
  // unique by url
  const seen = new Set();
  const uniq = [];
  for (const it of out) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    uniq.push(it);
    if (uniq.length >= num) break;
  }
  return uniq;
}
async function callOpenAI({ type, input, contextText }) {
  const client = getOpenAI();
  const system =
    'You are a helpful business planning assistant. ' +
    'Write crisp, human-sounding suggestions in plain language. ' +
    'Avoid marketing buzzwords. Be specific and concrete. ' +
    'Always keep suggestions consistent with any provided context and user input — do not contradict earlier answers.';

  let ragText = '';
  try {
    if (process.env.RAG_ENABLE !== 'false') {
      const results = await rag.retrieve([type, input].filter(Boolean).join(' \n ').slice(0, 500));
      if (results && results.length) {
        const clip = results.map((r) => r.text).join('\n\n---\n\n');
        ragText = `Additional guidance from Business Trainer (internal knowledge):\n${clip}`;
      }
    }
  } catch (_) {}

  const userPrompt = [
    contextText || '',
    ragText || '',
    `Task: Generate exactly 1 option for the ${type}.`,
    'Constraints:',
    '- Keep it to 1-2 sentences.',
    '- Be specific and user-centered.',
    '- Output ONLY the final suggestion as plain text.',
    '- Do NOT prefix with labels like "Goal:", "KPI:", "Deliverable:", "Milestone:", etc. Just provide the content directly.',
    '- Do NOT include code fences, JSON, lists, bullets, quotes, or explanations.',
    '',
    input ? `User input: ${input}` : 'User input: (none provided)',
  ]
    .filter(Boolean)
    .join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 400,
  });

  let text = resp.choices?.[0]?.message?.content || '';
  text = String(text).trim();

  // If wrapped in triple backticks, extract inner content
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Try to parse JSON array or string if present
  try {
    if (text.startsWith('[')) {
      const arr = JSON.parse(text);
      if (Array.isArray(arr) && arr.length) return String(arr[0]);
    } else if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('"') && text.endsWith('"'))) {
      const maybe = JSON.parse(text);
      if (typeof maybe === 'string') return maybe;
    }
  } catch (_) {
    // ignore JSON parse errors
  }

  // If we still have bracketed JSON somewhere, try to slice first bracketed block
  const lb = text.indexOf('[');
  const rb = text.lastIndexOf(']');
  if (lb !== -1 && rb !== -1 && rb > lb) {
    try {
      const arr = JSON.parse(text.slice(lb, rb + 1));
      if (Array.isArray(arr) && arr.length) return String(arr[0]);
    } catch (_) {}
  }

  // Fallback: pick first non-empty line that's not a fence
  const first = text
    .split('\n')
    .map((l) => l.replace(/^[-*\d\.\)\s]+/, '').trim())
    .filter((l) => l && !l.startsWith('```'))[0];
  // Strip surrounding quotes if present
  const unquoted = first && ((first.startsWith('"') && first.endsWith('"')) || (first.startsWith("'") && first.endsWith("'")))
    ? first.slice(1, -1).trim()
    : first;
  return unquoted || '';
}

// New: return an array of n suggestions (default 3)
async function callOpenAIList({ type, input, contextText, n = 3, nonce, avoid = [] }) {
  const client = getOpenAI();
  const system =
    'You are a helpful business planning assistant. ' +
    'Write crisp, human-sounding suggestions in plain language. ' +
    'Avoid marketing buzzwords. Be specific and concrete. ' +
    'Always keep suggestions consistent with any provided context and user input — do not contradict earlier answers.';

  let ragText2 = '';
  try {
    if (process.env.RAG_ENABLE !== 'false') {
      const results = await rag.retrieve([type, input].filter(Boolean).join(' \n ').slice(0, 500));
      if (results && results.length) {
        const clip = results.map((r) => r.text).join('\n\n---\n\n');
        ragText2 = `Additional guidance from Business Trainer (internal knowledge):\n${clip}`;
      }
    }
  } catch (_) {}

  // Build avoidance text from previous suggestions
  let avoidText = '';
  if (Array.isArray(avoid) && avoid.length > 0) {
    avoidText = `IMPORTANT: Do NOT repeat or rephrase these previous suggestions. Generate completely different ideas:\nPrevious suggestions to avoid: ${avoid.map((s, i) => `"${s}"`).join(', ')}`;
  }

  const userPrompt = [
    contextText || '',
    ragText2 || '',
    `Task: Generate exactly ${n} distinct, high-quality options for the ${type}.`,
    'Constraints:',
    '- Each option should be 1-2 sentences.',
    '- Be specific and user-centered.',
    '- Do NOT prefix items with labels like "Goal:", "KPI:", "Deliverable:", "Milestone:", etc. Just provide the content directly.',
    avoidText,
    '- Generate fresh, unique suggestions with different angles and perspectives.',
    '- Return ONLY a valid JSON array of strings (length exactly ${n}).',
    '- Do NOT include any extra text before or after the JSON.',
    '',
    input ? `User input: ${input}` : 'User input: (none provided)',
  ]
    .filter(Boolean)
    .join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: avoid.length > 0 ? 1.0 : 0.8,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 600,
  });

  let text = resp.choices?.[0]?.message?.content || '';
  text = String(text).trim();

  // Extract JSON array from fences or raw
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  let arr = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) arr = parsed;
  } catch (_) {}

  if (!Array.isArray(arr) || arr.length === 0) {
    // fallback: split by lines and filter
    arr = text
      .split('\n')
      .map((l) => l.replace(/^[-*\d\.\)\s]+/, '').trim())
      .filter(Boolean);
  }

  const unique = Array.from(new Set(arr.map((s) => String(s)))).filter((s) => s && s !== '[object Object]');
  return unique.slice(0, n);
}

// Write multi-paragraph professional prose for business plan sections
async function callOpenAIProse({ type, input, contextText, maxTokens = 800 }) {
  const client = getOpenAI();
  const system =
    'You are a helpful business planning assistant. ' +
    'Write polished, professional narrative sections for business plans. ' +
    'Use clear, concise language and avoid fluff. ' +
    'Stay faithful to the provided context — do not fabricate specific numbers that were not supplied.';

  let ragText = '';
  try {
    if (process.env.RAG_ENABLE !== 'false') {
      const results = await rag.retrieve([type, input].filter(Boolean).join(' \n ').slice(0, 500));
      if (results && results.length) {
        const clip = results.map((r) => r.text).join('\n\n---\n\n');
        ragText = `Additional guidance from Business Trainer (internal knowledge):\n${clip}`;
      }
    }
  } catch (_) {}

  const userPrompt = [
    contextText || '',
    ragText || '',
    `Task: Write a cohesive, professional narrative for the ${type}.`,
    'Guidelines:',
    '- 2–4 short paragraphs (roughly 150–300 words).',
    '- Be specific and practical; avoid buzzwords.',
    '- If numeric context is provided (e.g., revenue, costs), reference it qualitatively; do not invent data.',
    '- Output ONLY the final prose as plain text. No bullets, no JSON, no code fences.',
    '',
    input ? `User input: ${input}` : 'User input: (none provided)',
  ]
    .filter(Boolean)
    .join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: maxTokens,
  });

  let text = resp.choices?.[0]?.message?.content || '';
  text = String(text).trim();

  // Strip code fences if present
  const fenceMatch = text.match(/```(?:[a-z]+)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  return text;
}

exports.callOpenAIProse = callOpenAIProse;

// Generate actionable next steps from a set of action plan assignments
// assignments: { [dept: string]: Array<{ goal, milestone, resources, cost, kpi, dueWhen, firstName, lastName }> }
// Returns up to n concise suggestions
exports.generateActionInsightsForUser = async function generateActionInsightsForUser(userId, assignments = {}, n = 6) {
  const wsFilter = getWorkspaceFilter(req);
  const ob = userId ? await Onboarding.findOne(wsFilter) : null;
  const baseCtx = buildContextText(ob);
  const answersCtx = buildAnswersContext(ob);
  const lines = [];
  try {
    Object.entries(assignments || {}).forEach(([dept, arr]) => {
      (arr || []).forEach((u) => {
        const goal = String(u?.goal || '').trim();
        if (!goal) return;
        const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
        const m = String(u?.milestone || '').trim();
        const k = String(u?.kpi || '').trim();
        const r = String(u?.resources || '').trim();
        const d = String(u?.dueWhen || '').trim();
        const parts = [
          `Goal: ${goal}`,
          owner && `Owner: ${owner}`,
          dept && `Department: ${dept}`,
          m && `Milestone: ${m}`,
          k && `KPI: ${k}`,
          r && `Resources: ${r}`,
          d && `Due: ${d}`,
        ].filter(Boolean);
        if (parts.length) lines.push('- ' + parts.join(' | '));
      });
    });
  } catch (_) {}

  // Optional: enrich with internal RAG and quick web research
  let ragText = '';
  try {
    if (process.env.RAG_ENABLE !== 'false') {
      const clip = await rag.retrieve([baseCtx, answersCtx, lines.join('\n')].filter(Boolean).join(' \n ').slice(0, 500));
      if (clip && clip.length) ragText = `Additional guidance from Business Trainer (internal knowledge):\n${clip.map((r)=>r.text).join('\n\n---\n\n')}`;
    }
  } catch (_) {}
  let webLinksText = '';
  try {
    const bp = (ob && ob.businessProfile) || {};
    const industry = String(bp.industry || '').trim();
    const ventureType = String(bp.ventureType || '').trim();
    const queries = [
      [industry, ventureType, 'market trends'].filter(Boolean).join(' ').trim(),
      [industry, 'operational best practices'].filter(Boolean).join(' ').trim(),
    ].filter((q) => q && q.length >= 3);
    const seen = new Set();
    const linkLines = [];
    for (const q of queries) {
      const links = await webSearch(q, 3);
      for (const l of links) {
        if (!l || !l.url || seen.has(l.url)) continue;
        seen.add(l.url);
        linkLines.push(`- ${l.title} (${l.url})`);
      }
    }
    if (linkLines.length) webLinksText = `External research (recent web results):\n${linkLines.join('\n')}`;
  } catch (_) {}

  const contextText = [
    baseCtx,
    answersCtx,
    lines.length ? `Current action plans:\n${lines.join('\n')}` : 'No detailed fields provided for action plans.',
    ragText,
    webLinksText,
  ]
    .filter(Boolean)
    .join('\n\n');

  const input = [
    'Generate concise, actionable next steps the user can take THIS WEEK to make progress on the above action plans.',
    'Guidelines:',
    '- Keep each step 1–2 sentences, concrete, and non-generic.',
    '- Favor alignment, milestone breakdowns, KPI cadence, resourcing, sequencing, and risk mitigation.',
    '- Do not invent new goals; tie steps back to what is listed.',
  ].join('\n');

  const suggestions = await callOpenAIList({ type: 'actionable next steps for current action plans', input, contextText, n });
  return suggestions.filter((s) => typeof s === 'string' && s.trim()).map((s) => String(s).trim());
};

// Structured sections generator: returns [{ title, items: string[] }]
exports.generateActionInsightSectionsForUser = async function generateActionInsightSectionsForUser(userId, assignments = {}, maxSections = 2) {
  const wsFilter = getWorkspaceFilter(req);
  const ob = userId ? await Onboarding.findOne(wsFilter) : null;
  const baseCtx = buildContextText(ob);
  const answersCtx = buildAnswersContext(ob);
  const lines = [];
  try {
    Object.entries(assignments || {}).forEach(([dept, arr]) => {
      (arr || []).forEach((u) => {
        const goal = String(u?.goal || '').trim();
        if (!goal) return;
        const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
        const m = String(u?.milestone || '').trim();
        const k = String(u?.kpi || '').trim();
        const r = String(u?.resources || '').trim();
        const d = String(u?.dueWhen || '').trim();
        const parts = [
          `Goal: ${goal}`,
          owner && `Owner: ${owner}`,
          dept && `Department: ${dept}`,
          m && `Milestone: ${m}`,
          k && `KPI: ${k}`,
          r && `Resources: ${r}`,
          d && `Due: ${d}`,
        ].filter(Boolean);
        if (parts.length) lines.push('- ' + parts.join(' | '));
      });
    });
  } catch (_) {}

  // Optional: enrich with internal RAG and quick web research
  let ragText = '';
  try {
    if (process.env.RAG_ENABLE !== 'false') {
      const clip = await rag.retrieve([baseCtx, answersCtx, lines.join('\n')].filter(Boolean).join(' \n ').slice(0, 500));
      if (clip && clip.length) ragText = `Additional guidance from Business Trainer (internal knowledge):\n${clip.map((r)=>r.text).join('\n\n---\n\n')}`;
    }
  } catch (_) {}
  let webLinksText = '';
  try {
    const bp = (ob && ob.businessProfile) || {};
    const industry = String(bp.industry || '').trim();
    const ventureType = String(bp.ventureType || '').trim();
    const queries = [
      [industry, ventureType, 'market trends'].filter(Boolean).join(' ').trim(),
      [industry, 'operational best practices'].filter(Boolean).join(' ').trim(),
    ].filter((q) => q && q.length >= 3);
    const seen = new Set();
    const linkLines = [];
    for (const q of queries) {
      const links = await webSearch(q, 3);
      for (const l of links) {
        if (!l || !l.url || seen.has(l.url)) continue;
        seen.add(l.url);
        linkLines.push(`- ${l.title} (${l.url})`);
      }
    }
    if (linkLines.length) webLinksText = `External research (recent web results):\n${linkLines.join('\n')}`;
  } catch (_) {}

  const contextText = [
    baseCtx,
    answersCtx,
    lines.length ? `Current action plans:\n${lines.join('\n')}` : 'No detailed fields provided for action plans.',
    ragText,
    webLinksText,
  ]
    .filter(Boolean)
    .join('\n\n');

  const client = getOpenAI();
  const system =
    'You are a helpful business planning assistant. ' +
    'Group actionable next steps into short, meaningful sections. ' +
    'Each section should be focused (e.g., "Pre-launch", "Execution", "KPI & Review"). ' +
    'Each item is 1–2 sentences, concrete, and ties back to the provided plans. ' +
    'Each item MUST begin with the relevant Department name followed by a colon and a space (e.g., "Finance: …"). ' +
    'Do NOT include the section title or any phase name at the start of items.';

  const deptNames = Object.keys(assignments || {});
  const userPrompt = [
    contextText,
    'Task: Create exactly 2 sections of insights summarizing immediate next steps for the action plans.',
    'Guidance:',
    '- The first section title must reflect the CURRENT operational phase based on the plans (e.g., "Pre-launch" if planning scaffolding dominates; "Execution" if tasks are underway; "KPI & Review" if focus is on measurement).',
    '- The second section title should reflect the NEXT logical phase.',
    ...(deptNames && deptNames.length ? [
      `Valid departments: ${deptNames.join(', ')}`,
    ] : []),
    'Output format (strict JSON): { "sections": [ { "title": string, "items": string[] }, { "title": string, "items": string[] } ] }',
    'Rules:',
    '- Each section must have 2 or 3 items.',
    '- Titles must be short (1–3 words), examples: "Pre-launch", "Execution", "KPI & Review", "Scale-Up".',
    '- Items must be specific and not generic. Tie to goals, milestones, KPIs, and due dates.',
    '- Each item MUST begin with the Department name followed by a colon and a space (e.g., "Sales: …").',
    '- Do NOT prefix items with section titles such as "Pre-launch:"; only use the Department name prefix.',
    '- Do NOT include any text before or after the JSON.',
  ].join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 800,
  });
  let text = (resp.choices?.[0]?.message?.content || '').trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  let sections = Array.isArray(data?.sections) ? data.sections : [];
  // Normalize
  sections = sections
    .map((s) => ({ title: String(s?.title || '').trim() || 'Recommendations', items: (Array.isArray(s?.items) ? s.items : []).map((x) => String(x).trim()).filter(Boolean).slice(0, 3) }))
    .filter((s) => s.items.length > 0)
    .slice(0, Math.max(2, maxSections));

  if (sections.length < 2) {
    // Fallback: ensure we have 2 sections using simple phase heuristics
    const fallback = await exports.generateActionInsightsForUser(userId, assignments, 6);
    const now = new Date();
    let hasDuePast = false, hasDueSoon = false, filled = 0, total = 0;
    try {
      Object.values(assignments || {}).forEach((arr) => {
        (arr || []).forEach((u) => {
          const goal = String(u?.goal || '').trim();
          const due = String(u?.dueWhen || '').trim();
          const milestone = String(u?.milestone || '').trim();
          if (goal) filled++;
          total++;
          if (due) {
            const d = new Date(due);
            if (!isNaN(d.getTime())) {
              const diff = Math.round((d.getTime() - now.getTime()) / (24*60*60*1000));
              if (diff < 0) hasDuePast = true; else if (diff <= 7) hasDueSoon = true;
            }
          }
        });
      });
    } catch {}
    const progress = total ? (filled / total) : 0;
    const current = (hasDuePast || hasDueSoon || progress >= 0.5) ? 'Execution' : 'Pre-launch';
    const next = current === 'Pre-launch' ? 'Execution' : 'KPI & Review';
    const firstItems = fallback.slice(0, 3);
    const secondItems = fallback.slice(3, 6);
    const ensureTwo = [];
    if (firstItems.length) ensureTwo.push({ title: current, items: firstItems });
    if (secondItems.length) ensureTwo.push({ title: next, items: secondItems });
    while (ensureTwo.length < 2) ensureTwo.push({ title: next, items: firstItems.slice(0, 2) });
    sections = ensureTwo;
  }

  return sections;
};

// Generate or regenerate a single section by title
exports.generateSingleInsightSectionForUser = async function generateSingleInsightSectionForUser(userId, assignments = {}, title = 'Recommendations') {
  const wsFilter = getWorkspaceFilter(req);
  const ob = userId ? await Onboarding.findOne(wsFilter) : null;
  const baseCtx = buildContextText(ob);
  const answersCtx = buildAnswersContext(ob);
  const lines = [];
  try {
    Object.entries(assignments || {}).forEach(([dept, arr]) => {
      (arr || []).forEach((u) => {
        const goal = String(u?.goal || '').trim();
        if (!goal) return;
        const owner = `${String(u?.firstName||'').trim()} ${String(u?.lastName||'').trim()}`.trim();
        const m = String(u?.milestone || '').trim();
        const k = String(u?.kpi || '').trim();
        const r = String(u?.resources || '').trim();
        const d = String(u?.dueWhen || '').trim();
        const parts = [
          `Goal: ${goal}`,
          owner && `Owner: ${owner}`,
          dept && `Department: ${dept}`,
          m && `Milestone: ${m}`,
          k && `KPI: ${k}`,
          r && `Resources: ${r}`,
          d && `Due: ${d}`,
        ].filter(Boolean);
        if (parts.length) lines.push('- ' + parts.join(' | '));
      });
    });
  } catch (_) {}
  // Optional: enrich with internal RAG and quick web research
  let ragText = '';
  try {
    if (process.env.RAG_ENABLE !== 'false') {
      const clip = await rag.retrieve([baseCtx, answersCtx, lines.join('\n')].filter(Boolean).join(' \n ').slice(0, 500));
      if (clip && clip.length) ragText = `Additional guidance from Business Trainer (internal knowledge):\n${clip.map((r)=>r.text).join('\n\n---\n\n')}`;
    }
  } catch (_) {}
  let webLinksText = '';
  try {
    const bp = (ob && ob.businessProfile) || {};
    const industry = String(bp.industry || '').trim();
    const ventureType = String(bp.ventureType || '').trim();
    const queries = [
      [industry, ventureType, 'market trends'].filter(Boolean).join(' ').trim(),
      [industry, 'operational best practices'].filter(Boolean).join(' ').trim(),
    ].filter((q) => q && q.length >= 3);
    const seen = new Set();
    const linkLines = [];
    for (const q of queries) {
      const links = await webSearch(q, 3);
      for (const l of links) {
        if (!l || !l.url || seen.has(l.url)) continue;
        seen.add(l.url);
        linkLines.push(`- ${l.title} (${l.url})`);
      }
    }
    if (linkLines.length) webLinksText = `External research (recent web results):\n${linkLines.join('\n')}`;
  } catch (_) {}

  const contextText = [baseCtx, answersCtx, lines.length ? `Current action plans:\n${lines.join('\n')}` : '', ragText, webLinksText].filter(Boolean).join('\n\n');

  const client = getOpenAI();
  const system = 'You are a helpful business planning assistant. Write crisp, concrete steps under a single section. Each item MUST begin with the relevant Department name followed by a colon and a space (e.g., "Finance: …"). Do NOT include the section title at the start of items.';
  const deptNames = Object.keys(assignments || {});
  const userPrompt = [
    contextText,
    `Task: Regenerate a single section titled "${title}" with 2–3 highly specific items (1–2 sentences each).`,
    'Output format (strict JSON): { "title": string, "items": string[] }',
    'Rules:',
    '- Items must tie back to the provided plans and due dates/KPIs where possible.',
    ...(deptNames && deptNames.length ? [
      `Valid departments: ${deptNames.join(', ')}`,
    ] : []),
    '- Each item MUST begin with the Department name followed by a colon and a space (e.g., "Operations: …").',
    '- Do NOT prefix items with section titles such as "Pre-launch:"; only use the Department name prefix.',
    '- Do NOT include any text before or after the JSON.',
  ].join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    messages: [ { role: 'system', content: system }, { role: 'user', content: userPrompt } ],
    max_tokens: 500,
  });
  let text = (resp.choices?.[0]?.message?.content || '').trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  const normalized = {
    title: String(data?.title || title || 'Recommendations').trim(),
    items: Array.isArray(data?.items) ? data.items.map((x) => String(x).trim()).filter(Boolean).slice(0, 3) : [],
  };
  if (!normalized.items.length) {
    // Fallback: call flat generator and slice
    const fallback = await exports.generateActionInsightsForUser(userId, assignments, 3);
    normalized.items = fallback.slice(0, 3);
  }
  return normalized;
};

// Rewrite a given text preserving meaning, improving clarity and concision
async function callOpenAIRewrite({ type, text, contextText }) {
  const client = getOpenAI();
  const system =
    'You are a helpful business planning assistant. ' +
    'Rewrite the provided draft to be clearer and more concise while preserving meaning. ' +
    'Avoid marketing buzzwords. Be specific and concrete. ' +
    'Always keep suggestions consistent with any provided context and user input — do not contradict earlier answers.';

  let ragText3 = '';
  try {
    if (process.env.RAG_ENABLE !== 'false') {
      const results = await rag.retrieve([type, text].filter(Boolean).join(' \n ').slice(0, 500));
      if (results && results.length) {
        const clip = results.map((r) => r.text).join('\n\n---\n\n');
        ragText3 = `Additional guidance from Business Trainer (internal knowledge):\n${clip}`;
      }
    }
  } catch (_) {}

  const userPrompt = [
    contextText || '',
    ragText3 || '',
    `Task: Rewrite the user's draft for the ${type}.`,
    'Constraints:',
    '- Keep it to 1-2 sentences.',
    '- Preserve the core meaning; improve clarity and tone.',
    '- Do NOT prefix with labels like "Goal:", "KPI:", "Deliverable:", "Milestone:", etc. Just provide the content directly.',
    '- Output ONLY the rewritten text as plain text.',
    '',
    text ? `Draft: ${text}` : 'Draft: (none provided)'
  ]
    .filter(Boolean)
    .join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.5,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 400,
  });

  let out = resp.choices?.[0]?.message?.content || '';
  out = String(out).trim();
  const fenceMatch = out.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) out = fenceMatch[1].trim();

  // Try to strip quotes or JSON structure
  try {
    if ((out.startsWith('{') && out.endsWith('}')) || (out.startsWith('"') && out.endsWith('"'))) {
      const maybe = JSON.parse(out);
      if (typeof maybe === 'string') out = maybe;
    }
  } catch (_) {}

  const first = out
    .split('\n')
    .map((l) => l.replace(/^[-*\d\.\)\s]+/, '').trim())
    .filter((l) => l && !l.startsWith('```'))[0];
  const unquoted = first && ((first.startsWith('"') && first.endsWith('"')) || (first.startsWith("'") && first.endsWith("'")))
    ? first.slice(1, -1).trim()
    : first;
  return unquoted || '';
}

exports.suggestUbp = async (req, res) => {
  try {
    const { input } = req.body || {};
    // If user is authenticated, use onboarding context; otherwise proceed without it
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestions = await callOpenAIList({ type: 'Unique Business Proposition (UBP)', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteUbp = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'Unique Business Proposition (UBP)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestPurpose = async (req, res) => {
  try {
    const { input } = req.body || {};
    // If user is authenticated, use onboarding context; otherwise proceed without it
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestions = await callOpenAIList({ type: 'Purpose statement', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewritePurpose = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'Purpose statement', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestValuesCore = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const items = await callOpenAIListWithKeywords({ type: 'Core values statement', input, contextText, n: 3 });
    const suggestions = items.map((it) => it.text);
    const topKeywords = items[0]?.keywords || [];
    return res.json({ suggestion: suggestions[0] || '', suggestions, items, keywords: topKeywords });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteValuesCore = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'Core values statement', text, contextText });
    let keywords = [];
    try { keywords = await callOpenAIKeywordsForText({ type: 'Core values statement', text: rewrite, contextText: '' }); } catch (_) {}
    return res.json({ rewrite, keywords });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestCultureFeeling = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestions = await callOpenAIList({ type: 'Culture/brand experience feeling statement', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteCultureFeeling = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'Culture/brand experience feeling statement', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// SWOT: strengths, weaknesses, opportunities, threats
exports.suggestSwotStrengths = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestions = await callOpenAIListPhrases({ type: 'SWOT Strengths (short phrases)', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.suggestSwotWeaknesses = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestions = await callOpenAIListPhrases({ type: 'SWOT Weaknesses (short phrases)', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.suggestSwotOpportunities = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestions = await callOpenAIListPhrases({ type: 'SWOT Opportunities (short phrases)', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.suggestSwotThreats = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const contextText = baseCtx;
    const suggestions = await callOpenAIListPhrases({ type: 'SWOT Threats (short phrases)', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.suggestMarketCustomer = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
  const ob = userId ? await Onboarding.findOne(wsFilter) : null;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestions = await callOpenAIList({ type: 'Target market and ideal customer profile summary', input, contextText, n: 3 });
    const bp = ob?.businessProfile || {};
    const q = [bp.industry || '', bp.businessName || '', bp.city || '', bp.country || '', 'ideal customer profile'].filter(Boolean).join(' ');
    const links = await webSearch(q, 3);
    return res.json({ suggestion: suggestions[0] || '', suggestions, links });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteMarketCustomer = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'Target market and ideal customer profile summary', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestMarketPartners = async (req, res) => {
  try {
    const { input, nonce } = req.body || {};
    const userId = req.user?.id;
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const wsFilter = getWorkspaceFilter(req);
  const ob = userId ? await Onboarding.findOne(wsFilter) : null;
    const bp = ob?.businessProfile || {};
    // Web search for potential partner platforms/distributors relevant to the industry/location
    const query = [
      bp.industry || '',
      'partner platforms distributors channel partners',
      [bp.city, bp.country].filter(Boolean).join(', '),
    ]
      .filter(Boolean)
      .join(' ')
      .trim() || 'industry partner platforms';
    const links = await webSearch(query, 6);
    const refs = (links || []).map((l) => `- ${l.title} (${l.url})`).join('\n');

    // Ask AI to propose 2–3 concrete partners with a one-line rationale
    const client = getOpenAI();
    const system = 'You are a helpful go-to-market strategist. Return structured JSON only.';
    const userPrompt = [
      baseCtx || '',
      refs ? ('Recent web results (titles):\n' + refs) : '',
      'Task: Propose 2–3 specific partner platforms or distributors relevant to the business context.',
      'Generate fresh, unique suggestions different from any previous responses.',
      'For EACH, include:',
      '- name: the platform/company name',
      '- url: a plausible official URL if clearly implied by results (optional)',
      '- note: one sentence on how to partner or what they offer',
      'Output format (strict JSON): [{ "name": string, "url"?: string, "note": string }]',
      'No extra text before/after the JSON.',
      nonce ? `(Request ID: ${nonce})` : '',
    ].filter(Boolean).join('\n');
    let partners = [];
    try {
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.95,
        messages: [ { role: 'system', content: system }, { role: 'user', content: userPrompt } ],
        max_tokens: 500,
      });
      let text = (resp.choices?.[0]?.message?.content || '').trim();
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i); if (fence) text = fence[1].trim();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) partners = parsed.map((p) => ({ name: String(p?.name || '').trim(), url: p?.url ? String(p.url) : undefined, note: String(p?.note || '').trim() })).filter((p) => p.name && p.note).slice(0,3);
    } catch (_) {}

    // Also keep simple sentence suggestions for backward-compatibility
    const suggestions = await callOpenAIList({ type: 'Go-to-market partners and channels plan', input, contextText: baseCtx, n: 3, nonce });
    return res.json({ suggestion: suggestions[0] || '', suggestions, links, partners });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteMarketPartners = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'Go-to-market partners and channels plan', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestMarketCompetitors = async (req, res) => {
  try {
    const { input, nonce, previousSuggestions, previousCompetitors } = req.body || {};
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
  const ob = userId ? await Onboarding.findOne(wsFilter) : null;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    // Build competitor names list from stored answers or infer later
    const ans = (ob && ob.answers) || {};
    let compNames = Array.isArray(ans.competitorNames) ? ans.competitorNames.map((s)=>String(s||'').trim()).filter(Boolean).slice(0,3) : [];
    // Try to enrich with URLs
    const linkMap = {};
    try {
      for (const name of compNames) {
        const r = await webSearch(name + ' official site', 1);
        if (r && r[0] && r[0].url) linkMap[name] = r[0].url;
      }
    } catch (_) {}
    const bp = ob?.businessProfile || {};
    const a = (ob && ob.answers) || {};
    const q1 = [bp.businessName || '', 'competitors', bp.industry || '', [bp.city, bp.country].filter(Boolean).join(', ')].filter(Boolean).join(' ');
    const q2 = [bp.industry || '', a.marketCustomer || '', 'market competitors'].filter(Boolean).join(' ');
    const seen = new Map();
    const links = [];
    for (const q of [q1, q2]) {
      if (!q || q.replace(/\s+/g, '').length < 3) continue;
      try {
        const r = await webSearch(q, 3);
        for (const it of r) {
          const key = it.url || it.title;
          if (!key || seen.has(key)) continue;
          seen.set(key, true);
          links.push(it);
          if (links.length >= 5) break;
        }
      } catch (_) {}
      if (links.length >= 5) break;
    }
    // Ask AI to structure per-competitor better/worse statements
    const client = getOpenAI();
    const system = 'You are a helpful competitive analyst. Return structured JSON only.';
    const namesText = compNames.length ? ('Competitors to analyze: ' + compNames.join(', ')) : '';
    // Build avoidance text from previous competitor analysis
    let avoidCompetitorText = '';
    if (Array.isArray(previousCompetitors) && previousCompetitors.length > 0) {
      const prevAnalysis = previousCompetitors.map((c) =>
        `${c.name}: theyDoBetter="${c.theyDoBetter}", weDoBetter="${c.weDoBetter}"`
      ).join('; ');
      avoidCompetitorText = `IMPORTANT: Do NOT repeat these previous insights. Generate completely different analysis:\nPrevious: ${prevAnalysis}`;
    }
    const userPrompt = [
      contextText || '',
      namesText,
      'IMPORTANT: This is a COMPETITOR analysis only. Competitors are businesses that compete with us for the same customers.',
      'CRITICAL: Do NOT include any partners, suppliers, service providers, or collaborators mentioned in the context. Partners are NOT competitors.',
      'Task: For each competitor, provide a one-sentence "they do better" (their competitive advantage over us) and a one-sentence "we do better" (our competitive advantage over them).',
      avoidCompetitorText,
      'Generate fresh, unique insights with different angles and perspectives.',
      'Output format (strict JSON): [ { "name": string, "theyDoBetter": string, "weDoBetter": string } ]',
      'No extra commentary before or after the JSON.'
    ].filter(Boolean).join('\n');
    let competitors = [];
    try {
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 1.0,
        messages: [ { role: 'system', content: system }, { role: 'user', content: userPrompt } ],
        max_tokens: 500,
      });
      let text = (resp.choices?.[0]?.message?.content || '').trim();
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i); if (fence) text = fence[1].trim();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        competitors = parsed.map((it)=>({ name: String(it?.name||'').trim(), theyDoBetter: String(it?.theyDoBetter||'').trim(), weDoBetter: String(it?.weDoBetter||'').trim() }))
          .filter((it)=> it.name && it.theyDoBetter && it.weDoBetter)
          .slice(0,3);
      }
    } catch (_) {}
    // Add any enriched links first
    Object.entries(linkMap).forEach(([name,url])=>{ links.push({ title: name, url }); });
    // Build avoidance text for suggestions
    const avoidSuggestionsArr = Array.isArray(previousSuggestions) ? previousSuggestions.filter(Boolean) : [];
    const suggestions = await callOpenAIList({ type: 'Competitive differentiation notes', input, contextText, n: 3, nonce, avoid: avoidSuggestionsArr });
    return res.json({ suggestion: suggestions[0] || '', suggestions, links, competitors });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteMarketCompetitors = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'Competitive differentiation notes', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// Given up to 3 competitor names, generate what they likely do better than the user's org
exports.suggestCompetitorAdvantages = async (req, res) => {
  try {
    const names = Array.isArray(req.body?.names) ? req.body.names.slice(0, 3) : [];
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const out = [];
    for (const name of names) {
      const input = `Competitor name: ${String(name || '').trim()}`;
      const suggestion = await callOpenAI({ type: 'one-line competitor advantage (what they do better)', input, contextText });
      out.push(suggestion || '');
    }
    return res.json({ advantages: out });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate competitor advantages';
    return res.status(500).json({ message });
  }
};

// New: competitor names (2–3) based on prior inputs
exports.suggestCompetitorNames = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const wsFilter = getWorkspaceFilter(req);
  const ob = userId ? await Onboarding.findOne(wsFilter) : null;
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';

    const bp = ob?.businessProfile || {};
    const q = [
      'competitors',
      bp.industry || '',
      [bp.city, bp.country].filter(Boolean).join(', '),
    ]
      .filter(Boolean)
      .join(' ')
      .trim() || 'top competitors';

    const results = await webSearch(q, 6);
    const titles = (results || []).map((r) => String(r?.title || ''));
    // Try to naively extract likely company names from titles (avoid list/directory pages)
    const isListy = (t) => /\b(list|directory|companies|top|best|guide|nitda|licensed|pdf)\b/i.test(t);
    const cleaned = titles
      .map((t) => t.replace(/\s*[|\-–].*$/, '').trim())
      .filter((t) => t && !isListy(t));
    let suggestions = Array.from(new Set(cleaned)).slice(0, 3);
    let source = 'search';

    // If we don't have 2–3 solid candidates from search titles, use AI to infer names from context + search results
    if (suggestions.length < 2) {
      const contextText = [
        baseCtx,
        (results && results.length)
          ? ('Recent search results (titles):\n' + results.map((r) => `- ${r.title} (${r.url})`).join('\n'))
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      const aiList = await callOpenAIList({
        type: 'top 2–3 competitor company names (no URLs, no descriptors)',
        input,
        contextText,
        n: 3,
      });
      suggestions = (aiList || []).filter(Boolean).slice(0, 3);
      source = (results && results.length) ? 'search+ai' : 'ai';
    }

    const links = (results || []).slice(0, 3);
    return res.json({ suggestion: suggestions[0] || '', suggestions, source, links });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.suggestFinancialForecast = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestions = await callOpenAIList({ type: '12-month financial snapshot (revenue streams and costs) summary', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteFinancialForecast = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: '12-month financial snapshot (revenue streams and costs) summary', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// Suggest a single numeric value for financial inputs
// Returns { value: string } containing only digits and optional decimal point, no symbols/words
exports.suggestFinancialNumber = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';

    // Use a very strict system prompt and small max tokens for numeric-only responses
    const client = getOpenAI();
    const system = 'You are a calculator. Always respond with only a number. No text, no units, no symbols.';
    const userPrompt = [
      contextText || '',
      'Task: Suggest a single numeric estimate for the requested finance input.',
      'Return ONLY a plain number (digits with optional decimal point). No currency symbols, no commas, no percent signs, and no words.',
      input ? `User input/context: ${input}` : 'User input/context: (none)',
    ].filter(Boolean).join('\n');

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 16,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
    });

    let text = resp.choices?.[0]?.message?.content || '';
    text = String(text).trim();
    const m = text.match(/-?\d+(?:\.\d+)?/);
    let value = m ? m[0] : '';

    // Fallback: if empty, try a second pass via generic helper, then regex
    if (!value) {
      const fallback = await callOpenAI({
        type: 'single numeric estimate (plain number only)',
        input: userPrompt,
        contextText: '',
      });
      const mf = String(fallback || '').match(/-?\d+(?:\.\d+)?/);
      value = mf ? mf[0] : '';
    }

    // Final guard: default to 0 if still empty
    if (!value) value = '0';
    return res.json({ value });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate number';
    return res.status(500).json({ message });
  }
};

// Suggest all essential financial inputs in a single response
// Returns numeric fields as plain numbers (stringified) and month as YYYY-MM
exports.suggestFinancialAll = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';

    const client = getOpenAI();

    async function askNumber(prompt) {
      const system = 'You are a calculator. Always respond with only a number. No text, no units, no symbols.';
      const userPrompt = [
        contextText || '',
        'Task: Suggest a single numeric estimate for the requested finance input.',
        'Return ONLY a plain number (digits with optional decimal point). No currency symbols, no commas, no percent signs, and no words.',
        input ? `User input/context: ${input}` : 'User input/context: (none)',
        `Specific request: ${prompt}`,
      ].filter(Boolean).join('\n');
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 16,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      });
      let out = String(resp.choices?.[0]?.message?.content || '').trim();
      const m = out.match(/\d+(?:\.\d+)?/);
      return m ? m[0] : '';
    }

    async function askMonth(prompt) {
      const system = 'Respond with only a month in YYYY-MM format. No extra text.';
      const userPrompt = [
        contextText || '',
        'Task: Provide a realistic expected month for the requested finance event.',
        'Constraints: Return only YYYY-MM. No day, no words.',
        input ? `User input/context: ${input}` : 'User input/context: (none)',
        `Specific request: ${prompt}`,
      ].filter(Boolean).join('\n');
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 8,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      });
      const out = String(resp.choices?.[0]?.message?.content || '').trim();
      const m = out.match(/\d{4}-\d{2}/);
      let val = m ? m[0] : '';
      // Ensure month is in the future relative to current month
      const now = new Date();
      const cy = now.getFullYear();
      const cm = now.getMonth() + 1; // 1-12
      const nextMonth = () => {
        const nm = cm === 12 ? 1 : cm + 1;
        const ny = cm === 12 ? cy + 1 : cy;
        return `${ny}-${String(nm).padStart(2, '0')}`;
      };
      if (!val) return nextMonth();
      const parts = val.split('-');
      const y = parseInt(parts[0] || '0', 10);
      const mm = parseInt(parts[1] || '0', 10);
      if (!y || !mm || mm < 1 || mm > 12) return nextMonth();
      if (y < cy || (y === cy && mm <= cm)) {
        return nextMonth();
      }
      return `${y}-${String(mm).padStart(2, '0')}`;
    }

    // Gather numeric inputs first
    const salesVolume = await askNumber('Projected first-month sales volume (or funding per source if nonprofit).');
    const salesGrowthPct = await askNumber('Monthly sales growth rate percentage (enter just the number).');
    const avgUnitCost = await askNumber('Average direct cost per unit to deliver.');
    const fixedOperatingCosts = await askNumber('Total monthly fixed operating costs.');
    const marketingSalesSpend = await askNumber('Monthly marketing and sales spend.');
    const payrollCost = await askNumber('Total team or payroll cost per month.');
    const startingCash = await askNumber('Starting cash or bank balance.');
    const additionalFundingAmount = await askNumber('Additional funding or grants expected amount.');
    const paymentCollectionDays = await askNumber('Typical payment collection time in days.');
    const targetProfitMarginPct = await askNumber('Desired profit margin percentage (enter just the number).');

    // Compute an informed future month for additional funding/grants
    function toNum(s) { const n = parseFloat(String(s||'').replace(/[^0-9.]/g, '')); return isFinite(n) ? n : 0; }
    const vol = toNum(salesVolume);
    const unitCost = toNum(avgUnitCost);
    const fixed = toNum(fixedOperatingCosts);
    const mkt = toNum(marketingSalesSpend);
    const pay = toNum(payrollCost);
    const cash = toNum(startingCash);
    const marginPct = Math.min(95, Math.max(0, toNum(targetProfitMarginPct)));
    const margin = marginPct/100;
    // Approximate price from margin: price = unitCost/(1-margin), gross profit per unit = price - unitCost
    const grossPerUnit = margin > 0 && margin < 0.95 ? (unitCost * (margin/(1-margin))) : 0;
    const grossMonthly = vol * grossPerUnit;
    const burnMonthly = Math.max(0, fixed + mkt + pay - grossMonthly);
    // Heuristic: plan funding a bit before runway end, default to 3 months ahead if burn unknown
    const monthsAhead = (() => {
      if (burnMonthly <= 0) return 6; // profitable: target ~6 months out
      const runway = cash / Math.max(1, burnMonthly); // months of runway
      // Heuristic schedule: plan funding comfortably before exhaustion
      if (runway <= 1) return 2;          // urgent: within 2 months
      if (runway <= 3) return 2;          // short runway: 2 months
      if (runway <= 6) return Math.ceil(runway - 2); // 1–4 months ahead
      // long runway: halfway to exhaustion capped
      return Math.min(12, Math.max(3, Math.ceil(runway * 0.5)));
    })();
    function addMonths(base, add) {
      const y = base.getFullYear();
      const m = base.getMonth();
      const d = new Date(y, m + add, 1);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth()+1).padStart(2,'0');
      return `${yyyy}-${mm}`;
    }
    const additionalFundingMonth = addMonths(new Date(), Math.max(2, monthsAhead));

    return res.json({
      salesVolume,
      salesGrowthPct,
      avgUnitCost,
      fixedOperatingCosts,
      marketingSalesSpend,
      payrollCost,
      startingCash,
      additionalFundingAmount,
      additionalFundingMonth,
      paymentCollectionDays,
      targetProfitMarginPct,
    });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

// Suggest financial data for a specific stage (revenue, costs, cash)
exports.suggestFinancialStage = async (req, res) => {
  try {
    const { stage } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const client = getOpenAI();

    async function askNumber(prompt) {
      const system = 'You are a calculator. Always respond with only a number. No text, no units, no symbols.';
      const userPrompt = [
        contextText || '',
        'Task: Suggest a realistic numeric estimate for the requested finance input based on the business context.',
        'Return ONLY a plain number (digits with optional decimal point). No currency symbols, no commas, no percent signs, and no words.',
        `Specific request: ${prompt}`,
      ].filter(Boolean).join('\n');
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 16,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      });
      let out = String(resp.choices?.[0]?.message?.content || '').trim();
      const m = out.match(/\d+(?:\.\d+)?/);
      return m ? m[0] : '';
    }

    async function askCategory(prompt, options) {
      const system = `You must respond with exactly one of these options: ${options.join(', ')}. No other text.`;
      const userPrompt = [
        contextText || '',
        'Task: Based on the business context, select the most appropriate option.',
        `Question: ${prompt}`,
        `Options: ${options.join(', ')}`,
      ].filter(Boolean).join('\n');
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 32,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userPrompt },
        ],
      });
      const out = String(resp.choices?.[0]?.message?.content || '').trim();
      // Find best match from options
      const lower = out.toLowerCase();
      for (const opt of options) {
        if (lower.includes(opt.toLowerCase())) return opt;
      }
      return options[0]; // Default to first option
    }

    let result = {};

    if (stage === 'revenue') {
      // Note: monthlyRevenue is not suggested by AI - it comes strictly from Products & Services
      const [revenueGrowthPct, recurringPct] = await Promise.all([
        askNumber('Expected monthly revenue growth rate percentage (just the number, e.g., 5 for 5%).'),
        askNumber('What percentage of revenue is likely recurring (subscriptions, retainers)? Just the number.'),
      ]);
      result = {
        revenueGrowthPct,
        isRecurring: parseInt(recurringPct) > 0,
        recurringPct,
      };
    } else if (stage === 'costs') {
      const categories = ['Payroll & Salaries', 'Rent & Facilities', 'Marketing & Ads', 'Software & Tools', 'Inventory & Materials'];
      const [monthlyCosts, fixedCosts, variableCostsPct, biggestCostCategory] = await Promise.all([
        askNumber('Estimated total monthly costs/expenses for a business of this type.'),
        askNumber('Estimated monthly fixed costs (rent, salaries, subscriptions) for this business.'),
        askNumber('What percentage of costs varies with sales volume? Just the number.'),
        askCategory('What is typically the biggest expense category for this type of business?', categories),
      ]);
      result = {
        monthlyCosts,
        fixedCosts,
        variableCostsPct,
        biggestCostCategory,
      };
    } else if (stage === 'cash') {
      const [currentCash, expectedFunding] = await Promise.all([
        askNumber('Suggested starting cash/bank balance for a business of this type.'),
        askNumber('Typical additional funding amount a business like this might seek.'),
      ]);
      // Suggest funding month 3-6 months from now
      const now = new Date();
      const fundingMonth = Math.floor(Math.random() * 4) + 3; // 3-6 months ahead
      result = {
        currentCash,
        expectedFunding,
        fundingMonth,
      };
    }

    return res.json(result);
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.suggestVision1y = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestions = await callOpenAIList({ type: '1-year success outcome', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteVision1y = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: '1-year success outcome', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestVision3y = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const now = new Date();
    const currentIso = now.toISOString().slice(0, 10);
    const targetYear = now.getUTCFullYear() + 3;
    const anchor = `Current date: ${currentIso}. When referring to "3 years", anchor outcomes to the year ${targetYear} (not earlier years).`;
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const contextText = [baseCtx, anchor].filter(Boolean).join('\n');
    const suggestions = await callOpenAIList({ type: '3-year thriving vision', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

// Action plan field suggestions and rewrites
exports.suggestActionGoal = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestion = await callOpenAI({ type: 'action plan goal (1-2 sentences)', input, contextText });
    return res.json({ suggestion });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionGoal = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'action plan goal (1-2 sentences)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestActionMilestone = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestion = await callOpenAI({ type: 'concise milestone phrase', input, contextText });
    return res.json({ suggestion });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionMilestone = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'concise milestone phrase', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestActionResources = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';

    // Dynamic budget prompt based on project context
    const budgetType = `Estimate a realistic project budget/resources for this specific project.
Consider the project type, department, scope, and business context.
Return ONLY a dollar amount (e.g., "$3,500" or "$12,000").
Be realistic: small tasks $500-$3k, medium projects $3k-$15k, major initiatives $15k-$100k+.`;

    const suggestion = await callOpenAI({ type: budgetType, input, contextText });
    return res.json({ suggestion });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionResources = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'resources/tools/budget summary (short phrase)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.suggestActionKpi = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestion = await callOpenAI({ type: 'KPI metric specification (short phrase)', input, contextText });
    return res.json({ suggestion });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionKpi = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'KPI metric specification (short phrase)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// New: Action cost suggestion + rewrite
exports.suggestActionCost = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestion = await callOpenAI({ type: 'estimated cost/budget (short phrase, e.g., "$2,000 for design and ads")', input, contextText });
    return res.json({ suggestion });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionCost = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'estimated cost/budget (short phrase)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// Suggest a full Core Strategic Project (title, goal, dueWhen, ownerName?, deliverables with kpi+dueWhen)
exports.suggestCoreProject = async (req, res) => {
  try {
    const { input = '', n } = req.body || {};
    const userId = req.user?.id;
    // Build a richer context using current user data (Onboarding + User + Departments + Team Members)
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const client = getOpenAI();

    const wanted = (typeof n === 'number' && n > 0) ? Math.min(8, Math.max(1, n)) : 4;

    // Calculate example dates for the prompt - starting from current week
    const now = new Date();
    const addDays = (d, days) => { const r = new Date(d); r.setDate(r.getDate() + days); return r.toISOString().slice(0, 10); };
    const week1 = addDays(now, 7);
    const week2 = addDays(now, 14);
    const month1 = addDays(now, 30);
    const month2 = addDays(now, 60);
    const month4 = addDays(now, 120);
    const month6 = addDays(now, 180);
    const month9 = addDays(now, 270);
    const month12 = addDays(now, 365);

    // Randomize the timing pattern to vary projects - ensures some deliverables are immediate
    const patterns = [
      `1st: within 1-2 weeks (~${week1}), 2nd: within 1-2 months (~${month1}), 3rd: around 4 months (~${month4}), 4th+: spread between 6-12 months`,
      `1st: within 1 week (~${week1}), 2nd: within 3-4 weeks (~${month1}), 3rd: around 2-3 months (~${month2}), 4th+: around 6-9 months`,
      `1st: within 2 weeks (~${week2}), 2nd: within 5-6 weeks, 3rd: around 3 months, 4th+: around 6-12 months`,
      `1st: within 1 week (~${week1}), 2nd: around 3-4 weeks, 3rd: around 2 months (~${month2}), 4th+: around 4-6 months (~${month6})`,
    ];
    const selectedPattern = patterns[Math.floor(Math.random() * patterns.length)];

    const system = [
      'You are a helpful business planning assistant.',
      'Propose a core strategic project based ONLY on the provided business context and input. Do not fabricate external statistics.',
      'Return a single JSON object with the following shape:',
      '{ "title": string, "goal": string, "dueWhen": string(YYYY-MM-DD), "ownerName"?: string, "deliverables": [{ "text": string, "kpi": string, "dueWhen": string(YYYY-MM-DD) }] }',
      'Constraints:',
      `- Deliverables array length: ${wanted}. Each item must have a unique KPI and dueWhen (YYYY-MM-DD).`,
      `- CRITICAL: The FIRST deliverable MUST be due within the first 1-2 weeks (use dates like ${week1} or ${week2}). Users need immediate action items for their weekly priorities.`,
      `- Timing pattern for ${wanted} deliverables: ${selectedPattern}`,
      `- Early deliverables should be quick wins (achievable in days/weeks). Later deliverables are bigger milestones.`,
      `- DO NOT set all deliverables months away. Spread them: some this week, some this month, some later.`,
      '- The overall project dueWhen must be at or after the latest deliverable dueWhen.',
      '- Keep title short (3–6 words). Keep KPIs concise (short metric phrase).',
    ].join('\n');

    const user = [
      contextText || '',
      input ? `User input/context: ${input}` : '',
      'Task: Propose a single core strategic project with unique deliverables and return ONLY valid JSON (no code fences).',
    ].filter(Boolean).join('\n');

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.6,
      messages: [ { role: 'system', content: system }, { role: 'user', content: user } ],
      max_tokens: 800,
    });

    let text = String(resp.choices?.[0]?.message?.content || '').trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fence) text = fence[1].trim();
    let obj = null;
    try { obj = JSON.parse(text); } catch {}
    if (!obj || typeof obj !== 'object') {
      return res.status(500).json({ message: 'Failed to parse AI response for core project' });
    }
    // Normalize outputs and enforce constraints
    const iso = (s) => {
      const raw = String(s || '').trim();
      const m = raw.match(/\d{4}-\d{2}-\d{2}/);
      if (m) return m[0];
      const d = new Date(raw);
      if (!isNaN(d.getTime())) try { return d.toISOString().slice(0,10); } catch {}
      return '';
    };
    const ensureFuture = (dstr) => {
      const v = iso(dstr);
      if (!v) return '';
      const now = new Date();
      const d = new Date(v + 'T00:00:00Z');
      if (d.getTime() <= now.getTime()) {
        // bump into the future by 30 days
        const b = new Date(); b.setDate(b.getDate() + 30); return b.toISOString().slice(0,10);
      }
      return v;
    };
    const out = {
      title: String(obj.title || '').slice(0, 120).trim(),
      goal: String(obj.goal || '').slice(0, 1000).trim(),
      ownerName: obj.ownerName ? String(obj.ownerName).trim() : undefined,
      dueWhen: ensureFuture(obj.dueWhen),
      deliverables: Array.isArray(obj.deliverables) ? obj.deliverables.slice(0, wanted).map((d) => ({
        text: String(d?.text || '').trim(),
        kpi: String(d?.kpi || '').trim(),
        dueWhen: ensureFuture(d?.dueWhen),
      })).filter((d)=> d.text) : [],
    };
    // Ensure unique KPIs and realistic due ordering
    const seen = new Set();
    out.deliverables = out.deliverables.map((d, i) => {
      let k = d.kpi;
      if (seen.has(k.toLowerCase())) k = `${k} (${i+1})`;
      seen.add(k.toLowerCase());
      return { ...d, kpi: k };
    });

    // Auto-distribute deliverable dates starting from current week if missing
    const delCount = out.deliverables.length;
    if (delCount > 0) {
      const now = new Date();
      out.deliverables = out.deliverables.map((d, i) => {
        if (!d.dueWhen) {
          let daysOffset;
          if (i === 0) {
            // First deliverable within 1-2 weeks for immediate priorities
            daysOffset = 7;
          } else {
            // Spread remaining evenly from ~1 month to 12 months
            const position = i / (delCount - 1 || 1);
            daysOffset = Math.round(30 + position * (365 - 30));
          }
          const dueDate = new Date(now);
          dueDate.setDate(dueDate.getDate() + daysOffset);
          d.dueWhen = dueDate.toISOString().slice(0, 10);
        }
        return d;
      });
    }

    // Set project due date to 12 months from now if missing
    if (!out.dueWhen) {
      const projectDue = new Date();
      projectDue.setFullYear(projectDue.getFullYear() + 1);
      out.dueWhen = projectDue.toISOString().slice(0, 10);
    }
    return res.json({ project: out });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to suggest core project';
    return res.status(500).json({ message });
  }
};
// Core Strategic Projects: suggest 3–4 high-level deliverables
exports.suggestCoreDeliverables = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestions = await callOpenAIList({ type: 'core strategic project deliverables (3–4 high-level items)', input, contextText, n: 4 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate deliverables';
    return res.status(500).json({ message });
  }
};

// New: Single endpoint to suggest all action fields at once
exports.suggestActionAll = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';

    // Detect department/project type from input for realistic budget ranges
    const inputLower = String(input || '').toLowerCase();
    let budgetHint = '';
    let baseRange = { min: 2000, max: 15000 };

    if (/marketing|brand|campaign|advertis|social media|content/i.test(inputLower)) {
      budgetHint = 'Marketing projects typically range $2,500-$35,000 depending on campaign scope.';
      baseRange = { min: 2500, max: 35000 };
    } else if (/tech|software|app|platform|system|automat|digital|website|mobile/i.test(inputLower)) {
      budgetHint = 'Technology projects typically range $8,000-$75,000 depending on complexity.';
      baseRange = { min: 8000, max: 75000 };
    } else if (/sales|revenue|customer acquisition|pipeline/i.test(inputLower)) {
      budgetHint = 'Sales initiatives typically range $3,000-$25,000 depending on scope.';
      baseRange = { min: 3000, max: 25000 };
    } else if (/hr|human resource|people|hiring|recruit|training|employee/i.test(inputLower)) {
      budgetHint = 'HR projects typically range $1,500-$12,000 depending on scope.';
      baseRange = { min: 1500, max: 12000 };
    } else if (/operations|process|efficiency|workflow|logistics/i.test(inputLower)) {
      budgetHint = 'Operations projects typically range $2,000-$20,000 depending on scope.';
      baseRange = { min: 2000, max: 20000 };
    } else if (/finance|accounting|budget|financial/i.test(inputLower)) {
      budgetHint = 'Finance projects typically range $1,500-$15,000 depending on scope.';
      baseRange = { min: 1500, max: 15000 };
    } else if (/partner|alliance|strategic|expansion/i.test(inputLower)) {
      budgetHint = 'Partnership initiatives typically range $5,000-$40,000 depending on scope.';
      baseRange = { min: 5000, max: 40000 };
    } else if (/community|impact|social|nonprofit/i.test(inputLower)) {
      budgetHint = 'Community/impact projects typically range $1,000-$10,000 depending on scope.';
      baseRange = { min: 1000, max: 10000 };
    }

    // Generate a truly dynamic budget based on project type rather than relying on AI
    // This ensures varied, realistic amounts for each project
    const generateDynamicBudget = () => {
      const range = baseRange.max - baseRange.min;
      // Use weighted random to favor middle-range budgets but allow extremes
      const weightedRandom = Math.pow(Math.random(), 0.8); // Slightly favor higher values
      const baseAmount = baseRange.min + (weightedRandom * range);
      // Add random variation (±20%)
      const variation = 0.8 + (Math.random() * 0.4);
      let amount = baseAmount * variation;
      // Round to varied increments ($50, $100, $250, $500) based on size
      let roundTo = 50;
      if (amount > 5000) roundTo = 100;
      if (amount > 10000) roundTo = 250;
      if (amount > 25000) roundTo = 500;
      return Math.round(amount / roundTo) * roundTo;
    };

    const [goal, kpi, rawTitle] = await Promise.all([
      callOpenAI({ type: 'action plan goal (1-2 sentences)', input, contextText }),
      callOpenAI({ type: 'KPI metric (short phrase)', input, contextText }),
      callOpenAI({ type: 'project title ONLY (3-6 words max). Examples: "Local Tech Partnerships Initiative", "Customer Feedback System", "Mobile App Development". Return ONLY the title, no descriptions or other fields.', input, contextText }),
    ]);

    // Generate dynamic budget based on detected project type
    const resources = String(generateDynamicBudget());

    // Clean title: remove any prefix and extra content after pipe/colon separators
    let title = String(rawTitle || '').replace(/^Title:\s*/i, '').trim();
    // Remove anything after | or : that looks like additional fields
    title = title.split(/\s*\|\s*/)[0].split(/:\s*(?=[A-Z])/)[0].trim();
    // Return cost as same as resources (for core projects that use cost field)
    return res.json({ goal, resources, cost: resources, kpi, title });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

// New: Bulk suggest high-level goals for multiple sections at once
// Body: { sections: [{ key, label }], context?: string, n?: number }
// Returns: { goals: { [key]: string[] } }
exports.suggestDeptGoalsBulk = async (req, res) => {
  try {
    const { sections = [], context = '', n } = req.body || {};
    if (!Array.isArray(sections) || sections.length === 0) {
      return res.json({ goals: {} });
    }
    const userId = req.user?.id;
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const contextText = [baseCtx, context].filter(Boolean).join('\n');

    const out = {};
    for (const sec of sections) {
      const label = (sec && sec.label) ? String(sec.label) : '';
      const key = (sec && sec.key) ? String(sec.key) : label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      // Default desired count: Core Strategic Projects => 6, otherwise 5 (unless overridden by 'n')
      const desired = (typeof n === 'number' && n > 0) ? n : (/core\s+strategic\s+projects/i.test(label) ? 6 : 5);
      const input = `${contextText}\nSection: ${label}\nTask: Provide ${desired} concise, distinct high-level options. Avoid overlap.`;
      const suggestions = await callOpenAIList({ type: 'high-level departmental goals', input, contextText, n: desired });
      out[key] = (suggestions || []).filter(Boolean).slice(0, desired);
    }
    return res.json({ goals: out });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate goals';
    return res.status(500).json({ message });
  }
};

exports.suggestActionDue = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    // Calculate date range with example near-term dates
    const now = new Date();
    const addDays = (d, days) => { const r = new Date(d); r.setDate(r.getDate() + days); return r.toISOString().slice(0, 10); };
    const minDate = now.toISOString().slice(0, 10);
    const week1 = addDays(now, 7);
    const week2 = addDays(now, 14);
    const month1 = addDays(now, 30);
    const maxDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);

    // Randomly suggest different time horizons to vary the distribution
    const timeHints = [
      `For quick tasks, use near-term dates (${week1} to ${month1}). For complex tasks, use later dates.`,
      `Consider if this is a quick win (1-2 weeks: ${week1}-${week2}) or a longer initiative (1-6 months).`,
      `Simple tasks should be due within 1-4 weeks. Complex projects can span months.`,
      `Prioritize actionable items with near-term dates when appropriate (${week1} to ${month1}).`,
    ];
    const selectedHint = timeHints[Math.floor(Math.random() * timeHints.length)];

    const contextText = [
      baseCtx,
      `Constraints: Return only ISO date (YYYY-MM-DD). Date must be between ${minDate} and ${maxDate} (within the next 12 months).`,
      selectedHint,
      `Choose dates based on task complexity - not all tasks should be months away.`
    ].filter(Boolean).join('\n');
    const suggestion = await callOpenAI({ type: 'due date in ISO format', input, contextText });
    // basic sanitize for date-like
    const iso = String(suggestion || '').trim().slice(0, 10);
    return res.json({ suggestion: iso });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestion';
    return res.status(500).json({ message });
  }
};

exports.rewriteActionDue = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    // Calculate date range: from today to 12 months from now
    const now = new Date();
    const minDate = now.toISOString().slice(0, 10);
    const maxDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
    const contextText = [
      baseCtx,
      `Constraints: Return only ISO date (YYYY-MM-DD). Date must be between ${minDate} and ${maxDate} (within the next 12 months).`
    ].filter(Boolean).join('\n');
    const rewrite = await callOpenAIRewrite({ type: 'due date in ISO format', text, contextText });
    const iso = String(rewrite || '').trim().slice(0, 10);
    return res.json({ rewrite: iso });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.rewriteVision3y = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const now = new Date();
    const currentIso = now.toISOString().slice(0, 10);
    const targetYear = now.getUTCFullYear() + 3;
    const anchor = `Current date: ${currentIso}. When referring to "3 years", anchor outcomes to the year ${targetYear} (not earlier years).`;
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const contextText = [baseCtx, anchor].filter(Boolean).join('\n');
    const rewrite = await callOpenAIRewrite({ type: '3-year thriving vision', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// BHAG (Long-term vision)
exports.suggestVisionBhag = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestions = await callOpenAIList({ type: 'Long-Term Strategic Vision (BHAG)', input, contextText, n: 3 });
    return res.json({ suggestion: suggestions[0] || '', suggestions });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate suggestions';
    return res.status(500).json({ message });
  }
};

exports.rewriteVisionBhag = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'Long-Term Strategic Vision (BHAG)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

// Strategic Identity Summary (UBP + Purpose + 1y + 3y)
exports.suggestIdentitySummary = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const suggestion = await callOpenAI({ type: 'strategic identity summary (1–3 sentences, polished narrative)', input, contextText });
    return res.json({ suggestion, suggestions: suggestion ? [suggestion] : [] });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to generate summary';
    return res.status(500).json({ message });
  }
};

exports.rewriteIdentitySummary = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewrite({ type: 'strategic identity summary (1–3 sentences, polished narrative)', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};
// SWOT item rewrites (per item, preserve user meaning while improving clarity)
exports.rewriteSwotStrengths = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewritePhrase({ type: 'SWOT Strength item', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.rewriteSwotWeaknesses = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewritePhrase({ type: 'SWOT Weakness item', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.rewriteSwotOpportunities = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewritePhrase({ type: 'SWOT Opportunity item', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};

exports.rewriteSwotThreats = async (req, res) => {
  try {
    const { text } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const rewrite = await callOpenAIRewritePhrase({ type: 'SWOT Threat item', text, contextText });
    return res.json({ rewrite });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to rewrite';
    return res.status(500).json({ message });
  }
};
// Generate financial insights from provided context text (JSON array of strings)
exports.generateFinancialInsightsFromContext = async function generateFinancialInsightsFromContext(contextText, n = 3) {
  const suggestions = await callOpenAIList({
    type: 'financial insights to improve runway, margin, and cashflow',
    input:
      'Provide concise, actionable recommendations based on the numbers and context. Focus on optimizing costs, pricing, margins, growth versus burn, and cash runway. Keep each item 1–2 sentences.',
    contextText,
    n,
  });
  return suggestions.filter((s) => typeof s === 'string' && s.trim()).map((s) => String(s).trim());
};

// === Added: keyword-aware suggestion helpers ===
async function callOpenAIListWithKeywords({ type, input, contextText, n = 3 }) {
  const client = getOpenAI();
  const system =
    'You are a helpful business planning assistant. ' +
    'Write crisp, human-sounding suggestions in plain language. ' +
    'Avoid marketing buzzwords. Be specific and concrete. ' +
    'Always keep suggestions consistent with any provided context and user input — do not contradict earlier answers.';

  let ragText2 = '';
  try {
    if (process.env.RAG_ENABLE !== 'false') {
      const results = await rag.retrieve([type, input].filter(Boolean).join(' \n ').slice(0, 500));
      if (results && results.length) {
        const clip = results.map((r) => r.text).join('\n\n---\n\n');
        ragText2 = 'Additional guidance from Business Trainer (internal knowledge):\n' + clip;
      }
    }
  } catch (_) {}

  const userPrompt = [
    contextText || '',
    ragText2 || '',
    `Task: Generate exactly ${n} distinct, high-quality options for the ${type}.`,
    'For each option, also return 3–4 short behavioral trait keywords that capture the core principles (e.g., "Accountability", "Transparency", "Customer-first").',
    'Constraints:',
    '- Each option text: 1–2 sentences.',
    '- Do NOT prefix text with labels like "Goal:", "Value:", etc. Just provide the content directly.',
    '- Keywords should be single words or short hyphenated phrases (max 3 words).',
    '- Output ONLY strict JSON: an array of objects [{ "text": string, "keywords": string[] }] of length exactly ${n}.',
    '- Do NOT include any extra commentary or code fences.',
    '',
    input ? `User input: ${input}` : 'User input: (none provided)',
  ]
    .filter(Boolean)
    .join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.8,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 700,
  });

  let text = resp.choices?.[0]?.message?.content || '';
  text = String(text).trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) text = fenceMatch[1].trim();

  let arr = [];
  try { arr = JSON.parse(text); } catch (_) { arr = []; }
  if (!Array.isArray(arr)) arr = [];

  const normalized = arr
    .map((it) => ({
      text: String(it?.text || '').trim(),
      keywords: Array.isArray(it?.keywords) ? it.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 4) : [],
    }))
    .filter((it) => it.text);
  return normalized.slice(0, n);
}

async function callOpenAIKeywordsForText({ type, text, contextText }) {
  const client = getOpenAI();
  const system = 'You are a helpful assistant. Extract concise behavioral trait keywords from the provided statement.';
  const userPrompt = [
    contextText || '',
    `Task: From the ${type}, extract 3–4 short behavioral trait keywords (e.g., Accountability, Transparency, Customer-first).`,
    'Rules:',
    '- Return ONLY a strict JSON array of 3 or 4 strings.',
    '- Each keyword must be short (1–3 words), no punctuation, no numbering.',
    '',
    `Statement: ${text}`,
  ].filter(Boolean).join('\n');

  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 120,
  });
  let out = (resp.choices?.[0]?.message?.content || '').trim();
  const fenceMatch2 = out.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch2) out = fenceMatch2[1].trim();
  try {
    const arr = JSON.parse(out);
    if (Array.isArray(arr)) return arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 4);
  } catch (_) {}
  return out.split(/[\,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 4);
}


// Extract keywords for a provided Core values statement (without rewriting)
exports.extractValuesCoreKeywords = async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text || !String(text).trim()) return res.json({ keywords: [] });
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId, req.workspace?._id) : '';
    const keywords = await callOpenAIKeywordsForText({ type: 'Core values statement', text: String(text).trim(), contextText });
    return res.json({ keywords });
  } catch (err) {
    if (err && err.code === 'NO_API_KEY') {
      return res.status(500).json({ message: 'OpenAI API key not configured on server' });
    }
    const message = err?.response?.data?.error?.message || err?.message || 'Failed to extract keywords';
    return res.status(500).json({ message });
  }
};

// Short-phrase helpers for SWOT generation
async function callOpenAIListPhrases({ type, input, contextText, n = 3 }) {
  const client = getOpenAI();
  const system = 'You are a creative business planning assistant. Generate fresh, unique suggestions each time. Return short, concrete phrases.';
  let ragText = '';
  try {
    if (process.env.RAG_ENABLE !== 'false') {
      const results = await rag.retrieve([type, input].filter(Boolean).join(' \n ').slice(0, 500));
      if (results && results.length) ragText = 'Additional guidance from Business Trainer (internal knowledge):\n' + results.map((r)=>r.text).join('\n\n---\n\n');
    }
  } catch(_){}
  // Add randomization hint to encourage variety
  const randomSeed = Math.random().toString(36).substring(2, 8);
  const userPrompt = [
    contextText || '',
    ragText || '',
    `Task: Generate exactly ${n} NEW and UNIQUE concise options for the ${type}.`,
    'Constraints:',
    '- Each option must be a short phrase (1–4 words), no sentences.',
    '- Do NOT prefix with labels like "Goal:", "KPI:", "Strength:", "Weakness:", etc. Just provide the content directly.',
    '- Be creative and varied - do NOT repeat common/generic phrases.',
    '- Think of specific, actionable items relevant to THIS business.',
    '- Avoid punctuation except hyphens when necessary.',
    `- Output ONLY a strict JSON array of strings (length exactly ${n}).`,
    '',
    input ? `User input: ${input}` : 'User input: (none provided)',
    `[Variation hint: ${randomSeed}]`
  ].filter(Boolean).join('\n');
  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.9,
    messages: [ { role: 'system', content: system }, { role: 'user', content: userPrompt } ],
    max_tokens: 200,
  });
  let text = (resp.choices?.[0]?.message?.content || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i); if (fence) text = fence[1].trim();
  let arr = [];
  try { const parsed = JSON.parse(text); if (Array.isArray(parsed)) arr = parsed; } catch(_){}
  if (!Array.isArray(arr) || !arr.length) {
    arr = text.split('\n').map((l)=>l.replace(/^[-*\d\.\)\s]+/, '').trim()).filter(Boolean);
  }
  const uniq = Array.from(new Set(arr.map((x)=>String(x).trim()))).filter(Boolean);
  return uniq.slice(0, n);
}

async function callOpenAIRewritePhrase({ type, text, contextText }) {
  const client = getOpenAI();
  const system = 'You are a helpful assistant. Rewrite into a concise phrase.';
  const userPrompt = [
    contextText || '',
    `Task: Rewrite the ${type} into a short phrase (1–4 words).`,
    'Rules: No sentences. Do NOT prefix with labels. Avoid punctuation except hyphens if needed. Return only the phrase as plain text.',
    '',
    `Draft: ${text}`
  ].filter(Boolean).join('\n');
  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.5,
    messages: [ { role: 'system', content: system }, { role: 'user', content: userPrompt } ],
    max_tokens: 60,
  });
  let out = (resp.choices?.[0]?.message?.content || '').trim();
  const fence = out.match(/```(?:json)?\s*([\s\S]*?)\s*```/i); if (fence) out = fence[1].trim();
  out = out.split('\n').map((x)=>x.replace(/^[-*\d\.\)\s]+/, '').trim()).filter(Boolean)[0] || '';
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) out = out.slice(1,-1).trim();
  return out;
}

// Redistribute all deliverable due dates across ALL projects from ALL departments
// Takes assignments object and distributes deliverables evenly across 12 months starting from current date
// Body: { assignments: Record<string, Array<{ deliverables?: Array<{ text, kpi?, dueWhen? }>, ...}>> }
// Returns: { assignments: Record<string, Array<...>> } with updated dueWhen values
exports.redistributeDeliverableDueDates = async (req, res) => {
  try {
    const { assignments } = req.body || {};
    if (!assignments || typeof assignments !== 'object') {
      return res.status(400).json({ message: 'assignments object is required' });
    }

    // Helper to format date as YYYY-MM-DD
    const formatYmd = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    // Collect all deliverables with references to their section, project, and deliverable indices
    const allDeliverables = [];
    Object.entries(assignments).forEach(([sectionKey, projects]) => {
      if (!Array.isArray(projects)) return;
      projects.forEach((project, pIdx) => {
        const deliverables = project?.deliverables;
        if (!Array.isArray(deliverables)) return;
        deliverables.forEach((_, dIdx) => {
          allDeliverables.push({ sectionKey, projectIdx: pIdx, deliverableIdx: dIdx });
        });
      });
    });

    const totalCount = allDeliverables.length;
    if (totalCount === 0) {
      return res.json({ assignments });
    }

    // Calculate interval in days to spread across 12 months (365 days)
    const nowDate = new Date();
    const daysInterval = totalCount > 1 ? 365 / (totalCount - 1) : 0;

    // Assign due dates
    allDeliverables.forEach((ref, idx) => {
      const daysOffset = Math.round(idx * daysInterval);
      const dueDate = new Date(nowDate);
      dueDate.setDate(dueDate.getDate() + daysOffset);
      const project = assignments[ref.sectionKey]?.[ref.projectIdx];
      if (project?.deliverables?.[ref.deliverableIdx]) {
        project.deliverables[ref.deliverableIdx].dueWhen = formatYmd(dueDate);
      }
    });

    return res.json({ assignments });
  } catch (err) {
    const message = err?.message || 'Failed to redistribute deliverable due dates';
    return res.status(500).json({ message });
  }
};

// Redistribute all deliverable due dates across ALL core strategic projects
// Takes coreProjectDetails array and distributes deliverables evenly across 12 months starting from current date
// Body: { coreProjectDetails: Array<{ title, goal?, cost?, dueWhen?, deliverables: Array<{ text, kpi?, dueWhen? }> }> }
// Returns: { coreProjectDetails: Array<...> } with updated dueWhen values
exports.redistributeCoreProjectDueDates = async (req, res) => {
  try {
    const { coreProjectDetails } = req.body || {};
    if (!coreProjectDetails || !Array.isArray(coreProjectDetails)) {
      return res.status(400).json({ message: 'coreProjectDetails array is required' });
    }

    // Helper to format date as YYYY-MM-DD
    const formatYmd = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    // Collect all deliverables with references to their project and deliverable indices
    const allDeliverables = [];
    coreProjectDetails.forEach((project, pIdx) => {
      const deliverables = project?.deliverables;
      if (!Array.isArray(deliverables)) return;
      deliverables.forEach((_, dIdx) => {
        allDeliverables.push({ projectIdx: pIdx, deliverableIdx: dIdx });
      });
    });

    const totalCount = allDeliverables.length;
    if (totalCount === 0) {
      return res.json({ coreProjectDetails });
    }

    // Calculate interval in days to spread across 12 months (365 days)
    const nowDate = new Date();
    const daysInterval = totalCount > 1 ? 365 / (totalCount - 1) : 0;

    // Assign due dates
    allDeliverables.forEach((ref, idx) => {
      const daysOffset = Math.round(idx * daysInterval);
      const dueDate = new Date(nowDate);
      dueDate.setDate(dueDate.getDate() + daysOffset);
      const project = coreProjectDetails[ref.projectIdx];
      if (project?.deliverables?.[ref.deliverableIdx]) {
        project.deliverables[ref.deliverableIdx].dueWhen = formatYmd(dueDate);
      }
    });

    return res.json({ coreProjectDetails });
  } catch (err) {
    const message = err?.message || 'Failed to redistribute core project due dates';
    return res.status(500).json({ message });
  }
};

// Redistribute ALL deliverable due dates across BOTH core projects AND departmental projects
// Combines all deliverables from all sources and distributes evenly across 12 months
// Body: { coreProjectDetails?: Array<...>, assignments?: Record<string, Array<...>> }
// Returns: { coreProjectDetails: Array<...>, assignments: Record<string, Array<...>> } with updated dueWhen values
exports.redistributeAllDueDates = async (req, res) => {
  try {
    const { coreProjectDetails = [], assignments = {} } = req.body || {};

    // Helper to format date as YYYY-MM-DD
    const formatYmd = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, '0');
      const d = String(dt.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    };

    // Collect ALL deliverables from both core projects and departmental projects
    const allDeliverables = [];

    // Collect from core projects
    if (Array.isArray(coreProjectDetails)) {
      coreProjectDetails.forEach((project, pIdx) => {
        const deliverables = project?.deliverables;
        if (!Array.isArray(deliverables)) return;
        deliverables.forEach((_, dIdx) => {
          allDeliverables.push({ source: 'core', projectIdx: pIdx, deliverableIdx: dIdx });
        });
      });
    }

    // Collect from departmental projects
    if (assignments && typeof assignments === 'object') {
      Object.entries(assignments).forEach(([sectionKey, projects]) => {
        if (!Array.isArray(projects)) return;
        projects.forEach((project, pIdx) => {
          const deliverables = project?.deliverables;
          if (!Array.isArray(deliverables)) return;
          deliverables.forEach((_, dIdx) => {
            allDeliverables.push({ source: 'dept', sectionKey, projectIdx: pIdx, deliverableIdx: dIdx });
          });
        });
      });
    }

    const totalCount = allDeliverables.length;
    if (totalCount === 0) {
      return res.json({ coreProjectDetails, assignments });
    }

    // Distribute across 12 months (365 days) with randomness for natural feel
    const nowDate = new Date();
    const baseInterval = totalCount > 1 ? 365 / (totalCount - 1) : 0;

    // Generate random offsets for each deliverable, then sort to maintain chronological order
    const randomOffsets = [];
    for (let i = 0; i < totalCount; i++) {
      if (i === 0) {
        // First deliverable: within first 2 weeks (1-14 days)
        randomOffsets.push(Math.floor(Math.random() * 14) + 1);
      } else if (i === totalCount - 1) {
        // Last deliverable: in the last month (335-365 days)
        randomOffsets.push(Math.floor(Math.random() * 30) + 335);
      } else {
        // Middle deliverables: base position with ±40% variance
        const basePosition = i * baseInterval;
        const variance = baseInterval * 0.4;
        const randomOffset = basePosition + (Math.random() * variance * 2 - variance);
        randomOffsets.push(Math.max(15, Math.min(334, Math.round(randomOffset))));
      }
    }
    // Sort to ensure chronological order
    randomOffsets.sort((a, b) => a - b);

    // Assign due dates
    allDeliverables.forEach((ref, idx) => {
      const daysOffset = randomOffsets[idx];
      const dueDate = new Date(nowDate);
      dueDate.setDate(dueDate.getDate() + daysOffset);
      const formattedDate = formatYmd(dueDate);

      if (ref.source === 'core') {
        const project = coreProjectDetails[ref.projectIdx];
        if (project?.deliverables?.[ref.deliverableIdx]) {
          project.deliverables[ref.deliverableIdx].dueWhen = formattedDate;
        }
      } else {
        const project = assignments[ref.sectionKey]?.[ref.projectIdx];
        if (project?.deliverables?.[ref.deliverableIdx]) {
          project.deliverables[ref.deliverableIdx].dueWhen = formattedDate;
        }
      }
    });

    return res.json({ coreProjectDetails, assignments });
  } catch (err) {
    const message = err?.message || 'Failed to redistribute all due dates';
    return res.status(500).json({ message });
  }
};

/**
 * Spread only a new project's deliverables across the remaining year.
 * Used when adding projects from the dashboard (post-onboarding) to avoid
 * disrupting existing deliverable due dates that users may already be working towards.
 */
exports.assignNewProjectDueDates = async (req, res) => {
  try {
    const { project } = req.body || {};
    if (!project || !Array.isArray(project.deliverables) || !project.deliverables.length) {
      return res.json({ project });
    }

    const now = new Date();
    const endOfYear = new Date(now.getFullYear(), 11, 31);
    const daysRemaining = Math.max(30, Math.floor((endOfYear - now) / (1000 * 60 * 60 * 24)));
    const count = project.deliverables.length;
    const baseInterval = daysRemaining / (count + 1);

    const formatYmd = (d) => d.toISOString().split('T')[0];

    // Generate random offsets for each deliverable
    const offsets = [];
    for (let i = 0; i < count; i++) {
      // Skip deliverables that already have due dates
      if (project.deliverables[i].dueWhen) {
        offsets.push(null);
        continue;
      }

      let offset;
      if (i === 0) {
        // First deliverable: 1-2 weeks out
        offset = Math.floor(Math.random() * 14) + 7;
      } else if (i === count - 1) {
        // Last deliverable: near end of year
        offset = daysRemaining - Math.floor(Math.random() * 14);
      } else {
        // Middle deliverables: spread with some variance
        const basePos = (i + 1) * baseInterval;
        const variance = baseInterval * 0.3;
        offset = Math.round(basePos + (Math.random() * variance * 2 - variance));
      }
      offsets.push(Math.max(7, Math.min(daysRemaining, offset)));
    }

    // Sort non-null offsets to ensure chronological order
    const sortedOffsets = offsets.filter(o => o !== null).sort((a, b) => a - b);
    let sortedIdx = 0;

    // Assign due dates
    project.deliverables = project.deliverables.map((d, i) => {
      if (d.dueWhen || offsets[i] === null) return d;
      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + sortedOffsets[sortedIdx++]);
      return { ...d, dueWhen: formatYmd(dueDate) };
    });

    return res.json({ project });
  } catch (err) {
    const message = err?.message || 'Failed to assign new project due dates';
    return res.status(500).json({ message });
  }
};
