const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const errorHandler = require('./middleware/errorHandler');
const subscriptionCtrl = require('./controllers/subscription.controller');

const app = express();

// Webhook (Stripe) must use raw body for signature verification; mount BEFORE json parser
app.post('/api/subscriptions/webhook', express.raw({ type: 'application/json' }), subscriptionCtrl.webhook);

// Middleware
// Increase JSON limit to allow base64 image payloads for avatar upload
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
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

// Allowed origins priority:
// 1) CORS_ORIGINS if provided (comma-separated)
// 2) FRONTEND_ORIGIN if set
// 3) Fallback to plangenie.com
const feOrigin = (process.env.FRONTEND_ORIGIN || '').trim();
const fallbackOrigins = feOrigin ? [normalizeOrigin(feOrigin)] : ['https://plangenie.com'];
const allowedOrigins = new Set(envOrigins.length > 0 ? envOrigins : fallbackOrigins);

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

// Debug endpoint for cookie configuration (temporary - remove after debugging)
app.get('/debug/cookie-config', (req, res) => {
  const { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } = require('./config/cookies');
  res.json({
    nodeEnv: process.env.NODE_ENV,
    cookieDomain: process.env.COOKIE_DOMAIN || '(not set)',
    cookieSameSite: process.env.COOKIE_SAMESITE || '(using default)',
    accessCookieOptions: ACCESS_TOKEN_COOKIE.options,
    refreshCookieOptions: REFRESH_TOKEN_COOKIE.options,
    corsOrigins: Array.from(allowedOrigins),
  });
});

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/onboarding', require('./routes/onboarding.routes'));
app.use('/api/misc', require('./routes/misc.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/dashboard/revenue-streams', require('./routes/revenueStream.routes'));
app.use('/api/dashboard/financial-baseline', require('./routes/financialBaseline.routes'));
// Core & Department Projects (individual document collections)
app.use('/api/core-projects', require('./routes/coreProject.routes'));
app.use('/api/department-projects', require('./routes/departmentProject.routes'));
// Individual entity collections (replacing array-based storage)
app.use('/api/products', require('./routes/product.routes'));
app.use('/api/org-positions', require('./routes/orgPosition.routes'));
app.use('/api/vision-goals', require('./routes/visionGoal.routes'));
app.use('/api/okrs', require('./routes/okr.routes'));
app.use('/api/competitors', require('./routes/competitor.routes'));
app.use('/api/swot', require('./routes/swotEntry.routes'));
// Individual field updates (replacing full answers object replacement)
app.use('/api/workspace-fields', require('./routes/workspaceField.routes'));
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
// Strategy Documents
app.use('/api/strategy-documents', require('./routes/strategyDocument.routes'));
// Integration Requests
app.use('/api/integration-requests', require('./routes/integrationRequest.routes'));
// Workspaces (feature-flagged) - replaces Journeys
const enableWorkspaces = String(process.env.FEATURE_WORKSPACES || process.env.FEATURE_JOURNEYS || '').toLowerCase() === 'true';
if (enableWorkspaces) {
  app.use('/api/workspaces', require('./routes/workspace.routes'));
  // Keep /api/journeys as alias for backward compatibility during migration
  app.use('/api/journeys', require('./routes/workspace.routes'));
  // Workspace invites (semi-public routes)
  app.use('/api/workspace-invite', require('./routes/workspaceInvite.routes'));
  // Initialize priority recalculation background job
  require('./jobs/recalculatePriorities').init();
} else {
  app.use('/api/workspaces', require('./routes/workspace.stub.routes'));
  app.use('/api/journeys', require('./routes/workspace.stub.routes'));
}

// Initialize weekly notification job (runs every Friday at 9 AM Eastern / 14:00 UTC)
// require('./jobs/weeklyNotifications').init();

// Initialize daily wish job (runs daily at 12 noon Eastern / 17:00 UTC)
require('./jobs/dailyWish').init();

// Initialize review reminders job (runs daily at 8 AM Eastern / 13:00 UTC)
require('./jobs/reviewReminders').init();

// Initialize account deletion job (runs daily at 03:00 server time)
try { require('./jobs/accountDeletion').schedule(); } catch (_) {}

// Error handler
app.use(errorHandler);

module.exports = app;
