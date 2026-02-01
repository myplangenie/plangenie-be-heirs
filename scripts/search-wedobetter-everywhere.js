/**
 * Search entire database for "weDoBetter" or competitor differentiation data
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/plangenie';

async function main() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected\n');

    const db = mongoose.connection.db;

    // Get all collections
    const collections = await db.listCollections().toArray();
    console.log(`Searching ${collections.length} collections...\n`);

    const workspaceId = '6974ac0967d9a44d4550f084'; // Contranet

    for (const col of collections) {
      const collection = db.collection(col.name);

      // Search for documents containing "what we do better" (case insensitive)
      const textSearch = await collection.find({
        $or: [
          { $text: { $search: "what we do better" } },
        ]
      }).limit(5).toArray().catch(() => []);

      // Search for weDoBetter field
      const fieldSearch = await collection.find({
        weDoBetter: { $exists: true, $ne: '' }
      }).limit(5).toArray().catch(() => []);

      // Search by workspace ID
      const workspaceSearch = await collection.find({
        $or: [
          { workspace: new mongoose.Types.ObjectId(workspaceId) },
          { workspace: workspaceId },
        ]
      }).limit(10).toArray().catch(() => []);

      if (fieldSearch.length > 0) {
        console.log(`\n=== ${col.name} - has weDoBetter field ===`);
        fieldSearch.forEach(doc => {
          console.log(`  ID: ${doc._id}`);
          console.log(`  weDoBetter: ${doc.weDoBetter?.substring(0, 100)}...`);
        });
      }

      if (workspaceSearch.length > 0) {
        console.log(`\n=== ${col.name} - Contranet workspace docs ===`);
        console.log(`  Found ${workspaceSearch.length} documents`);

        // Check each doc for any field containing "what we do better"
        for (const doc of workspaceSearch) {
          const jsonStr = JSON.stringify(doc).toLowerCase();
          if (jsonStr.includes('what we do better') || jsonStr.includes('wedobetter')) {
            console.log(`  Doc ${doc._id} contains "what we do better" or "weDoBetter"!`);
            console.log(`  Fields:`, Object.keys(doc).join(', '));
          }
        }
      }
    }

    // Direct search on Dashboard/Plan collections for Contranet
    console.log('\n\n=== DIRECT SEARCH FOR CONTRANET ===');

    const dashboards = await db.collection('dashboards').find({
      $or: [
        { workspace: new mongoose.Types.ObjectId(workspaceId) },
        { user: new mongoose.Types.ObjectId('6974ac0867d9a44d4550f082') },
      ]
    }).toArray();

    console.log(`\nDashboards for Contranet: ${dashboards.length}`);
    for (const d of dashboards) {
      const jsonStr = JSON.stringify(d);
      if (jsonStr.toLowerCase().includes('paypal') || jsonStr.toLowerCase().includes('stripe')) {
        console.log('  Found dashboard with PayPal/Stripe:');
        // Look for competitor-related fields
        if (d.market) console.log('  market:', JSON.stringify(d.market).substring(0, 500));
        if (d.competitors) console.log('  competitors:', JSON.stringify(d.competitors).substring(0, 500));
      }
    }

    const plans = await db.collection('plans').find({
      $or: [
        { workspace: new mongoose.Types.ObjectId(workspaceId) },
        { user: new mongoose.Types.ObjectId('6974ac0867d9a44d4550f082') },
      ]
    }).toArray();

    console.log(`\nPlans for Contranet: ${plans.length}`);
    for (const p of plans) {
      const jsonStr = JSON.stringify(p);
      if (jsonStr.toLowerCase().includes('paypal') || jsonStr.toLowerCase().includes('stripe')) {
        console.log('  Found plan with PayPal/Stripe');
        if (p.sections) {
          for (const [key, val] of Object.entries(p.sections)) {
            if (JSON.stringify(val).toLowerCase().includes('paypal')) {
              console.log(`  Section "${key}":`, JSON.stringify(val).substring(0, 500));
            }
          }
        }
      }
    }

    // Check journeys
    const journeys = await db.collection('journeys').find({
      workspace: new mongoose.Types.ObjectId(workspaceId),
    }).toArray();

    console.log(`\nJourneys for Contranet: ${journeys.length}`);
    for (const j of journeys) {
      if (j.market || j.competitors || j.answers) {
        console.log('  Journey has market/competitors/answers');
        if (j.answers?.compNotes) console.log('  compNotes:', j.answers.compNotes.substring(0, 200));
        if (j.answers?.competitorNames) console.log('  competitorNames:', j.answers.competitorNames);
      }
    }

    console.log('\n=== SEARCH COMPLETE ===');

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
