#!/usr/bin/env node
// Migrate department references from string keys to Department._id across all workspaces

require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

async function main() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!MONGO_URI) {
    console.error('[migrateDepartmentIds] Missing MONGO_URI');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI, { dbName: process.env.MONGO_DB || undefined });

  const Workspace = require('../models/Workspace');
  const Department = require('../models/Department');
  const DepartmentProject = require('../models/DepartmentProject');
  const OKR = require('../models/OKR');
  const CoreProject = require('../models/CoreProject');
  const { getWorkspaceFields, updateWorkspaceFields } = require('../services/workspaceFieldService');
  const { normalizeDepartmentKey } = require('../utils/departmentNormalize');

  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const wsIdx = argv.indexOf('--workspace');
  const targetWs = wsIdx !== -1 ? argv[wsIdx + 1] : null;

  const workspaces = targetWs ? await Workspace.find({ _id: targetWs }).lean() : await Workspace.find({}).lean();
  let updatedWorkspaces = 0;

  for (const ws of workspaces) {
    const wid = ws._id;
    const fields = await getWorkspaceFields(wid);
    const actionSections = Array.isArray(fields.actionSections) ? fields.actionSections : [];
    const labelByKey = new Map();
    for (const s of actionSections) {
      const k = normalizeDepartmentKey(String((s && s.key) || (s && s.label) || ''));
      if (!k) continue;
      const label = String((s && s.label) || '').trim() || titleize(k);
      labelByKey.set(k, label);
    }

    const projects = await DepartmentProject.find({ workspace: wid, isDeleted: false }).select('_id departmentKey departmentId').lean();
    const okrs = await OKR.find({ workspace: wid, okrType: 'department', isDeleted: false }).select('_id departmentKey departmentId').lean();
    const core = await CoreProject.find({ workspace: wid, isDeleted: false }).select('_id departments departmentIds').lean();

    // Build union of department designators
    const keys = new Set();
    projects.forEach(p => p.departmentKey && keys.add(normalizeDepartmentKey(p.departmentKey)));
    okrs.forEach(o => o.departmentKey && keys.add(normalizeDepartmentKey(o.departmentKey)));
    (core||[]).forEach(c => (Array.isArray(c.departments) ? c.departments : []).forEach(k=> k && keys.add(normalizeDepartmentKey(k))));
    // Seed from actionSections keys too
    for (const k of Array.from(labelByKey.keys())) keys.add(k);

    const ops = [];
    const deptByKey = new Map();
    for (const key of keys) {
      const name = labelByKey.get(key) || titleize(key);
      let dept = await Department.findOne({ workspace: wid, name }).lean();
      if (!dept && !dryRun) {
        dept = (await Department.create({ workspace: wid, user: ws.user, name })).toObject();
      }
      if (dept) deptByKey.set(key, dept._id);
    }

    // Update DepartmentProjects
    for (const p of projects) {
      if (p.departmentId) continue;
      const key = normalizeDepartmentKey(p.departmentKey || '');
      const id = deptByKey.get(key);
      if (id) {
        if (!dryRun) await DepartmentProject.updateOne({ _id: p._id }, { $set: { departmentId: id } });
      }
    }

    // Update OKRs
    for (const o of okrs) {
      if (o.departmentId) continue;
      const key = normalizeDepartmentKey(o.departmentKey || '');
      const id = deptByKey.get(key);
      if (id) {
        if (!dryRun) await OKR.updateOne({ _id: o._id }, { $set: { departmentId: id } });
      }
    }

    // Update Core Projects (departmentIds mirror)
    for (const c of core) {
      if (Array.isArray(c.departmentIds) && c.departmentIds.length) continue;
      const base = Array.isArray(c.departments) ? c.departments : [];
      const ids = [];
      for (const k of base) { const id = deptByKey.get(normalizeDepartmentKey(k||'')); if (id) ids.push(id); }
      if (ids.length) { if (!dryRun) await CoreProject.updateOne({ _id: c._id }, { $set: { departmentIds: ids } }); }
    }

    // Ensure actionSections includes all Department documents (label = Department.name)
    try {
      const depts = await Department.find({ workspace: wid }).select('name').lean();
      const merged = mergeActionSections(actionSections, depts.map(d => ({ key: normalizeDepartmentKey(d.name), label: d.name })));
      if (!dryRun) await updateWorkspaceFields(wid, { actionSections: merged });
    } catch {}

    updatedWorkspaces += 1;
    console.log(`[migrate] Workspace ${wid}: projects=${projects.length}, okrs=${okrs.length}, core=${core.length}, depts=${keys.size}`);
  }

  await mongoose.disconnect();
  console.log(`[migrate] Done. Updated ${updatedWorkspaces} workspace(s).`);

  function titleize(s='') {
    const spaced = String(s).replace(/[-_]+/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2');
    return spaced.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  function mergeActionSections(existing, toAdd) {
    const map = new Map();
    (Array.isArray(existing) ? existing : []).forEach(s => {
      const k = normalizeDepartmentKey(String((s && s.key) || (s && s.label) || ''));
      if (!k) return;
      const lbl = String((s && s.label) || '').trim() || titleize(k);
      map.set(k, { key: k, label: lbl });
    });
    (Array.isArray(toAdd) ? toAdd : []).forEach(s => {
      const k = normalizeDepartmentKey(String((s && s.key) || (s && s.label) || ''));
      if (!k) return;
      const lbl = String((s && s.label) || '').trim() || titleize(k);
      map.set(k, { key: k, label: lbl });
    });
    return Array.from(map.values());
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
