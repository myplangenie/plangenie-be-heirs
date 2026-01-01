const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');
const subscriptionCtrl = require('./controllers/subscription.controller');

const app = express();

// Webhook (Stripe) must use raw body for signature verification; mount BEFORE json parser
app.post('/api/subscriptions/webhook', express.raw({ type: 'application/json' }), subscriptionCtrl.webhook);

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
  allowedHeaders: ['Content-Type', 'Authorization', 'X-View-As', 'X-Workspace-Id', 'X-Journey-Id'],
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
app.use('/api/collab', require('./routes/collab.routes'));
// Subscriptions
app.use('/api/subscriptions', require('./routes/subscription.routes'));
// Optional integrations
app.use('/api/gamma', require('./routes/gamma.routes'));
// Chat
app.use('/api/chat', require('./routes/chat.routes'));
// Admin
app.use('/api/admin', require('./routes/admin.routes'));
// AI Agents
app.use('/api/agents', require('./routes/agents.routes'));
// Workspaces (feature-flagged) - replaces Journeys
const enableWorkspaces = String(process.env.FEATURE_WORKSPACES || process.env.FEATURE_JOURNEYS || '').toLowerCase() === 'true';
if (enableWorkspaces) {
  app.use('/api/workspaces', require('./routes/workspace.routes'));
  // Keep /api/journeys as alias for backward compatibility during migration
  app.use('/api/journeys', require('./routes/workspace.routes'));
  // Initialize priority recalculation background job
  require('./jobs/recalculatePriorities').init();
} else {
  app.use('/api/workspaces', require('./routes/workspace.stub.routes'));
  app.use('/api/journeys', require('./routes/workspace.stub.routes'));
}

// Initialize weekly notification job (runs every Friday at 9am)
require('./jobs/weeklyNotifications').init();

// Error handler
app.use(errorHandler);

module.exports = app;
