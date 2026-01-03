/**
 * Drop old unique indexes that conflict with workspace-based schema
 *
 * This script removes the old `user_1` unique indexes from collections
 * that now use compound `{ user, workspace }` indexes.
 *
 * Can be run standalone: node scripts/drop-old-indexes.js
 * Or imported and called from server startup (runs only once)
 */

const mongoose = require('mongoose');

const MIGRATION_NAME = 'drop-user-unique-indexes-for-workspaces';

const COLLECTIONS_TO_FIX = [
  'onboardings',
  'plans',
  'dashboards',
  'financials',
  'plansections',
  'teammembers',
  'departments',
  'notifications',
];

async function dropOldIndexes(connection = mongoose.connection) {
  const db = connection.db;
  if (!db) {
    console.log('[drop-old-indexes] No database connection available, skipping.');
    return;
  }

  // Check if this migration has already run
  const migrationsCollection = db.collection('_migrations');
  const existing = await migrationsCollection.findOne({ name: MIGRATION_NAME });
  if (existing) {
    // Migration already completed, skip silently
    return;
  }

  console.log('[drop-old-indexes] Running one-time migration to drop old unique indexes...');

  for (const collName of COLLECTIONS_TO_FIX) {
    try {
      const collection = db.collection(collName);
      const indexes = await collection.indexes();

      // Find the old user_1 unique index
      const oldIndex = indexes.find(
        (idx) => idx.name === 'user_1' && idx.unique === true
      );

      if (oldIndex) {
        console.log(`[drop-old-indexes] Dropping old 'user_1' unique index from ${collName}...`);
        await collection.dropIndex('user_1');
        console.log(`[drop-old-indexes] Successfully dropped 'user_1' index from ${collName}`);
      }
    } catch (err) {
      // Ignore "index not found" errors, log others
      if (err.code !== 27 && !err.message?.includes('index not found')) {
        console.error(`[drop-old-indexes] Error processing ${collName}:`, err.message);
      }
    }
  }

  // Mark migration as complete
  await migrationsCollection.insertOne({
    name: MIGRATION_NAME,
    completedAt: new Date(),
  });

  console.log('[drop-old-indexes] Migration complete.');
}

// If run directly
if (require.main === module) {
  require('dotenv').config();
  const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

  (async () => {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.');

    await dropOldIndexes();

    await mongoose.disconnect();
    console.log('Disconnected.');
  })().catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
  });
}

module.exports = { dropOldIndexes };
