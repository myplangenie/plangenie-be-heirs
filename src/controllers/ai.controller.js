const Onboarding = require('../models/Onboarding');
const User = require('../models/User');
const TeamMember = require('../models/TeamMember');
const Department = require('../models/Department');
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
    const lines = [];
    if (a.ubp) lines.push(`UBP: ${String(a.ubp).trim()}`);
    if (a.purpose) lines.push(`Purpose: ${String(a.purpose).trim()}`);
    if (a.visionBhag) lines.push(`Long-Term Strategic Vision (BHAG): ${String(a.visionBhag).trim()}`);
    if (a.vision1y) lines.push(`1-Year Goals: ${(String(a.vision1y).trim().split('\n').filter(Boolean).join('; '))}`);
    if (a.vision3y) lines.push(`3-Year Goals: ${(String(a.vision3y).trim().split('\n').filter(Boolean).join('; '))}`);
    if (a.valuesCore) lines.push(`Core Values: ${String(a.valuesCore).trim()}`);
    if (a.cultureFeeling) lines.push(`Culture & Behaviors: ${String(a.cultureFeeling).trim()}`);
    return lines.length ? `\n\nUser-provided answers:\n- ${lines.join('\n- ')}` : '';
  } catch (_) {
    return '';
  }
}

// Build a richer, user-aware context for Core Strategic Project suggestions
// Includes: Onboarding profile, fallback to User.companyName, key onboarding answers,
// existing core projects, departments summary, and active team members (limited).
async function buildCoreProjectContextForUser(userId) {
  try {
    const [ob, user, departments, teamMembers] = await Promise.all([
      userId ? Onboarding.findOne({ user: userId }) : null,
      userId ? User.findById(userId) : null,
      userId ? Department.find({ user: userId }).select('name status owner dueDate').limit(50).lean().exec() : [],
      userId ? TeamMember.find({ user: userId, status: 'Active' }).select('name role department email status').limit(200).lean().exec() : [],
    ]);

    // Profile section (with fallback business name)
    const bp = (ob && ob.businessProfile) || {};
    const up = (ob && ob.userProfile) || {};
    const businessName = String(bp.businessName || user?.companyName || '').trim();
    const profileLines = [
      businessName && `Business Name: ${businessName}`,
      bp.industry && `Industry: ${bp.industry}`,
      bp.city && bp.country && `Location: ${bp.city}, ${bp.country}`,
      bp.ventureType && `Venture Type: ${bp.ventureType}`,
      bp.teamSize && `Team Size: ${bp.teamSize}`,
      bp.businessStage && `Stage: ${bp.businessStage}`,
      up.role && `User Role: ${up.role}`,
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
    const vvText = vvParts.length ? `\n\nVision & Values:\n- ${vvParts.join('\n- ')}` : '';

    // Market & Competition
    const marketLines = [];
    if (answers.marketCustomer) marketLines.push(`Customer: ${String(answers.marketCustomer).trim()}`);
    if (answers.partnersDesc) marketLines.push(`Partners: ${String(answers.partnersDesc).trim()}`);
    if (answers.compNotes) marketLines.push(`Competitors Notes: ${String(answers.compNotes).trim()}`);
    if (Array.isArray(answers.competitorNames) && answers.competitorNames.length) {
      const names = answers.competitorNames.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8).join(', ');
      if (names) marketLines.push(`Competitor Names: ${names}`);
    }
    const marketText = marketLines.length ? `\n\nMarket & Competition:\n- ${marketLines.join('\n- ')}` : '';

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

    return [profileText, vvText, marketText, coreProjectsText, departmentsText, teamText].filter(Boolean).join('\n\n');
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
async function callOpenAIList({ type, input, contextText, n = 3 }) {
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

  const userPrompt = [
    contextText || '',
    ragText2 || '',
    `Task: Generate exactly ${n} distinct, high-quality options for the ${type}.`,
    'Constraints:',
    '- Each option should be 1-2 sentences.',
    '- Be specific and user-centered.',
    '- Return ONLY a valid JSON array of strings (length exactly ${n}).',
    '- Do NOT include any extra text before or after the JSON.',
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
  const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
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
  const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
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
  const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const { input } = req.body || {};
    const userId = req.user?.id;
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId) : '';
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
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
      'For EACH, include:',
      '- name: the platform/company name',
      '- url: a plausible official URL if clearly implied by results (optional)',
      '- note: one sentence on how to partner or what they offer',
      'Output format (strict JSON): [{ "name": string, "url"?: string, "note": string }]',
      'No extra text before/after the JSON.'
    ].filter(Boolean).join('\n');
    let partners = [];
    try {
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [ { role: 'system', content: system }, { role: 'user', content: userPrompt } ],
        max_tokens: 500,
      });
      let text = (resp.choices?.[0]?.message?.content || '').trim();
      const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i); if (fence) text = fence[1].trim();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) partners = parsed.map((p) => ({ name: String(p?.name || '').trim(), url: p?.url ? String(p.url) : undefined, note: String(p?.note || '').trim() })).filter((p) => p.name && p.note).slice(0,3);
    } catch (_) {}

    // Also keep simple sentence suggestions for backward-compatibility
    const suggestions = await callOpenAIList({ type: 'Go-to-market partners and channels plan', input, contextText: baseCtx, n: 3 });
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const { input } = req.body || {};
    const userId = req.user?.id;
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const userPrompt = [
      contextText || '',
      namesText,
      'Task: For each competitor, provide a one-sentence "they do better" and a one-sentence "we do better".',
      'Output format (strict JSON): [ { "name": string, "theyDoBetter": string, "weDoBetter": string } ]',
      'No extra commentary before or after the JSON.'
    ].filter(Boolean).join('\n');
    let competitors = [];
    try {
      const resp = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.7,
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
    const suggestions = await callOpenAIList({ type: 'Competitive differentiation notes', input, contextText, n: 3 });
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const ob = userId ? await Onboarding.findOne({ user: userId }) : null;
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId) : '';

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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';

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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';

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

exports.suggestVision1y = async (req, res) => {
  try {
    const { input } = req.body || {};
    const userId = req.user?.id;
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
    const suggestion = await callOpenAI({ type: 'resources/tools/budget summary (short phrase)', input, contextText });
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
    const client = getOpenAI();

    const wanted = (typeof n === 'number' && n > 0) ? Math.min(8, Math.max(1, n)) : 4;

    const system = [
      'You are a helpful business planning assistant.',
      'Propose a core strategic project based ONLY on the provided business context and input. Do not fabricate external statistics.',
      'Return a single JSON object with the following shape:',
      '{ "title": string, "goal": string, "dueWhen": string(YYYY-MM-DD), "ownerName"?: string, "deliverables": [{ "text": string, "kpi": string, "dueWhen": string(YYYY-MM-DD) }] }',
      'Constraints:',
      `- Deliverables array length: ${wanted}. Each item must have a unique KPI and realistic dueWhen (YYYY-MM-DD).`,
      '- The overall project dueWhen must be on or after the latest deliverable dueWhen.',
      '- Use future dates within the next 4–8 months.',
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
    // If overall due missing, set to the latest deliverable due or +60 days
    if (!out.dueWhen) {
      const latest = out.deliverables.map((d)=> d.dueWhen).filter(Boolean).sort().slice(-1)[0];
      out.dueWhen = latest || (()=>{ const b=new Date(); b.setDate(b.getDate()+60); return b.toISOString().slice(0,10); })();
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';

    const [goal, milestone, resources, cost, kpi, title] = await Promise.all([
      callOpenAI({ type: 'action plan goal (1-2 sentences)', input, contextText }),
      callOpenAI({ type: 'concise deliverable/milestone phrase', input, contextText }),
      callOpenAI({ type: 'resources/tools/budget summary (short phrase)', input, contextText }),
      callOpenAI({ type: 'estimated cost/budget (short phrase, e.g., "$2,000 for design and ads")', input, contextText }),
      callOpenAI({ type: 'KPI metric specification (short phrase)', input, contextText }),
      callOpenAI({ type: 'short, specific project title (3–6 words)', input, contextText }),
    ]);
    return res.json({ goal, milestone, resources, cost, kpi, title });
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
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId) : '';
    const contextText = [baseCtx, 'Constraints: Return only ISO date (YYYY-MM-DD)'].filter(Boolean).join('\n');
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
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId) : '';
    const contextText = [baseCtx, 'Constraints: Return only ISO date (YYYY-MM-DD)'].filter(Boolean).join('\n');
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
    const baseCtx = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
    const contextText = userId ? await buildCoreProjectContextForUser(userId) : '';
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
  const system = 'You are a helpful business planning assistant. Return short, concrete phrases.';
  let ragText = '';
  try {
    if (process.env.RAG_ENABLE !== 'false') {
      const results = await rag.retrieve([type, input].filter(Boolean).join(' \n ').slice(0, 500));
      if (results && results.length) ragText = 'Additional guidance from Business Trainer (internal knowledge):\n' + results.map((r)=>r.text).join('\n\n---\n\n');
    }
  } catch(_){}
  const userPrompt = [
    contextText || '',
    ragText || '',
    `Task: Generate exactly ${n} concise options for the ${type}.`,
    'Constraints:',
    '- Each option must be a short phrase (1–4 words), no sentences.',
    '- Avoid punctuation except hyphens when necessary.',
    `- Output ONLY a strict JSON array of strings (length exactly ${n}).`,
    '',
    input ? `User input: ${input}` : 'User input: (none provided)'
  ].filter(Boolean).join('\n');
  const resp = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
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
    'Rules: No sentences. Avoid punctuation except hyphens if needed. Return only the phrase as plain text.',
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
