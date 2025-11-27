const express = require('express');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/onboarding.controller');
const ai = require('../controllers/ai.controller');

const router = express.Router();

// Get current onboarding data
router.get('/', auth(false), ctrl.get);

// Save user profile step
router.post(
  '/user-profile',
  auth(false),
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
  auth(false),
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
  auth(false),
  [body('ubp').optional().isString().trim().isLength({ min: 0, max: 5000 })],
  ctrl.saveVision
);

// AI suggestions for Vision & Purpose
router.post('/vision/ubp/suggest', auth(false), ai.suggestUbp);
router.post('/vision/purpose/suggest', auth(false), ai.suggestPurpose);
router.post('/vision/destination/1y/suggest', auth(false), ai.suggestVision1y);
router.post('/vision/destination/3y/suggest', auth(false), ai.suggestVision3y);
router.post('/vision/destination/bhag/suggest', auth(false), ai.suggestVisionBhag);
// Rewrite endpoints (immediate rewrite of current text)
router.post('/vision/ubp/rewrite', auth(false), ai.rewriteUbp);
router.post('/vision/purpose/rewrite', auth(false), ai.rewritePurpose);
router.post('/vision/destination/1y/rewrite', auth(false), ai.rewriteVision1y);
router.post('/vision/destination/3y/rewrite', auth(false), ai.rewriteVision3y);
router.post('/vision/destination/bhag/rewrite', auth(false), ai.rewriteVisionBhag);
// Strategic Identity Summary
router.post('/vision/identity/summary/suggest', auth(false), ai.suggestIdentitySummary);
router.post('/vision/identity/summary/rewrite', auth(false), ai.rewriteIdentitySummary);
router.post('/values/core/suggest', auth(false), ai.suggestValuesCore);
router.post('/values/feeling/suggest', auth(false), ai.suggestCultureFeeling);
router.post('/values/core/rewrite', auth(false), ai.rewriteValuesCore);
router.post('/values/feeling/rewrite', auth(false), ai.rewriteCultureFeeling);
// SWOT analysis
router.post('/values/swot/strengths/suggest', auth(false), ai.suggestSwotStrengths);
router.post('/values/swot/weaknesses/suggest', auth(false), ai.suggestSwotWeaknesses);
router.post('/values/swot/opportunities/suggest', auth(false), ai.suggestSwotOpportunities);
router.post('/values/swot/threats/suggest', auth(false), ai.suggestSwotThreats);
router.post('/values/swot/strengths/rewrite', auth(false), ai.rewriteSwotStrengths);
router.post('/values/swot/weaknesses/rewrite', auth(false), ai.rewriteSwotWeaknesses);
router.post('/values/swot/opportunities/rewrite', auth(false), ai.rewriteSwotOpportunities);
router.post('/values/swot/threats/rewrite', auth(false), ai.rewriteSwotThreats);
router.post('/market/customer/suggest', auth(false), ai.suggestMarketCustomer);
router.post('/market/customer/rewrite', auth(false), ai.rewriteMarketCustomer);
router.post('/market/partners/suggest', auth(false), ai.suggestMarketPartners);
router.post('/market/competitors/suggest', auth(false), ai.suggestMarketCompetitors);
router.post('/market/competitors/names', auth(false), ai.suggestCompetitorNames);
router.post('/market/partners/rewrite', auth(false), ai.rewriteMarketPartners);
router.post('/market/competitors/rewrite', auth(false), ai.rewriteMarketCompetitors);
router.post('/market/competitors/advantages', auth(false), ai.suggestCompetitorAdvantages);
router.post('/financial/forecast/suggest', auth(false), ai.suggestFinancialForecast);
router.post('/financial/number/suggest', auth(false), ai.suggestFinancialNumber);
router.post('/financial/suggest-all', auth(false), ai.suggestFinancialAll);
// Action plan field suggestions (single result) and rewrites
router.post('/actions/goal/suggest', auth(false), ai.suggestActionGoal);
router.post('/actions/goal/rewrite', auth(false), ai.rewriteActionGoal);
router.post('/actions/milestone/suggest', auth(false), ai.suggestActionMilestone);
router.post('/actions/milestone/rewrite', auth(false), ai.rewriteActionMilestone);
router.post('/actions/resources/suggest', auth(false), ai.suggestActionResources);
router.post('/actions/resources/rewrite', auth(false), ai.rewriteActionResources);
router.post('/actions/kpi/suggest', auth(false), ai.suggestActionKpi);
router.post('/actions/kpi/rewrite', auth(false), ai.rewriteActionKpi);
router.post('/actions/due/suggest', auth(false), ai.suggestActionDue);
router.post('/actions/due/rewrite', auth(false), ai.rewriteActionDue);
// Cost + suggest-all
router.post('/actions/cost/suggest', auth(false), ai.suggestActionCost);
router.post('/actions/cost/rewrite', auth(false), ai.rewriteActionCost);
router.post('/actions/suggest-all', auth(false), ai.suggestActionAll);
// Core Strategic Projects deliverables
router.post('/actions/core/deliverables', auth(false), ai.suggestCoreDeliverables);
// Bulk goals per department/section
router.post('/actions/sections/goals', auth(false), ai.suggestDeptGoalsBulk);
router.post('/financial/forecast/rewrite', auth(false), ai.rewriteFinancialForecast);

// Save/load all onboarding answers (optional server persistence)
router.get('/all', auth(false), ctrl.getAllAnswers);
router.post('/all', auth(false), ctrl.saveAllAnswers);

module.exports = router;
