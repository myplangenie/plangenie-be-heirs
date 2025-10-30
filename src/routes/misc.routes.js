const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/misc.controller');

// Public endpoint for demo requests
router.post('/request-demo', ctrl.requestDemo);

module.exports = router;

