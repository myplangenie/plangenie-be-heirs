const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/misc.controller');

// Public endpoints
router.post('/request-demo', ctrl.requestDemo);
router.post('/contact/book-call', ctrl.bookCall);

module.exports = router;
