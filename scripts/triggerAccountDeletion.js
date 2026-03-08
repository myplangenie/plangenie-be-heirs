/**
 * Script to trigger the account deletion job.
 *
 * Usage:
 *   node scripts/triggerAccountDeletion.js [--dry-run]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const { runJob } = require('../src/jobs/accountDeletion');

async function main() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('Error: MONGODB_URI or MONGO_URI not set');
    process.exit(1);
  }

  console.log('[accountDeletion] Connecting to MongoDB...');
  await mongoose.connect(mongoUri);
  console.log('[accountDeletion] Connected.');

  try {
    const result = await runJob();
    console.log('[accountDeletion] Result:', result);
  } finally {
    await mongoose.disconnect();
    console.log('[accountDeletion] Disconnected.');
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});

