/**
 * Check script to see if weDoBetter data exists in the database
 *
 * Run with: node scripts/check-wedobetter-data.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');

const Onboarding = require('../src/models/Onboarding');
const Competitor = require('../src/models/Competitor');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/plangenie';

async function connect() {
  console.log('[Check] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[Check] Connected to MongoDB\n');
}

async function disconnect() {
  await mongoose.disconnect();
  console.log('\n[Check] Disconnected from MongoDB');
}

async function main() {
  try {
    await connect();

    // 1. Check Competitor collection for weDoBetter data
    console.log('=== CHECKING COMPETITOR COLLECTION ===\n');

    const totalCompetitors = await Competitor.countDocuments({ isDeleted: false });
    const withWeDoBetter = await Competitor.countDocuments({
      isDeleted: false,
      weDoBetter: { $exists: true, $ne: '', $ne: null }
    });

    console.log(`Total competitors: ${totalCompetitors}`);
    console.log(`Competitors with weDoBetter: ${withWeDoBetter}`);

    if (withWeDoBetter > 0) {
      console.log('\nSample competitors with weDoBetter:');
      const samples = await Competitor.find({
        isDeleted: false,
        weDoBetter: { $exists: true, $ne: '', $ne: null }
      }).limit(3).lean();
      samples.forEach(c => {
        console.log(`  - ${c.name}: "${c.weDoBetter}"`);
      });
    }

    // 2. Check Onboarding.answers for compNotes with "What we do better"
    console.log('\n\n=== CHECKING ONBOARDING.ANSWERS FOR compNotes ===\n');

    const onboardings = await Onboarding.find({
      $or: [
        { 'answers.compNotes': { $exists: true, $ne: '' } },
        { 'answers.competitorsNotes': { $exists: true, $ne: '' } },
      ],
    }).lean();

    console.log(`Onboarding docs with compNotes: ${onboardings.length}`);

    let withWeDoBetterInNotes = 0;
    let sampleNotes = [];

    for (const ob of onboardings) {
      const compNotes = ob.answers?.compNotes || ob.answers?.competitorsNotes || '';
      if (compNotes.toLowerCase().includes('what we do better')) {
        withWeDoBetterInNotes++;
        if (sampleNotes.length < 2) {
          sampleNotes.push({
            workspace: ob.workspace,
            compNotes: compNotes.substring(0, 500) + (compNotes.length > 500 ? '...' : '')
          });
        }
      }
    }

    console.log(`Onboarding docs with "What we do better" in compNotes: ${withWeDoBetterInNotes}`);

    if (sampleNotes.length > 0) {
      console.log('\nSample compNotes with "What we do better":');
      sampleNotes.forEach((s, i) => {
        console.log(`\n--- Sample ${i + 1} (workspace: ${s.workspace}) ---`);
        console.log(s.compNotes);
      });
    }

    // 3. Summary
    console.log('\n\n=== SUMMARY ===\n');

    if (withWeDoBetter > 0) {
      console.log('✓ Some competitors already have weDoBetter data in the database.');
    } else if (withWeDoBetterInNotes > 0) {
      console.log('! weDoBetter data exists in old compNotes but NOT in Competitor collection.');
      console.log('  Run: node scripts/migrate-competitor-wedobetter.js');
    } else {
      console.log('✗ No weDoBetter data found anywhere.');
      console.log('  This means users never entered "What we do better" information.');
    }

  } catch (err) {
    console.error('[Check] ERROR:', err);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

main();
