const express = require('express');
const requireAdmin = require('../middleware/admin');
const ctrl = require('../controllers/admin.controller');
const weeklyNotifications = require('../jobs/weeklyNotifications');
const dailyWish = require('../jobs/dailyWish');
const reviewReminders = require('../jobs/reviewReminders');

const router = express.Router();

router.use(requireAdmin());

router.get('/me', ctrl.me);
router.get('/overview', ctrl.overview);

router.get('/users', ctrl.listUsers);
router.get('/users/:id', ctrl.getUser);
router.get('/users/:id/full-data', ctrl.getUserFullData);
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

// Test endpoint to manually trigger daily wish
router.post('/test-daily-wish', async (req, res) => {
  try {
    console.log('[admin] Manually triggering daily wish job...');
    await dailyWish.runJob();
    res.json({ ok: true, message: 'Daily wish job completed' });
  } catch (err) {
    console.error('[admin] Daily wish test failed:', err?.message || err);
    res.status(500).json({ ok: false, message: err?.message || 'Job failed' });
  }
});

// Test endpoint to manually trigger review reminders
router.post('/test-review-reminders', async (req, res) => {
  try {
    console.log('[admin] Manually triggering review reminders job...');
    await reviewReminders.runJob();
    res.json({ ok: true, message: 'Review reminders job completed' });
  } catch (err) {
    console.error('[admin] Review reminders test failed:', err?.message || err);
    res.status(500).json({ ok: false, message: err?.message || 'Job failed' });
  }
});

module.exports = router;

