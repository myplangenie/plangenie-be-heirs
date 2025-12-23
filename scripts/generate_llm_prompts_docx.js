#!/usr/bin/env node
/*
  Extracts LLM prompt strings from key backend files and writes a DOCX
  (minimal WordprocessingML zip) to the backend root as LLM_Prompts.docx.

  Heuristics:
  - Captures occurrences of const system = ... and const userPrompt = ...
  - Also captures const user = ... (used in suggestCoreProject)
  - Also captures ad-hoc instruction variables (studyInstruction, financialInstruction)
  - Reconstructs string arrays joined by '\\n' or ' ' by concatenating quoted segments only
    (variable inserts are omitted)
  - Titles are derived from nearest function or export name above the match
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DOCX = path.join(ROOT, 'LLM_Prompts.docx');

const files = [
  path.join(ROOT, 'src', 'controllers', 'ai.controller.js'),
  path.join(ROOT, 'src', 'controllers', 'chat.controller.js'),
  path.join(ROOT, 'src', 'controllers', 'dashboard.controller.js'),
];

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function findFunctionContext(text, index) {
  const head = text.slice(0, index);
  const lines = head.split(/\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    // exports.name = ...
    let m = line.match(/^exports\.(\w+)/);
    if (m) return m[1];
    // async function name( or function name(
    m = line.match(/^(?:async\s+)?function\s+(\w+)/);
    if (m) return m[1];
    // const name = async (...) => or name = (...)=>
    m = line.match(/^const\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (m) return m[1];
  }
  return 'top-level';
}

function unescapeJs(s) {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\`/g, '`');
}

// Extract concatenated string from an expression like [ 'a', 'b', `c ${x}` ].join('\n')
// We only collect quoted literals; variables are ignored.
function extractStringArrayJoined(expr) {
  // Identify join separator
  let joinSep = '\n';
  const jm = expr.match(/\.join\((['"])([\s\S]*?)\1\)/);
  if (jm) joinSep = unescapeJs(jm[2]);
  const insideArr = (() => {
    const m = expr.match(/\[([\s\S]*?)\]/);
    return m ? m[1] : '';
  })();
  const parts = [];
  const rx = /(['"`])([\s\S]*?)\1/g;
  let match;
  while ((match = rx.exec(insideArr))) {
    parts.push(unescapeJs(match[2]));
  }
  return parts.join(joinSep);
}

// Extract plain quoted string
function extractPlainString(expr) {
  const m = expr.match(/^\s*(['"`])([\s\S]*?)\1\s*$/);
  if (m) return unescapeJs(m[2]);
  return null;
}

// Attempt to reconstruct prompt text from a JS initializer expression
function reconstructPrompt(expr) {
  expr = String(expr || '').trim();
  if (!expr) return '';
  if (/^\[/.test(expr) && /\.join\(/.test(expr)) {
    return extractStringArrayJoined(expr);
  }
  const plain = extractPlainString(expr);
  if (plain != null) return plain;
  // Fallback: return the raw snippet (trimmed) to avoid losing content
  return expr;
}

function findMatchesForVar(text, varNames) {
  const out = [];
  const pattern = new RegExp(
    `\\bconst\\s+(${varNames.map((v)=>v.replace(/[-]/g,'\\$&')).join('|')})\\s*=\\s*([\\s\\S]*?)\\;`,
    'g'
  );
  let m;
  while ((m = pattern.exec(text))) {
    const varName = m[1];
    const expr = m[2];
    out.push({ index: m.index, varName, expr });
  }
  return out;
}

function collectPromptsFromFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  const text = readFileSafe(filePath);
  const prompts = [];
  if (!text) return prompts;

  // Variables we consider as prompts
  const matches = [
    ...findMatchesForVar(text, ['system', 'userPrompt', 'user', 'studyInstruction', 'financialInstruction', 'content']),
  ];
  for (const m of matches) {
    const ctx = findFunctionContext(text, m.index);
    const body = reconstructPrompt(m.expr);
    // Filter out very small or obviously non-prompt content
    const isLikelyPrompt = /you are|task:|constraints:|guidelines:|only json|strict json|do not include|return only|kpi|deliverables|yyyy-mm|sections?|assistant/i.test(body);
    if (!isLikelyPrompt) continue;
    prompts.push({ file: rel, func: ctx, varName: m.varName, text: body });
  }
  return prompts;
}

function collectAll() {
  const all = [];
  for (const f of files) {
    all.push(...collectPromptsFromFile(f));
  }
  // Merge by (file, func), grouping system/user entries together
  const groups = new Map();
  for (const p of all) {
    const key = `${p.file}::${p.func}`;
    if (!groups.has(key)) groups.set(key, { file: p.file, func: p.func, items: [] });
    groups.get(key).items.push({ varName: p.varName, text: p.text });
  }
  return Array.from(groups.values());
}

// Minimal Word document XML helpers
function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildDocumentXml(groups) {
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  parts.push('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">');
  parts.push('<w:body>');

  const addParagraph = (text, { bold = false } = {}) => {
    parts.push('<w:p>');
    parts.push('<w:r>');
    if (bold) parts.push('<w:rPr><w:b/></w:rPr>');
    const lines = String(text).split(/\n/);
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i];
      parts.push(`<w:t xml:space="preserve">${xmlEscape(t)}</w:t>`);
      if (i !== lines.length - 1) parts.push('<w:br/>');
    }
    parts.push('</w:r>');
    parts.push('</w:p>');
  };

  const now = new Date().toISOString().replace('T', ' ').replace(/\..+$/, '');
  addParagraph('LLM Prompts Catalog — Backend', { bold: true });
  addParagraph(`Generated: ${now}`);

  // Sort groups for stable output
  groups.sort((a, b) => (a.file + a.func).localeCompare(b.file + b.func));

  function friendlyTitle(file, func, combinedText) {
    const f = String(func || '').trim();
    const lower = (combinedText || '').toLowerCase();
    const map = {
      // chat.controller.js
      respond: 'Chat Assistant Guidance',
      planFacts: 'Planning Which Facts To Use',
      // ai.controller.js helpers
      callOpenAI: 'Suggestion — Single Option',
      callOpenAIList: 'Suggestions — Multiple Options',
      callOpenAIProse: 'Narrative Section Writer',
      callOpenAIRewrite: 'Rewrite For Clarity',
      callOpenAIListWithKeywords: 'Suggestions With Keywords',
      callOpenAIKeywordsForText: 'Extract Behavior Keywords',
      callOpenAIListPhrases: 'Short Phrases Generator',
      callOpenAIRewritePhrase: 'Rewrite Into Short Phrase',
      // ai.controller.js endpoints (common descriptive names)
      suggestUbp: 'Unique Business Proposition',
      rewriteUbp: 'Rewrite — Unique Business Proposition',
      suggestPurpose: 'Purpose Statement',
      rewritePurpose: 'Rewrite — Purpose Statement',
      suggestValuesCore: 'Core Values',
      rewriteValuesCore: 'Rewrite — Core Values',
      suggestCultureFeeling: 'Culture & Brand Experience',
      rewriteCultureFeeling: 'Rewrite — Culture & Brand Experience',
      suggestSwotStrengths: 'SWOT — Strengths',
      suggestSwotWeaknesses: 'SWOT — Weaknesses',
      suggestSwotOpportunities: 'SWOT — Opportunities',
      suggestSwotThreats: 'SWOT — Threats',
      rewriteSwotStrengths: 'Rewrite — SWOT Strength',
      rewriteSwotWeaknesses: 'Rewrite — SWOT Weakness',
      rewriteSwotOpportunities: 'Rewrite — SWOT Opportunity',
      rewriteSwotThreats: 'Rewrite — SWOT Threat',
      suggestCompetitorAdvantages: 'Competitor Advantages',
      suggestCompetitorNames: 'Competitor Names',
      suggestMarketPartners: 'Partners & Channels',
      rewriteMarketPartners: 'Rewrite — Partners & Channels',
      suggestMarketCompetitors: 'Competitive Landscape',
      rewriteMarketCompetitors: 'Rewrite — Competitive Landscape',
      suggestCoreProject: 'Core Strategic Project Proposal',
      suggestCoreDeliverables: 'Core Project Deliverables',
      suggestActionAll: 'Action Plan Fields (All)',
      suggestDeptGoalsBulk: 'Departmental Goals (Bulk)',
      suggestActionDue: 'Suggest Due Date',
      rewriteActionDue: 'Rewrite — Due Date',
      rewriteVision3y: '3‑Year Vision',
      suggestVisionBhag: 'Long‑Term Strategic Vision (BHAG)',
      rewriteVisionBhag: 'Rewrite — Long‑Term Strategic Vision (BHAG)',
      suggestIdentitySummary: 'Strategic Identity Summary',
      rewriteIdentitySummary: 'Rewrite — Strategic Identity Summary',
      suggestFinancialNumber: 'Numeric Finance Estimate',
      suggestFinancialAll: 'Financial Inputs — All',
      generateActionInsightsForUser: 'Actionable Next Steps',
      generateActionInsightSectionsForUser: 'Action Insight Sections',
      generateSingleInsightSectionForUser: 'Generate Single Insight Section',
      extractValuesCoreKeywords: 'Extract Core Values Keywords',
      generateFinancialInsightsFromContext: 'Financial Insights',
    };
    if (map[f]) return map[f];
    // Heuristics
    if (lower.includes('market and opportunity study')) return 'Market & Opportunity Study';
    if (lower.includes('financial section')) return 'Financial Section';
    if (lower.includes('unique business proposition')) return 'Unique Business Proposition';
    if (lower.includes('purpose')) return 'Purpose Statement';
    if (lower.includes('core values')) return 'Core Values';
    if (lower.includes('culture') && lower.includes('brand')) return 'Culture & Brand Experience';
    if (lower.includes('long-term') && lower.includes('vision')) return 'Long‑Term Strategic Vision';
    if (lower.includes('kpi') && lower.includes('sections')) return 'Action Insight Sections';
    if (lower.includes('core strategic project')) return 'Core Strategic Project Proposal';
    if (lower.includes('competitor')) return 'Competitive Landscape';
    if (lower.includes('partners')) return 'Partners & Channels';
    if (lower.includes('departmental goals')) return 'Departmental Goals';
    if (lower.includes('due date')) return 'Due Date Suggestion';
    if (lower.includes('financial') && lower.includes('insights')) return 'Financial Insights';
    if (lower.includes('chat') || lower.includes('assistant')) return 'Chat Assistant Guidance';
    return `${file} — ${func}`;
  }

  function prettifyAllowedOps(text) {
    const m = text.match(/Allowed ops:\s*([\s\S]*?)\.?$/i);
    if (!m) return null;
    const ops = m[1]
      .replace(/\s*\|\s*/g, ', ')
      .replace(/user\.profile/gi, 'user profile')
      .replace(/business\.profile/gi, 'business profile')
      .replace(/team\.members\.count/gi, 'team member count')
      .replace(/team\.members\.list/gi, 'team members')
      .replace(/departments\.count/gi, 'departments count')
      .replace(/departments\.list/gi, 'departments')
      .replace(/coreProjects\.count/gi, 'core projects count')
      .replace(/coreProjects\.list/gi, 'core projects')
      .replace(/deadlines\.list/gi, 'deadlines');
    return `May reference internal data such as ${ops}.`;
  }

  function combineForClient(g) {
    const texts = [];
    for (const it of g.items) texts.push(it.text);
    let merged = texts.join('\n');
    const lines = merged.split(/\n+/);
    const out = [];
    for (let raw of lines) {
      let l = raw.trim();
      if (!l) continue;
      // Drop technical lines
      if (/\b(JSON|code fence|strict JSON|tool[s]?|function call|no extra text|only the final|Output ONLY|Return ONLY|messages:|model:|temperature:|max_tokens|fence)\b/i.test(l)) continue;
      if (/^User input:/i.test(l)) continue;
      if (/^Additional guidance from Business Trainer/i.test(l)) continue;
      if (/^\(Context provided/i.test(l)) continue;
      // Transform headings
      l = l.replace(/^Task:\s*/i, '');
      l = l.replace(/^Constraints:\s*/i, '');
      l = l.replace(/^Guidelines:\s*/i, '');
      l = l.replace(/^Rules:\s*/i, '');
      // Humanize "You are ..." to a friendly tone
      l = l.replace(/^You are\s+/i, '');
      l = l.replace(/^Never mention that you are an AI model\.?/i, '');
      // Allowed ops -> friendly sentence
      if (/^Allowed ops:/i.test(l)) {
        const friendly = prettifyAllowedOps(l);
        if (friendly) { out.push(friendly); continue; }
      }
      // Date format notes
      l = l.replace(/Respond with only a month in YYYY-MM format\.?/i, 'Returns a month in YYYY-MM format.');
      l = l.replace(/Constraints: Return only ISO date \(YYYY-MM-DD\)/i, 'Returns a due date in ISO format (YYYY-MM-DD).');
      // Clean bullets of leading dashes/numbers
      l = l.replace(/^[-*\d\.\)\s]+/, '');
      out.push(l);
    }
    // De-duplicate consecutive lines
    const dedup = [];
    for (const s of out) {
      if (!dedup.length || dedup[dedup.length - 1] !== s) dedup.push(s);
    }
    return dedup.join('\n');
  }

  let counter = 0;
  for (const g of groups) {
    counter += 1;
    const combined = combineForClient(g);
    const friendly = friendlyTitle(g.file, g.func, combined);
    const title = `${counter}. ${friendly}`;
    addParagraph('');
    addParagraph(title, { bold: true });
    addParagraph(combined);
  }

  parts.push('</w:body>');
  parts.push('</w:document>');
  return parts.join('');
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function writeMinimalDocx(docXml, destPath) {
  const tmp = path.join(ROOT, '__prompts_docx_tmp');
  const relsDir = path.join(tmp, '_rels');
  const wordDir = path.join(tmp, 'word');
  ensureDir(relsDir);
  ensureDir(wordDir);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
`  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
`  <Default Extension="xml" ContentType="application/xml"/>\n` +
`  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n` +
`</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
`  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n` +
`</Relationships>`;

  fs.writeFileSync(path.join(tmp, '[Content_Types].xml'), contentTypes);
  fs.writeFileSync(path.join(relsDir, '.rels'), rels);
  fs.writeFileSync(path.join(wordDir, 'document.xml'), docXml);

  // Zip into .docx
  const { spawnSync } = require('child_process');
  // Remove existing file if present
  try { fs.unlinkSync(destPath); } catch {}
  const zip = spawnSync('zip', ['-rq', destPath, '.'], { cwd: tmp });
  if (zip.status !== 0) {
    throw new Error('zip failed: ' + (zip.stderr ? zip.stderr.toString() : ''));
  }
  // Cleanup tmp folder
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

function main() {
  const groups = collectAll();
  const docXml = buildDocumentXml(groups);
  writeMinimalDocx(docXml, TARGET_DOCX);
  console.log('Wrote', TARGET_DOCX);
}

if (require.main === module) {
  main();
}
