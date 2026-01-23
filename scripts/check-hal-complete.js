/**
 * Check Hal's complete data in onboarding.answers vs collections
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

async function main() {
  console.log('Connecting to database...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected!\n');

  const db = mongoose.connection.db;

  // Find WMS Financial workspace
  const workspace = await db.collection('workspaces').findOne({ name: /WMS/i });
  if (!workspace) {
    console.log('WMS Financial workspace not found');
    return;
  }

  console.log(`Workspace: ${workspace.name} (${workspace._id})\n`);

  // Find the onboarding for this workspace
  const onboarding = await db.collection('onboardings').findOne({ workspace: workspace._id });
  if (!onboarding) {
    console.log('No onboarding found for this workspace');
    return;
  }

  const answers = onboarding.answers || {};

  console.log('=== DATA IN ONBOARDING.ANSWERS ===\n');

  // Products
  const products = answers.products || [];
  console.log(`Products: ${products.length} items`);
  products.forEach((p, i) => {
    console.log(`  [${i}] ${p.name || p.product || p.title || '(no name)'}`);
  });

  // Core Projects
  const coreProjectDetails = answers.coreProjectDetails || [];
  console.log(`\nCore Projects: ${coreProjectDetails.length} items`);
  coreProjectDetails.forEach((cp, i) => {
    console.log(`  [${i}] ${cp.title || '(no title)'}`);
  });

  // Department Projects
  const actionAssignments = answers.actionAssignments || {};
  let deptCount = 0;
  Object.entries(actionAssignments).forEach(([dept, projects]) => {
    if (Array.isArray(projects)) {
      deptCount += projects.length;
    }
  });
  console.log(`\nDepartment Projects: ${deptCount} items`);
  Object.entries(actionAssignments).forEach(([dept, projects]) => {
    if (Array.isArray(projects) && projects.length > 0) {
      console.log(`  ${dept}:`);
      projects.forEach((p, i) => {
        console.log(`    [${i}] ${p.title || p.goal || '(no title)'}`);
      });
    }
  });

  // Competitors
  const competitorNames = answers.competitorNames || [];
  console.log(`\nCompetitors: ${competitorNames.length} items`);
  competitorNames.forEach((c, i) => {
    console.log(`  [${i}] ${c}`);
  });

  // Org Positions
  const orgPositions = answers.orgPositions || [];
  console.log(`\nOrg Positions: ${orgPositions.length} items`);
  orgPositions.forEach((p, i) => {
    console.log(`  [${i}] ${p.name || p.position || '(no name)'}`);
  });

  // SWOT
  const swotS = (answers.swotStrengths || '').split('\n').filter(Boolean);
  const swotW = (answers.swotWeaknesses || '').split('\n').filter(Boolean);
  const swotO = (answers.swotOpportunities || '').split('\n').filter(Boolean);
  const swotT = (answers.swotThreats || '').split('\n').filter(Boolean);
  console.log(`\nSWOT in answers: S=${swotS.length}, W=${swotW.length}, O=${swotO.length}, T=${swotT.length}`);

  // Vision Goals
  const vision1y = (answers.vision1y || '').split('\n').filter(Boolean);
  const vision3y = (answers.vision3y || '').split('\n').filter(Boolean);
  console.log(`Vision Goals in answers: 1y=${vision1y.length}, 3y=${vision3y.length}`);

  // UBP and Purpose (these stay in onboarding.answers)
  console.log('\n=== WORKSPACE FIELDS (stay in onboarding.answers) ===\n');
  console.log(`UBP: ${answers.ubp ? 'SET' : 'NOT SET'}`);
  console.log(`Purpose: ${answers.purpose ? 'SET' : 'NOT SET'}`);
  console.log(`BHAG: ${answers.visionBhag ? 'SET' : 'NOT SET'}`);
  console.log(`Values Core: ${answers.valuesCore ? 'SET' : 'NOT SET'}`);

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
