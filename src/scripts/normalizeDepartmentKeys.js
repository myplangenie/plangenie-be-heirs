#!/usr/bin/env node
// Normalize department keys across a workspace so projects/OKRs reuse existing department buckets
// Usage: MONGO_URI=... node src/scripts/normalizeDepartmentKeys.js [--workspace <id>] [--dry-run]

require('dotenv').config();
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const CoreProject = require('../models/CoreProject');
const DepartmentProject = require('../models/DepartmentProject');
const OKR = require('../models/OKR');
const { normalizeDepartmentKey } = require('../utils/departmentNormalize');

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

  const wsQuery = onlyWid ? { _id: onlyWid } : {};
  const workspaces = await Workspace.find(wsQuery).select('_id fields').lean();
  let totalUpdated = 0;
  for (const ws of workspaces) {
    const wid = ws._id;
    const fields = ws.fields instanceof Map ? Object.fromEntries(ws.fields) : (ws.fields || {});
    const editable = Array.isArray(fields.editableDepts) ? fields.editableDepts : [];
    // Build candidate display names (prefer editableDepts)
    const candidateNames = new Set(
      editable.map((d) => (typeof d === 'string' ? d : (d?.label || d?.key || '')))
    );
    // Add observed keys
    const deptKeys = await DepartmentProject.distinct('departmentKey', { workspace: wid, isDeleted: false });
    deptKeys.forEach((k) => candidateNames.add(String(k || '')));
    const coreDeptSets = await CoreProject.find({ workspace: wid, isDeleted: false }).select('departments').lean();
    coreDeptSets.forEach((p) => (p.departments || []).forEach((k) => candidateNames.add(String(k || ''))));

    // Map normalized -> canonical display
    const canonical = {};
    for (const name of candidateNames) {
      const nk = normalizeDepartmentKey(String(name || ''));
      if (!nk) continue;
      if (!canonical[nk]) canonical[nk] = String(name);
      // If editableDepts contains a label for the same normalized key, prefer that label
    }
    // Second pass: ensure editableDepts labels win
    for (const e of editable) {
      const name = typeof e === 'string' ? e : (e?.label || e?.key || '');
      const nk = normalizeDepartmentKey(String(name || ''));
      if (nk) canonical[nk] = String(name);
    }

    // Update DepartmentProjects
    const deptProjects = await DepartmentProject.find({ workspace: wid, isDeleted: false }).select('_id departmentKey').lean();
    for (const p of deptProjects) {
      const nk = normalizeDepartmentKey(String(p.departmentKey || ''));
      const target = canonical[nk] || p.departmentKey;
      if (target && target !== p.departmentKey) {
        if (!dryRun) {
          await DepartmentProject.updateOne({ _id: p._id }, { $set: { departmentKey: target } });
        }
        totalUpdated += 1;
      }
    }

    // Update CoreProjects
    const coreProjects = await CoreProject.find({ workspace: wid, isDeleted: false }).select('_id departments').lean();
    for (const p of coreProjects) {
      const depts = Array.isArray(p.departments) ? p.departments : [];
      const mapped = depts.map((d) => {
        const nk = normalizeDepartmentKey(String(d || ''));
        return canonical[nk] || d;
      });
      if (JSON.stringify(mapped) !== JSON.stringify(depts)) {
        if (!dryRun) {
          await CoreProject.updateOne({ _id: p._id }, { $set: { departments: mapped } });
        }
        totalUpdated += 1;
      }
    }

    // Update Department OKRs
    const deptOkrs = await OKR.find({ workspace: wid, okrType: 'department', isDeleted: { $ne: true } }).select('_id departmentKey').lean();
    for (const o of deptOkrs) {
      const nk = normalizeDepartmentKey(String(o.departmentKey || ''));
      const target = canonical[nk] || o.departmentKey;
      if (target && target !== o.departmentKey) {
        if (!dryRun) {
          await OKR.updateOne({ _id: o._id }, { $set: { departmentKey: target } });
        }
        totalUpdated += 1;
      }
    }
  }

  console.log(`${dryRun ? '[DRY RUN] ' : ''}Updated records: ${totalUpdated}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

