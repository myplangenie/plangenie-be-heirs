const express = require('express');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');

const router = express.Router();

router.post(
  '/signup',
  [
    body('firstName').optional().isString().trim().isLength({ min: 1 }).withMessage('First name required'),
    body('lastName').optional().isString().trim().isLength({ min: 1 }).withMessage('Last name required'),
    body('fullName').optional().isString().trim().isLength({ min: 1 }).withMessage('Full name required'), // backwards compat
    body('companyName').optional().isString().trim(),
    body('email').isEmail().normalizeEmail(),
    body('password').isString().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('collabToken').optional().isString().trim(),
  ],
  ctrl.register
);

router.post(
  '/verify-otp',
  [
    body('email').isEmail().normalizeEmail(),
    body('code').isString().trim().isLength({ min: 4, max: 8 }).withMessage('Invalid code'),
  ],
  ctrl.verifyOtp
);

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isString().notEmpty(),
  ],
  ctrl.login
);

router.get('/me', auth(), ctrl.me);
router.post('/onboarding/done', auth(true), ctrl.markOnboarded);
router.post('/onboarding/detail-done', auth(true), ctrl.markOnboardingDetailDone);
router.post('/resend-otp', ctrl.resendOtp);
// Email verification
router.get('/verify', ctrl.verifyEmail);

// Token refresh endpoint
router.post('/refresh', ctrl.refresh);

// Logout endpoint (clear cookies and invalidate refresh token)
router.post('/logout', ctrl.logout);

module.exports = router;
