#!/usr/bin/env node
// Verifies canonical department registry upsert and cleanup

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

async function main() {
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
  if (!MONGO_URI) {
    console.error('[verifyActionSections] Missing MONGO_URI in env');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI, { dbName: process.env.MONGO_DB || undefined });

  const Workspace = require('../src/models/Workspace');
  const { getWorkspaceFields, ensureActionSections, updateWorkspaceFields } = require('../src/services/workspaceFieldService');

  // Allow explicit workspace override via CLI: --workspace <id>
  const argIdx = process.argv.findIndex((a) => a === '--workspace');
  let ws = null;
  if (argIdx !== -1 && process.argv[argIdx + 1]) {
    const widArg = process.argv[argIdx + 1];
    ws = await Workspace.findById(widArg).lean();
  }
  // Fallback: pick most recently updated default workspace
  if (!ws) ws = await Workspace.findOne({ defaultWorkspace: true }).sort({ updatedAt: -1 }).lean();
  if (!ws) {
    console.error('[verifyActionSections] No default workspace found');
    process.exit(1);
  }
  const wid = ws._id.toString();
  const label = 'QA Verify Department';
  const key = 'qaVerifyDept';

  // Snapshot current actionSections
  const before = await getWorkspaceFields(wid);
  const beforeSections = Array.isArray(before.actionSections) ? before.actionSections : [];

  // Upsert test department
  await ensureActionSections(wid, [label]);

  const after = await getWorkspaceFields(wid);
  const afterSections = Array.isArray(after.actionSections) ? after.actionSections : [];
  const found = afterSections.find((s) => String(s?.key || '') === key || String(s?.label || '') === label);
  console.log(JSON.stringify({ workspaceId: wid, upserted: Boolean(found), countBefore: beforeSections.length, countAfter: afterSections.length }, null, 2));

  // Cleanup: remove the test entry to keep data tidy
  const cleaned = afterSections.filter((s) => String(s?.key || '') !== key && String(s?.label || '') !== label);
  await updateWorkspaceFields(wid, { actionSections: cleaned });

  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
