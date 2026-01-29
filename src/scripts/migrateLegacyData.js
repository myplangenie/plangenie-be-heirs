/**
 * Comprehensive Migration Script: Migrate all legacy data to new CRUD models
 *
 * This script migrates:
 * - Competitors: competitorsNotes -> Competitor model
 * - SWOT: swotStrengths/Weaknesses/Opportunities/Threats -> SwotEntry model
 * - Vision Goals: vision1y/vision3y -> VisionGoal model
 * - Products: legacy products array -> Product model (normalizes price to pricing)
 * - OrgPositions: legacyParentId -> parentId
 *
 * Usage:
 *   node src/scripts/migrateLegacyData.js                    # Migrate all
 *   node src/scripts/migrateLegacyData.js --dry-run          # Preview without making changes
 *   node src/scripts/migrateLegacyData.js --only=competitors # Migrate specific type
 *   node src/scripts/migrateLegacyData.js --only=swot
 *   node src/scripts/migrateLegacyData.js --only=vision
 *   node src/scripts/migrateLegacyData.js --only=products
 *   node src/scripts/migrateLegacyData.js --only=orgpositions
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');
const Competitor = require('../models/Competitor');
const SwotEntry = require('../models/SwotEntry');
const VisionGoal = require('../models/VisionGoal');
const Product = require('../models/Product');
const OrgPosition = require('../models/OrgPosition');

const isDryRun = process.argv.includes('--dry-run');
const onlyArg = process.argv.find(arg => arg.startsWith('--only='));
const onlyType = onlyArg ? onlyArg.split('=')[1] : null;

// Stats tracking
const stats = {
  competitors: { workspaces: 0, migrated: 0, skipped: 0, created: 0 },
  swot: { workspaces: 0, migrated: 0, skipped: 0, created: 0 },
  vision: { workspaces: 0, migrated: 0, skipped: 0, created: 0 },
  products: { workspaces: 0, migrated: 0, skipped: 0, created: 0, updated: 0 },
  orgpositions: { total: 0, migrated: 0, skipped: 0 },
};

/**
 * Parse competitors from legacy competitorsNotes text format
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

/**
 * Parse SWOT items from newline-separated string
 */
function parseSwotItems(text) {
  return String(text || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Parse vision goals from newline-separated string
 */
function parseVisionGoals(text) {
  return String(text || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Migrate Competitors
 */
async function migrateCompetitors() {
  console.log('\n--- Migrating Competitors ---\n');

  const workspaces = await Workspace.find({
    'fields.competitorsNotes': { $exists: true, $ne: '' }
  }).lean();

  stats.competitors.workspaces = workspaces.length;
  console.log(`Found ${workspaces.length} workspaces with competitorsNotes`);

  for (const workspace of workspaces) {
    const workspaceId = workspace._id;
    const userId = workspace.user;
    const competitorsNotes = workspace.fields?.get?.('competitorsNotes') || workspace.fields?.competitorsNotes || '';

    if (!competitorsNotes?.trim()) continue;

    // Check if already migrated
    const existingCount = await Competitor.countDocuments({
      workspace: workspaceId,
      isDeleted: { $ne: true }
    });

    if (existingCount > 0) {
      console.log(`  [SKIP] Workspace ${workspace.wid || workspaceId}: Already has ${existingCount} competitors`);
      stats.competitors.skipped++;
      continue;
    }

    const parsed = parseCompetitorsFromNotes(competitorsNotes);
    if (parsed.length === 0) {
      stats.competitors.skipped++;
      continue;
    }

    console.log(`  [MIGRATE] Workspace ${workspace.wid || workspaceId}: ${parsed.length} competitors`);

    if (!isDryRun) {
      for (let i = 0; i < parsed.length; i++) {
        try {
          await Competitor.create({
            workspace: workspaceId,
            user: userId,
            name: parsed[i].name,
            advantage: parsed[i].advantage,
            order: i,
          });
          stats.competitors.created++;
        } catch (err) {
          console.error(`    - Failed: ${parsed[i].name}: ${err.message}`);
        }
      }
    } else {
      stats.competitors.created += parsed.length;
    }
    stats.competitors.migrated++;
  }
}

/**
 * Migrate SWOT entries
 */
async function migrateSwot() {
  console.log('\n--- Migrating SWOT ---\n');

  const workspaces = await Workspace.find({
    $or: [
      { 'fields.swotStrengths': { $exists: true, $ne: '' } },
      { 'fields.swotWeaknesses': { $exists: true, $ne: '' } },
      { 'fields.swotOpportunities': { $exists: true, $ne: '' } },
      { 'fields.swotThreats': { $exists: true, $ne: '' } },
    ]
  }).lean();

  stats.swot.workspaces = workspaces.length;
  console.log(`Found ${workspaces.length} workspaces with SWOT data`);

  for (const workspace of workspaces) {
    const workspaceId = workspace._id;
    const userId = workspace.user;
    const fields = workspace.fields || {};

    // Check if already migrated
    const existingCount = await SwotEntry.countDocuments({
      workspace: workspaceId,
      isDeleted: { $ne: true }
    });

    if (existingCount > 0) {
      console.log(`  [SKIP] Workspace ${workspace.wid || workspaceId}: Already has ${existingCount} SWOT entries`);
      stats.swot.skipped++;
      continue;
    }

    const swotData = {
      strength: parseSwotItems(fields.get?.('swotStrengths') || fields.swotStrengths),
      weakness: parseSwotItems(fields.get?.('swotWeaknesses') || fields.swotWeaknesses),
      opportunity: parseSwotItems(fields.get?.('swotOpportunities') || fields.swotOpportunities),
      threat: parseSwotItems(fields.get?.('swotThreats') || fields.swotThreats),
    };

    const totalItems = Object.values(swotData).reduce((sum, arr) => sum + arr.length, 0);
    if (totalItems === 0) {
      stats.swot.skipped++;
      continue;
    }

    console.log(`  [MIGRATE] Workspace ${workspace.wid || workspaceId}: ${totalItems} SWOT entries`);

    if (!isDryRun) {
      for (const [entryType, items] of Object.entries(swotData)) {
        for (let i = 0; i < items.length; i++) {
          try {
            await SwotEntry.create({
              workspace: workspaceId,
              user: userId,
              entryType,
              text: items[i],
              order: i,
            });
            stats.swot.created++;
          } catch (err) {
            console.error(`    - Failed ${entryType}: ${err.message}`);
          }
        }
      }
    } else {
      stats.swot.created += totalItems;
    }
    stats.swot.migrated++;
  }
}

/**
 * Migrate Vision Goals
 */
async function migrateVision() {
  console.log('\n--- Migrating Vision Goals ---\n');

  const workspaces = await Workspace.find({
    $or: [
      { 'fields.vision1y': { $exists: true, $ne: '' } },
      { 'fields.vision3y': { $exists: true, $ne: '' } },
    ]
  }).lean();

  stats.vision.workspaces = workspaces.length;
  console.log(`Found ${workspaces.length} workspaces with vision goals`);

  for (const workspace of workspaces) {
    const workspaceId = workspace._id;
    const userId = workspace.user;
    const fields = workspace.fields || {};

    // Check if already migrated
    const existingCount = await VisionGoal.countDocuments({
      workspace: workspaceId,
      isDeleted: { $ne: true }
    });

    if (existingCount > 0) {
      console.log(`  [SKIP] Workspace ${workspace.wid || workspaceId}: Already has ${existingCount} vision goals`);
      stats.vision.skipped++;
      continue;
    }

    const goals1y = parseVisionGoals(fields.get?.('vision1y') || fields.vision1y);
    const goals3y = parseVisionGoals(fields.get?.('vision3y') || fields.vision3y);

    const totalGoals = goals1y.length + goals3y.length;
    if (totalGoals === 0) {
      stats.vision.skipped++;
      continue;
    }

    console.log(`  [MIGRATE] Workspace ${workspace.wid || workspaceId}: ${totalGoals} vision goals`);

    if (!isDryRun) {
      for (let i = 0; i < goals1y.length; i++) {
        try {
          await VisionGoal.create({
            workspace: workspaceId,
            user: userId,
            goalType: '1y',
            text: goals1y[i],
            order: i,
          });
          stats.vision.created++;
        } catch (err) {
          console.error(`    - Failed 1y goal: ${err.message}`);
        }
      }
      for (let i = 0; i < goals3y.length; i++) {
        try {
          await VisionGoal.create({
            workspace: workspaceId,
            user: userId,
            goalType: '3y',
            text: goals3y[i],
            order: i,
          });
          stats.vision.created++;
        } catch (err) {
          console.error(`    - Failed 3y goal: ${err.message}`);
        }
      }
    } else {
      stats.vision.created += totalGoals;
    }
    stats.vision.migrated++;
  }
}

/**
 * Migrate Products (normalize price to pricing)
 */
async function migrateProducts() {
  console.log('\n--- Migrating Products ---\n');

  // Find products with price field but no pricing field
  const productsWithPrice = await Product.find({
    price: { $exists: true, $ne: '' },
    $or: [
      { pricing: { $exists: false } },
      { pricing: '' },
      { pricing: null }
    ]
  }).lean();

  stats.products.total = productsWithPrice.length;
  console.log(`Found ${productsWithPrice.length} products with price field to normalize`);

  if (!isDryRun) {
    for (const product of productsWithPrice) {
      try {
        await Product.updateOne(
          { _id: product._id },
          { $set: { pricing: product.price } }
        );
        stats.products.updated++;
        console.log(`  [UPDATE] Product ${product._id}: pricing = ${product.price}`);
      } catch (err) {
        console.error(`  [ERROR] Product ${product._id}: ${err.message}`);
      }
    }
  } else {
    stats.products.updated = productsWithPrice.length;
    for (const product of productsWithPrice.slice(0, 10)) {
      console.log(`  [WOULD UPDATE] Product ${product._id}: pricing = ${product.price}`);
    }
    if (productsWithPrice.length > 10) {
      console.log(`  ... and ${productsWithPrice.length - 10} more`);
    }
  }
}

/**
 * Migrate OrgPositions (normalize legacyParentId to parentId)
 */
async function migrateOrgPositions() {
  console.log('\n--- Migrating OrgPositions ---\n');

  // Find positions with legacyParentId but no parentId
  const positionsWithLegacy = await OrgPosition.find({
    legacyParentId: { $exists: true, $ne: null },
    $or: [
      { parentId: { $exists: false } },
      { parentId: null }
    ]
  }).lean();

  stats.orgpositions.total = positionsWithLegacy.length;
  console.log(`Found ${positionsWithLegacy.length} positions with legacyParentId to normalize`);

  if (!isDryRun) {
    for (const position of positionsWithLegacy) {
      try {
        await OrgPosition.updateOne(
          { _id: position._id },
          { $set: { parentId: position.legacyParentId } }
        );
        stats.orgpositions.migrated++;
        console.log(`  [UPDATE] Position ${position._id}: parentId = ${position.legacyParentId}`);
      } catch (err) {
        console.error(`  [ERROR] Position ${position._id}: ${err.message}`);
      }
    }
  } else {
    stats.orgpositions.migrated = positionsWithLegacy.length;
    for (const position of positionsWithLegacy.slice(0, 10)) {
      console.log(`  [WOULD UPDATE] Position ${position._id}: parentId = ${position.legacyParentId}`);
    }
    if (positionsWithLegacy.length > 10) {
      console.log(`  ... and ${positionsWithLegacy.length - 10} more`);
    }
  }
}

/**
 * Print summary
 */
function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));

  if (!onlyType || onlyType === 'competitors') {
    console.log('\nCompetitors:');
    console.log(`  Workspaces with data: ${stats.competitors.workspaces}`);
    console.log(`  Workspaces migrated: ${stats.competitors.migrated}`);
    console.log(`  Workspaces skipped: ${stats.competitors.skipped}`);
    console.log(`  Competitors ${isDryRun ? 'would be ' : ''}created: ${stats.competitors.created}`);
  }

  if (!onlyType || onlyType === 'swot') {
    console.log('\nSWOT:');
    console.log(`  Workspaces with data: ${stats.swot.workspaces}`);
    console.log(`  Workspaces migrated: ${stats.swot.migrated}`);
    console.log(`  Workspaces skipped: ${stats.swot.skipped}`);
    console.log(`  Entries ${isDryRun ? 'would be ' : ''}created: ${stats.swot.created}`);
  }

  if (!onlyType || onlyType === 'vision') {
    console.log('\nVision Goals:');
    console.log(`  Workspaces with data: ${stats.vision.workspaces}`);
    console.log(`  Workspaces migrated: ${stats.vision.migrated}`);
    console.log(`  Workspaces skipped: ${stats.vision.skipped}`);
    console.log(`  Goals ${isDryRun ? 'would be ' : ''}created: ${stats.vision.created}`);
  }

  if (!onlyType || onlyType === 'products') {
    console.log('\nProducts:');
    console.log(`  Products with price field: ${stats.products.total}`);
    console.log(`  Products ${isDryRun ? 'would be ' : ''}updated: ${stats.products.updated}`);
  }

  if (!onlyType || onlyType === 'orgpositions') {
    console.log('\nOrgPositions:');
    console.log(`  Positions with legacyParentId: ${stats.orgpositions.total}`);
    console.log(`  Positions ${isDryRun ? 'would be ' : ''}migrated: ${stats.orgpositions.migrated}`);
  }

  console.log('');
  if (isDryRun) {
    console.log('*** This was a dry run. To apply changes, run without --dry-run ***');
  }
}

/**
 * Main migration function
 */
async function migrate() {
  console.log('='.repeat(60));
  console.log('Legacy Data Migration Script');
  console.log(isDryRun ? '*** DRY RUN MODE - No changes will be made ***' : '*** LIVE MODE - Changes will be saved ***');
  if (onlyType) console.log(`*** Running only: ${onlyType} ***`);
  console.log('='.repeat(60));

  // Connect to MongoDB
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('Error: MONGO_URI or MONGODB_URI environment variable not set');
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log('Connected to MongoDB');

  try {
    if (!onlyType || onlyType === 'competitors') await migrateCompetitors();
    if (!onlyType || onlyType === 'swot') await migrateSwot();
    if (!onlyType || onlyType === 'vision') await migrateVision();
    if (!onlyType || onlyType === 'products') await migrateProducts();
    if (!onlyType || onlyType === 'orgpositions') await migrateOrgPositions();

    printSummary();
  } finally {
    await mongoose.disconnect();
    console.log('\nDone.');
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
