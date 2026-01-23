/**
 * Verify live database migration status
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function main() {
  console.log('Connecting to database...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected!\n');

  const db = mongoose.connection.db;

  // Count documents in each collection
  const collections = [
    'visiongoals',
    'swotentries',
    'products',
    'competitors',
    'coreprojects',
    'departmentprojects',
    'orgpositions',
  ];

  console.log('=== LIVE DATABASE DOCUMENT COUNTS ===\n');

  for (const col of collections) {
    try {
      const count = await db.collection(col).countDocuments({ isDeleted: { $ne: true } });
      console.log(`${col}: ${count} documents`);
    } catch (e) {
      console.log(`${col}: ERROR - ${e.message}`);
    }
  }

  // Check WMS Financial specifically
  console.log('\n=== WMS FINANCIAL (Hal McInerney) ===\n');

  const workspaces = await db.collection('workspaces').find({ name: /WMS/i }).toArray();
  if (workspaces.length > 0) {
    const ws = workspaces[0];
    console.log(`Workspace: ${ws.name} (${ws._id})`);

    const wsId = ws._id;

    const visionGoals = await db.collection('visiongoals').countDocuments({
      workspace: wsId,
      isDeleted: { $ne: true }
    });
    const swot = await db.collection('swotentries').countDocuments({
      workspace: wsId,
      isDeleted: { $ne: true }
    });
    const products = await db.collection('products').countDocuments({
      workspace: wsId,
      isDeleted: { $ne: true }
    });
    const coreProjects = await db.collection('coreprojects').countDocuments({
      workspace: wsId,
      isDeleted: { $ne: true }
    });
    const deptProjects = await db.collection('departmentprojects').countDocuments({
      workspace: wsId,
      isDeleted: { $ne: true }
    });

    console.log(`  Vision Goals: ${visionGoals}`);
    console.log(`  SWOT Entries: ${swot}`);
    console.log(`  Products: ${products}`);
    console.log(`  Core Projects: ${coreProjects}`);
    console.log(`  Dept Projects: ${deptProjects}`);

    // List vision goals
    if (visionGoals > 0) {
      console.log('\n  Vision Goals Detail:');
      const goals = await db.collection('visiongoals').find({
        workspace: wsId,
        isDeleted: { $ne: true }
      }).toArray();
      goals.forEach(g => {
        console.log(`    [${g.goalType}] ${g.text.substring(0, 60)}${g.text.length > 60 ? '...' : ''}`);
      });
    }
  } else {
    console.log('WMS Financial workspace not found');
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
