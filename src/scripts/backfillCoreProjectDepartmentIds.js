#!/usr/bin/env node
// Backfill CoreProject.departmentIds from legacy CoreProject.departments (labels/keys)
// Safe, idempotent, and non-destructive. Creates Department docs as needed.

require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!MONGO_URI) {
    console.error('[backfillCoreProjectDepartmentIds] Missing MONGO_URI');
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI, { dbName: process.env.MONGO_DB || undefined });

  const Workspace = require('../models/Workspace');
  const Department = require('../models/Department');
  const CoreProject = require('../models/CoreProject');
  const { normalizeDepartmentKey } = require('../utils/departmentNormalize');

  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const wsIdx = argv.indexOf('--workspace');
  const targetWs = wsIdx !== -1 ? argv[wsIdx + 1] : null;

  const workspaces = targetWs ? await Workspace.find({ _id: targetWs }).lean() : await Workspace.find({}).lean();

  let updatedWs = 0;
  for (const ws of workspaces) {
    const wid = ws._id;
    const scan = await CoreProject.find({ workspace: wid, isDeleted: false }).select('_id departments departmentIds').lean();
    let createdDepartments = 0;
    let updatedProjects = 0;

    // Index Department names by normalized key for fast lookup
    const existingDeptDocs = await Department.find({ workspace: wid }).select('_id name').lean();
    const deptByNorm = new Map();
    existingDeptDocs.forEach(d => { deptByNorm.set(normalizeDepartmentKey(d.name || ''), d); });

    for (const p of scan) {
      // Skip projects that already have departmentIds
      if (Array.isArray(p.departmentIds) && p.departmentIds.length) continue;
      const labels = Array.isArray(p.departments) ? p.departments : [];
      if (labels.length === 0) continue;
      const ids = [];
      for (const nameRaw of labels) {
        const name = String(nameRaw || '').trim();
        if (!name) continue;
        const key = normalizeDepartmentKey(name);
        let doc = deptByNorm.get(key);
        if (!doc && !dryRun) {
          const created = await Department.create({ workspace: wid, user: ws.user, name });
          doc = created.toObject();
          deptByNorm.set(key, doc);
          createdDepartments += 1;
        }
        if (doc) ids.push(doc._id);
      }
      if (ids.length) {
        if (!dryRun) {
          await CoreProject.updateOne({ _id: p._id }, { $set: { departmentIds: ids } });
        }
        updatedProjects += 1;
      }
    }

    updatedWs += 1;
    console.log(`[core-backfill] Workspace ${wid}: scanned=${scan.length}, updatedProjects=${updatedProjects}, createdDepartments=${createdDepartments}`);
  }

  await mongoose.disconnect();
  console.log(`[core-backfill] Done. Processed ${updatedWs} workspace(s).`);
}

main().catch((e) => { console.error(e); process.exit(1); });

