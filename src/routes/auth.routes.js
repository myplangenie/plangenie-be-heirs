const express = require('express');
const { body } = require('express-validator');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/auth.controller');

const router = express.Router();

router.post(
  '/signup',
  [
    body('fullName').optional().isString().trim().isLength({ min: 1 }).withMessage('Full name required'),
    body('email').isEmail().normalizeEmail(),
    body('password').isString().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  ctrl.register
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

module.exports = router;
