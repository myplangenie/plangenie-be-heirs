/**
 * Migration Script: Migrate legacy competitorsNotes to Competitor model
 *
 * This script reads competitorsNotes from Workspace.fields for all workspaces
 * and creates Competitor documents for workspaces that don't have any.
 *
 * Usage:
 *   node src/scripts/migrateCompetitors.js
 *   node src/scripts/migrateCompetitors.js --dry-run  (preview without making changes)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const Competitor = require('../models/Competitor');

const isDryRun = process.argv.includes('--dry-run');

/**
 * Parse competitors from legacy competitorsNotes text format
 * Format: blocks separated by double newlines, each block has:
 *   CompetitorName
 *   What they do better: ...
 *   What we do better: ...
 */
function parseCompetitorsFromNotes(notes) {
  const blocks = String(notes || '')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split('\n');
    let name = '';
    let theyBetter = '';
    let weBetter = '';

    lines.forEach((line, i) => {
      if (i === 0 && !line.toLowerCase().startsWith('what they') && !line.toLowerCase().startsWith('what we')) {
        name = line;
      } else if (line.toLowerCase().startsWith('what they do better:')) {
        theyBetter = line.replace(/^what they do better:\s*/i, '');
      } else if (line.toLowerCase().startsWith('what we do better:')) {
        weBetter = line.replace(/^what we do better:\s*/i, '');
      }
    });

    return { name: name.trim(), advantage: theyBetter.trim(), weBetter: weBetter.trim() };
  }).filter((c) => c.name);
}

async function migrate() {
  console.log('='.repeat(60));
  console.log('Competitor Migration Script');
  console.log(isDryRun ? '*** DRY RUN MODE - No changes will be made ***' : '*** LIVE MODE - Changes will be saved ***');
  console.log('='.repeat(60));
  console.log('');

  // Connect to MongoDB
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Error: MONGO_URI or MONGODB_URI environment variable not set');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');
  console.log('');

  // Get all workspaces with competitorsNotes in their fields
  const workspaces = await Workspace.find({
    'fields.competitorsNotes': { $exists: true, $ne: '' }
  }).lean();

  console.log(`Found ${workspaces.length} workspaces with competitorsNotes`);
  console.log('');

  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalCompetitorsCreated = 0;

  for (const workspace of workspaces) {
    const workspaceId = workspace._id;
    const userId = workspace.user;
    const competitorsNotes = workspace.fields?.get?.('competitorsNotes') || workspace.fields?.competitorsNotes || '';

    if (!competitorsNotes || !competitorsNotes.trim()) {
      continue;
    }

    // Check if workspace already has Competitor documents
    const existingCount = await Competitor.countDocuments({
      workspace: workspaceId,
      isDeleted: { $ne: true }
    });

    if (existingCount > 0) {
      console.log(`[SKIP] Workspace ${workspace.wid || workspaceId}: Already has ${existingCount} competitors`);
      totalSkipped++;
      continue;
    }

    // Parse legacy data
    const parsed = parseCompetitorsFromNotes(competitorsNotes);

    if (parsed.length === 0) {
      console.log(`[SKIP] Workspace ${workspace.wid || workspaceId}: No valid competitors found in notes`);
      totalSkipped++;
      continue;
    }

    console.log(`[MIGRATE] Workspace ${workspace.wid || workspaceId}: Found ${parsed.length} competitors to migrate`);

    if (!isDryRun) {
      // Create Competitor documents
      for (let i = 0; i < parsed.length; i++) {
        const comp = parsed[i];
        try {
          await Competitor.create({
            workspace: workspaceId,
            user: userId,
            name: comp.name,
            advantage: comp.advantage,
            order: i,
          });
          totalCompetitorsCreated++;
          console.log(`  - Created: ${comp.name}`);
        } catch (err) {
          console.error(`  - Failed to create ${comp.name}:`, err.message);
        }
      }
    } else {
      // Dry run - just show what would be created
      for (const comp of parsed) {
        console.log(`  - Would create: ${comp.name}${comp.advantage ? ` (advantage: ${comp.advantage.substring(0, 50)}...)` : ''}`);
        totalCompetitorsCreated++;
      }
    }

    totalMigrated++;
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Migration Summary');
  console.log('='.repeat(60));
  console.log(`Workspaces processed: ${workspaces.length}`);
  console.log(`Workspaces migrated: ${totalMigrated}`);
  console.log(`Workspaces skipped (already have competitors): ${totalSkipped}`);
  console.log(`Competitors ${isDryRun ? 'would be ' : ''}created: ${totalCompetitorsCreated}`);
  console.log('');

  if (isDryRun) {
    console.log('This was a dry run. To apply changes, run without --dry-run flag.');
  }

  await mongoose.disconnect();
  console.log('Done.');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
