const express = require('express');
const router = express.Router({ mergeParams: true });
const ctrl = require('../controllers/scenario.controller');
const { requireWorkspaceAccess } = require('../middleware/workspaceAccess');

// All routes require at least viewer access to the workspace
const requireViewer = requireWorkspaceAccess('viewer');
const requireContributor = requireWorkspaceAccess('contributor');

/**
 * Financial Scenario Routes
 *
 * These routes manage the Scenario Sandbox for what-if analysis.
 * Base path: /api/workspaces/:wid/financial-scenarios
 */

// GET /api/workspaces/:wid/financial-scenarios
// List all scenarios
router.get('/', requireViewer, ctrl.list);

// POST /api/workspaces/:wid/financial-scenarios
// Create a new scenario
router.post('/', requireContributor, ctrl.create);

// POST /api/workspaces/:wid/financial-scenarios/quick-calc
// Quick calculation without saving (for real-time lever adjustments)
router.post('/quick-calc', requireViewer, ctrl.quickCalc);

// GET /api/workspaces/:wid/financial-scenarios/compare
// Compare baseline with a scenario
router.get('/compare', requireViewer, ctrl.compare);

// GET /api/workspaces/:wid/financial-scenarios/:sid
// Get a single scenario
router.get('/:sid', requireViewer, ctrl.get);

// PATCH /api/workspaces/:wid/financial-scenarios/:sid
// Update scenario levers
router.patch('/:sid', requireContributor, ctrl.update);

// POST /api/workspaces/:wid/financial-scenarios/:sid/calculate
// Recalculate scenario metrics
router.post('/:sid/calculate', requireViewer, ctrl.calculate);

// POST /api/workspaces/:wid/financial-scenarios/:sid/apply
// Apply scenario to baseline
router.post('/:sid/apply', requireContributor, ctrl.apply);

// POST /api/workspaces/:wid/financial-scenarios/:sid/discard
// Discard a scenario
router.post('/:sid/discard', requireContributor, ctrl.discard);

// DELETE /api/workspaces/:wid/financial-scenarios/:sid
// Permanently delete a scenario
router.delete('/:sid', requireContributor, ctrl.delete);

module.exports = router;
