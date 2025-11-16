const express = require('express');
const auth = require('../middleware/auth');
const ensureOnboarded = require('../middleware/ensureOnboarded');
const ctrl = require('../controllers/dashboard.controller');

const router = express.Router();

// All dashboard APIs require auth
router.get('/summary', auth(true), ensureOnboarded, ctrl.getSummary);
// Insights
router.get('/insights', auth(true), ensureOnboarded, ctrl.getInsights);
router.post('/insights/generate', auth(true), ensureOnboarded, ctrl.generateInsights);
router.get('/strategy-canvas', auth(true), ensureOnboarded, ctrl.getStrategyCanvas);
router.patch('/strategy-canvas', auth(true), ensureOnboarded, ctrl.updateStrategyCanvas);

// Notifications
router.get('/notifications', auth(true), ensureOnboarded, ctrl.getNotifications);
router.post('/notifications/mark-all-read', auth(true), ensureOnboarded, ctrl.markAllRead);
router.patch('/notifications/preferences', auth(true), ensureOnboarded, ctrl.updateNotificationPrefs);

// Departments
router.get('/departments', auth(true), ensureOnboarded, ctrl.getDepartments);
router.patch('/departments', auth(true), ensureOnboarded, ctrl.updateDepartment);
// Action plans: update the status of a single assignment item
router.patch('/action-assignments/status', auth(true), ensureOnboarded, ctrl.updateActionAssignmentStatus);
// Action plans: update fields of a single assignment item
router.patch('/action-assignments/item', auth(true), ensureOnboarded, ctrl.updateActionAssignmentItem);

// Financials
router.get('/financials', auth(true), ensureOnboarded, ctrl.getFinancials);
router.post('/financials/recalculate', auth(true), ensureOnboarded, ctrl.recalculateFinancials);
router.post('/financials/insights', auth(true), ensureOnboarded, ctrl.generateFinancialInsights);
// Update/blend actuals for financials (monthly)
router.post('/financials/actuals', auth(true), ensureOnboarded, ctrl.saveFinancialActuals);
// Import monthly actuals via CSV text
router.post('/financials/import', auth(true), ensureOnboarded, ctrl.importFinancialsCSV);

// Products & Services
router.get('/products', auth(true), ensureOnboarded, ctrl.getProducts);
router.put('/products', auth(true), ensureOnboarded, ctrl.saveProducts);

// Plan
router.get('/plan', auth(true), ensureOnboarded, ctrl.getPlan);
router.post('/plan/sections', auth(true), ensureOnboarded, ctrl.addPlanSection);
router.delete('/plan/sections/:sid', auth(true), ensureOnboarded, ctrl.deletePlanSection);
// Compiled Plan (Customizable Plan Builder)
router.post('/plan/compiled', auth(true), ensureOnboarded, ctrl.saveCompiledPlan);
router.get('/plan/compiled', auth(true), ensureOnboarded, ctrl.getCompiledPlan);
// Plan Prose (AI-generated narrative sections)
router.get('/plan/prose', auth(true), ensureOnboarded, ctrl.getPlanProse);
router.post('/plan/prose/generate', auth(true), ensureOnboarded, ctrl.generatePlanProse);

// Settings
router.get('/settings', auth(true), ensureOnboarded, ctrl.getSettings);
router.patch('/settings/profile', auth(true), ensureOnboarded, ctrl.updateProfile);
router.post('/settings/members', auth(true), ensureOnboarded, ctrl.createMember);
router.patch('/settings/members/:mid', auth(true), ensureOnboarded, ctrl.updateMember);
router.delete('/settings/members/:mid', auth(true), ensureOnboarded, ctrl.deleteMember);

module.exports = router;
