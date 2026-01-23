/**
 * Verify Hal's data is safe - check exactly what the frontend will receive
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
    await mongoose.disconnect();
    return;
  }

  console.log(`Workspace: ${workspace.name} (${workspace._id})\n`);

  // Find the onboarding for this workspace
  const onboarding = await db.collection('onboardings').findOne({ workspace: workspace._id });
  if (!onboarding) {
    console.log('❌ NO ONBOARDING FOUND - DATA WOULD BE LOST!');
    await mongoose.disconnect();
    return;
  }

  const answers = onboarding.answers || {};

  console.log('=== CHECKING ONBOARDING.ANSWERS (what frontend reads) ===\n');

  // Check each critical field
  const checks = [
    { name: 'UBP', value: answers.ubp },
    { name: 'Purpose', value: answers.purpose },
    { name: 'BHAG (visionBhag)', value: answers.visionBhag },
    { name: 'Vision 1Y', value: answers.vision1y },
    { name: 'Vision 3Y', value: answers.vision3y },
    { name: 'Values Core', value: answers.valuesCore },
    { name: 'Culture Feeling', value: answers.cultureFeeling },
    { name: 'SWOT Strengths', value: answers.swotStrengths },
    { name: 'SWOT Weaknesses', value: answers.swotWeaknesses },
    { name: 'SWOT Opportunities', value: answers.swotOpportunities },
    { name: 'SWOT Threats', value: answers.swotThreats },
  ];

  let allSafe = true;
  checks.forEach(({ name, value }) => {
    const hasValue = value && String(value).trim().length > 0;
    const status = hasValue ? '✅' : '⚠️ EMPTY';
    const preview = hasValue ? `"${String(value).substring(0, 60)}${String(value).length > 60 ? '...' : ''}"` : '(no data)';
    console.log(`${status} ${name}: ${preview}`);
    if (!hasValue && name !== 'Culture Feeling') {
      // Culture feeling might legitimately be empty
    }
  });

  // Now check what SwotEntry collection has (since SWOT is read from collection)
  console.log('\n=== CHECKING SWOTENTRY COLLECTION (what frontend ACTUALLY reads for SWOT) ===\n');

  const swotEntries = await db.collection('swotentries').find({
    workspace: workspace._id,
    isDeleted: { $ne: true }
  }).toArray();

  if (swotEntries.length === 0) {
    console.log('❌ NO SWOT ENTRIES IN COLLECTION!');
    console.log('   Frontend calls SwotSvc.getSwotAsStrings() which reads from SwotEntry collection.');
    console.log('   If collection is empty, Hal will NOT see his SWOT data!');
    allSafe = false;
  } else {
    console.log(`✅ Found ${swotEntries.length} SWOT entries in collection:`);
    const byType = {};
    swotEntries.forEach(e => {
      byType[e.entryType] = (byType[e.entryType] || 0) + 1;
    });
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`   - ${type}: ${count}`);
    });
  }

  // Check Products collection
  console.log('\n=== CHECKING PRODUCTS COLLECTION ===\n');
  const products = await db.collection('products').find({
    workspace: workspace._id,
    isDeleted: { $ne: true }
  }).toArray();
  console.log(`Found ${products.length} products in collection`);

  // Check Competitors collection
  console.log('\n=== CHECKING COMPETITORS COLLECTION ===\n');
  const competitors = await db.collection('competitors').find({
    workspace: workspace._id,
    isDeleted: { $ne: true }
  }).toArray();
  console.log(`Found ${competitors.length} competitors in collection`);

  // Check CoreProjects collection
  console.log('\n=== CHECKING COREPROJECTS COLLECTION ===\n');
  const coreProjects = await db.collection('coreprojects').find({
    workspace: workspace._id,
    isDeleted: { $ne: true }
  }).toArray();
  console.log(`Found ${coreProjects.length} core projects in collection`);

  // Check DepartmentProjects collection
  console.log('\n=== CHECKING DEPARTMENTPROJECTS COLLECTION ===\n');
  const deptProjects = await db.collection('departmentprojects').find({
    workspace: workspace._id,
    isDeleted: { $ne: true }
  }).toArray();
  console.log(`Found ${deptProjects.length} department projects in collection`);

  // Final summary
  console.log('\n========================================');
  console.log('SUMMARY FOR HAL (WMS FINANCIAL)');
  console.log('========================================\n');

  console.log('Data read from onboarding.answers:');
  console.log(`  UBP: ${answers.ubp ? '✅ HAS DATA' : '❌ MISSING'}`);
  console.log(`  Purpose: ${answers.purpose ? '✅ HAS DATA' : '❌ MISSING'}`);
  console.log(`  BHAG: ${answers.visionBhag ? '✅ HAS DATA' : '❌ MISSING'}`);
  console.log(`  Vision 1Y: ${answers.vision1y ? '✅ HAS DATA' : '❌ MISSING'}`);
  console.log(`  Vision 3Y: ${answers.vision3y ? '✅ HAS DATA' : '❌ MISSING'}`);
  console.log(`  Values: ${answers.valuesCore ? '✅ HAS DATA' : '❌ MISSING'}`);

  console.log('\nData read from individual collections:');
  console.log(`  SWOT: ${swotEntries.length > 0 ? '✅ ' + swotEntries.length + ' entries' : '❌ MISSING'}`);
  console.log(`  Products: ${products.length > 0 ? '✅ ' + products.length + ' items' : '⚠️ None (may be intentional)'}`);
  console.log(`  Competitors: ${competitors.length > 0 ? '✅ ' + competitors.length + ' items' : '⚠️ None (may be intentional)'}`);
  console.log(`  Core Projects: ${coreProjects.length > 0 ? '✅ ' + coreProjects.length + ' items' : '⚠️ None (may be intentional)'}`);
  console.log(`  Dept Projects: ${deptProjects.length > 0 ? '✅ ' + deptProjects.length + ' items' : '⚠️ None (may be intentional)'}`);

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
