const express = require('express');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceCtx = require('../middleware/workspace');
const ctrl = require('../controllers/workspace.controller');
const { requireViewer, requireContributor, requireAdmin, requireOwner } = require('../middleware/workspaceRole');

const router = express.Router();

// Workspaces are per-owner; allow collaborators to read (GETs) via viewAs.
router.use(auth(true));
router.use(viewAs);

// List/create workspaces (list needs workspace context, create doesn't need role check)
router.get('/', workspaceCtx, ctrl.list);
router.post('/', ctrl.create);

// Workspace CRUD with role enforcement
router.get('/:wid', requireViewer, ctrl.get);
router.patch('/:wid', requireContributor, ctrl.patch);
router.delete('/:wid', requireOwner, ctrl.delete);
router.post('/:wid/touch', requireViewer, ctrl.touch); // Update lastActivityAt on access
router.get('/:wid/this-week', requireViewer, ctrl.thisWeek);

// Decision Strip & Priorities
router.get('/:wid/decision-strip', requireViewer, ctrl.getDecisionStrip);
router.get('/:wid/roadmap', requireViewer, ctrl.getRoadmap);
router.post('/:wid/dismiss-suggestion', requireContributor, ctrl.dismissSuggestion);
router.post('/:wid/snooze-suggestion', requireContributor, ctrl.snoozeSuggestion);
router.post('/:wid/ai-suggestions', requireContributor, ctrl.getAISuggestions);

// Reviews
const review = require('../controllers/review.controller');
router.get('/:wid/reviews', requireViewer, review.list);
router.post('/:wid/reviews', requireContributor, review.create);
router.get('/:wid/reviews/:rid', requireViewer, review.get);
router.patch('/:wid/reviews/:rid', requireContributor, review.patch);
router.post('/:wid/reviews/:rid/send-actions', requireContributor, review.sendActions);
router.post('/:wid/reviews/:rid/insights', requireViewer, review.generateInsights);

// Decisions
const decision = require('../controllers/decision.controller');
router.get('/:wid/decisions', requireViewer, decision.list);
router.post('/:wid/decisions', requireContributor, decision.create);
router.get('/:wid/decisions/:did', requireViewer, decision.get);
router.patch('/:wid/decisions/:did', requireContributor, decision.patch);

// Assumptions Library
const assumption = require('../controllers/assumption.controller');
router.get('/:wid/assumptions', requireViewer, assumption.list);
router.post('/:wid/assumptions', requireContributor, assumption.create);
router.get('/:wid/assumptions/:aid', requireViewer, assumption.get);
router.patch('/:wid/assumptions/:aid', requireContributor, assumption.patch);
router.get('/:wid/assumptions/:aid/history', requireViewer, assumption.history);
router.get('/:wid/assumptions/summary', requireViewer, assumption.summary);
// Scenarios (Pro feature) - Legacy assumption-based scenarios
router.get('/:wid/scenarios', requireViewer, assumption.listScenarios);
router.post('/:wid/scenarios', requireContributor, assumption.createScenario);
router.patch('/:wid/scenarios/:sid', requireContributor, assumption.patchScenario);

// Financial Scenarios (Pro feature) - New scenario sandbox
const scenarioCtrl = require('../controllers/scenario.controller');
router.get('/:wid/financial-scenarios', requireViewer, scenarioCtrl.list);
router.post('/:wid/financial-scenarios', requireContributor, scenarioCtrl.create);
router.post('/:wid/financial-scenarios/quick-calc', requireViewer, scenarioCtrl.quickCalc);
router.get('/:wid/financial-scenarios/compare', requireViewer, scenarioCtrl.compare);
router.get('/:wid/financial-scenarios/:sid', requireViewer, scenarioCtrl.get);
router.patch('/:wid/financial-scenarios/:sid', requireContributor, scenarioCtrl.update);
router.post('/:wid/financial-scenarios/:sid/calculate', requireViewer, scenarioCtrl.calculate);
router.post('/:wid/financial-scenarios/:sid/apply', requireContributor, scenarioCtrl.apply);
router.post('/:wid/financial-scenarios/:sid/discard', requireContributor, scenarioCtrl.discard);
router.delete('/:wid/financial-scenarios/:sid', requireContributor, scenarioCtrl.delete);

// Financial Insights (AI-powered analysis)
router.get('/:wid/financial-insights', requireViewer, scenarioCtrl.getInsights);
router.post('/:wid/financial-insights/ask', requireViewer, scenarioCtrl.askQuestion);

// Workspace Members (admin required for member management)
const memberCtrl = require('../controllers/workspaceMember.controller');
router.get('/:wid/members', requireViewer, memberCtrl.listMembers);
router.post('/:wid/members/invite', requireAdmin, memberCtrl.inviteMember);
router.patch('/:wid/members/:memberId/role', requireAdmin, memberCtrl.updateMemberRole);
router.delete('/:wid/members/:memberId', requireAdmin, memberCtrl.removeMember);
// Member AI permissions (admin required)
router.get('/:wid/members/:memberId/ai-permissions', requireAdmin, memberCtrl.getMemberAIPermissions);
router.patch('/:wid/members/:memberId/ai-permissions', requireAdmin, memberCtrl.updateMemberAIPermissions);

// Workspace AI Settings (admin required for updates)
router.get('/:wid/ai-settings', requireViewer, ctrl.getAISettings);
router.patch('/:wid/ai-settings', requireAdmin, ctrl.updateAISettings);

// Workspace Notification Preferences (admin required for updates)
router.get('/:wid/notification-preferences', requireViewer, ctrl.getNotificationPreferences);
router.patch('/:wid/notification-preferences', requireAdmin, ctrl.updateNotificationPreferences);

// Workspace Export Settings (admin required for updates)
router.get('/:wid/export-settings', requireViewer, ctrl.getExportSettings);
router.patch('/:wid/export-settings', requireAdmin, ctrl.updateExportSettings);

module.exports = router;
