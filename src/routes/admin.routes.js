const express = require('express');
const requireAdmin = require('../middleware/admin');
const ctrl = require('../controllers/admin.controller');

const router = express.Router();

router.use(requireAdmin());

router.get('/me', ctrl.me);
router.get('/overview', ctrl.overview);

router.get('/users', ctrl.listUsers);
router.get('/users/:id', ctrl.getUser);
router.patch('/users/:id/status', ctrl.updateUserStatus);
router.delete('/users/:id', ctrl.deleteUser);

router.get('/subscriptions', ctrl.subscriptions);

router.get('/logs', ctrl.logs);

module.exports = router;

