#!/usr/bin/env node
/**
 * Migration Script: Onboarding.answers → Workspace.fields
 *
 * This script copies all data from Onboarding.answers to Workspace.fields
 * for existing users. It does NOT delete the original data.
 *
 * Usage:
 *   node src/scripts/migrateAnswersToWorkspaceFields.js
 *
 * Options:
 *   --dry-run    Preview changes without writing to database
 *   --verbose    Show detailed progress for each user
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Onboarding = require('../models/Onboarding');
const Workspace = require('../models/Workspace');
const crypto = require('crypto');

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

// Fields to migrate from Onboarding.answers to Workspace.fields
const FIELDS_TO_MIGRATE = [
  // Vision & Purpose
  'ubp',
  'purpose',
  'bhag',
  'visionBhag',
  'visionStatement',
  'missionStatement',
  'identitySummary',
  'vision1y',
  'vision3y',
  // Values & Culture
  'valuesCore',
  'valuesCoreKeywords',
  'cultureFeeling',
  // Market
  'targetMarket',
  'targetCustomer',
  'marketCustomer',
  'custType',
  'partners',
  'partnersDesc',
  'partnersYN',
  'competitorsNotes',
  'compNotes',
  'competitorNames',
  'competitorAdvantages',
  // Financial
  'finSalesVolume',
  'finSalesGrowthPct',
  'finAvgUnitCost',
  'finFixedOperatingCosts',
  'finMarketingSalesSpend',
  'finPayrollCost',
  'finStartingCash',
  'finAdditionalFundingAmount',
  'finAdditionalFundingMonth',
  'finPaymentCollectionDays',
  'finTargetProfitMarginPct',
  'finMonthlyRevenue',
  'finRevenueGrowthPct',
  'finIsRecurring',
  'finRecurringPct',
  'finMonthlyCosts',
  'finFixedCosts',
  'finVariableCostsPct',
  'finBiggestCostCategory',
  'finCurrentCash',
  'finExpectedFunding',
  'finFundingMonth',
  'finFundingYear',
  'financialForecast',
  // Actuals
  'finActualRevenue',
  'finActualCogs',
  'finActualMarketing',
  'finActualPayroll',
  'finActualFixed',
  'finActualFunding',
  'finActualNewCustomers',
  // Department Configuration
  'editableDepts',
  'deptsConfirmed',
  // Org structure
  'orgPositions',
  // Products
  'products',
  // Action sections
  'actionSections',
  // Plan prose
  'planProse',
  // SWOT (legacy text format)
  'swotStrengths',
  'swotWeaknesses',
  'swotOpportunities',
  'swotThreats',
  // Goals
  'goalsShortTerm',
  'goalsMidTerm',
  'goalsLongTerm',
  // Misc
  'companyLogoUrl',
  // Legacy financial object (flatten if exists)
  'financial',
];

// Stats tracking
const stats = {
  totalOnboardings: 0,
  withAnswers: 0,
  migrated: 0,
  skipped: 0,
  errors: 0,
  fieldsCount: 0,
};

async function getOrCreateWorkspace(userId, existingWorkspaceId = null) {
  // If onboarding already has a workspace reference, use it
  if (existingWorkspaceId) {
    const ws = await Workspace.findById(existingWorkspaceId);
    if (ws) return ws;
  }

  // Find or create default workspace for user
  let defaultWs = await Workspace.findOne({ user: userId, defaultWorkspace: true });
  if (!defaultWs) {
    const wid = `ws_${crypto.randomBytes(6).toString('hex')}`;
    defaultWs = await Workspace.create({
      user: userId,
      wid,
      name: 'My Business',
      defaultWorkspace: true,
    });
    if (VERBOSE) console.log(`  Created new workspace ${wid} for user ${userId}`);
  }
  return defaultWs;
}

function flattenFinancialObject(financial) {
  // If there's a nested 'financial' object, flatten it to fin* fields
  if (!financial || typeof financial !== 'object') return {};

  const mapping = {
    salesVolume: 'finSalesVolume',
    salesGrowthPct: 'finSalesGrowthPct',
    avgUnitCost: 'finAvgUnitCost',
    fixedOperatingCosts: 'finFixedOperatingCosts',
    marketingSalesSpend: 'finMarketingSalesSpend',
    payrollCost: 'finPayrollCost',
    startingCash: 'finStartingCash',
    additionalFundingAmount: 'finAdditionalFundingAmount',
    additionalFundingMonth: 'finAdditionalFundingMonth',
    paymentCollectionDays: 'finPaymentCollectionDays',
    targetProfitMarginPct: 'finTargetProfitMarginPct',
  };

  const flattened = {};
  for (const [oldKey, newKey] of Object.entries(mapping)) {
    if (financial[oldKey] !== undefined && financial[oldKey] !== null && financial[oldKey] !== '') {
      flattened[newKey] = financial[oldKey];
    }
  }
  return flattened;
}

async function migrateOnboarding(ob) {
  const userId = ob.user;
  const answers = ob.answers || {};

  // Check if there's any data to migrate
  const hasData = Object.keys(answers).some(key => {
    const val = answers[key];
    if (val === null || val === undefined || val === '') return false;
    if (Array.isArray(val) && val.length === 0) return false;
    if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) return false;
    return true;
  });

  if (!hasData) {
    stats.skipped++;
    if (VERBOSE) console.log(`  Skipped user ${userId} - no data in answers`);
    return;
  }

  stats.withAnswers++;

  try {
    // Get or create workspace
    const ws = await getOrCreateWorkspace(userId, ob.workspace);

    // Initialize fields Map if needed
    if (!ws.fields) {
      ws.fields = new Map();
    }

    // Count fields before
    const fieldsBefore = ws.fields.size;

    // Migrate each field
    let fieldsMigrated = 0;
    for (const field of FIELDS_TO_MIGRATE) {
      if (field === 'financial' && answers.financial) {
        // Flatten nested financial object
        const flattened = flattenFinancialObject(answers.financial);
        for (const [key, value] of Object.entries(flattened)) {
          if (!ws.fields.has(key) || ws.fields.get(key) === null || ws.fields.get(key) === '') {
            ws.fields.set(key, value);
            fieldsMigrated++;
          }
        }
      } else if (answers[field] !== undefined && answers[field] !== null && answers[field] !== '') {
        // Only migrate if workspace doesn't already have this field with data
        const existing = ws.fields.get(field);
        const existingIsEmpty = existing === null || existing === undefined || existing === '' ||
          (Array.isArray(existing) && existing.length === 0) ||
          (typeof existing === 'object' && !Array.isArray(existing) && Object.keys(existing).length === 0);

        if (existingIsEmpty) {
          ws.fields.set(field, answers[field]);
          fieldsMigrated++;
        }
      }
    }

    if (fieldsMigrated > 0) {
      if (!DRY_RUN) {
        ws.markModified('fields');
        await ws.save();

        // Update onboarding to reference this workspace if not already
        if (!ob.workspace) {
          await Onboarding.updateOne({ _id: ob._id }, { workspace: ws._id });
        }
      }

      stats.migrated++;
      stats.fieldsCount += fieldsMigrated;
      if (VERBOSE) {
        console.log(`  Migrated user ${userId}: ${fieldsMigrated} fields → workspace ${ws.wid || ws._id}`);
      }
    } else {
      stats.skipped++;
      if (VERBOSE) console.log(`  Skipped user ${userId} - workspace already has data`);
    }

  } catch (err) {
    stats.errors++;
    console.error(`  ERROR migrating user ${userId}:`, err.message);
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('Migration: Onboarding.answers → Workspace.fields');
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('MODE: DRY RUN (no changes will be written)\n');
  } else {
    console.log('MODE: LIVE (changes will be written to database)\n');
  }

  // Connect to MongoDB
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('ERROR: MONGO_URI or MONGODB_URI environment variable not set');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('Connected.\n');

  // Find all onboarding documents with answers
  console.log('Finding onboarding documents...');
  const onboardings = await Onboarding.find({
    answers: { $exists: true, $ne: null }
  }).lean();

  stats.totalOnboardings = onboardings.length;
  console.log(`Found ${onboardings.length} onboarding documents with answers.\n`);

  if (onboardings.length === 0) {
    console.log('Nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  // Process each onboarding
  console.log('Processing...');
  for (let i = 0; i < onboardings.length; i++) {
    const ob = onboardings[i];
    if (VERBOSE) {
      console.log(`[${i + 1}/${onboardings.length}] Processing user ${ob.user}...`);
    } else if (i % 100 === 0) {
      console.log(`  Progress: ${i}/${onboardings.length}`);
    }
    await migrateOnboarding(ob);
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total onboardings found:    ${stats.totalOnboardings}`);
  console.log(`With non-empty answers:     ${stats.withAnswers}`);
  console.log(`Successfully migrated:      ${stats.migrated}`);
  console.log(`Skipped (no data/existing): ${stats.skipped}`);
  console.log(`Errors:                     ${stats.errors}`);
  console.log(`Total fields migrated:      ${stats.fieldsCount}`);
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('\nThis was a DRY RUN. No changes were made.');
    console.log('Run without --dry-run to apply changes.');
  } else {
    console.log('\nMigration complete!');
    console.log('Original Onboarding.answers data has been preserved.');
  }

  await mongoose.disconnect();
  console.log('\nDisconnected from MongoDB.');
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
