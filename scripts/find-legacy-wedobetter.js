/**
 * Search for where "What we do better" data was stored in the legacy system
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

    // Get the full Onboarding document for Contranet
    const onboarding = await db.collection('onboardings').findOne({
      workspace: new mongoose.Types.ObjectId(workspaceId)
    });

    if (onboarding) {
      console.log('=== FULL ONBOARDING DOCUMENT FOR CONTRANET ===\n');
      console.log('Top-level keys:', Object.keys(onboarding).join(', '));

      if (onboarding.answers) {
        console.log('\n=== answers keys ===');
        console.log(Object.keys(onboarding.answers).join(', '));

        // Print any field that might contain competitor data
        const competitorFields = ['compNotes', 'competitorsNotes', 'competitorNames', 'competitorAdvantages',
          'competitors', 'competitorDiff', 'competitorDifferentiation', 'weDoBetter', 'ourAdvantages',
          'marketCompetitors', 'market'];

        console.log('\n=== Competitor-related fields ===');
        for (const field of competitorFields) {
          if (onboarding.answers[field] !== undefined) {
            const val = onboarding.answers[field];
            console.log(`${field}:`, typeof val === 'string' ? val.substring(0, 200) : JSON.stringify(val).substring(0, 200));
          }
        }

        // Search all string fields for "what we do better" or "paypal"
        console.log('\n=== Fields containing "paypal" or "what we do better" ===');
        for (const [key, val] of Object.entries(onboarding.answers)) {
          if (typeof val === 'string') {
            if (val.toLowerCase().includes('paypal') || val.toLowerCase().includes('what we do better')) {
              console.log(`${key}:`, val.substring(0, 300));
            }
          } else if (typeof val === 'object' && val !== null) {
            const jsonStr = JSON.stringify(val).toLowerCase();
            if (jsonStr.includes('paypal') || jsonStr.includes('what we do better')) {
              console.log(`${key}:`, JSON.stringify(val).substring(0, 300));
            }
          }
        }
      }

      // Check if there are any other top-level fields
      console.log('\n=== Other top-level fields ===');
      for (const [key, val] of Object.entries(onboarding)) {
        if (key !== 'answers' && key !== '_id' && key !== '__v') {
          if (typeof val === 'object' && val !== null) {
            const jsonStr = JSON.stringify(val).toLowerCase();
            if (jsonStr.includes('paypal') || jsonStr.includes('what we do better') || jsonStr.includes('competitor')) {
              console.log(`${key}:`, JSON.stringify(val).substring(0, 300));
            }
          }
        }
      }
    }

    // Also check Journey collection
    console.log('\n\n=== CHECKING JOURNEYS ===');
    const journeys = await db.collection('journeys').find({
      workspace: new mongoose.Types.ObjectId(workspaceId)
    }).toArray();

    console.log(`Found ${journeys.length} journeys`);
    for (const j of journeys) {
      const jsonStr = JSON.stringify(j).toLowerCase();
      if (jsonStr.includes('paypal') || jsonStr.includes('what we do better')) {
        console.log('Journey contains relevant data:', Object.keys(j).join(', '));
        if (j.answers) console.log('answers keys:', Object.keys(j.answers).join(', '));
      }
    }

    // Check Dashboard collection
    console.log('\n\n=== CHECKING DASHBOARDS ===');
    const dashboards = await db.collection('dashboards').find({
      $or: [
        { workspace: new mongoose.Types.ObjectId(workspaceId) },
        { workspace: workspaceId },
      ]
    }).toArray();

    console.log(`Found ${dashboards.length} dashboards`);
    for (const d of dashboards) {
      const jsonStr = JSON.stringify(d).toLowerCase();
      if (jsonStr.includes('paypal') || jsonStr.includes('stripe')) {
        console.log('Dashboard contains PayPal/Stripe:', Object.keys(d).join(', '));
      }
    }

    // Check Plans collection for market.competitors
    console.log('\n\n=== CHECKING PLANS ===');
    const plans = await db.collection('plans').find({}).toArray();
    console.log(`Found ${plans.length} total plans`);

    for (const p of plans) {
      if (p.market?.competitors) {
        const compStr = typeof p.market.competitors === 'string' ? p.market.competitors : JSON.stringify(p.market.competitors);
        if (compStr.toLowerCase().includes('what we do better')) {
          console.log(`Plan ${p._id} has weDoBetter in market.competitors`);
          console.log('  workspace:', p.workspace);
          console.log('  competitors sample:', compStr.substring(0, 300));
        }
      }
    }

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
