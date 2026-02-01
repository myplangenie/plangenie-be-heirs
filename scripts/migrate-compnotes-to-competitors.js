/**
 * Migration script to create Competitor documents from compNotes data
 *
 * This script reads compNotes from Onboarding.answers and creates
 * Competitor documents with name, advantage, and weDoBetter fields.
 *
 * Run with: node scripts/migrate-compnotes-to-competitors.js
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
 * Parse compNotes text to extract competitor data
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

    // Only include if we have the structured format
    if (theyDoBetter || weDoBetter) {
      competitors.push({ name, theyDoBetter, weDoBetter });
    }
  }

  return competitors;
}

/**
 * Create or update competitors for a workspace from compNotes
 */
async function processWorkspace(ob) {
  const workspaceId = ob.workspace;
  const userId = ob.user;
  const compNotes = ob.answers?.compNotes || ob.answers?.competitorsNotes || '';

  if (!compNotes || !workspaceId || !userId) return { created: 0, updated: 0 };

  const parsed = parseCompNotes(compNotes);
  if (parsed.length === 0) return { created: 0, updated: 0 };

  let created = 0;
  let updated = 0;

  for (let i = 0; i < parsed.length; i++) {
    const pc = parsed[i];
    if (!pc.name) continue;

    // Check if competitor exists
    const existing = await Competitor.findOne({
      workspace: workspaceId,
      isDeleted: false,
      name: { $regex: new RegExp(`^${pc.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
    });

    if (existing) {
      // Update existing if weDoBetter is missing
      let needsUpdate = false;
      if (pc.theyDoBetter && !existing.advantage) {
        existing.advantage = pc.theyDoBetter;
        needsUpdate = true;
      }
      if (pc.weDoBetter && !existing.weDoBetter) {
        existing.weDoBetter = pc.weDoBetter;
        needsUpdate = true;
      }
      if (needsUpdate) {
        await existing.save();
        updated++;
        console.log(`    Updated "${pc.name}"`);
      }
    } else {
      // Create new competitor
      const order = await Competitor.getNextOrder(workspaceId);
      await Competitor.create({
        workspace: workspaceId,
        user: userId,
        name: pc.name,
        advantage: pc.theyDoBetter || undefined,
        weDoBetter: pc.weDoBetter || undefined,
        order,
      });
      created++;
      console.log(`    Created "${pc.name}" with advantage: "${(pc.theyDoBetter || '').substring(0, 30)}..." weDoBetter: "${(pc.weDoBetter || '').substring(0, 30)}..."`);
    }
  }

  return { created, updated };
}

async function main() {
  try {
    await connect();

    console.log('\n[Migration] Creating/updating Competitor documents from compNotes...\n');

    // Get all onboarding documents with compNotes containing structured format
    const onboardings = await Onboarding.find({
      $or: [
        { 'answers.compNotes': { $regex: /what (they|we) do better/i } },
        { 'answers.competitorsNotes': { $regex: /what (they|we) do better/i } },
      ],
    }).lean();

    console.log(`[Migration] Found ${onboardings.length} onboarding documents with structured competitor notes\n`);

    let totalCreated = 0;
    let totalUpdated = 0;

    for (const ob of onboardings) {
      if (!ob.workspace) continue;

      console.log(`[Migration] Processing workspace ${ob.workspace}`);
      const result = await processWorkspace(ob);
      totalCreated += result.created;
      totalUpdated += result.updated;

      if (result.created > 0 || result.updated > 0) {
        console.log(`  - Created: ${result.created}, Updated: ${result.updated}`);
      } else {
        console.log(`  - No changes needed`);
      }
    }

    console.log('\n[Migration] === MIGRATION COMPLETE ===');
    console.log(`  Total competitors created: ${totalCreated}`);
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
