/**
 * Search for JSON-format competitor data with weDoBetter
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/plangenie';

async function main() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected\n');

    const db = mongoose.connection.db;
    const workspaceId = '6974ac0967d9a44d4550f084'; // Contranet

    // Search ALL collections for JSON with "weDoBetter" key
    const collections = await db.listCollections().toArray();

    for (const col of collections) {
      const collection = db.collection(col.name);

      // Search for documents with string fields containing "weDoBetter"
      // This catches JSON stored as string
      try {
        const docs = await collection.find({
          $or: [
            { workspace: new mongoose.Types.ObjectId(workspaceId) },
            { workspace: workspaceId },
          ]
        }).toArray();

        for (const doc of docs) {
          // Stringify and search for weDoBetter pattern
          const jsonStr = JSON.stringify(doc);
          if (jsonStr.includes('"weDoBetter"') || jsonStr.includes("'weDoBetter'")) {
            console.log(`\n=== Found in ${col.name} ===`);
            console.log('Doc ID:', doc._id);

            // Find which field contains it
            for (const [key, val] of Object.entries(doc)) {
              if (typeof val === 'string' && val.includes('weDoBetter')) {
                console.log(`Field "${key}" contains weDoBetter JSON:`);
                console.log(val.substring(0, 500));
              } else if (typeof val === 'object' && val !== null) {
                const subJson = JSON.stringify(val);
                if (subJson.includes('weDoBetter')) {
                  console.log(`Field "${key}" contains weDoBetter:`);
                  console.log(subJson.substring(0, 500));
                }
              }
            }
          }
        }
      } catch (e) {
        // Skip errors
      }
    }

    // Also specifically check Plans collection for market.competitors with JSON
    console.log('\n\n=== CHECKING ALL PLANS for JSON competitors ===');
    const plans = await db.collection('plans').find({}).toArray();

    for (const p of plans) {
      // Check market.competitors
      if (p.market?.competitors) {
        const compStr = p.market.competitors;
        if (typeof compStr === 'string' && compStr.includes('weDoBetter')) {
          console.log(`\nPlan ${p._id} (workspace: ${p.workspace}):`);
          console.log('market.competitors:', compStr.substring(0, 400));
        }
      }

      // Check sections
      if (p.sections) {
        for (const [secKey, secVal] of Object.entries(p.sections)) {
          const secStr = JSON.stringify(secVal);
          if (secStr.includes('weDoBetter')) {
            console.log(`\nPlan ${p._id} section "${secKey}":`);
            console.log(secStr.substring(0, 400));
          }
        }
      }
    }

    // Check Dashboards
    console.log('\n\n=== CHECKING ALL DASHBOARDS ===');
    const dashboards = await db.collection('dashboards').find({}).toArray();

    for (const d of dashboards) {
      const jsonStr = JSON.stringify(d);
      if (jsonStr.includes('weDoBetter')) {
        console.log(`\nDashboard ${d._id} (workspace: ${d.workspace}):`);

        if (d.market?.competitors) {
          console.log('market.competitors:', typeof d.market.competitors === 'string'
            ? d.market.competitors.substring(0, 400)
            : JSON.stringify(d.market.competitors).substring(0, 400));
        }

        // Check all fields
        for (const [key, val] of Object.entries(d)) {
          if (typeof val === 'string' && val.includes('weDoBetter')) {
            console.log(`Field "${key}":`, val.substring(0, 400));
          }
        }
      }
    }

    // Check onboardings compNotes for JSON format
    console.log('\n\n=== CHECKING ONBOARDINGS for JSON compNotes ===');
    const onboardings = await db.collection('onboardings').find({
      'answers.compNotes': { $regex: 'weDoBetter' }
    }).toArray();

    console.log(`Found ${onboardings.length} onboardings with weDoBetter in compNotes`);
    for (const ob of onboardings) {
      console.log(`\nOnboarding ${ob._id} (workspace: ${ob.workspace}):`);
      console.log('compNotes:', ob.answers.compNotes?.substring(0, 400));
    }

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
