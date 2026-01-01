const express = require('express');
const requireAdmin = require('../middleware/admin');
const ctrl = require('../controllers/admin.controller');
const weeklyNotifications = require('../jobs/weeklyNotifications');

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

// Test endpoint to manually trigger weekly digest
router.post('/test-weekly-digest', async (req, res) => {
  try {
    console.log('[admin] Manually triggering weekly digest job...');
    await weeklyNotifications.runJob();
    res.json({ ok: true, message: 'Weekly digest job completed' });
  } catch (err) {
    console.error('[admin] Weekly digest test failed:', err?.message || err);
    res.status(500).json({ ok: false, message: err?.message || 'Job failed' });
  }
});

module.exports = router;

