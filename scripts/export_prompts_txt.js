#!/usr/bin/env node
/*
  Export all LLM prompt strings found in backend controllers into a single
  numbered text file PROMPTS.txt in the repo root.

  Requirements addressed:
  - Capture ALL prompts (system/user/userPrompt/studyInstruction/financialInstruction)
  - Include every line/word as authored (no trimming/dropping)
  - Number them (1,2,3, ...)
  - Indicate where each prompt is used: file path and the line where the
    function that uses the prompt starts
  - Format each prompt as a single quoted string (escaped newlines)

  Notes:
  - We reconstruct prompt bodies from:
      * string arrays joined by .join(sep)
      * concatenated literals (e.g., 'a' + 'b' + `c`)
      * plain quoted strings (single/double/backtick)
    For any other expression, we fall back to the raw initializer text so
    nothing is lost.
*/

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUTPUT = path.join(ROOT, 'PROMPTS.txt');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
      walk(p, out);
    } else if (/\.js$/i.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function unescapeJs(s) {
  return String(s)
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\`/g, '`');
}

// Extract string from an expression like [ 'a', `b ${x}` ].join('\n')
// We keep quoted literals intact (including ${...} inside template literals)
function extractStringArrayJoined(expr) {
  // Find top-level array [ ... ] and its matching closing bracket
  const start = expr.indexOf('[');
  if (start === -1) return '';
  let i = start + 1;
  let depth = 1;
  let inString = false;
  let quote = '';
  let escape = false;
  let inTplExpr = false;
  let tplDepth = 0;
  for (; i < expr.length; i++) {
    const ch = expr[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (quote === '`' && ch === '$' && expr[i+1] === '{' && !inTplExpr) { inTplExpr = true; tplDepth = 1; i++; continue; }
      if (quote === '`' && inTplExpr) {
        if (ch === '{') { tplDepth++; continue; }
        if (ch === '}') { tplDepth--; if (tplDepth === 0) inTplExpr = false; continue; }
      }
      if (ch === quote && !inTplExpr) { inString = false; quote = ''; continue; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inString = true; quote = ch; continue; }
    if (ch === '[') { depth++; continue; }
    if (ch === ']') { depth--; if (depth === 0) break; continue; }
  }
  const end = i;
  const arrContent = expr.slice(start + 1, end);
  // Determine the join separator by looking after the array close
  let joinSep = '\n';
  const tail = expr.slice(end + 1);
  const jm = tail.match(/\.join\s*\((['"])([\s\S]*?)\1\)/);
  if (jm) joinSep = unescapeJs(jm[2]);

  // Collect literal string contents in order
  const parts = [];
  let j = 0;
  inString = false; quote = ''; escape = false; inTplExpr = false; tplDepth = 0;
  let buf = '';
  for (; j < arrContent.length; j++) {
    const ch = arrContent[j];
    if (!inString) {
      if (ch === '"' || ch === "'" || ch === '`') {
        inString = true; quote = ch; escape = false; inTplExpr = false; tplDepth = 0; buf = ''; continue;
      }
      continue;
    }
    // inside a string literal
    if (escape) { buf += ch; escape = false; continue; }
    if (ch === '\\') { buf += ch; escape = true; continue; }
    if (quote === '`' && ch === '$' && arrContent[j+1] === '{' && !inTplExpr) { buf += '${'; inTplExpr = true; tplDepth = 1; j++; continue; }
    if (quote === '`' && inTplExpr) {
      buf += ch;
      if (ch === '{') { tplDepth++; }
      else if (ch === '}') { tplDepth--; if (tplDepth === 0) inTplExpr = false; }
      continue;
    }
    if (ch === quote && !inTplExpr) {
      // finalize this string
      parts.push(unescapeJs(buf));
      inString = false; quote = ''; buf = '';
      continue;
    }
    buf += ch;
  }
  return parts.join(joinSep);
}

// Extract concatenated literal strings: 'a' + "b" + `c ${x}`
function extractConcatenatedLiterals(expr) {
  const parts = [];
  const rx = /(["'`])([\s\S]*?)\1/g;
  let m;
  while ((m = rx.exec(expr))) {
    parts.push(unescapeJs(m[2]));
  }
  return parts.length ? parts.join('') : null;
}

function extractPlainString(expr) {
  const m = expr.match(/^\s*(["'`])([\s\S]*?)\1\s*$/);
  if (m) return unescapeJs(m[2]);
  return null;
}

function reconstructPrompt(expr) {
  expr = String(expr || '').trim();
  if (!expr) return '';
  if (/^\[/.test(expr) && /\.join\(/.test(expr)) {
    return extractStringArrayJoined(expr);
  }
  const concat = extractConcatenatedLiterals(expr);
  if (concat != null) return concat;
  const plain = extractPlainString(expr);
  if (plain != null) return plain;
  // Fallback: preserve raw text to avoid losing info
  return expr;
}

function findVarMatches(text, varNames) {
  const out = [];
  const nameGroup = varNames.map((v) => v.replace(/[-]/g, '\\$&')).join('|');
  const pattern = new RegExp(`\\b(?:const|let|var)\\s+(${nameGroup})\\s*=`, 'g');
  let m;
  while ((m = pattern.exec(text))) {
    const varName = m[1];
    const startIdx = m.index; // at the beginning of declaration
    const eqIdx = text.indexOf('=', startIdx);
    if (eqIdx === -1) continue;
    // Scan forward to the terminating semicolon not inside quotes/brackets
    let i = eqIdx + 1;
    let inString = false;
    let quote = '';
    let escape = false;
    let p = 0, b = 0, c = 0; // (), [], {}
    let endIdx = -1;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === quote) { inString = false; quote = ''; continue; }
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') { inString = true; quote = ch; continue; }
      if (ch === '(') { p++; continue; }
      if (ch === ')') { if (p > 0) p--; continue; }
      if (ch === '[') { b++; continue; }
      if (ch === ']') { if (b > 0) b--; continue; }
      if (ch === '{') { c++; continue; }
      if (ch === '}') { if (c > 0) c--; continue; }
      if (ch === ';' && p === 0 && b === 0 && c === 0) { endIdx = i; break; }
    }
    if (endIdx === -1) continue;
    const expr = text.slice(eqIdx + 1, endIdx).trim();
    out.push({ index: startIdx, varName, expr });
  }
  return out;
}

function findFunctionContext(text, index) {
  const head = text.slice(0, index);
  const lines = head.split(/\n/);
  let exportCand = null;
  let funcCand = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    const line = raw.trim();
    // Record nearest exported function
    let m = line.match(/^exports\.(\w+)\s*=\s*(?:async\s*)?(?:function\s*\w*\s*\(|\([^)]*\)\s*=>)/);
    if (m && !exportCand) exportCand = { name: m[1], line: i + 1 };
    m = line.match(/^module\.exports\.(\w+)\s*=\s*(?:async\s*)?(?:function\s*\w*\s*\(|\([^)]*\)\s*=>)/);
    if (m && !exportCand) exportCand = { name: m[1], line: i + 1 };
    // Record nearest named function (ignore const arrow helpers)
    m = line.match(/^(?:async\s+)?function\s+(\w+)\s*\(/);
    if (m && !funcCand) funcCand = { name: m[1], line: i + 1 };
  }
  if (funcCand && exportCand) {
    const n = funcCand.name || '';
    const distFunc = lines.length - (funcCand.line || 0);
    const distExp = lines.length - (exportCand.line || 0);
    const looksHelper = n.length < 5 && !/^(callOpenAI|ask|rewrite|suggest|generate|extract)/.test(n);
    if (looksHelper) return exportCand; // likely a tiny nested helper like num()
    // Otherwise prefer whichever header is closer to where the prompt is
    return distFunc <= distExp ? funcCand : exportCand;
  }
  return funcCand || exportCand || { name: 'top-level', line: 1 };
}

function isLikelyPromptText(text) {
  // Keep broad to avoid missing: look for typical instruction cues
  return /(you are|task:|constraints:|guidelines:|return only|strict json|do not|must|rules:|sections?:|output format|json|assistant|calculator)/i.test(text);
}

function collectPromptsFromFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  const text = readFileSafe(filePath);
  if (!text) return [];
  const matches = findVarMatches(text, [
    'system', 'userPrompt', 'user', 'studyInstruction', 'financialInstruction'
  ]);

  const prompts = [];
  for (const m of matches) {
    const ctx = findFunctionContext(text, m.index);
    const flat = reconstructPrompt(m.expr); // Flatten arrays/concats into final prompt text
    const short = String(flat).trim().replace(/\s+/g, ' ');
    if (short.length < 12) continue; // avoid trivial
    if (m.varName === 'user' && !isLikelyPromptText(flat)) continue; // exclude DB/variable 'user'
    prompts.push({ file: rel, func: ctx.name, funcLine: ctx.line, varName: m.varName, text: flat });
  }
  return prompts;
}

function main() {
  // Focus on key backend controllers where prompts are authored
  const files = [
    path.join(SRC, 'controllers', 'ai.controller.js'),
    path.join(SRC, 'controllers', 'chat.controller.js'),
    path.join(SRC, 'controllers', 'dashboard.controller.js'),
  ];
  const all = [];
  for (const f of files) {
    all.push(...collectPromptsFromFile(f));
  }
  // Sort by file, function start line, then varName for stability
  all.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.funcLine !== b.funcLine) return a.funcLine - b.funcLine;
    return a.varName.localeCompare(b.varName);
  });

  // Build numbered output
  const lines = [];
  lines.push('LLM Prompts (compiled)');
  lines.push('');
  let idx = 0;
  for (const p of all) {
    idx += 1;
    const header = `${idx}. ${p.file} line ${p.funcLine} — ${p.func} — ${p.varName}`;
    // Format prompt text as a single JSON string to preserve all characters/newlines
    const asString = JSON.stringify(String(p.text));
    lines.push(header);
    lines.push(asString);
    lines.push('');
  }

  fs.writeFileSync(OUTPUT, lines.join('\n'), 'utf8');
  console.log(`Wrote ${OUTPUT} with ${idx} prompts.`);
}

if (require.main === module) {
  main();
}
