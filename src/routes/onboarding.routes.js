const express = require('express');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const workspaceContext = require('../middleware/workspace');
const ctrl = require('../controllers/onboarding.controller');
const ai = require('../controllers/ai.controller');
const { requireFeature } = require('../middleware/plan');
const { requireViewer, requireContributor, requireAdmin } = require('../middleware/workspaceRole');
const { requireAI } = require('../middleware/workspaceAI');

const router = express.Router();

// Apply auth first, then workspace context (workspace needs req.user.id)
router.use(auth(false));
router.use(workspaceContext);

// Get current onboarding data
router.get('/', requireViewer, ctrl.get);

// Save user profile step
router.post(
  '/user-profile',
  requireContributor,
  [
    body('fullName').optional().isString().trim(),
    body('role').optional().isString().trim(),
    body('roleOther').optional().isString().trim(),
    body('builtPlanBefore').optional(),
    body('planningGoal').optional().isString().trim(),
    body('planningGoalOther').optional().isString().trim(),
    body('includePersonalPlanning').optional(),
    // Accept legacy 'personal' during rollout; controller maps to 'organization'
    body('planningFor').optional().isString().isIn(['organization','business','personal']),
  ],
  ctrl.saveUserProfile
);

// Save business profile step
router.post(
  '/business-profile',
  requireContributor,
  [
    body('businessName').optional().isString().trim(),
    body('businessStage').optional().isString().trim(),
    body('industry').optional().isString().trim(),
    body('country').optional().isString().trim(),
    body('city').optional().isString().trim(),
    body('ventureType').optional().isString().trim(),
    body('teamSize').optional().isString().trim(),
    body('funding').optional(),
    body('tools').optional().isArray(),
    body('connectTools').optional(),
  ],
  ctrl.saveBusinessProfile
);

// Save vision/purpose step
router.post(
  '/vision',
  requireContributor,
  [body('ubp').optional().isString().trim().isLength({ min: 0, max: 5000 })],
  ctrl.saveVision
);

// AI suggestions for Vision & Purpose (read-only AI operations, require contributor to modify)
// Workspace AI permissions checked via requireAI middleware
router.post('/vision/ubp/suggest', requireContributor, requireAI('vision'), ai.suggestUbp);
router.post('/vision/purpose/suggest', requireContributor, requireAI('vision'), ai.suggestPurpose);
router.post('/vision/destination/1y/suggest', requireContributor, requireAI('vision'), ai.suggestVision1y);
router.post('/vision/destination/3y/suggest', requireContributor, requireAI('vision'), ai.suggestVision3y);
router.post('/vision/destination/bhag/suggest', requireContributor, requireAI('vision'), ai.suggestVisionBhag);
// Rewrite endpoints (immediate rewrite of current text)
router.post('/vision/ubp/rewrite', requireContributor, requireAI('vision'), ai.rewriteUbp);
router.post('/vision/purpose/rewrite', requireContributor, requireAI('vision'), ai.rewritePurpose);
router.post('/vision/destination/1y/rewrite', requireContributor, requireAI('vision'), ai.rewriteVision1y);
router.post('/vision/destination/3y/rewrite', requireContributor, requireAI('vision'), ai.rewriteVision3y);
router.post('/vision/destination/bhag/rewrite', requireContributor, requireAI('vision'), ai.rewriteVisionBhag);
// Strategic Identity Summary
router.post('/vision/identity/summary/suggest', requireContributor, requireAI('vision'), ai.suggestIdentitySummary);
router.post('/vision/identity/summary/rewrite', requireContributor, requireAI('vision'), ai.rewriteIdentitySummary);
// Values suggestions
router.post('/values/core/suggest', requireContributor, requireAI('values'), ai.suggestValuesCore);
router.post('/values/feeling/suggest', requireContributor, requireAI('values'), ai.suggestCultureFeeling);
router.post('/values/core/rewrite', requireContributor, requireAI('values'), ai.rewriteValuesCore);
router.post("/values/core/keywords", requireContributor, requireAI('values'), ai.extractValuesCoreKeywords);
router.post('/values/feeling/rewrite', requireContributor, requireAI('values'), ai.rewriteCultureFeeling);
// SWOT analysis
router.post('/values/swot/strengths/suggest', requireContributor, requireAI('swot'), ai.suggestSwotStrengths);
router.post('/values/swot/weaknesses/suggest', requireContributor, requireAI('swot'), ai.suggestSwotWeaknesses);
router.post('/values/swot/opportunities/suggest', requireContributor, requireAI('swot'), ai.suggestSwotOpportunities);
router.post('/values/swot/threats/suggest', requireContributor, requireAI('swot'), ai.suggestSwotThreats);
router.post('/values/swot/strengths/rewrite', requireContributor, requireAI('swot'), ai.rewriteSwotStrengths);
router.post('/values/swot/weaknesses/rewrite', requireContributor, requireAI('swot'), ai.rewriteSwotWeaknesses);
router.post('/values/swot/opportunities/rewrite', requireContributor, requireAI('swot'), ai.rewriteSwotOpportunities);
router.post('/values/swot/threats/rewrite', requireContributor, requireAI('swot'), ai.rewriteSwotThreats);
// Market analysis
router.post('/market/customer/suggest', requireContributor, requireAI('market'), requireFeature('aiCustomerAnalysis'), ai.suggestMarketCustomer);
router.post('/market/customer/rewrite', requireContributor, requireAI('market'), requireFeature('aiCustomerAnalysis'), ai.rewriteMarketCustomer);
router.post('/market/partners/suggest', requireContributor, requireAI('market'), ai.suggestMarketPartners);
router.post('/market/competitors/suggest', requireContributor, requireAI('market'), requireFeature('aiCompetitors'), ai.suggestMarketCompetitors);
router.post('/market/competitors/names', requireContributor, requireAI('market'), requireFeature('aiCompetitors'), ai.suggestCompetitorNames);
router.post('/market/partners/rewrite', requireContributor, requireAI('market'), ai.rewriteMarketPartners);
router.post('/market/competitors/rewrite', requireContributor, requireAI('market'), requireFeature('aiCompetitors'), ai.rewriteMarketCompetitors);
router.post('/market/competitors/advantages', requireContributor, requireAI('market'), requireFeature('aiCompetitors'), ai.suggestCompetitorAdvantages);
// Financial suggestions
router.post('/financial/forecast/suggest', requireContributor, requireAI('financial'), requireFeature('financials'), ai.suggestFinancialForecast);
router.post('/financial/number/suggest', requireContributor, requireAI('financial'), requireFeature('financials'), ai.suggestFinancialNumber);
router.post('/financial/suggest-all', requireContributor, requireAI('financial'), requireFeature('financials'), ai.suggestFinancialAll);
router.post('/financial/stage/suggest', requireContributor, requireAI('financial'), requireFeature('financials'), ai.suggestFinancialStage);
// Action plan field suggestions (single result) and rewrites
router.post('/actions/goal/suggest', requireContributor, requireAI('actions'), requireFeature('aiActionPlans'), ai.suggestActionGoal);
router.post('/actions/goal/rewrite', requireContributor, requireAI('actions'), requireFeature('aiActionPlans'), ai.rewriteActionGoal);
router.post('/actions/milestone/suggest', requireContributor, requireAI('actions'), requireFeature('aiActionPlans'), ai.suggestActionMilestone);
router.post('/actions/milestone/rewrite', requireContributor, requireAI('actions'), requireFeature('aiActionPlans'), ai.rewriteActionMilestone);
router.post('/actions/resources/suggest', requireContributor, requireAI('actions'), requireFeature('aiActionPlans'), ai.suggestActionResources);
router.post('/actions/resources/rewrite', requireContributor, requireAI('actions'), requireFeature('aiActionPlans'), ai.rewriteActionResources);
// Allow Lite users to generate KPI suggestions
router.post('/actions/kpi/suggest', requireContributor, requireAI('actions'), ai.suggestActionKpi);
router.post('/actions/kpi/rewrite', requireContributor, requireAI('actions'), requireFeature('aiActionPlans'), ai.rewriteActionKpi);
// Allow Lite users to suggest due dates for core project details
router.post('/actions/due/suggest', requireContributor, requireAI('actions'), ai.suggestActionDue);
router.post('/actions/due/rewrite', requireContributor, requireAI('actions'), requireFeature('aiActionPlans'), ai.rewriteActionDue);
// Cost + suggest-all
router.post('/actions/cost/suggest', requireContributor, requireAI('actions'), requireFeature('aiActionPlans'), ai.suggestActionCost);
router.post('/actions/cost/rewrite', requireContributor, requireAI('actions'), requireFeature('aiActionPlans'), ai.rewriteActionCost);
// Allow Lite users to use the bulk suggest-all for action plan fields
router.post('/actions/suggest-all', requireContributor, requireAI('actions'), ai.suggestActionAll);
// Core Projects deliverables
router.post('/actions/core/deliverables', requireContributor, requireAI('core'), requireFeature('aiCoreProjects'), ai.suggestCoreDeliverables);
// Core Project (full) suggestion
router.post('/actions/core/project/suggest', requireContributor, requireAI('core'), requireFeature('aiCoreProjects'), ai.suggestCoreProject);
// Bulk goals per department/section
// Allow Lite users to generate section goals used by core projects workflows
router.post('/actions/sections/goals', requireContributor, requireAI('actions'), ai.suggestDeptGoalsBulk);
// Redistribute deliverable due dates across all projects globally
router.post('/actions/redistribute-due-dates', requireContributor, ai.redistributeDeliverableDueDates);
// Redistribute deliverable due dates across all core strategic projects
router.post('/actions/core/redistribute-due-dates', requireContributor, ai.redistributeCoreProjectDueDates);
// Redistribute ALL deliverable due dates across BOTH core projects AND departmental projects
router.post('/actions/redistribute-all-due-dates', requireContributor, ai.redistributeAllDueDates);
// Assign due dates only to a new project's deliverables (for post-onboarding dashboard use)
router.post('/actions/assign-new-project-due-dates', requireContributor, ai.assignNewProjectDueDates);
// Spread a single project's deliverables considering existing deliverables across all projects
router.post('/actions/spread-project-deliverables-incremental', requireContributor, ai.spreadProjectDeliverablesIncremental);
router.post('/financial/forecast/rewrite', requireContributor, requireAI('financial'), requireFeature('financials'), ai.rewriteFinancialForecast);

// REMOVED: Legacy 1-Year Goals CRUD that used Workspace.fields
// Use /api/vision-goals instead (VisionGoal model)

// REMOVED: Legacy /all endpoints that read/write Workspace.fields
// Use individual CRUD APIs instead:
// - /api/workspace-fields (for simple text fields like ubp, purpose, values)
// - /api/competitors (Competitor model)
// - /api/swot (SwotEntry model)
// - /api/vision-goals (VisionGoal model)
// - /api/products (Product model)
// - /api/org-positions (OrgPosition model)

module.exports = router;
