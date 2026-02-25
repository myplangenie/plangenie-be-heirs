/**
 * Migration script: Move all users to weekly for dailyWish emails
 * Run: node src/scripts/migrateDailyWishToWeekly.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Workspace = require('../models/Workspace');

async function migrate() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI not configured');
      process.exit(1);
    }

    console.log('Connecting to MongoDB...');
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    // Update all workspaces: set dailyWish frequency to 'weekly'
    // This covers:
    // 1. Users with 'daily' explicitly set
    // 2. Users with no preference (will now have 'weekly' explicitly set)
    const result = await Workspace.updateMany(
      {},
      {
        $set: {
          'notificationPreferences.emailFrequency.dailyWish': 'weekly'
        }
      }
    );

    console.log(`Migration complete!`);
    console.log(`- Matched: ${result.matchedCount} workspaces`);
    console.log(`- Modified: ${result.modifiedCount} workspaces`);
    console.log(`\nAll users are now set to receive weekly AI recommendations.`);
    console.log(`Users can change this in Settings → Notifications → AI Recommendations.`);
    console.log(`They can also set it to "Never" to stop receiving these emails.`);

  } catch (err) {
    console.error('Migration failed:', err?.message || err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

migrate();
