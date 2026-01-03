const express = require('express');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/dashboard.controller');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const { body } = require('express-validator');
const { requireFeature } = require('../middleware/plan');

const router = express.Router();

// All dashboard APIs require auth; allow view-as (read-only) for collaborators
router.use(auth(true));
router.use(viewAs);
router.use(workspaceContext);

router.get('/summary',  ctrl.getSummary);
// Insights
router.get('/insights',  ctrl.getInsights);
router.post('/insights/generate',  requireFeature('aiActionPlans'), ctrl.generateInsights);
router.get('/strategy-canvas',  ctrl.getStrategyCanvas);
// Exports for Strategy Canvas
router.get('/strategy-canvas/export/pdf', ctrl.exportStrategyCanvasPdf);
router.get('/strategy-canvas/export/docx', ctrl.exportStrategyCanvasDocx);
// Allow Lite users to edit Strategy Canvas (UBP, Purpose, 1y/3y, Summary)
router.patch('/strategy-canvas',  ctrl.updateStrategyCanvas);

// Notifications
router.get('/notifications',  ctrl.getNotifications);
router.post('/notifications/mark-all-read',  ctrl.markAllRead);
router.patch('/notifications/preferences',  ctrl.updateNotificationPrefs);

// Departments
router.get('/departments',  ctrl.getDepartments);
// Exports for Departments
router.get('/departments/export/pdf', ctrl.exportDepartmentsPdf);
router.get('/departments/export/docx', ctrl.exportDepartmentsDocx);
router.patch('/departments',  requireFeature('departmentPlans'), ctrl.updateDepartment);
// Action plans: update the status of a single assignment item
router.patch('/action-assignments/status',  requireFeature('departmentPlans'), ctrl.updateActionAssignmentStatus);
// Action plans: update fields of a single assignment item
router.patch('/action-assignments/item',  requireFeature('departmentPlans'), ctrl.updateActionAssignmentItem);

// Financials
router.get('/financials',  requireFeature('financials'), ctrl.getFinancials);
router.get('/financials/insights', requireFeature('financials'), ctrl.getFinancialInsights);
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
// Export as Word (DOCX)
router.get('/plan/export/docx',  ctrl.exportPlanDocx);
// Upload business logo
router.post('/logo',  [body('dataUrl').isString().withMessage('dataUrl is required')], ctrl.uploadCompanyLogo);
router.post('/plan/sections',  requireFeature('planEdit'), ctrl.addPlanSection);
router.delete('/plan/sections/:sid',  requireFeature('planEdit'), ctrl.deletePlanSection);
// Compiled Plan (Customizable Plan Builder)
// Allow access during onboarding-detail builder before final completion
// Lite users must be able to save Core Strategic Projects and Details; controller enforces fine-grained limits
router.post('/plan/compiled', ctrl.saveCompiledPlan);
router.get('/plan/compiled', ctrl.getCompiledPlan);
// Plan Prose (AI-generated narrative sections)
router.get('/plan/prose', ctrl.getPlanProse);
// Allow Lite users to generate Market/Financial prose for the plan
router.post('/plan/prose/generate', ctrl.generatePlanProse);

// Settings
router.get('/settings',  ctrl.getSettings);
router.patch('/settings/profile',  ctrl.updateProfile);
router.post('/settings/members',  ctrl.createMember);
router.patch('/settings/members/:mid',  ctrl.updateMember);
router.delete('/settings/members/:mid',  ctrl.deleteMember);
// Purge seeded sample members for the current user
router.delete('/settings/members/sample',  ctrl.purgeSampleMembers);

// Financial Snapshot (Financial Clarity feature)
router.get('/financial-snapshot', ctrl.getFinancialSnapshot);
router.patch('/financial-snapshot/:section', ctrl.updateFinancialSection);
router.get('/financial-snapshot/health-tiles', ctrl.getHealthTiles);
router.get('/financial-snapshot/decision-support', ctrl.getDecisionSupport);
router.post('/financial-snapshot/complete-onboarding', ctrl.completeFinancialOnboarding);
router.post('/financial-snapshot/sync', ctrl.syncFinancialFromOnboarding);

module.exports = router;
