/**
 * Sanitize outer quotes in saved text fields
 *
 * Usage:
 *   MONGO_URI=... node src/scripts/sanitizeQuotes.js --workspace <id> [--dry-run]
 */

const mongoose = require('mongoose');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const CoreProject = require('../models/CoreProject');
const DepartmentProject = require('../models/DepartmentProject');

function stripOuterQuotes(s) {
  if (s == null) return s;
  const t = String(s).trim();
  return t.replace(/^["'“‘`]+/, '').replace(/["'”’`]+$/, '');
}

async function run() {
  const argv = yargs(hideBin(process.argv)).option('workspace', { type: 'string' }).option('dry-run', { type: 'boolean' }).argv;
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGO_URI is required');
    process.exit(1);
  }
  await mongoose.connect(uri);
  const ws = argv.workspace || null;
  const filter = { isDeleted: { $ne: true } };
  if (ws) filter.workspace = ws;

  let updates = 0;

  // Core projects
  const cores = await CoreProject.find(filter);
  for (const p of cores) {
    let changed = false;
    if (p.goal) { const v = stripOuterQuotes(p.goal); if (v !== p.goal) { p.goal = v; changed = true; } }
    if (Array.isArray(p.deliverables)) {
      p.deliverables.forEach((d) => {
        if (d && d.kpi) {
          const v = stripOuterQuotes(d.kpi);
          if (v !== d.kpi) { d.kpi = v; changed = true; }
        }
      });
    }
    if (changed && !argv['dry-run']) { await p.save(); updates++; }
  }

  // Department projects
  const depts = await DepartmentProject.find(filter);
  for (const p of depts) {
    let changed = false;
    if (p.goal) { const v = stripOuterQuotes(p.goal); if (v !== p.goal) { p.goal = v; changed = true; } }
    if (p.milestone) { const v = stripOuterQuotes(p.milestone); if (v !== p.milestone) { p.milestone = v; changed = true; } }
    if (p.resources) { const v = stripOuterQuotes(p.resources); if (v !== p.resources) { p.resources = v; changed = true; } }
    if (Array.isArray(p.deliverables)) {
      p.deliverables.forEach((d) => {
        if (d && d.kpi) {
          const v = stripOuterQuotes(d.kpi);
          if (v !== d.kpi) { d.kpi = v; changed = true; }
        }
      });
    }
    if (changed && !argv['dry-run']) { await p.save(); updates++; }
  }

  console.log(`Sanitize complete. Updated documents: ${updates}`);
  await mongoose.disconnect();
}

run().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});

