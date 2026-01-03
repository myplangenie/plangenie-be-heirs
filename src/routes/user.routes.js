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

module.exports = router;

