/**
 * Reset/Repair OrgPosition Hierarchy per Workspace
 *
 * - Validates parentId references (same workspace, not self, acyclic)
 * - Optionally detaches invalid/looping parents
 * - Optionally re-attaches members to a department head (picked by title scoring)
 * - Re-sequences `order` to a compact 0..N-1 range
 * - Does NOT delete positions
 * - Does NOT overwrite Department.owner if already set
 *
 * Usage:
 *   MONGO_URI=... node src/scripts/resetOrgHierarchy.js [--workspace <ObjectId>|--wid <wid>] [--dry-run] [--attach]
 *
 * Flags:
 *   --workspace <id>  Repair a single workspace by ObjectId
 *   --wid <wid>       Repair a single workspace by `wid`
 *   --dry-run         Log planned changes without writing
 *   --attach          After detaching bad parents, attach to department head for that department
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const OrgPosition = require('../models/OrgPosition');
const Department = require('../models/Department');
const { ensureActionSections } = require('../services/workspaceFieldService');
const { normalizeDepartmentKey } = require('../utils/departmentNormalize');

function parseArgs() {
  const out = { dryRun: false, attach: false };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--workspace') out.workspace = a[++i];
    else if (a[i] === '--wid') out.wid = a[++i];
    else if (a[i] === '--dry-run') out.dryRun = true;
    else if (a[i] === '--attach') out.attach = true;
  }
  return out;
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

async function repairWorkspace(ws, { dryRun = false, attach = false } = {}) {
  const wsId = ws._id;
  const userId = ws.user;
  const positions = await OrgPosition.find({ workspace: wsId, isDeleted: false }).lean();
  if (positions.length === 0) return { detached: 0, attached: 0, reordered: 0, cyclesFixed: 0 };

  const byId = new Map(positions.map(p => [String(p._id), p]));

  // Validate parent references
  let detached = 0, attached = 0, cyclesFixed = 0;
  const updates = [];

  // Detect cycles via DFS
  const state = new Map(); // id -> 0 unvisited, 1 visiting, 2 done
  function hasCycleFrom(id) {
    const st = state.get(id) || 0;
    if (st === 1) return true; // back-edge
    if (st === 2) return false;
    state.set(id, 1);
    const node = byId.get(id);
    const pid = node && node.parentId ? String(node.parentId) : null;
    if (pid && byId.has(pid) && hasCycleFrom(pid)) return true;
    state.set(id, 2);
    return false;
  }

  // First, detach invalid parent references (missing, wrong ws, self)
  positions.forEach((p) => {
    const id = String(p._id);
    const pid = p.parentId ? String(p.parentId) : null;
    let needsDetach = false;
    if (pid) {
      const par = byId.get(pid);
      if (!par) needsDetach = true; // missing
      else if (String(par.workspace) !== String(wsId)) needsDetach = true; // wrong workspace
      else if (pid === id) needsDetach = true; // self-parent
    }
    if (needsDetach) {
      detached++;
      if (!dryRun) updates.push(OrgPosition.updateOne({ _id: id }, { $set: { parentId: null } }));
      // reflect in local map for downstream ops
      const local = byId.get(id);
      if (local) local.parentId = null;
    }
  });

  // Then, break cycles by detaching the child link
  for (const p of positions) {
    const id = String(p._id);
    if (hasCycleFrom(id)) {
      // Break by detaching parent of this node
      cyclesFixed++;
      if (!dryRun) updates.push(OrgPosition.updateOne({ _id: id }, { $set: { parentId: null } }));
      const local = byId.get(id);
      if (local) local.parentId = null;
    }
  }

  // Attach to department heads if requested
  if (attach) {
    // Group by normalized department key
    const groups = new Map(); // key -> { headId, head, items: [] }
    positions.forEach((p) => {
      const key = normalizeDepartmentKey(p.department || '');
      const arr = groups.get(key) || [];
      arr.push(p);
      groups.set(key, arr);
    });

    for (const [key, items] of groups.entries()) {
      if (!items || items.length === 0) continue;
      // Pick head: prefer top-of-dept (parent outside same dept), score by title
      const canon = (s='') => String(normalizeDepartmentKey(s)).trim().toLowerCase();
      const itemsById = new Map(items.map(p => [String(p._id), p]));
      const topOfDept = items.filter(p => {
        const pid = p.parentId ? String(p.parentId) : null;
        if (!pid) return true;
        const parent = itemsById.get(pid);
        if (!parent) return true; // parent not in same dept
        return canon(parent.department || '') !== canon(key);
      });
      const pool = topOfDept.length ? topOfDept : items;
      const head = pool.sort((a,b) => scoreTitle(b.position)-scoreTitle(a.position))[0] || items[0];
      const headId = String(head._id);

      // Ensure department record exists and owner is set (only if empty)
      const label = String(head.department || key || '').trim() || 'General';
      try {
        const existing = await Department.findOne({ workspace: wsId, name: label }).lean();
        if (!existing) {
          if (!dryRun) await Department.create({ user: userId, workspace: wsId, name: label, owner: head.name || head.holderName || '' });
        } else if (!existing.owner || !String(existing.owner).trim()) {
          if (!dryRun) await Department.updateOne({ _id: existing._id }, { $set: { owner: head.name || head.holderName || '' } });
        }
        if (!dryRun) await ensureActionSections(wsId, [label]);
      } catch {}

      // Attach all items missing parent within this department to head (excluding head itself)
      for (const p of items) {
        const id = String(p._id);
        if (id === headId) continue;
        const pid = p.parentId ? String(p.parentId) : null;
        // If no parent or parent outside dept, attach to head
        let attachNeeded = false;
        if (!pid) attachNeeded = true;
        else {
          const parent = itemsById.get(pid);
          if (!parent) attachNeeded = true; // parent outside dept group
        }
        if (attachNeeded) {
          attached++;
          if (!dryRun) updates.push(OrgPosition.updateOne({ _id: id }, { $set: { parentId: headId } }));
        }
      }
    }
  }

  // Re-sequence order compactly (by name/title for stability)
  const sorted = Array.from(byId.values()).sort((a, b) => {
    const an = String(a?.name || a?.holderName || a?.position || '').toLowerCase();
    const bn = String(b?.name || b?.holderName || b?.position || '').toLowerCase();
    return an.localeCompare(bn);
  });
  let reordered = 0;
  sorted.forEach((p, idx) => {
    if (p.order !== idx) {
      reordered++;
      if (!dryRun) updates.push(OrgPosition.updateOne({ _id: p._id }, { $set: { order: idx } }));
    }
  });

  if (!dryRun && updates.length) await Promise.all(updates);

  return { detached, attached, reordered, cyclesFixed };
}

async function run() {
  const { workspace, wid, dryRun, attach } = parseArgs();
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) { console.error('Missing MONGO_URI/MONGODB_URI'); process.exit(1); }
  await mongoose.connect(uri, { maxPoolSize: 5 });

  const filter = workspace ? { _id: workspace } : (wid ? { wid } : {});
  const workspaces = await Workspace.find(filter).select('_id wid user fields').lean();
  if (workspaces.length === 0) { console.log('No workspaces matched.'); await mongoose.disconnect(); return; }

  let total = { detached: 0, attached: 0, reordered: 0, cyclesFixed: 0 };
  for (const ws of workspaces) {
    const r = await repairWorkspace(ws, { dryRun, attach });
    total.detached += r.detached;
    total.attached += r.attached;
    total.reordered += r.reordered;
    total.cyclesFixed += r.cyclesFixed;
    console.log(`[resetHierarchy] Workspace ${ws.wid || ws._id}: detached=${r.detached} cyclesFixed=${r.cyclesFixed} attached=${r.attached} reordered=${r.reordered}${dryRun ? ' (dry-run)' : ''}`);
  }

  await mongoose.disconnect();
  console.log(`[resetHierarchy] Done. Workspaces=${workspaces.length}, detached=${total.detached}, cyclesFixed=${total.cyclesFixed}, attached=${total.attached}, reordered=${total.reordered}${dryRun ? ' (dry-run)' : ''}`);
}

run().catch((e) => {
  console.error('[resetHierarchy] Error:', e?.message || e);
  process.exit(1);
});

