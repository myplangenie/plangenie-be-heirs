const express = require('express');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/workspaceMember.controller');

const router = express.Router();

// Get invite info (public - no auth required)
router.get('/info', ctrl.getInviteInfo);

// Accept invite (optional auth - can work with or without logged in user)
router.post('/accept', auth(false), ctrl.acceptInvite);

module.exports = router;
