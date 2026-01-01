#!/usr/bin/env node
/**
 * Script to manually trigger the weekly digest email
 * Usage: node scripts/triggerWeeklyDigest.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const weeklyNotifications = require('../src/jobs/weeklyNotifications');

async function main() {
  console.log('Connecting to MongoDB...');

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('ERROR: MONGODB_URI or MONGO_URI not set in environment');
    process.exit(1);
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('ERROR: RESEND_API_KEY not set in environment');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');

    console.log('\nTriggering weekly digest job...\n');
    await weeklyNotifications.runJob();

    console.log('\nDone!');
  } catch (err) {
    console.error('Error:', err.message || err);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
    process.exit(0);
  }
}

main();
