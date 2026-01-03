const mongoose = require('mongoose');
const { dropOldIndexes } = require('../../scripts/drop-old-indexes');

async function connectDB(uri) {
  if (!uri) throw new Error('MONGO_URI is not set');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    // useNewUrlParser/useUnifiedTopology not needed in modern mongoose
    autoIndex: true,
  });

  // Drop old unique indexes that conflict with workspace-based schema
  // This runs once on startup and is safe to run multiple times
  try {
    await dropOldIndexes(mongoose.connection);
  } catch (err) {
    console.error('[db] Failed to drop old indexes:', err.message);
  }

  return mongoose.connection;
}

module.exports = { connectDB };

