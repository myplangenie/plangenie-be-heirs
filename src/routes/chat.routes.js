const express = require('express');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const ctrl = require('../controllers/chat.controller');

const router = express.Router();

// Allow both public and authed, but prefer authed for personalized context
router.post('/respond', auth(false), viewAs, workspaceContext, ctrl.respond);

module.exports = router;
