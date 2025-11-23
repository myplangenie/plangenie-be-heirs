const express = require('express');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/collab.controller');

const router = express.Router();

router.post('/invite', auth(true), ctrl.invite);
router.post('/invite/resend', auth(true), ctrl.resend);
router.delete('/invite', auth(true), ctrl.revoke);
router.get('/viewables', auth(true), ctrl.viewables);
router.get('/collaborators', auth(true), ctrl.collaborators);
router.get('/accept', auth(false), ctrl.accept);
router.post('/accept', auth(true), ctrl.acceptLogged);
router.post('/decline', auth(true), ctrl.decline);
router.get('/decline', auth(false), ctrl.declineByToken);

module.exports = router;
