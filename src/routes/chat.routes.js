const express = require('express');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const ctrl = require('../controllers/chat.controller');

const router = express.Router();

// Main chat endpoint — supports JSON response + SSE streaming (pass stream:true in body)
router.post('/respond', auth(false), viewAs, workspaceContext, ctrl.respond);

// Chat history (requires auth)
router.get('/history', auth(), viewAs, workspaceContext, ctrl.getHistory);
router.delete('/history', auth(), viewAs, workspaceContext, ctrl.clearHistory);

// Agent action audit log (requires auth)
router.get('/action-log', auth(), viewAs, workspaceContext, ctrl.getActionLog);

// Undo last AI action
router.post('/undo', auth(), viewAs, workspaceContext, ctrl.undoLastAction);

// Proactive greeting / workspace snapshot
router.get('/greeting', auth(), viewAs, workspaceContext, ctrl.getGreeting);

module.exports = router;
