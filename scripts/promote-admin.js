#!/usr/bin/env node
require('dotenv').config();
const { connectDB } = require('../src/config/db');
const User = require('../src/models/User');

function parseArgs(argv) {
  const out = { email: null, demote: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--email' && argv[i+1]) { out.email = String(argv[++i]).trim(); continue; }
    if (a === '--demote') { out.demote = true; continue; }
  }
  return out;
}

(async () => {
  const { email, demote } = parseArgs(process.argv.slice(2));
  if (!email) {
    console.error('Usage: node scripts/promote-admin.js --email user@example.com [--demote]');
    process.exit(2);
  }
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGO_URI not set in environment');
    process.exit(2);
  }
  await connectDB(uri);
  const update = demote ? { isAdmin: false } : { isAdmin: true };
  const user = await User.findOneAndUpdate({ email: email.toLowerCase() }, update, { new: true });
  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }
  console.log(`${demote ? 'Demoted' : 'Promoted'} ${user.email} -> isAdmin=${user.isAdmin}`);
  process.exit(0);
})().catch((err) => {
  console.error('Error:', err?.message || err);
  process.exit(1);
});

