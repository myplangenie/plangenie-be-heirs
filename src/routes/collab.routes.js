const express = require('express');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/collab.controller');

const router = express.Router();

router.post('/invite', auth(true), ctrl.invite);
router.get('/viewables', auth(true), ctrl.viewables);

module.exports = router;

