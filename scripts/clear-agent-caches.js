/**
 * Clear Agent Caches Script
 * Removes all cached agent responses to force fresh generation
 *
 * Usage: node scripts/clear-agent-caches.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const AgentCache = require('../src/models/AgentCache');

async function main() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Delete all agent caches
    const result = await AgentCache.deleteMany({});
    console.log(`Deleted ${result.deletedCount} agent cache entries`);

    // Also show any remaining entries (should be 0)
    const remaining = await AgentCache.countDocuments();
    console.log(`Remaining entries: ${remaining}`);

    console.log('Done!');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
