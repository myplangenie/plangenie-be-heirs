const express = require('express');
const auth = require('../middleware/auth');
const ensureOnboarded = require('../middleware/ensureOnboarded');
const ctrl = require('../controllers/dashboard.controller');
const viewAs = require('../middleware/viewAs');

const router = express.Router();

// All dashboard APIs require auth; allow view-as (read-only) for collaborators
router.use(auth(true));
router.use(viewAs);

router.get('/summary', ensureOnboarded, ctrl.getSummary);
// Insights
router.get('/insights', ensureOnboarded, ctrl.getInsights);
router.post('/insights/generate', ensureOnboarded, ctrl.generateInsights);
router.get('/strategy-canvas', ensureOnboarded, ctrl.getStrategyCanvas);
router.patch('/strategy-canvas', ensureOnboarded, ctrl.updateStrategyCanvas);

// Notifications
router.get('/notifications', ensureOnboarded, ctrl.getNotifications);
router.post('/notifications/mark-all-read', ensureOnboarded, ctrl.markAllRead);
router.patch('/notifications/preferences', ensureOnboarded, ctrl.updateNotificationPrefs);

// Departments
router.get('/departments', ensureOnboarded, ctrl.getDepartments);
router.patch('/departments', ensureOnboarded, ctrl.updateDepartment);
// Action plans: update the status of a single assignment item
router.patch('/action-assignments/status', ensureOnboarded, ctrl.updateActionAssignmentStatus);
// Action plans: update fields of a single assignment item
router.patch('/action-assignments/item', ensureOnboarded, ctrl.updateActionAssignmentItem);

// Financials
router.get('/financials', ensureOnboarded, ctrl.getFinancials);
router.post('/financials/recalculate', ensureOnboarded, ctrl.recalculateFinancials);
router.post('/financials/assumptions', ensureOnboarded, ctrl.saveFinancialAssumptions);
router.post('/financials/insights', ensureOnboarded, ctrl.generateFinancialInsights);
// Update/blend actuals for financials (monthly)
router.post('/financials/actuals', ensureOnboarded, ctrl.saveFinancialActuals);
// Import monthly actuals via CSV text
router.post('/financials/import', ensureOnboarded, ctrl.importFinancialsCSV);

// Products & Services
router.get('/products', ensureOnboarded, ctrl.getProducts);
router.put('/products', ensureOnboarded, ctrl.saveProducts);

// Plan
router.get('/plan', ensureOnboarded, ctrl.getPlan);
router.post('/plan/sections', ensureOnboarded, ctrl.addPlanSection);
router.delete('/plan/sections/:sid', ensureOnboarded, ctrl.deletePlanSection);
// Compiled Plan (Customizable Plan Builder)
// Allow access during onboarding-detail builder before final completion
router.post('/plan/compiled', ctrl.saveCompiledPlan);
router.get('/plan/compiled', ctrl.getCompiledPlan);
// Plan Prose (AI-generated narrative sections)
router.get('/plan/prose', ctrl.getPlanProse);
router.post('/plan/prose/generate', ctrl.generatePlanProse);

// Settings
router.get('/settings', ensureOnboarded, ctrl.getSettings);
router.patch('/settings/profile', ensureOnboarded, ctrl.updateProfile);
router.post('/settings/members', ensureOnboarded, ctrl.createMember);
router.patch('/settings/members/:mid', ensureOnboarded, ctrl.updateMember);
router.delete('/settings/members/:mid', ensureOnboarded, ctrl.deleteMember);

module.exports = router;
