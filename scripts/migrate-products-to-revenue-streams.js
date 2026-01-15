#!/usr/bin/env node
/**
 * Migration Script: Products to Revenue Streams
 *
 * This script migrates existing products from Onboarding.answers.products
 * to the new RevenueStream model.
 *
 * All existing products are mapped to the 'product_sales' type.
 *
 * Usage:
 *   node scripts/migrate-products-to-revenue-streams.js [--dry-run]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Onboarding = require('../src/models/Onboarding');
const RevenueStream = require('../src/models/RevenueStream');
const User = require('../src/models/User');
const Workspace = require('../src/models/Workspace');

const isDryRun = process.argv.includes('--dry-run');

async function migrate() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/plangenie';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Find all onboarding records with products
    const onboardings = await Onboarding.find({
      'answers.products': { $exists: true, $ne: [], $type: 'array' },
    }).lean().exec();

    console.log(`Found ${onboardings.length} onboarding records with products`);

    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const ob of onboardings) {
      const userId = ob.user;
      const workspaceId = ob.workspace;
      const products = ob.answers?.products || [];

      if (!products.length) {
        totalSkipped++;
        continue;
      }

      console.log(`\nProcessing user ${userId} (workspace ${workspaceId}): ${products.length} products`);

      // Check if already migrated (has revenue streams for this workspace)
      const existingStreams = await RevenueStream.countDocuments({
        user: userId,
        workspace: workspaceId,
        isActive: true,
      });

      if (existingStreams > 0) {
        console.log(`  Skipping: Already has ${existingStreams} revenue streams`);
        totalSkipped++;
        continue;
      }

      // Migrate each product to a revenue stream
      for (let i = 0; i < products.length; i++) {
        const product = products[i];

        // Parse numeric values
        const unitPrice = parseFloat(
          String(product.price || product.pricing || '0').replace(/[^0-9.-]/g, '')
        ) || 0;
        const unitCost = parseFloat(
          String(product.unitCost || '0').replace(/[^0-9.-]/g, '')
        ) || 0;
        const unitsPerMonth = parseFloat(
          String(product.monthlyVolume || '0').replace(/[^0-9.-]/g, '')
        ) || 0;

        const streamData = {
          user: userId,
          workspace: workspaceId,
          name: product.product || `Product ${i + 1}`,
          description: product.description || '',
          type: 'product_sales',
          inputs: {
            unitPrice,
            unitCost,
            unitsPerMonth,
          },
          isPrimary: i === 0, // First product is primary
          isActive: true,
        };

        console.log(`  Product: "${streamData.name}" - $${unitPrice} x ${unitsPerMonth}/mo`);

        if (!isDryRun) {
          try {
            const stream = new RevenueStream(streamData);
            await stream.save();
            totalMigrated++;
          } catch (err) {
            console.error(`  Error creating stream: ${err.message}`);
            totalErrors++;
          }
        } else {
          totalMigrated++;
        }
      }
    }

    console.log('\n========================================');
    console.log('Migration Summary');
    console.log('========================================');
    console.log(`Total migrated: ${totalMigrated}`);
    console.log(`Total skipped: ${totalSkipped}`);
    console.log(`Total errors: ${totalErrors}`);
    if (isDryRun) {
      console.log('\n[DRY RUN - No changes were made]');
    }

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
