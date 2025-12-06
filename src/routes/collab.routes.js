const express = require('express');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/collab.controller');
const { requireFeature } = require('../middleware/plan');

const router = express.Router();

router.post('/invite', auth(true), requireFeature('multiUserTeam'), ctrl.invite);
router.post('/invite/resend', auth(true), requireFeature('multiUserTeam'), ctrl.resend);
router.delete('/invite', auth(true), requireFeature('multiUserTeam'), ctrl.revoke);
router.get('/viewables', auth(true), requireFeature('multiUserTeam'), ctrl.viewables);
router.get('/collaborators', auth(true), requireFeature('multiUserTeam'), ctrl.collaborators);
router.get('/accept', auth(false), ctrl.accept);
router.post('/accept', auth(true), requireFeature('multiUserTeam'), ctrl.acceptLogged);
router.post('/decline', auth(true), requireFeature('multiUserTeam'), ctrl.decline);
router.get('/decline', auth(false), ctrl.declineByToken);

module.exports = router;
