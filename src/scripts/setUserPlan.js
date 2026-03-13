#!/usr/bin/env node
/* eslint-disable no-console */
require('dotenv').config();
const mongoose = require('mongoose');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[k] = v;
    }
  }
  return args;
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email || args.e;
  const plan = String(args.plan || 'enterprise').toLowerCase(); // enterprise|pro|lite
  const active = String(args.active ?? 'true').toLowerCase() !== 'false'; // default true

  if (!email) {
    console.error('Usage: node src/scripts/setUserPlan.js --email user@example.com [--plan enterprise] [--active true]');
    process.exit(1);
  }
  if (!process.env.MONGO_URI) {
    console.error('Set MONGO_URI in env before running.');
    process.exit(1);
  }

  const allowedPlans = new Set(['enterprise', 'pro', 'lite']);
  if (!allowedPlans.has(plan)) {
    console.error(`Invalid --plan ${plan}. Use one of: enterprise, pro, lite`);
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB || undefined });
    const users = mongoose.connection.collection('users');

    const emailRegex = new RegExp(`^${escapeRegex(email)}$`, 'i');
    const now = new Date();

    const before = await users.findOne(
      { email: emailRegex },
      { projection: { _id: 1, email: 1, planSlug: 1, hasActiveSubscription: 1 } }
    );
    if (!before) {
      console.error(`No user found for email ${email}`);
      process.exit(2);
    }

    const update = {
      $set: {
        planSlug: plan,
        hasActiveSubscription: active,
        updatedAt: now,
      },
    };

    const res = await users.findOneAndUpdate(
      { _id: before._id },
      update,
      { returnDocument: 'after' }
    );

    console.log('Updated user plan successfully:', {
      email: res.value?.email,
      from: { planSlug: before.planSlug, hasActiveSubscription: before.hasActiveSubscription },
      to:   { planSlug: res.value?.planSlug, hasActiveSubscription: res.value?.hasActiveSubscription },
    });
    process.exit(0);
  } catch (err) {
    console.error('Error:', err?.message || err);
    process.exit(3);
  } finally {
    try { await mongoose.disconnect(); } catch {}
  }
})();

