/**
 * Smoke-check collaborator access filtering for Overview priorities and restrictions.
 *
 * Usage:
 *   node src/scripts/smokeAccess.js --owner <ownerUserId> --wid <workspaceWid> \
 *       [--viewer <viewerUserId>] [--type admin|limited] [--depts marketing,sales]
 *
 * This script calls workspace.controller.getDecisionStrip and collab.controller.myRestrictions
 * with a simulated view-as context to verify:
 *  - Admin: contextual priorities include owned items or items in allowed departments
 *  - Contributor: priorities restricted to assigned items; restricted pages include financial-clarity and plan
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const User = require('../models/User');
const workspaceCtrl = require('../controllers/workspace.controller');
const collabCtrl = require('../controllers/collab.controller');

function parseArgs() {
  const out = { type: 'limited', depts: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    const v = a[i+1];
    if (k === '--owner') out.owner = v, i++;
    else if (k === '--wid') out.wid = v, i++;
    else if (k === '--viewer') out.viewer = v, i++;
    else if (k === '--type') out.type = v, i++;
    else if (k === '--depts') out.depts = (v || '').split(',').map(s => s.trim()).filter(Boolean), i++;
  }
  return out;
}

function mockRes() {
  return {
    json(payload) { this.payload = payload; },
    status(code) { this.statusCode = code; return this; },
  };
}

async function main() {
  const { owner, wid, viewer, type, depts } = parseArgs();
  if (!wid) {
    console.error('Usage: node src/scripts/smokeAccess.js --wid <wid> [--owner <ownerId>] [--viewer <viewerId>] [--type admin|limited] [--depts marketing,sales]');
    process.exit(1);
  }
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) { console.error('Missing MONGO_URI/MONGODB_URI'); process.exit(1); }
  await mongoose.connect(uri, { maxPoolSize: 5 });

  // Find workspace by wid and infer owner if not provided
  const ws = await Workspace.findOne({ wid }).select('_id wid user').lean();
  if (!ws) { console.error('Workspace not found for wid'); process.exit(1); }
  const ownerId = owner || String(ws.user);

  // Prepare simulated req with view-as context: impersonate owner but include viewer details
  const req = {
    user: {
      id: String(ownerId),
      viewerId: viewer ? String(viewer) : String(ownerId),
      viewOnly: true,
      accessType: type === 'admin' ? 'admin' : 'limited',
      allowedDepartments: Array.isArray(depts) ? depts : [],
    },
    params: { wid },
    query: {},
  };
  const res = mockRes();

  await workspaceCtrl.getDecisionStrip(req, res, (e)=>{ if (e) console.error(e); });
  const ds = res.payload?.decisionStrip || {};
  const title = `DecisionStrip (${type})`;
  console.log(`\n=== ${title} for wid=${wid}, owner=${ownerId} ===`);
  console.log(`weeklyTop3: ${ds.weeklyFocus?.length || 0}, upcoming: ${ds.upcomingItems?.length || 0}`);
  console.log((ds.weeklyFocus || []).slice(0,3).map(i => ({ title: i.title, owner: i.owner, dept: i?.source?.department, due: i.dueWhen })).slice(0,3));

  // myRestrictions for the viewer
  const reqR = { user: { id: req.user.viewerId }, query: { ownerId } };
  const resR = mockRes();
  await collabCtrl.myRestrictions(reqR, resR, ()=>{});
  console.log('\n=== Restrictions (simulated) ===');
  console.log(resR.payload || resR);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('Smoke access failed:', e);
  process.exit(1);
});
