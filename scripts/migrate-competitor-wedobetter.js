/**
 * Migration script to update existing competitors with weDoBetter data
 *
 * This script reads the compNotes/competitorsNotes from Onboarding.answers
 * and updates existing Competitor documents with the weDoBetter field.
 *
 * Run with: node scripts/migrate-competitor-wedobetter.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');

const Onboarding = require('../src/models/Onboarding');
const Competitor = require('../src/models/Competitor');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/plangenie';

async function connect() {
  console.log('[Migration] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[Migration] Connected to MongoDB');
}

async function disconnect() {
  await mongoose.disconnect();
  console.log('[Migration] Disconnected from MongoDB');
}

/**
 * Parse compNotes text to extract competitor data including weDoBetter
 * Format:
 *   Competitor Name
 *   What they do better: advantage text
 *   What we do better: weDoBetter text
 *
 * Blocks separated by double newlines
 */
function parseCompNotes(compNotes) {
  if (!compNotes) return [];

  const blocks = String(compNotes).split(/\n\n+/).filter(b => b.trim());
  const competitors = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    // First line is the competitor name (may have bullet prefix)
    const name = lines[0].replace(/^[-•*]\s*/, '').trim();
    if (!name) continue;

    let theyDoBetter = '';
    let weDoBetter = '';

    // Parse remaining lines for "What they do better" and "What we do better"
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for "What they do better:" pattern
      const theyMatch = line.match(/^what they do better[:\s]*(.*)$/i);
      if (theyMatch) {
        theyDoBetter = theyMatch[1].trim();
        continue;
      }

      // Check for "What we do better:" pattern
      const weMatch = line.match(/^what we do better[:\s]*(.*)$/i);
      if (weMatch) {
        weDoBetter = weMatch[1].trim();
        continue;
      }
    }

    competitors.push({ name, theyDoBetter, weDoBetter });
  }

  return competitors;
}

/**
 * Update competitors for a single workspace
 */
async function updateWorkspaceCompetitors(workspaceId, compNotes) {
  const parsed = parseCompNotes(compNotes);
  if (parsed.length === 0) return 0;

  let updated = 0;

  for (const pc of parsed) {
    if (!pc.weDoBetter) continue; // Skip if no weDoBetter data

    // Find matching competitor by name (case-insensitive)
    const competitor = await Competitor.findOne({
      workspace: workspaceId,
      isDeleted: false,
      name: { $regex: new RegExp(`^${pc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });

    if (competitor && !competitor.weDoBetter) {
      competitor.weDoBetter = pc.weDoBetter;
      await competitor.save();
      updated++;
      console.log(`    Updated "${pc.name}" with weDoBetter: "${pc.weDoBetter.substring(0, 50)}..."`);
    }
  }

  return updated;
}

async function main() {
  try {
    await connect();

    console.log('\n[Migration] Updating existing competitors with weDoBetter data...\n');

    // Get all onboarding documents with compNotes or competitorsNotes
    const onboardings = await Onboarding.find({
      $or: [
        { 'answers.compNotes': { $exists: true, $ne: '' } },
        { 'answers.competitorsNotes': { $exists: true, $ne: '' } },
      ],
    }).lean();

    console.log(`[Migration] Found ${onboardings.length} onboarding documents with competitor notes\n`);

    let totalUpdated = 0;

    for (const ob of onboardings) {
      if (!ob.workspace) continue;

      const compNotes = ob.answers?.compNotes || ob.answers?.competitorsNotes || '';
      if (!compNotes) continue;

      console.log(`[Migration] Processing workspace ${ob.workspace}`);
      const updated = await updateWorkspaceCompetitors(ob.workspace, compNotes);
      totalUpdated += updated;

      if (updated > 0) {
        console.log(`  - Updated ${updated} competitors`);
      } else {
        console.log(`  - No competitors needed updating`);
      }
    }

    console.log('\n[Migration] === MIGRATION COMPLETE ===');
    console.log(`  Total competitors updated: ${totalUpdated}`);
    console.log('');

  } catch (err) {
    console.error('[Migration] ERROR:', err);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

main();
