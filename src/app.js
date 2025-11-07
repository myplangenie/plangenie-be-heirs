const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

// CORS
const originsFromEnv = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true); // allow REST tools/curl
      if (originsFromEnv.length === 0 || originsFromEnv.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/onboarding', require('./routes/onboarding.routes'));
app.use('/api/misc', require('./routes/misc.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
// Optional integrations
app.use('/api/gamma', require('./routes/gamma.routes'));
// Chat
app.use('/api/chat', require('./routes/chat.routes'));

// Error handler
app.use(errorHandler);

module.exports = app;
