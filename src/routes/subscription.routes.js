const express = require('express');
const auth = require('../middleware/auth');
const ctrl = require('../controllers/subscription.controller');

const router = express.Router();

// Subscription lifecycle/user endpoints
router.post('/checkout', auth(true), ctrl.createCheckoutSession);
router.post('/portal', auth(true), ctrl.createPortalSession);
router.post('/cancel', auth(true), ctrl.cancelSubscription);
router.get('/me', auth(true), ctrl.getMySubscription);

// Promo code validation
router.post('/promo/validate', auth(true), ctrl.validatePromoCode);

// Workspace slots and billing
router.get('/workspace-slots', auth(true), ctrl.getWorkspaceSlots);
router.get('/billing-summary', auth(true), ctrl.getBillingSummary);
router.post('/workspace-addon/checkout', auth(true), ctrl.createWorkspaceAddonCheckout);

// Note: webhook is mounted in app.js with express.raw body parser

module.exports = router;
