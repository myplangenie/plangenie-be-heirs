/**
 * Migrate Departments to actionSections (workspace.fields)
 *
 * Purpose:
 * - Establish actionSections as the single source of truth for departments
 * - Merge departments from:
 *   - fields.actionSections (existing)
 *   - fields.editableDepts
 *   - DepartmentProject.departmentKey (distinct)
 * - Normalize keys, deduplicate, choose the best label, and write back
 *
 * Usage:
 *   node src/scripts/migrateDepartmentsToActionSections.js --workspace <id> [--dry-run]
 *   node src/scripts/migrateDepartmentsToActionSections.js                 (migrate all)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const DepartmentProject = require('../models/DepartmentProject');
const { normalizeDepartmentKey } = require('../utils/departmentNormalize');

function parseArgs() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--workspace') out.workspace = a[++i];
    else if (a[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

// Friendly labels for well-known keys
const KEY_LABELS = {
  marketing: 'Marketing',
  sales: 'Sales',
  operations: 'Operations and Service Delivery',
  finance: 'Finance and Admin',
  peopleHR: 'People and Human Resources',
  partnerships: 'Partnerships and Alliances',
  technology: 'Technology and Infrastructure',
  sustainability: 'ESG and Sustainability',
};

function titleCaseKey(k) {
  const s = String(k || '').replace(/([A-Z])/g, ' $1').replace(/[\-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function bestLabelFor(key, candidates) {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  for (const c of candidates) {
    if (c && c.trim()) return c.trim();
  }
  return titleCaseKey(key);
}

async function migrateOne(ws, { dryRun = false } = {}) {
  const wid = ws._id.toString();
  const fields = ws.fields instanceof Map ? Object.fromEntries(ws.fields) : (ws.fields || {});
  const actionSections = Array.isArray(fields.actionSections) ? fields.actionSections : [];
  const editableDepts = Array.isArray(fields.editableDepts) ? fields.editableDepts : [];

  // Gather from actionSections
  const map = new Map(); // key -> { key, label }
  const order = [];
  for (const s of actionSections) {
    const key = normalizeDepartmentKey(s?.key || s?.label || s?.name || '');
    if (!key) continue;
    const label = String(s?.label || s?.name || '').trim() || bestLabelFor(key, []);
    if (!map.has(key)) order.push(key);
    map.set(key, { key, label });
  }

  // Gather from editableDepts
  for (const d of editableDepts) {
    const key = normalizeDepartmentKey(typeof d === 'string' ? d : (d?.key || d?.label || ''));
    if (!key) continue;
    const label = typeof d === 'string' ? d : (d?.label || d?.key || '');
    if (!map.has(key)) order.push(key);
    const prev = map.get(key);
    map.set(key, { key, label: prev?.label || bestLabelFor(key, [label]) });
  }

  // Gather from DepartmentProject.departmentKey
  const projectKeys = await DepartmentProject.distinct('departmentKey', { workspace: ws._id, isDeleted: false }).catch(() => []);
  for (const raw of projectKeys || []) {
    const key = normalizeDepartmentKey(raw);
    if (!key) continue;
    if (!map.has(key)) order.push(key);
    const prev = map.get(key);
    map.set(key, { key, label: prev?.label || bestLabelFor(key, []) });
  }

  // If nothing to do
  if (order.length === (actionSections?.length || 0) && order.every((k, i) => actionSections[i]?.key === k)) {
    console.log(`[migrate] Workspace ${wid}: no change`);
    return false;
  }

  const merged = order.map((k) => map.get(k)).filter(Boolean);
  console.log(`[migrate] Workspace ${wid}: ${actionSections.length} -> ${merged.length} departments`);
  if (dryRun) {
    console.log(`[migrate] DRY RUN. Example output:`, merged.slice(0, 10));
    return false;
  }

  // Write back
  if (!ws.fields) ws.fields = new Map();
  if (ws.fields instanceof Map) {
    ws.fields.set('actionSections', merged);
    ws.fields.set('deptsConfirmed', true);
  } else {
    ws.fields = Object.assign({}, fields, { actionSections: merged, deptsConfirmed: true });
  }
  ws.markModified('fields');
  await ws.save();
  return true;
}

async function run() {
  const { workspace, dryRun } = parseArgs();
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGO_URI/MONGODB_URI');
    process.exit(1);
  }
  await mongoose.connect(uri, { maxPoolSize: 5 });
  const filter = workspace ? { _id: workspace } : {};
  const list = await Workspace.find(filter).select('_id fields').lean(false);
  let changed = 0;
  for (const ws of list) {
    const did = await migrateOne(ws, { dryRun });
    if (did) changed++;
  }
  await mongoose.disconnect();
  console.log(`[migrate] Done. Updated ${changed} of ${list.length} workspaces.`);
}

run().catch((e) => {
  console.error('[migrate] Error:', e?.message || e);
  process.exit(1);
});

