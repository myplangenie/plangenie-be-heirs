/**
 * Check if PayPal's workspace has weDoBetter in old compNotes
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');

const Onboarding = require('../src/models/Onboarding');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/plangenie';

async function main() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected\n');

    // Find onboarding for PayPal's workspace
    const workspaceId = '6974ac0967d9a44d4550f084';

    const onboarding = await Onboarding.findOne({
      workspace: workspaceId
    }).lean();

    if (onboarding) {
      console.log('=== ONBOARDING FOR PAYPAL WORKSPACE ===\n');

      const compNotes = onboarding.answers?.compNotes || onboarding.answers?.competitorsNotes || '';

      console.log('compNotes field exists:', !!compNotes);
      console.log('compNotes length:', compNotes.length);
      console.log('\ncompNotes content:');
      console.log('---');
      console.log(compNotes || '(empty)');
      console.log('---');

      if (compNotes.toLowerCase().includes('what we do better')) {
        console.log('\n✓ "What we do better" text FOUND in compNotes');
      } else {
        console.log('\n✗ "What we do better" text NOT FOUND in compNotes');
      }
    } else {
      console.log('Onboarding not found for workspace', workspaceId);
    }

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
