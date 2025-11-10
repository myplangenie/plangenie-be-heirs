const express = require('express');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/dashboard.controller');

const router = express.Router();

// All dashboard APIs require auth
router.get('/summary', auth(true), ctrl.getSummary);
// Insights
router.get('/insights', auth(true), ctrl.getInsights);
router.post('/insights/generate', auth(true), ctrl.generateInsights);
router.get('/strategy-canvas', auth(true), ctrl.getStrategyCanvas);
router.patch('/strategy-canvas', auth(true), ctrl.updateStrategyCanvas);

// Notifications
router.get('/notifications', auth(true), ctrl.getNotifications);
router.post('/notifications/mark-all-read', auth(true), ctrl.markAllRead);
router.patch('/notifications/preferences', auth(true), ctrl.updateNotificationPrefs);

// Departments
router.get('/departments', auth(true), ctrl.getDepartments);
router.patch('/departments', auth(true), ctrl.updateDepartment);
// Action plans: update the status of a single assignment item
router.patch('/action-assignments/status', auth(true), ctrl.updateActionAssignmentStatus);

// Financials
router.get('/financials', auth(true), ctrl.getFinancials);
router.post('/financials/recalculate', auth(true), ctrl.recalculateFinancials);
router.post('/financials/insights', auth(true), ctrl.generateFinancialInsights);
// Update/blend actuals for financials (monthly)
router.post('/financials/actuals', auth(true), ctrl.saveFinancialActuals);
// Import monthly actuals via CSV text
router.post('/financials/import', auth(true), ctrl.importFinancialsCSV);

// Products & Services
router.get('/products', auth(true), ctrl.getProducts);
router.put('/products', auth(true), ctrl.saveProducts);

// Plan
router.get('/plan', auth(true), ctrl.getPlan);
router.post('/plan/sections', auth(true), ctrl.addPlanSection);
router.delete('/plan/sections/:sid', auth(true), ctrl.deletePlanSection);
// Compiled Plan (Customizable Plan Builder)
router.post('/plan/compiled', auth(true), ctrl.saveCompiledPlan);
router.get('/plan/compiled', auth(true), ctrl.getCompiledPlan);

// Settings
router.get('/settings', auth(true), ctrl.getSettings);
router.patch('/settings/profile', auth(true), ctrl.updateProfile);
router.post('/settings/members', auth(true), ctrl.createMember);
router.patch('/settings/members/:mid', auth(true), ctrl.updateMember);
router.delete('/settings/members/:mid', auth(true), ctrl.deleteMember);

module.exports = router;
