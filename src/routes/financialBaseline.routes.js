const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/financialBaseline.controller');
const auth = require('../middleware/auth');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');

// All routes require authentication and workspace resolution
router.use(auth());
router.use(workspaceContext);

// GET /api/dashboard/financial-baseline
// Get the full financial baseline for current workspace
router.get('/', requireViewer, ctrl.get);

// GET /api/dashboard/financial-baseline/metrics
// Get just the metrics (lighter endpoint)
router.get('/metrics', requireViewer, ctrl.getMetrics);

// GET /api/dashboard/financial-baseline/forecast
// Get forecast data
router.get('/forecast', requireViewer, ctrl.getForecast);

// PATCH /api/dashboard/financial-baseline/work-costs
// Update work-related costs
router.patch('/work-costs', requireContributor, ctrl.updateWorkCosts);

// PATCH /api/dashboard/financial-baseline/fixed-costs
// Update fixed costs
router.patch('/fixed-costs', requireContributor, ctrl.updateFixedCosts);

// PATCH /api/dashboard/financial-baseline/cash
// Update cash position
router.patch('/cash', requireContributor, ctrl.updateCash);

// POST /api/dashboard/financial-baseline/sync-revenue
// Sync revenue from revenue streams
router.post('/sync-revenue', requireContributor, ctrl.syncRevenue);

// POST /api/dashboard/financial-baseline/confirm
// Confirm baseline (marks as explicitly confirmed)
router.post('/confirm', requireContributor, ctrl.confirm);

module.exports = router;
