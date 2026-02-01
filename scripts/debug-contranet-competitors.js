/**
 * Debug script to check Contranet workspace competitor data
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');

const Workspace = require('../src/models/Workspace');
const Competitor = require('../src/models/Competitor');
const Onboarding = require('../src/models/Onboarding');
const User = require('../src/models/User');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/plangenie';

async function main() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected\n');

    // Find user by email
    const user = await User.findOne({ email: 'adelekeifeoluwase@gmail.com' }).lean();
    console.log('=== USER ===');
    console.log('User ID:', user?._id);
    console.log('Email:', user?.email);

    // Find Contranet workspace
    const workspace = await Workspace.findOne({
      name: { $regex: /contranet/i }
    }).lean();

    console.log('\n=== WORKSPACE ===');
    console.log('Workspace ID:', workspace?._id);
    console.log('Workspace name:', workspace?.name);

    if (workspace) {
      // Get all competitors for this workspace
      const competitors = await Competitor.find({
        workspace: workspace._id,
        isDeleted: false
      }).sort({ order: 1 }).lean();

      console.log('\n=== COMPETITORS IN DATABASE ===');
      console.log('Total competitors:', competitors.length);
      competitors.forEach((c, i) => {
        console.log(`\n${i + 1}. ${c.name}`);
        console.log('   _id:', c._id);
        console.log('   advantage:', c.advantage || '(empty)');
        console.log('   weDoBetter:', c.weDoBetter || '(empty)');
        console.log('   weDoBetter field exists:', 'weDoBetter' in c);
      });

      // Check onboarding for this workspace
      const onboarding = await Onboarding.findOne({
        workspace: workspace._id
      }).lean();

      console.log('\n=== ONBOARDING compNotes ===');
      const compNotes = onboarding?.answers?.compNotes || onboarding?.answers?.competitorsNotes || '';
      console.log('compNotes exists:', !!compNotes);
      console.log('compNotes length:', compNotes.length);
      if (compNotes) {
        console.log('\ncompNotes content:');
        console.log('---');
        console.log(compNotes);
        console.log('---');
        console.log('\nContains "What we do better":', compNotes.toLowerCase().includes('what we do better'));
        console.log('Contains "What they do better":', compNotes.toLowerCase().includes('what they do better'));
      }

      // Also check competitorNames array
      const competitorNames = onboarding?.answers?.competitorNames || [];
      console.log('\n=== ONBOARDING competitorNames array ===');
      console.log('competitorNames:', competitorNames);
    } else {
      console.log('\nWorkspace "Contranet" not found!');

      // List all workspaces for this user
      if (user) {
        const userWorkspaces = await Workspace.find({
          $or: [
            { owner: user._id },
            { members: user._id }
          ]
        }).lean();
        console.log('\nUser workspaces:');
        userWorkspaces.forEach(w => console.log(`  - ${w.name} (${w._id})`));
      }
    }

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
