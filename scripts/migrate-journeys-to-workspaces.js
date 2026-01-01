/**
 * Migration script: Journeys → Workspaces
 *
 * This script:
 * 1. Renames the 'journeys' collection to 'workspaces'
 * 2. Updates field names: jid → wid, defaultJourney → defaultWorkspace
 * 3. Updates references in related collections (ReviewSession, Decision, Assumption, Scenario)
 *
 * Usage: node scripts/migrate-journeys-to-workspaces.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

async function migrate() {
  if (!MONGO_URI) {
    console.error('MONGO_URI not set in environment');
    process.exit(1);
  }

  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  const db = mongoose.connection.db;

  try {
    // Check if journeys collection exists
    const collections = await db.listCollections({ name: 'journeys' }).toArray();

    if (collections.length === 0) {
      console.log('No "journeys" collection found. Checking if already migrated...');
      const workspacesExists = await db.listCollections({ name: 'workspaces' }).toArray();
      if (workspacesExists.length > 0) {
        console.log('"workspaces" collection already exists. Migration may have already run.');
      } else {
        console.log('No collections to migrate. Fresh install - no action needed.');
      }
      return;
    }

    console.log('Found "journeys" collection. Starting migration...');

    // Step 1: Update field names in journeys collection
    console.log('\n1. Updating field names in journeys collection...');
    const journeysCollection = db.collection('journeys');

    // Rename jid → wid
    const renameJidResult = await journeysCollection.updateMany(
      { jid: { $exists: true } },
      { $rename: { 'jid': 'wid' } }
    );
    console.log(`   Renamed jid → wid in ${renameJidResult.modifiedCount} documents`);

    // Rename defaultJourney → defaultWorkspace
    const renameDefaultResult = await journeysCollection.updateMany(
      { defaultJourney: { $exists: true } },
      { $rename: { 'defaultJourney': 'defaultWorkspace' } }
    );
    console.log(`   Renamed defaultJourney → defaultWorkspace in ${renameDefaultResult.modifiedCount} documents`);

    // Update wid prefix from j_ to ws_ if needed
    const cursor = journeysCollection.find({ wid: { $regex: /^j_/ } });
    let prefixUpdateCount = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const newWid = doc.wid.replace(/^j_/, 'ws_');
      await journeysCollection.updateOne(
        { _id: doc._id },
        { $set: { wid: newWid } }
      );
      prefixUpdateCount++;
    }
    console.log(`   Updated wid prefix j_ → ws_ in ${prefixUpdateCount} documents`);

    // Step 2: Rename collection
    console.log('\n2. Renaming collection journeys → workspaces...');
    await journeysCollection.rename('workspaces');
    console.log('   Collection renamed successfully');

    // Step 3: Update references in ReviewSession
    console.log('\n3. Updating ReviewSession references...');
    const reviewsExists = await db.listCollections({ name: 'reviewsessions' }).toArray();
    if (reviewsExists.length > 0) {
      const reviews = db.collection('reviewsessions');
      const reviewResult = await reviews.updateMany(
        { journey: { $exists: true } },
        { $rename: { 'journey': 'workspace' } }
      );
      console.log(`   Updated ${reviewResult.modifiedCount} ReviewSession documents`);
    } else {
      console.log('   No reviewsessions collection found');
    }

    // Step 4: Update references in Decision
    console.log('\n4. Updating Decision references...');
    const decisionsExists = await db.listCollections({ name: 'decisions' }).toArray();
    if (decisionsExists.length > 0) {
      const decisions = db.collection('decisions');
      const decisionResult = await decisions.updateMany(
        { journey: { $exists: true } },
        { $rename: { 'journey': 'workspace' } }
      );
      console.log(`   Updated ${decisionResult.modifiedCount} Decision documents`);
    } else {
      console.log('   No decisions collection found');
    }

    // Step 5: Update references in Assumption
    console.log('\n5. Updating Assumption references...');
    const assumptionsExists = await db.listCollections({ name: 'assumptions' }).toArray();
    if (assumptionsExists.length > 0) {
      const assumptions = db.collection('assumptions');
      const assumptionResult = await assumptions.updateMany(
        { journey: { $exists: true } },
        { $rename: { 'journey': 'workspace' } }
      );
      console.log(`   Updated ${assumptionResult.modifiedCount} Assumption documents`);
    } else {
      console.log('   No assumptions collection found');
    }

    // Step 6: Update references in Scenario
    console.log('\n6. Updating Scenario references...');
    const scenariosExists = await db.listCollections({ name: 'scenarios' }).toArray();
    if (scenariosExists.length > 0) {
      const scenarios = db.collection('scenarios');
      const scenarioResult = await scenarios.updateMany(
        { journey: { $exists: true } },
        { $rename: { 'journey': 'workspace' } }
      );
      console.log(`   Updated ${scenarioResult.modifiedCount} Scenario documents`);
    } else {
      console.log('   No scenarios collection found');
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Update your code to use Workspace model instead of Journey');
    console.log('2. Update route handlers to use /api/workspaces');
    console.log('3. Update frontend to use workspace terminology');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

migrate();
