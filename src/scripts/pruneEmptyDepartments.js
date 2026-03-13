#!/usr/bin/env node
// Delete Department docs that have no projects linked to them (by id or legacy key)
// Usage:
//   MONGO_URI=... node src/scripts/pruneEmptyDepartments.js [--workspace <id>] [--dry-run] [--prune-sections]
//
// Behavior:
// - A Department is considered "in use" if ANY of the following hold within its workspace:
//     * There exists a DepartmentProject with departmentId = Department._id (and not isDeleted)
//     * There exists a DepartmentProject with departmentKey matching normalizeDepartmentKey(Department.name)
//     * There exists a CoreProject with Department._id present in departmentIds (and not isDeleted)
//     * There exists a CoreProject with normalizeDepartmentKey(Department.name) present in legacy departments[] (and not isDeleted)
// - If none of the above, the Department is deleted.
// - When --prune-sections is set, the script also removes deleted departments from Workspace.fields.actionSections.

require('dotenv').config();
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const Department = require('../models/Department');
const CoreProject = require('../models/CoreProject');
const DepartmentProject = require('../models/DepartmentProject');
const { normalizeDepartmentKey } = require('../utils/departmentNormalize');

async function pruneWorkspace(workspaceId, { dryRun = false, pruneSections = false } = {}) {
  const wid = String(workspaceId);
  const [departments, dpIds, dpKeys, cpIds, cpKeys] = await Promise.all([
    Department.find({ workspace: wid }).select('_id name').lean(),
    // departmentId references from Department Projects
    DepartmentProject.distinct('departmentId', { workspace: wid, isDeleted: false }).catch(() => []),
    // legacy departmentKey values from Department Projects
    DepartmentProject.distinct('departmentKey', { workspace: wid, isDeleted: false }).catch(() => []),
    // id references from Core Projects
    CoreProject.distinct('departmentIds', { workspace: wid, isDeleted: false }).catch(() => []),
    // legacy department labels from Core Projects
    CoreProject.distinct('departments', { workspace: wid, isDeleted: false }).catch(() => []),
  ]);

  const usedIdSet = new Set(
    [...(dpIds || []), ...(cpIds || [])]
      .map((v) => (v ? String(v) : ''))
      .filter(Boolean)
  );
  const usedKeySet = new Set(
    [...(dpKeys || []), ...(cpKeys || [])]
      .map((v) => normalizeDepartmentKey(String(v || '')))
      .filter(Boolean)
  );

  const deletable = [];
  for (const d of departments) {
    const id = String(d._id);
    const key = normalizeDepartmentKey(String(d.name || ''));
    const inUseById = usedIdSet.has(id);
    const inUseByKey = key && usedKeySet.has(key);
    if (!inUseById && !inUseByKey) deletable.push({ _id: d._id, name: d.name || '' });
  }

  if (!deletable.length) {
    console.log(`[${wid}] No empty departments to delete.`);
    return { deleted: 0, prunedSections: 0 };
  }

  console.log(`[${wid}] Deleting ${deletable.length} empty department(s):`);
  deletable.forEach((d) => console.log(`  - ${String(d.name || '')} (${d._id})`));

  if (!dryRun) {
    const ids = deletable.map((d) => d._id);
    await Department.deleteMany({ _id: { $in: ids }, workspace: wid });
  }

  let pruned = 0;
  if (pruneSections) {
    try {
      const ws = await Workspace.findById(wid);
      if (ws) {
        const fields = ws.fields instanceof Map ? ws.fields : new Map(Object.entries(ws.fields || {}));
        const sections = Array.isArray(fields.get('actionSections')) ? fields.get('actionSections') : [];
        const delKeySet = new Set(
          deletable.map((d) => normalizeDepartmentKey(String(d.name || ''))).filter(Boolean)
        );
        const next = sections.filter((s) => !delKeySet.has(normalizeDepartmentKey(String((s && (s.key || s.label)) || ''))));
        if (next.length !== sections.length) {
          pruned = sections.length - next.length;
          if (!dryRun) {
            fields.set('actionSections', next);
            ws.fields = fields;
            ws.markModified('fields');
            await ws.save();
          }
          console.log(`[${wid}] Pruned ${pruned} actionSections entrie(s).`);
        }
      }
    } catch (e) {
      console.warn(`[${wid}] Failed to prune actionSections: ${e?.message || e}`);
    }
  }

  return { deleted: deletable.length, prunedSections: pruned };
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGO_URI/MONGODB_URI');
    process.exit(1);
  }
  await mongoose.connect(uri);

  const args = process.argv.slice(2);
  const widIdx = args.indexOf('--workspace');
  const onlyWid = widIdx >= 0 ? args[widIdx + 1] : null;
  const dryRun = args.includes('--dry-run');
  const pruneSections = args.includes('--prune-sections');

  const wsQuery = onlyWid ? { _id: onlyWid } : {};
  const workspaces = await Workspace.find(wsQuery).select('_id').lean();
  let totalDeleted = 0;
  let totalPruned = 0;
  for (const ws of workspaces) {
    const { deleted, prunedSections } = await pruneWorkspace(ws._id, { dryRun, pruneSections });
    totalDeleted += deleted;
    totalPruned += prunedSections;
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Deleted departments: ${totalDeleted}`);
  if (pruneSections) console.log(`Pruned actionSections entries: ${totalPruned}`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

