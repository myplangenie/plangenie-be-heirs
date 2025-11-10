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

module.exports = router;

