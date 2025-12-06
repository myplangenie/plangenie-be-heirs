const express = require('express');
const auth = require('../middleware/auth');
const ensureOnboarded = require('../middleware/ensureOnboarded');
const ctrl = require('../controllers/dashboard.controller');
const viewAs = require('../middleware/viewAs');
const { body } = require('express-validator');
const { requireFeature } = require('../middleware/plan');

const router = express.Router();

// All dashboard APIs require auth; allow view-as (read-only) for collaborators
router.use(auth(true));
router.use(viewAs);

router.get('/summary', ensureOnboarded, ctrl.getSummary);
// Insights
router.get('/insights', ensureOnboarded, ctrl.getInsights);
router.post('/insights/generate', ensureOnboarded, requireFeature('aiActionPlans'), ctrl.generateInsights);
router.get('/strategy-canvas', ensureOnboarded, ctrl.getStrategyCanvas);
router.patch('/strategy-canvas', ensureOnboarded, requireFeature('planEdit'), ctrl.updateStrategyCanvas);

// Notifications
router.get('/notifications', ensureOnboarded, ctrl.getNotifications);
router.post('/notifications/mark-all-read', ensureOnboarded, ctrl.markAllRead);
router.patch('/notifications/preferences', ensureOnboarded, ctrl.updateNotificationPrefs);

// Departments
router.get('/departments', ensureOnboarded, ctrl.getDepartments);
router.patch('/departments', ensureOnboarded, requireFeature('departmentPlans'), ctrl.updateDepartment);
// Action plans: update the status of a single assignment item
router.patch('/action-assignments/status', ensureOnboarded, requireFeature('departmentPlans'), ctrl.updateActionAssignmentStatus);
// Action plans: update fields of a single assignment item
router.patch('/action-assignments/item', ensureOnboarded, requireFeature('departmentPlans'), ctrl.updateActionAssignmentItem);

// Financials
router.get('/financials', ensureOnboarded, requireFeature('financials'), ctrl.getFinancials);
router.post('/financials/recalculate', ensureOnboarded, requireFeature('financials'), ctrl.recalculateFinancials);
router.post('/financials/assumptions', ensureOnboarded, requireFeature('financials'), ctrl.saveFinancialAssumptions);
router.post('/financials/insights', ensureOnboarded, requireFeature('financials'), ctrl.generateFinancialInsights);
// Update/blend actuals for financials (monthly)
router.post('/financials/actuals', ensureOnboarded, requireFeature('financials'), ctrl.saveFinancialActuals);
// Import monthly actuals via CSV text
router.post('/financials/import', ensureOnboarded, requireFeature('financials'), ctrl.importFinancialsCSV);

// Products & Services
router.get('/products', ensureOnboarded, ctrl.getProducts);
router.put('/products', ensureOnboarded, ctrl.saveProducts);

// Plan
router.get('/plan', ensureOnboarded, ctrl.getPlan);
router.get('/plan/export/pdf', ensureOnboarded, ctrl.exportPlanPdf);
// Upload business logo
router.post('/logo', ensureOnboarded, [body('dataUrl').isString().withMessage('dataUrl is required')], ctrl.uploadCompanyLogo);
router.post('/plan/sections', ensureOnboarded, requireFeature('planEdit'), ctrl.addPlanSection);
router.delete('/plan/sections/:sid', ensureOnboarded, requireFeature('planEdit'), ctrl.deletePlanSection);
// Compiled Plan (Customizable Plan Builder)
// Allow access during onboarding-detail builder before final completion
router.post('/plan/compiled', requireFeature('planEdit'), ctrl.saveCompiledPlan);
router.get('/plan/compiled', ctrl.getCompiledPlan);
// Plan Prose (AI-generated narrative sections)
router.get('/plan/prose', ctrl.getPlanProse);
router.post('/plan/prose/generate', requireFeature('planEdit'), ctrl.generatePlanProse);

// Settings
router.get('/settings', ensureOnboarded, ctrl.getSettings);
router.patch('/settings/profile', ensureOnboarded, ctrl.updateProfile);
router.post('/settings/members', ensureOnboarded, ctrl.createMember);
router.patch('/settings/members/:mid', ensureOnboarded, ctrl.updateMember);
router.delete('/settings/members/:mid', ensureOnboarded, ctrl.deleteMember);
// Purge seeded sample members for the current user
router.delete('/settings/members/sample', ensureOnboarded, ctrl.purgeSampleMembers);

module.exports = router;
