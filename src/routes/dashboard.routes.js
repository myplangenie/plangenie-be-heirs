const express = require('express');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/dashboard.controller');

const router = express.Router();

// All dashboard APIs require auth
router.get('/summary', auth(true), ctrl.getSummary);
router.get('/strategy-canvas', auth(true), ctrl.getStrategyCanvas);

// Notifications
router.get('/notifications', auth(true), ctrl.getNotifications);
router.post('/notifications/mark-all-read', auth(true), ctrl.markAllRead);
router.patch('/notifications/preferences', auth(true), ctrl.updateNotificationPrefs);

// Departments
router.get('/departments', auth(true), ctrl.getDepartments);

// Financials
router.get('/financials', auth(true), ctrl.getFinancials);

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
