/**
 * Migration script to move data from answers object to individual collections
 * Run this script once to migrate existing data
 *
 * Usage:
 *   node src/scripts/migrateToIndividualCollections.js [--dry-run]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Onboarding = require('../models/Onboarding');
const SwotEntry = require('../models/SwotEntry');
const VisionGoal = require('../models/VisionGoal');
const Competitor = require('../models/Competitor');
const Product = require('../models/Product');

const DRY_RUN = process.argv.includes('--dry-run');

async function connect() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('No MongoDB URI found in environment');
  }
  await mongoose.connect(uri);
  console.log('Connected to MongoDB');
}

function parseNewlineSeparated(str) {
  return String(str || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

async function migrateSwot(onboarding, userId, workspaceId, stats) {
  const answers = onboarding.answers || {};

  const types = [
    { field: 'swotStrengths', entryType: 'strength' },
    { field: 'swotWeaknesses', entryType: 'weakness' },
    { field: 'swotOpportunities', entryType: 'opportunity' },
    { field: 'swotThreats', entryType: 'threat' },
  ];

  for (const { field, entryType } of types) {
    const items = parseNewlineSeparated(answers[field]);
    if (items.length === 0) continue;

    // Check if already migrated
    const existing = await SwotEntry.countDocuments({
      workspace: workspaceId,
      entryType,
      isDeleted: false,
    });

    if (existing > 0) {
      console.log(`  [SKIP] ${entryType}: already has ${existing} entries`);
      stats.skipped++;
      continue;
    }

    const docs = items.map((text, order) => ({
      workspace: workspaceId,
      user: userId,
      entryType,
      text,
      order,
      isDeleted: false,
    }));

    if (DRY_RUN) {
      console.log(`  [DRY-RUN] Would create ${docs.length} ${entryType} entries`);
    } else {
      await SwotEntry.insertMany(docs);
      console.log(`  [OK] Created ${docs.length} ${entryType} entries`);
    }
    stats.swot += docs.length;
  }
}

async function migrateVisionGoals(onboarding, userId, workspaceId, stats) {
  const answers = onboarding.answers || {};

  const types = [
    { field: 'vision1y', goalType: '1y' },
    { field: 'vision3y', goalType: '3y' },
  ];

  for (const { field, goalType } of types) {
    const items = parseNewlineSeparated(answers[field]);
    if (items.length === 0) continue;

    // Check if already migrated
    const existing = await VisionGoal.countDocuments({
      workspace: workspaceId,
      goalType,
      isDeleted: false,
    });

    if (existing > 0) {
      console.log(`  [SKIP] ${goalType} goals: already has ${existing} entries`);
      stats.skipped++;
      continue;
    }

    const docs = items.map((text, order) => ({
      workspace: workspaceId,
      user: userId,
      goalType,
      text,
      status: 'not_started',
      order,
      isDeleted: false,
    }));

    if (DRY_RUN) {
      console.log(`  [DRY-RUN] Would create ${docs.length} ${goalType} goals`);
    } else {
      await VisionGoal.insertMany(docs);
      console.log(`  [OK] Created ${docs.length} ${goalType} goals`);
    }
    stats.goals += docs.length;
  }
}

async function migrateCompetitors(onboarding, userId, workspaceId, stats) {
  const answers = onboarding.answers || {};

  const names = Array.isArray(answers.competitorNames) ? answers.competitorNames : [];
  const advantages = Array.isArray(answers.competitorAdvantages) ? answers.competitorAdvantages : [];

  if (names.length === 0) return;

  // Check if already migrated
  const existing = await Competitor.countDocuments({
    workspace: workspaceId,
    isDeleted: false,
  });

  if (existing > 0) {
    console.log(`  [SKIP] Competitors: already has ${existing} entries`);
    stats.skipped++;
    return;
  }

  const docs = names.map((name, order) => ({
    workspace: workspaceId,
    user: userId,
    name: String(name || '').trim(),
    advantage: advantages[order] ? String(advantages[order]).trim() : undefined,
    order,
    isDeleted: false,
  })).filter(d => d.name);

  if (docs.length === 0) return;

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would create ${docs.length} competitors`);
  } else {
    await Competitor.insertMany(docs);
    console.log(`  [OK] Created ${docs.length} competitors`);
  }
  stats.competitors += docs.length;
}

async function migrateProducts(onboarding, userId, workspaceId, stats) {
  const answers = onboarding.answers || {};

  const products = Array.isArray(answers.products) ? answers.products : [];

  if (products.length === 0) return;

  // Check if already migrated
  const existing = await Product.countDocuments({
    workspace: workspaceId,
    isDeleted: false,
  });

  if (existing > 0) {
    console.log(`  [SKIP] Products: already has ${existing} entries`);
    stats.skipped++;
    return;
  }

  const docs = products.map((p, order) => {
    const name = typeof p === 'string' ? p : (p?.name || p?.title || '');
    return {
      workspace: workspaceId,
      user: userId,
      name: String(name).trim(),
      description: p?.description,
      pricing: p?.price || p?.pricing,
      unitCost: p?.unitCost,
      monthlyVolume: p?.monthlyVolume,
      category: p?.category,
      status: 'active',
      order,
      isDeleted: false,
    };
  }).filter(d => d.name);

  if (docs.length === 0) return;

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] Would create ${docs.length} products`);
  } else {
    await Product.insertMany(docs);
    console.log(`  [OK] Created ${docs.length} products`);
  }
  stats.products += docs.length;
}

async function main() {
  console.log(`\n=== Migration to Individual Collections ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}\n`);

  await connect();

  const stats = {
    onboardings: 0,
    swot: 0,
    goals: 0,
    competitors: 0,
    products: 0,
    skipped: 0,
    errors: 0,
  };

  // Find all onboarding records with workspace
  const onboardings = await Onboarding.find({ workspace: { $exists: true, $ne: null } }).lean();
  console.log(`Found ${onboardings.length} onboarding records with workspaces\n`);

  for (const ob of onboardings) {
    const workspaceId = ob.workspace;
    const userId = ob.user;

    if (!workspaceId || !userId) {
      console.log(`[SKIP] Missing workspace or user for onboarding ${ob._id}`);
      continue;
    }

    console.log(`\nMigrating workspace ${workspaceId}:`);
    stats.onboardings++;

    try {
      await migrateSwot(ob, userId, workspaceId, stats);
      await migrateVisionGoals(ob, userId, workspaceId, stats);
      await migrateCompetitors(ob, userId, workspaceId, stats);
      await migrateProducts(ob, userId, workspaceId, stats);
    } catch (err) {
      console.error(`  [ERROR] ${err.message}`);
      stats.errors++;
    }
  }

  console.log(`\n=== Migration Summary ===`);
  console.log(`Onboardings processed: ${stats.onboardings}`);
  console.log(`SWOT entries created: ${stats.swot}`);
  console.log(`Vision goals created: ${stats.goals}`);
  console.log(`Competitors created: ${stats.competitors}`);
  console.log(`Products created: ${stats.products}`);
  console.log(`Skipped (already migrated): ${stats.skipped}`);
  console.log(`Errors: ${stats.errors}`);

  if (DRY_RUN) {
    console.log(`\nThis was a dry run. Run without --dry-run to apply changes.`);
  }

  await mongoose.disconnect();
  console.log('\nDisconnected from MongoDB');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
