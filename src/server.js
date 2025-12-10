require('dotenv').config();
const app = require('./app');
const { connectDB } = require('./config/db');

const PORT = process.env.PORT || 8000;

async function start() {
  try {
    const skipDb = String(process.env.SKIP_DB || '').toLowerCase() === 'true' || process.env.SKIP_DB === '1';
    if (skipDb) {
      console.warn('SKIP_DB enabled — starting server without MongoDB connection');
    } else {
      await connectDB(process.env.MONGO_URI);
      console.log('MongoDB connected');
    }
    app.listen(PORT, () => console.log(`Server running on port ${PORT}` + (skipDb ? ' (no DB)' : '')));
  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

start();
