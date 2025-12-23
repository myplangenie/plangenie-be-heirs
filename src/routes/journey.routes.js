const express = require('express');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const journeyCtx = require('../middleware/journey');
const ctrl = require('../controllers/journey.controller');

const router = express.Router();

// Journeys are per-owner; allow collaborators to read (GETs) via viewAs.
router.use(auth(true));
router.use(viewAs);

router.get('/', journeyCtx, ctrl.list);
router.post('/', ctrl.create);
router.get('/:jid', ctrl.get);
router.patch('/:jid', ctrl.patch);
router.get('/:jid/this-week', ctrl.thisWeek);

// Reviews
const review = require('../controllers/review.controller');
router.get('/:jid/reviews', review.list);
router.post('/:jid/reviews', review.create);
router.get('/:jid/reviews/:rid', review.get);
router.patch('/:jid/reviews/:rid', review.patch);

// Decisions
const decision = require('../controllers/decision.controller');
router.get('/:jid/decisions', decision.list);
router.post('/:jid/decisions', decision.create);
router.get('/:jid/decisions/:did', decision.get);
router.patch('/:jid/decisions/:did', decision.patch);

// Assumptions Library
const assumption = require('../controllers/assumption.controller');
router.get('/:jid/assumptions', assumption.list);
router.post('/:jid/assumptions', assumption.create);
router.get('/:jid/assumptions/:aid', assumption.get);
router.patch('/:jid/assumptions/:aid', assumption.patch);
router.get('/:jid/assumptions/:aid/history', assumption.history);
router.get('/:jid/assumptions/summary', assumption.summary);
// Scenarios (Pro feature)
router.get('/:jid/scenarios', assumption.listScenarios);
router.post('/:jid/scenarios', assumption.createScenario);
router.patch('/:jid/scenarios/:sid', assumption.patchScenario);

module.exports = router;
