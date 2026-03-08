const express = require('express');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/user.controller');

const router = express.Router();

router.post(
  '/avatar',
  auth(true),
  [body('dataUrl').isString().withMessage('dataUrl is required')],
  ctrl.uploadAvatar
);

// Tour completion endpoints
router.get('/tours', auth(true), ctrl.getTourStatus);
router.post(
  '/tours/complete',
  auth(true),
  [body('tourKey').isString().withMessage('tourKey is required')],
  ctrl.completeTour
);

// Account deletion request (schedule deletion after grace period)
router.post('/delete', auth(true), ctrl.requestDeletion);
router.post('/delete/cancel', auth(true), ctrl.cancelDeletion);

// Email change with OTP
router.post('/email-change/request', auth(true), [body('newEmail').isEmail().withMessage('Valid newEmail is required')], ctrl.requestEmailChange);
router.post('/email-change/confirm', auth(true), [body('code').isString().isLength({ min: 4 }).withMessage('Code is required')], ctrl.confirmEmailChange);

module.exports = router;
