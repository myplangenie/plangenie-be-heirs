const express = require('express');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/dashboard.controller');
const viewAs = require('../middleware/viewAs');
const { body } = require('express-validator');
const { requireFeature } = require('../middleware/plan');

const router = express.Router();

// All dashboard APIs require auth; allow view-as (read-only) for collaborators
router.use(auth(true));
router.use(viewAs);

router.get('/summary',  ctrl.getSummary);
// Insights
router.get('/insights',  ctrl.getInsights);
router.post('/insights/generate',  requireFeature('aiActionPlans'), ctrl.generateInsights);
router.get('/strategy-canvas',  ctrl.getStrategyCanvas);
router.patch('/strategy-canvas',  requireFeature('planEdit'), ctrl.updateStrategyCanvas);

// Notifications
router.get('/notifications',  ctrl.getNotifications);
router.post('/notifications/mark-all-read',  ctrl.markAllRead);
router.patch('/notifications/preferences',  ctrl.updateNotificationPrefs);

// Departments
router.get('/departments',  ctrl.getDepartments);
router.patch('/departments',  requireFeature('departmentPlans'), ctrl.updateDepartment);
// Action plans: update the status of a single assignment item
router.patch('/action-assignments/status',  requireFeature('departmentPlans'), ctrl.updateActionAssignmentStatus);
// Action plans: update fields of a single assignment item
router.patch('/action-assignments/item',  requireFeature('departmentPlans'), ctrl.updateActionAssignmentItem);

// Financials
router.get('/financials',  requireFeature('financials'), ctrl.getFinancials);
router.post('/financials/recalculate',  requireFeature('financials'), ctrl.recalculateFinancials);
router.post('/financials/assumptions',  requireFeature('financials'), ctrl.saveFinancialAssumptions);
router.post('/financials/insights',  requireFeature('financials'), ctrl.generateFinancialInsights);
// Update/blend actuals for financials (monthly)
router.post('/financials/actuals',  requireFeature('financials'), ctrl.saveFinancialActuals);
// Import monthly actuals via CSV text
router.post('/financials/import',  requireFeature('financials'), ctrl.importFinancialsCSV);

// Products & Services
router.get('/products',  ctrl.getProducts);
router.put('/products',  ctrl.saveProducts);

// Plan
router.get('/plan',  ctrl.getPlan);
router.get('/plan/export/pdf',  ctrl.exportPlanPdf);
// Upload business logo
router.post('/logo',  [body('dataUrl').isString().withMessage('dataUrl is required')], ctrl.uploadCompanyLogo);
router.post('/plan/sections',  requireFeature('planEdit'), ctrl.addPlanSection);
router.delete('/plan/sections/:sid',  requireFeature('planEdit'), ctrl.deletePlanSection);
// Compiled Plan (Customizable Plan Builder)
// Allow access during onboarding-detail builder before final completion
router.post('/plan/compiled', requireFeature('planEdit'), ctrl.saveCompiledPlan);
router.get('/plan/compiled', ctrl.getCompiledPlan);
// Plan Prose (AI-generated narrative sections)
router.get('/plan/prose', ctrl.getPlanProse);
router.post('/plan/prose/generate', requireFeature('planEdit'), ctrl.generatePlanProse);

// Settings
router.get('/settings',  ctrl.getSettings);
router.patch('/settings/profile',  ctrl.updateProfile);
router.post('/settings/members',  ctrl.createMember);
router.patch('/settings/members/:mid',  ctrl.updateMember);
router.delete('/settings/members/:mid',  ctrl.deleteMember);
// Purge seeded sample members for the current user
router.delete('/settings/members/sample',  ctrl.purgeSampleMembers);

module.exports = router;
