#!/usr/bin/env node
// One-time migration: populate Collaboration.collaborator for accepted rows
// and prefer id-based lookups over email.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGO_URI || process.env.DATABASE_URL || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Missing MONGO_URI (or DATABASE_URL/MONGODB_URI) in env');
    process.exit(1);
  }
  await mongoose.connect(uri, { dbName: process.env.MONGO_DB || undefined });

  const Collaboration = require('../src/models/Collaboration');
  const User = require('../src/models/User');

  const session = await mongoose.startSession();
  let updated = 0;
  try {
    await session.withTransaction(async () => {
      // Case 1: accepted rows with viewer set but collaborator missing
      const cur1 = Collaboration.find({ status: 'accepted', viewer: { $type: 'objectId' }, $or: [ { collaborator: { $exists: false } }, { collaborator: null } ] }).cursor();
      for await (const doc of cur1) {
        try {
          doc.collaborator = doc.viewer;
          await doc.save({ session });
          updated++;
        } catch (e) {
          console.warn('Skip viewer->collaborator for', String(doc._id), e?.message || e);
        }
      }
      // Case 2: accepted rows with collaborator missing and viewer missing, but email matches a user
      const cur2 = Collaboration.find({ status: 'accepted', $or: [ { collaborator: { $exists: false } }, { collaborator: null } ], $or: [ { viewer: { $exists: false } }, { viewer: null } ] }).cursor();
      for await (const doc of cur2) {
        const email = String(doc.email || '').toLowerCase();
        if (!email) continue;
        try {
          const u = await User.findOne({ email }).select('_id').lean().exec();
          if (u && String(u._id) !== String(doc.owner)) {
            doc.collaborator = u._id;
            await doc.save({ session });
            updated++;
          }
        } catch (e) {
          console.warn('Skip email->collaborator for', String(doc._id), e?.message || e);
        }
      }
    });
  } finally {
    session.endSession();
    await mongoose.disconnect();
  }
  console.log(`Migration complete. Updated ${updated} collaboration(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

