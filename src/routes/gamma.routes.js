const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/gamma.controller');
const auth = require('../middleware/auth');

// Allow both public and authed, but prefer authed for user association
router.post('/generate-plan', auth(false), ctrl.generatePlan);
router.post('/generate-my-plan', auth(false), ctrl.generateMyPlan);

module.exports = router;

