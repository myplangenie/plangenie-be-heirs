const express = require('express');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/chat.controller');

const router = express.Router();

// Allow both public and authed, but prefer authed for personalized context
router.post('/respond', auth(false), ctrl.respond);

module.exports = router;

