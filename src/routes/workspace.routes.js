const express = require('express');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceCtx = require('../middleware/workspace');
const ctrl = require('../controllers/workspace.controller');

const router = express.Router();

// Workspaces are per-owner; allow collaborators to read (GETs) via viewAs.
router.use(auth(true));
router.use(viewAs);

router.get('/', workspaceCtx, ctrl.list);
router.post('/', ctrl.create);
router.get('/:wid', ctrl.get);
router.patch('/:wid', ctrl.patch);
router.delete('/:wid', ctrl.delete);
router.get('/:wid/this-week', ctrl.thisWeek);

// Decision Strip & Priorities
router.get('/:wid/decision-strip', ctrl.getDecisionStrip);
router.get('/:wid/roadmap', ctrl.getRoadmap);
router.post('/:wid/reschedule', ctrl.acceptReschedule);
router.post('/:wid/dismiss-suggestion', ctrl.dismissSuggestion);
router.post('/:wid/mark-complete', ctrl.markComplete);
router.post('/:wid/snooze-suggestion', ctrl.snoozeSuggestion);
router.post('/:wid/ai-suggestions', ctrl.getAISuggestions);

// Reviews
const review = require('../controllers/review.controller');
router.get('/:wid/reviews', review.list);
router.post('/:wid/reviews', review.create);
router.get('/:wid/reviews/:rid', review.get);
router.patch('/:wid/reviews/:rid', review.patch);

// Decisions
const decision = require('../controllers/decision.controller');
router.get('/:wid/decisions', decision.list);
router.post('/:wid/decisions', decision.create);
router.get('/:wid/decisions/:did', decision.get);
router.patch('/:wid/decisions/:did', decision.patch);

// Assumptions Library
const assumption = require('../controllers/assumption.controller');
router.get('/:wid/assumptions', assumption.list);
router.post('/:wid/assumptions', assumption.create);
router.get('/:wid/assumptions/:aid', assumption.get);
router.patch('/:wid/assumptions/:aid', assumption.patch);
router.get('/:wid/assumptions/:aid/history', assumption.history);
router.get('/:wid/assumptions/summary', assumption.summary);
// Scenarios (Pro feature)
router.get('/:wid/scenarios', assumption.listScenarios);
router.post('/:wid/scenarios', assumption.createScenario);
router.patch('/:wid/scenarios/:sid', assumption.patchScenario);

module.exports = router;
