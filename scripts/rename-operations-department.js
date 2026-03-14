#!/usr/bin/env node
/**
 * One-time migration: Consolidate all "Operations" variants → 'Operations'
 *
 * Variants handled:
 *   'Operations and Service Delivery'
 *   'Operations & Service Delivery'
 *   'operations'
 *   'operationsandserviceexcellence'
 *
 * Covers every place the name can appear:
 *   - Department.name
 *   - OrgPosition.department
 *   - OrgPosition.departmentLabel
 *   - OKR.departmentKey
 *   - OKR.departmentLabel
 *   - DepartmentProject.departmentKey
 *   - CoreProject.departments[]
 *
 * Usage:
 *   node scripts/rename-operations-department.js           # live run
 *   node scripts/rename-operations-department.js --dry-run # preview only
 */

require('dotenv').config();
const mongoose = require('mongoose');

const OLD_VALUES = [
  'Operations and Service Delivery',
  'Operations & Service Delivery',
  'operations',
  'operationsandserviceexcellence',
];
const NEW = 'Operations';
const DRY = process.argv.includes('--dry-run');

if (DRY) console.log('DRY RUN — no writes will be made\n');

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (!uri) { console.error('No MongoDB URI found in env'); process.exit(1); }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB\n');

  const db = mongoose.connection.db;
  let totalUpdated = 0;

  // ── helper: scalar field ──────────────────────────────────────────────────
  async function runScalar(collectionName, field, label) {
    const col = db.collection(collectionName);
    const filter = { [field]: { $in: OLD_VALUES } };
    const count = await col.countDocuments(filter);
    console.log(`${collectionName} · ${label}: ${count} doc(s) matched`);
    if (count > 0 && !DRY) {
      const res = await col.updateMany(filter, { $set: { [field]: NEW } });
      console.log(`  → updated ${res.modifiedCount}`);
      totalUpdated += res.modifiedCount;
    }
  }

  // ── helper: array field ───────────────────────────────────────────────────
  async function runArray(collectionName, field, label) {
    const col = db.collection(collectionName);
    const filter = { [field]: { $in: OLD_VALUES } };
    const count = await col.countDocuments(filter);
    console.log(`${collectionName} · ${label}: ${count} doc(s) matched`);
    if (count > 0 && !DRY) {
      const res = await col.updateMany(
        filter,
        { $set: { [`${field}.$[el]`]: NEW } },
        { arrayFilters: [{ el: { $in: OLD_VALUES } }] }
      );
      console.log(`  → updated ${res.modifiedCount}`);
      totalUpdated += res.modifiedCount;
    }
  }

  // ── 1. Department.name ────────────────────────────────────────────────────
  await runScalar('departments', 'name', 'name');

  // ── 2. OrgPosition.department ─────────────────────────────────────────────
  await runScalar('orgpositions', 'department', 'department');

  // ── 3. OrgPosition.departmentLabel ───────────────────────────────────────
  await runScalar('orgpositions', 'departmentLabel', 'departmentLabel');

  // ── 4. OKR.departmentKey ─────────────────────────────────────────────────
  await runScalar('okrs', 'departmentKey', 'departmentKey');

  // ── 5. OKR.departmentLabel ───────────────────────────────────────────────
  await runScalar('okrs', 'departmentLabel', 'departmentLabel');

  // ── 6. DepartmentProject.departmentKey ───────────────────────────────────
  await runScalar('departmentprojects', 'departmentKey', 'departmentKey');

  // ── 7. CoreProject.departments[] ─────────────────────────────────────────
  await runArray('coreprojects', 'departments', 'departments[]');

  console.log('\n──────────────────────────────────────');
  if (DRY) {
    console.log('Dry run complete. Re-run without --dry-run to apply changes.');
  } else {
    console.log(`Done. Total documents modified: ${totalUpdated}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
