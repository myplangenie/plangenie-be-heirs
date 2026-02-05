/**
 * Seed the test account: test@plangenie.com / plangenie123
 *
 * Run once:  node src/scripts/seedTestAccount.js
 *
 * If the account already exists it will NOT overwrite any data.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Notification = require('../models/Notification');

const TEST_EMAIL = 'test@plangenie.com';
const TEST_PASSWORD = 'plangenie123';

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const existing = await User.findOne({ email: TEST_EMAIL });
  if (existing) {
    console.log(`Test account already exists (id=${existing._id}). No changes made.`);
    await mongoose.disconnect();
    return;
  }

  const hashed = await User.hashPassword(TEST_PASSWORD);

  const user = await User.create({
    firstName: 'Test',
    lastName: 'User',
    fullName: 'Test User',
    companyName: 'PlanGenie Test',
    email: TEST_EMAIL,
    password: hashed,
    isVerified: false,
    onboardingDone: false,
  });

  console.log(`Created test user: ${user._id}`);

  // Create default workspace
  const wid = `ws_${crypto.randomBytes(6).toString('hex')}`;
  const workspace = await Workspace.create({
    user: user._id,
    wid,
    name: 'PlanGenie Test',
    defaultWorkspace: true,
  });

  console.log(`Created test workspace: ${workspace.wid}`);

  // Welcome notification
  await Notification.create({
    user: user._id,
    workspace: workspace._id,
    nid: `welcome_${user._id}`,
    title: 'Welcome to Plan Genie!',
    description: "We're excited to have you on board. Explore your dashboard to track progress, manage projects, and access AI-powered insights for your business.",
    type: 'info',
    severity: 'success',
    time: 'Just now',
    actions: [{ label: 'View Dashboard', kind: 'primary' }],
  });

  console.log('Done! Test account ready.');
  console.log(`  Email:    ${TEST_EMAIL}`);
  console.log(`  Password: ${TEST_PASSWORD}`);
  console.log(`  OTP:      123456`);

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
