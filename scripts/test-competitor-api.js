/**
 * Test script to check what the Competitor API returns
 *
 * Run with: node scripts/test-competitor-api.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');

const Competitor = require('../src/models/Competitor');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/plangenie';

async function main() {
  try {
    console.log('[Test] Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('[Test] Connected\n');

    // Get a workspace that has competitors with weDoBetter
    const sampleCompetitor = await Competitor.findOne({
      isDeleted: false,
      weDoBetter: { $exists: true, $ne: '', $ne: null }
    }).lean();

    if (!sampleCompetitor) {
      console.log('No competitor with weDoBetter found');
      return;
    }

    console.log('=== SAMPLE COMPETITOR WITH weDoBetter ===\n');
    console.log('Full document:');
    console.log(JSON.stringify(sampleCompetitor, null, 2));

    // Now simulate what the list endpoint returns
    console.log('\n\n=== SIMULATING LIST ENDPOINT ===\n');
    const competitors = await Competitor.find({
      workspace: sampleCompetitor.workspace,
      isDeleted: false,
    }).sort({ order: 1 }).lean();

    console.log(`Found ${competitors.length} competitors for workspace ${sampleCompetitor.workspace}\n`);

    competitors.forEach((c, i) => {
      console.log(`${i + 1}. ${c.name}`);
      console.log(`   advantage: "${c.advantage || ''}"`);
      console.log(`   weDoBetter: "${c.weDoBetter || ''}"`);
      console.log('');
    });

    // Simulate getNamesArray endpoint
    console.log('\n=== SIMULATING getNamesArray ENDPOINT ===\n');
    const names = await Competitor.getNamesArray(sampleCompetitor.workspace);
    const advantages = await Competitor.getAdvantagesArray(sampleCompetitor.workspace);
    const weDoBetters = await Competitor.getWeDoBettersArray(sampleCompetitor.workspace);

    console.log('competitorNames:', names);
    console.log('competitorAdvantages:', advantages);
    console.log('competitorWeDoBetters:', weDoBetters);

  } catch (err) {
    console.error('[Test] ERROR:', err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n[Test] Disconnected');
  }
}

main();
