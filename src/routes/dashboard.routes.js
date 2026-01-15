const express = require('express');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/dashboard.controller');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const { body } = require('express-validator');
const { requireFeature } = require('../middleware/plan');
const { requireViewer, requireContributor, requireAdmin } = require('../middleware/workspaceRole');
const {
  requirePlanPdfExport,
  requirePlanDocxExport,
  requireStrategyPdfExport,
  requireStrategyDocxExport,
  requireDepartmentsPdfExport,
  requireDepartmentsDocxExport,
  requireFinancialsCsvExport,
} = require('../middleware/workspaceExport');

const router = express.Router();

// Public endpoint for print data (used by PDF generation - no auth needed)
router.get('/print-data/:token', ctrl.getPrintData);

// All dashboard APIs require auth; allow view-as (read-only) for collaborators
router.use(auth(true));
router.use(viewAs);
router.use(workspaceContext);

// Summary & Insights (read access)
router.get('/summary', requireViewer, ctrl.getSummary);
router.get('/insights', requireViewer, ctrl.getInsights);
router.post('/insights/generate', requireContributor, requireFeature('aiActionPlans'), ctrl.generateInsights);

// Strategy Canvas
router.get('/strategy-canvas', requireViewer, ctrl.getStrategyCanvas);
router.get('/strategy-canvas/export/pdf', requireViewer, requireStrategyPdfExport, ctrl.exportStrategyCanvasPdf);
router.get('/strategy-canvas/export/docx', requireViewer, requireStrategyDocxExport, ctrl.exportStrategyCanvasDocx);
router.patch('/strategy-canvas', requireContributor, ctrl.updateStrategyCanvas);

// Notifications (user-specific, viewer access)
router.get('/notifications', requireViewer, ctrl.getNotifications);
router.post('/notifications/mark-all-read', requireViewer, ctrl.markAllRead);
router.patch('/notifications/preferences', requireViewer, ctrl.updateNotificationPrefs);
router.get('/notifications/read-ids', requireViewer, ctrl.getReadNotificationIds);
router.post('/notifications/mark-read', requireViewer, ctrl.markNotificationsRead);

// Daily Wishes (read access)
router.get('/daily-wishes', requireViewer, ctrl.getDailyWishes);
router.get('/daily-wishes/today', requireViewer, ctrl.getTodayWish);
router.post('/daily-wishes/:id/view', requireViewer, ctrl.markWishViewed);

// Departments
router.get('/departments', requireViewer, ctrl.getDepartments);
router.get('/departments/export/pdf', requireViewer, requireDepartmentsPdfExport, ctrl.exportDepartmentsPdf);
router.get('/departments/export/docx', requireViewer, requireDepartmentsDocxExport, ctrl.exportDepartmentsDocx);
router.patch('/departments', requireContributor, requireFeature('departmentPlans'), ctrl.updateDepartment);
router.patch('/action-assignments/status', requireContributor, requireFeature('departmentPlans'), ctrl.updateActionAssignmentStatus);
router.patch('/action-assignments/item', requireContributor, requireFeature('departmentPlans'), ctrl.updateActionAssignmentItem);

// Financials
router.get('/financials', requireViewer, requireFeature('financials'), ctrl.getFinancials);
router.get('/financials/insights', requireViewer, requireFeature('financials'), ctrl.getFinancialInsights);
router.post('/financials/recalculate', requireContributor, requireFeature('financials'), ctrl.recalculateFinancials);
router.post('/financials/assumptions', requireContributor, requireFeature('financials'), ctrl.saveFinancialAssumptions);
router.post('/financials/insights', requireContributor, requireFeature('financials'), ctrl.generateFinancialInsights);
router.post('/financials/actuals', requireContributor, requireFeature('financials'), ctrl.saveFinancialActuals);
router.post('/financials/import', requireContributor, requireFeature('financials'), ctrl.importFinancialsCSV);

// Products & Services
router.get('/products', requireViewer, ctrl.getProducts);
router.put('/products', requireContributor, ctrl.saveProducts);

// Plan
router.get('/plan', requireViewer, ctrl.getPlan);
router.get('/plan/export/pdf', requireViewer, requirePlanPdfExport, ctrl.exportPlanPdf);
router.get('/plan/export/docx', requireViewer, requirePlanDocxExport, ctrl.exportPlanDocx);
router.post('/logo', requireContributor, [body('dataUrl').isString().withMessage('dataUrl is required')], ctrl.uploadCompanyLogo);
router.post('/plan/sections', requireContributor, requireFeature('planEdit'), ctrl.addPlanSection);
router.delete('/plan/sections/:sid', requireAdmin, requireFeature('planEdit'), ctrl.deletePlanSection);
router.post('/plan/compiled', requireContributor, ctrl.saveCompiledPlan);
router.get('/plan/compiled', requireViewer, ctrl.getCompiledPlan);
router.get('/plan/prose', requireViewer, ctrl.getPlanProse);
router.put('/plan/prose', requireContributor, ctrl.savePlanProse);
router.post('/plan/prose/generate', requireContributor, ctrl.generatePlanProse);

// Settings (admin for member management)
router.get('/settings', requireViewer, ctrl.getSettings);
router.patch('/settings/profile', requireContributor, ctrl.updateProfile);
router.post('/settings/members', requireAdmin, ctrl.createMember);
router.patch('/settings/members/:mid', requireAdmin, ctrl.updateMember);
router.delete('/settings/members/:mid', requireAdmin, ctrl.deleteMember);
router.delete('/settings/members/sample', requireAdmin, ctrl.purgeSampleMembers);

// Financial Snapshot (Financial Clarity feature)
router.get('/financial-snapshot', requireViewer, ctrl.getFinancialSnapshot);
router.patch('/financial-snapshot/:section', requireContributor, ctrl.updateFinancialSection);
router.get('/financial-snapshot/health-tiles', requireViewer, ctrl.getHealthTiles);
router.get('/financial-snapshot/decision-support', requireViewer, ctrl.getDecisionSupport);
router.post('/financial-snapshot/complete-onboarding', requireContributor, ctrl.completeFinancialOnboarding);
router.post('/financial-snapshot/sync', requireContributor, ctrl.syncFinancialFromOnboarding);

module.exports = router;
