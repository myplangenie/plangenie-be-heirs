const express = require('express');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const workspaceContext = require('../middleware/workspace');
const ctrl = require('../controllers/onboarding.controller');
const ai = require('../controllers/ai.controller');
const { requireFeature } = require('../middleware/plan');

const router = express.Router();

// Apply auth first, then workspace context (workspace needs req.user.id)
router.use(auth(false));
router.use(workspaceContext);

// Get current onboarding data
router.get('/', ctrl.get);

// Save user profile step
router.post(
  '/user-profile',
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
  [body('ubp').optional().isString().trim().isLength({ min: 0, max: 5000 })],
  ctrl.saveVision
);

// AI suggestions for Vision & Purpose
router.post('/vision/ubp/suggest', ai.suggestUbp);
router.post('/vision/purpose/suggest', ai.suggestPurpose);
router.post('/vision/destination/1y/suggest', ai.suggestVision1y);
router.post('/vision/destination/3y/suggest', ai.suggestVision3y);
router.post('/vision/destination/bhag/suggest', ai.suggestVisionBhag);
// Rewrite endpoints (immediate rewrite of current text)
router.post('/vision/ubp/rewrite', ai.rewriteUbp);
router.post('/vision/purpose/rewrite', ai.rewritePurpose);
router.post('/vision/destination/1y/rewrite', ai.rewriteVision1y);
router.post('/vision/destination/3y/rewrite', ai.rewriteVision3y);
router.post('/vision/destination/bhag/rewrite', ai.rewriteVisionBhag);
// Strategic Identity Summary
router.post('/vision/identity/summary/suggest', ai.suggestIdentitySummary);
router.post('/vision/identity/summary/rewrite', ai.rewriteIdentitySummary);
router.post('/values/core/suggest', ai.suggestValuesCore);
router.post('/values/feeling/suggest', ai.suggestCultureFeeling);
router.post('/values/core/rewrite', ai.rewriteValuesCore);
router.post("/values/core/keywords", ai.extractValuesCoreKeywords);
router.post('/values/feeling/rewrite', ai.rewriteCultureFeeling);
// SWOT analysis
router.post('/values/swot/strengths/suggest', ai.suggestSwotStrengths);
router.post('/values/swot/weaknesses/suggest', ai.suggestSwotWeaknesses);
router.post('/values/swot/opportunities/suggest', ai.suggestSwotOpportunities);
router.post('/values/swot/threats/suggest', ai.suggestSwotThreats);
router.post('/values/swot/strengths/rewrite', ai.rewriteSwotStrengths);
router.post('/values/swot/weaknesses/rewrite', ai.rewriteSwotWeaknesses);
router.post('/values/swot/opportunities/rewrite', ai.rewriteSwotOpportunities);
router.post('/values/swot/threats/rewrite', ai.rewriteSwotThreats);
router.post('/market/customer/suggest', requireFeature('aiCustomerAnalysis'), ai.suggestMarketCustomer);
router.post('/market/customer/rewrite', requireFeature('aiCustomerAnalysis'), ai.rewriteMarketCustomer);
router.post('/market/partners/suggest', ai.suggestMarketPartners);
router.post('/market/competitors/suggest', requireFeature('aiCompetitors'), ai.suggestMarketCompetitors);
router.post('/market/competitors/names', requireFeature('aiCompetitors'), ai.suggestCompetitorNames);
router.post('/market/partners/rewrite', ai.rewriteMarketPartners);
router.post('/market/competitors/rewrite', requireFeature('aiCompetitors'), ai.rewriteMarketCompetitors);
router.post('/market/competitors/advantages', requireFeature('aiCompetitors'), ai.suggestCompetitorAdvantages);
router.post('/financial/forecast/suggest', requireFeature('financials'), ai.suggestFinancialForecast);
router.post('/financial/number/suggest', requireFeature('financials'), ai.suggestFinancialNumber);
router.post('/financial/suggest-all', requireFeature('financials'), ai.suggestFinancialAll);
router.post('/financial/stage/suggest', requireFeature('financials'), ai.suggestFinancialStage);
// Action plan field suggestions (single result) and rewrites
router.post('/actions/goal/suggest', requireFeature('aiActionPlans'), ai.suggestActionGoal);
router.post('/actions/goal/rewrite', requireFeature('aiActionPlans'), ai.rewriteActionGoal);
router.post('/actions/milestone/suggest', requireFeature('aiActionPlans'), ai.suggestActionMilestone);
router.post('/actions/milestone/rewrite', requireFeature('aiActionPlans'), ai.rewriteActionMilestone);
router.post('/actions/resources/suggest', requireFeature('aiActionPlans'), ai.suggestActionResources);
router.post('/actions/resources/rewrite', requireFeature('aiActionPlans'), ai.rewriteActionResources);
// Allow Lite users to generate KPI suggestions
router.post('/actions/kpi/suggest', ai.suggestActionKpi);
router.post('/actions/kpi/rewrite', requireFeature('aiActionPlans'), ai.rewriteActionKpi);
// Allow Lite users to suggest due dates for core project details
router.post('/actions/due/suggest', ai.suggestActionDue);
router.post('/actions/due/rewrite', requireFeature('aiActionPlans'), ai.rewriteActionDue);
// Cost + suggest-all
router.post('/actions/cost/suggest', requireFeature('aiActionPlans'), ai.suggestActionCost);
router.post('/actions/cost/rewrite', requireFeature('aiActionPlans'), ai.rewriteActionCost);
// Allow Lite users to use the bulk suggest-all for action plan fields
router.post('/actions/suggest-all', ai.suggestActionAll);
// Core Strategic Projects deliverables
router.post('/actions/core/deliverables', requireFeature('aiCoreProjects'), ai.suggestCoreDeliverables);
// Core Strategic Project (full) suggestion
router.post('/actions/core/project/suggest', requireFeature('aiCoreProjects'), ai.suggestCoreProject);
// Bulk goals per department/section
// Allow Lite users to generate section goals used by core projects workflows
router.post('/actions/sections/goals', ai.suggestDeptGoalsBulk);
router.post('/financial/forecast/rewrite', requireFeature('financials'), ai.rewriteFinancialForecast);

// 1-Year Goals CRUD
router.get('/vision/destination/1y/goals', ctrl.getVision1yGoals);
router.post('/vision/destination/1y/goals', ctrl.addVision1yGoal);
router.patch('/vision/destination/1y/goals/:index', ctrl.updateVision1yGoal);
router.delete('/vision/destination/1y/goals/:index', ctrl.deleteVision1yGoal);

// Save/load all onboarding answers (optional server persistence)
router.get('/all', ctrl.getAllAnswers);
router.post('/all', ctrl.saveAllAnswers);

module.exports = router;
