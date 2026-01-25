#!/usr/bin/env node
/**
 * One-time migration: Convert old department keys to display names
 *
 * Old format: "technology", "marketing", "peopleHR"
 * New format: "Technology", "Marketing", "Human Resources"
 *
 * Usage: node scripts/migrate-department-keys.js
 *
 * This script:
 * - Finds all DepartmentProject documents with old-style keys
 * - Updates them to use proper display names
 * - Preserves all other data
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

// Mapping from old keys to new display names
const KEY_TO_LABEL = {
  "marketing": "Marketing",
  "sales": "Sales",
  "operations": "Operations",
  "finance": "Finance",
  "financeAdmin": "Finance",
  "peopleHR": "Human Resources",
  "partnerships": "Partnerships",
  "technology": "Technology",
  "sustainability": "Sustainability",
  "communityImpact": "Sustainability",
};

function isOldStyleKey(key) {
  // If it's in our mapping, it's definitely old style
  if (KEY_TO_LABEL[key]) return true;
  // If it has no spaces and starts with lowercase, it's probably old style
  if (!key.includes(" ") && /^[a-z]/.test(key)) return true;
  return false;
}

function convertKey(oldKey) {
  // Use mapping if available
  if (KEY_TO_LABEL[oldKey]) {
    return KEY_TO_LABEL[oldKey];
  }
  // Otherwise, convert camelCase to Title Case
  return oldKey
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.DATABASE_URL || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGO_URI (or DATABASE_URL/MONGODB_URI) in env');
    process.exit(1);
  }

  console.log('🚀 Starting department key migration...');
  console.log('');

  await mongoose.connect(uri, { dbName: process.env.MONGO_DB || undefined });

  const DepartmentProject = require('../src/models/DepartmentProject');

  // Step 1: Find all unique department keys
  const allKeys = await DepartmentProject.distinct('departmentKey', { isDeleted: false });
  console.log(`Found ${allKeys.length} unique department keys`);

  // Step 2: Identify which keys need migration
  const toMigrate = [];
  for (const key of allKeys) {
    if (isOldStyleKey(key)) {
      const count = await DepartmentProject.countDocuments({ departmentKey: key, isDeleted: false });
      toMigrate.push({ from: key, to: convertKey(key), count });
    }
  }

  if (toMigrate.length === 0) {
    console.log('');
    console.log('✅ No migration needed! All departments already use display names.');
    await mongoose.disconnect();
    return;
  }

  // Step 3: Show preview
  console.log('');
  console.log('📋 Migration preview:');
  console.log('─'.repeat(50));
  let totalProjects = 0;
  for (const item of toMigrate) {
    console.log(`  "${item.from}" → "${item.to}" (${item.count} projects)`);
    totalProjects += item.count;
  }
  console.log('─'.repeat(50));
  console.log(`Total: ${totalProjects} projects to update`);
  console.log('');

  // Step 4: Ask for confirmation
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) => {
    rl.question('Proceed with migration? (yes/no): ', resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
    console.log('Migration cancelled.');
    await mongoose.disconnect();
    return;
  }

  // Step 5: Run migration
  console.log('');
  console.log('🔄 Running migration...');

  let migrated = 0;
  let errors = 0;

  for (const item of toMigrate) {
    console.log(`  Migrating "${item.from}" → "${item.to}"...`);

    try {
      const result = await DepartmentProject.updateMany(
        { departmentKey: item.from },
        { $set: { departmentKey: item.to } }
      );
      migrated += result.modifiedCount;
      console.log(`    ✓ Updated ${result.modifiedCount} projects`);
    } catch (err) {
      errors++;
      console.error(`    ✗ Error: ${err.message}`);
    }
  }

  // Step 6: Summary
  console.log('');
  console.log('─'.repeat(50));
  console.log('✅ Migration complete!');
  console.log(`   ${migrated} projects updated successfully`);
  if (errors > 0) {
    console.log(`   ${errors} errors occurred`);
  }
  console.log('');
  console.log('Refresh your /dashboard/departments page to see the changes.');

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error('❌ Migration failed:', e);
  process.exit(1);
});
