/**
 * Backfill Team Members and Departments from Org Positions
 *
 * - Creates/updates TeamMember docs for each OrgPosition (mid = OrgPosition._id)
 * - Upserts Department per workspace with human-friendly name and owner (dept head)
 * - Ensures workspace actionSections contains all departments
 *
 * Usage:
 *   node src/scripts/backfillTeamMembersAndDepartments.js                 # all workspaces
 *   node src/scripts/backfillTeamMembersAndDepartments.js --workspace <id> # single workspace
 *   node src/scripts/backfillTeamMembersAndDepartments.js --dry-run
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const OrgPosition = require('../models/OrgPosition');
const TeamMember = require('../models/TeamMember');
const Department = require('../models/Department');
const User = require('../models/User');
const { ensureActionSections } = require('../services/workspaceFieldService');
const { normalizeDepartmentKey } = require('../utils/departmentNormalize');

function parseArgs() {
  const out = { dryRun: false };
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

function titleizeKey(key = '') {
  const spaced = String(key)
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function bestLabelFor(key, existingLabel) {
  if (existingLabel && existingLabel.trim()) return existingLabel.trim();
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  return titleizeKey(key);
}

function scoreTitle(title = '') {
  const t = String(title || '').toLowerCase();
  if (/\bchief\b|\bvp\b|vice president/.test(t)) return 5;
  if (/head of|\bhead\b/.test(t)) return 4;
  if (/director/.test(t)) return 3;
  if (/lead/.test(t)) return 2;
  if (/manager/.test(t)) return 1;
  return 0;
}

async function backfillOneWorkspace(ws, { dryRun = false } = {}) {
  const wsId = ws._id;
  const userId = ws.user;

  // Read org positions (active)
  const positions = await OrgPosition.find({ workspace: wsId, isDeleted: false }).lean();
  if (!positions.length) return { createdTM: 0, updatedTM: 0, depts: 0 };

  // Map parent pointers
  const byId = new Map(positions.map((p) => [String(p._id), p]));

  // Group positions by normalized department key
  const groups = new Map(); // key -> { key, label?, items: [] }
  // Try to use existing actionSections labels if available
  const fields = ws.fields instanceof Map ? Object.fromEntries(ws.fields) : (ws.fields || {});
  const actionSections = Array.isArray(fields.actionSections) ? fields.actionSections : [];
  const labelByKey = new Map(
    actionSections
      .map((s) => {
        const k = normalizeDepartmentKey(s?.key || s?.label || '');
        const lbl = String(s?.label || '').trim();
        return k ? [k, lbl] : null;
      })
      .filter(Boolean)
  );

  for (const p of positions) {
    const key = normalizeDepartmentKey(p.department || '');
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, label: labelByKey.get(key) || bestLabelFor(key), items: [] });
    groups.get(key).items.push(p);
  }

  let createdTM = 0, updatedTM = 0, upsertedDepts = 0;

  // Upsert TeamMember for each position
  for (const p of positions) {
    const mid = String(p._id);
    const key = normalizeDepartmentKey(p.department || '');
    const label = groups.get(key)?.label || bestLabelFor(key);
    if (dryRun) { createdTM++; continue; }
    const res = await TeamMember.findOneAndUpdate(
      { user: userId, workspace: wsId, mid },
      {
        $set: {
          name: p.name || '',
          email: p.email || '',
          position: p.position || '',
          department: label || '',
          status: 'Active',
        },
        $setOnInsert: { role: 'Viewer' },
      },
      { upsert: true, new: true }
    ).lean();
    if (res) updatedTM++; else createdTM++;
  }

  // Upsert Departments with owner (preserve existing owner) and ensure actionSections
  for (const [key, info] of groups) {
    const items = info.items || [];
    if (!items.length) continue;
    const label = info.label || bestLabelFor(key);

    // Determine owner: top-of-department
    const top = items.filter((p) => {
      const parentId = p.parentId ? String(p.parentId) : null;
      if (!parentId) return true;
      const parent = byId.get(parentId);
      if (!parent) return true;
      return normalizeDepartmentKey(parent.department || '') !== key;
    });
    const pool = top.length ? top : items;
    const sorted = pool.slice().sort((a, b) => scoreTitle(b.position) - scoreTitle(a.position));
    let owner = (sorted[0]?.name || '').trim();
    if (!owner) {
      try {
        const u = await User.findById(userId).lean();
        owner = (u?.fullName || `${u?.firstName || ''} ${u?.lastName || ''}`).trim();
      } catch {}
    }

    if (dryRun) { upsertedDepts++; continue; }

    const existing = await Department.findOne({ workspace: wsId, name: label }).lean();
    if (!existing) {
      // Create new department with computed owner
      await Department.create({ user: userId, workspace: wsId, name: label, owner });
    } else if (!existing.owner || !String(existing.owner).trim()) {
      // Only set owner if not already set
      await Department.updateOne({ _id: existing._id }, { $set: { owner } });
    }
    await ensureActionSections(wsId, [label]);
    upsertedDepts++;
  }

  return { createdTM, updatedTM, depts: upsertedDepts };
}

async function run() {
  const { workspace, dryRun } = parseArgs();
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) { console.error('Missing MONGO_URI/MONGODB_URI'); process.exit(1); }
  await mongoose.connect(uri, { maxPoolSize: 5 });

  const filter = workspace ? { _id: workspace } : {};
  const list = await Workspace.find(filter).select('_id user fields').lean(false);

  let totalTM = 0, totalDepts = 0;
  for (const ws of list) {
    const r = await backfillOneWorkspace(ws, { dryRun });
    console.log(`[backfill] Workspace ${ws.wid || ws._id}: TM updated=${r.updatedTM} created~=${r.createdTM} depts=${r.depts}`);
    totalTM += (r.updatedTM + r.createdTM);
    totalDepts += r.depts;
  }

  await mongoose.disconnect();
  console.log(`[backfill] Done. TeamMembers processed=${totalTM}, Departments upserted=${totalDepts}, workspaces=${list.length}${dryRun ? ' (dry-run)' : ''}`);
}

run().catch((e) => {
  console.error('[backfill] Error:', e?.message || e);
  process.exit(1);
});
