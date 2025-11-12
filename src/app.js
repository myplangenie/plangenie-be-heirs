const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middleware
// Increase JSON limit to allow base64 image payloads for avatar upload
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(morgan('dev'));

// CORS
function normalizeOrigin(o) {
  try {
    return new URL(o).origin; // strips trailing slash, normalizes host/port
  } catch (_e) {
    return (o || '').trim().replace(/\/$/, '');
  }
}

const envOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(normalizeOrigin);

// In production, default to the known public domains if not explicitly set
const defaultProdOrigins = ['https://plangenie.com', 'https://www.plangenie.com'];
const allowedOrigins = new Set(
  envOrigins.length > 0
    ? envOrigins
    : (process.env.NODE_ENV === 'production' ? defaultProdOrigins : [])
);

const corsOptions = {
  origin: function (origin, cb) {
    if (!origin) return cb(null, true); // allow REST tools/curl
    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.size === 0 || allowedOrigins.has(normalized)) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400, // cache preflight for 24h
};

app.use(cors(corsOptions));
// Explicitly enable preflight for all routes
app.options('*', cors(corsOptions));

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/onboarding', require('./routes/onboarding.routes'));
app.use('/api/misc', require('./routes/misc.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/user', require('./routes/user.routes'));
// Optional integrations
app.use('/api/gamma', require('./routes/gamma.routes'));
// Chat
app.use('/api/chat', require('./routes/chat.routes'));

// Error handler
app.use(errorHandler);

module.exports = app;
