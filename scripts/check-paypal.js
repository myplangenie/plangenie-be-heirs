/**
 * Check PayPal competitor data
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');

const Competitor = require('../src/models/Competitor');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/plangenie';

async function main() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected\n');

    // Find PayPal
    const paypal = await Competitor.findOne({
      name: { $regex: /paypal/i },
      isDeleted: false
    }).lean();

    if (paypal) {
      console.log('=== PAYPAL COMPETITOR ===\n');
      console.log('Full document:');
      console.log(JSON.stringify(paypal, null, 2));
      console.log('\n');
      console.log('name:', paypal.name);
      console.log('advantage:', paypal.advantage);
      console.log('weDoBetter:', paypal.weDoBetter);
    } else {
      console.log('PayPal competitor not found');
    }

  } catch (err) {
    console.error('ERROR:', err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
