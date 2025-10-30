const mongoose = require('mongoose');

async function connectDB(uri) {
  if (!uri) throw new Error('MONGO_URI is not set');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    // useNewUrlParser/useUnifiedTopology not needed in modern mongoose
    autoIndex: true,
  });
  return mongoose.connection;
}

module.exports = { connectDB };

