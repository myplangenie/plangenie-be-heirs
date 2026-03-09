const Stripe = require('stripe');
const Subscription = require('../models/Subscription');
const SubscriptionHistory = require('../models/SubscriptionHistory');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const PromoCode = require('../models/PromoCode');

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

function getStripe() {
  const key = requireEnv('STRIPE_SECRET_KEY');
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

// Ensure a user subscription doc exists and is linked to stripe customer if available
async function ensureSubscriptionForUser(user, opts = {}) {
  let sub = await Subscription.findOne({ user: user._id });
  if (!sub) {
    sub = await Subscription.create({
      user: user._id,
      planType: 'Pro',
      status: 'initialized',
      stripeCustomerId: user.stripeCustomerId || undefined,
      currency: 'usd',
      amountCents: 0,
      stripePriceId: process.env.STRIPE_PRICE_ID || undefined,
    });
  }
  return sub;
}

// Resolve Stripe price ID by plan and interval, with backward-compatible fallbacks
function resolvePriceId(plan, interval) {
  const p = String(plan || 'pro').toLowerCase();
  const i = interval === 'year' ? 'year' : 'month';
  if (p === 'lite') {
    const env = i === 'year' ? process.env.STRIPE_PRICE_ID_LITE_YEAR : process.env.STRIPE_PRICE_ID_LITE_MONTH;
    return env || '';
  }
  // default to pro
  if (i === 'year') {
    return (
      process.env.STRIPE_PRICE_ID_PRO_YEAR ||
      process.env.STRIPE_PRICE_ID_YEAR ||
      process.env.STRIPE_PRICE_ID ||
      ''
    );
  }
  return (
    process.env.STRIPE_PRICE_ID_PRO_MONTH ||
    process.env.STRIPE_PRICE_ID_MONTH ||
    process.env.STRIPE_PRICE_ID ||
    ''
  );
}

exports.createCheckoutSession = async (req, res) => {
  try {
    // Always prefer explicit app base URL from environment for billing return pages
    const appWebUrl = process.env.APP_WEB_URL || 'http://localhost:3000';
    const interval = (req.body && req.body.interval) || 'month';
    const plan = String((req.body && req.body.plan) || 'pro').toLowerCase();
    const requestedPromo = String(req.body?.promoCode || '').trim();

    // Bypass Stripe flow for testing when a configured promo code is used.
    const isProd = (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production');
    const defaultBypass = isProd ? '' : 'PG-BYPASS-100';
    const bypassList = (process.env.BYPASS_PROMO_CODES || defaultBypass)
      .split(',')
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean);

    if (requestedPromo && bypassList.includes(requestedPromo.toLowerCase())) {
      const user = await User.findById(req.user.id);
      if (!user) return res.status(404).json({ message: 'User not found' });
      const sub = await ensureSubscriptionForUser(user);
      // Simulate activation
      sub.status = 'active';
      sub.planType = plan === 'lite' ? 'Lite' : 'Pro';
      sub.amountCents = 0;
      const now = new Date();
      sub.currentPeriodStart = now;
      const addDays = interval === 'year' ? 365 : 30;
      sub.currentPeriodEnd = new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000);
      sub.renewalDate = sub.currentPeriodEnd;
      await sub.save();
      // Pro and Enterprise unlock premium features
      user.hasActiveSubscription = (['Pro', 'Enterprise'].includes(sub.planType));
      user.planSlug = (sub.planType || 'Lite').toLowerCase();
      await user.save();
      await SubscriptionHistory.create({
        user: user._id,
        subscription: sub._id,
        event: 'activated',
        reason: 'bypass_code',
        meta: { promoCode: requestedPromo },
      });
      // Send user to billing return success which handles redirect to next
      const successUrl = `${appWebUrl}/billing/return?status=success`;
      return res.json({ url: successUrl });
    }

    // Check for database promo codes (free trials)
    if (requestedPromo) {
      const promoResult = await PromoCode.findAndValidate(requestedPromo, req.user.id);
      if (promoResult.valid && promoResult.promoCode && promoResult.type === 'free_trial') {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const promoCode = promoResult.promoCode;
        const sub = await ensureSubscriptionForUser(user);

        // Activate free trial subscription
        sub.status = 'active';
        sub.planType = promoCode.planType || 'Lite';
        sub.amountCents = 0;
        const now = new Date();
        sub.currentPeriodStart = now;
        sub.currentPeriodEnd = new Date(now.getTime() + promoCode.durationDays * 24 * 60 * 60 * 1000);
        sub.renewalDate = sub.currentPeriodEnd;
        await sub.save();

        // Pro and Enterprise unlock premium features
        user.hasActiveSubscription = (['Pro', 'Enterprise'].includes(sub.planType));
        user.planSlug = (sub.planType || 'Lite').toLowerCase();
        await user.save();

        // Record redemption
        await promoCode.recordRedemption(user._id);

        await SubscriptionHistory.create({
          user: user._id,
          subscription: sub._id,
          event: 'activated',
          reason: 'promo_code_free_trial',
          meta: {
            promoCode: requestedPromo,
            planType: promoCode.planType,
            durationDays: promoCode.durationDays,
          },
        });

        // Send user to billing return success
        const successUrl = `${appWebUrl}/billing/return?status=success`;
        return res.json({ url: successUrl });
      } else if (promoResult.valid === false && promoResult.reason) {
        // Database promo code found but invalid (expired, used, etc.)
        // Only return error if it looks like a database code (not found means try Stripe)
        if (promoResult.reason !== 'Code not found') {
          return res.status(400).json({ message: promoResult.reason });
        }
      }
    }

    // Normal Stripe flow
    const stripe = getStripe();
    // Choose price by plan + interval
    const priceId = resolvePriceId(plan, interval);
    if (!priceId) {
      console.error('Stripe price ID not configured for interval:', interval);
      return res.status(500).json({ message: 'Price configuration missing' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Ensure Stripe customer
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.fullName || [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
        metadata: { userId: String(user._id) },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // Ensure a subscription record exists
    const subscription = await ensureSubscriptionForUser(user);

    // Optional promo code support
    let discounts = undefined;
    try {
      const code = String(req.body?.promoCode || '').trim();
      if (code) {
        const list = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
        const pc = list?.data?.[0];
        if (!pc) {
          return res.status(400).json({ message: 'Promo code is invalid' });
        }
        discounts = [{ promotion_code: pc.id }];
      }
    } catch (_e) {
      // If Stripe errors on lookup, surface a consistent message
      return res.status(400).json({ message: 'Promo code is invalid' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      // Apply validated promotion code if provided
      discounts,
      success_url: `${appWebUrl}/billing/return?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appWebUrl}/billing/return?status=cancelled`,
      metadata: {
        userId: String(user._id),
        subscriptionId: String(subscription._id),
        plan: plan,
      },
    });

    // Log history
    await SubscriptionHistory.create({
      user: user._id,
      subscription: subscription._id,
      event: 'initialized',
      stripeCustomerId: customerId,
      stripeSessionId: session.id,
    });

    await Subscription.updateOne(
      { _id: subscription._id },
      { $set: { status: 'initialized', stripeCustomerId: customerId, stripePriceId: priceId, planType: plan === 'lite' ? 'Lite' : 'Pro' } }
    );

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('createCheckoutSession error', err);
    res.status(500).json({ message: 'Failed to create checkout session' });
  }
};

exports.createPortalSession = async (req, res) => {
  try {
    const stripe = getStripe();
    const appWebUrl = process.env.APP_WEB_URL || 'http://localhost:3000';
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.stripeCustomerId) return res.status(400).json({ message: 'No Stripe customer for user' });

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      // Return to the app's billing return flow which already handles status/redirects
      return_url: `${appWebUrl}/billing/return`,
    });

    const subscription = await ensureSubscriptionForUser(user);
    await SubscriptionHistory.create({
      user: user._id,
      subscription: subscription._id,
      event: 'portal_opened',
      stripeCustomerId: user.stripeCustomerId,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('createPortalSession error', err);
    res.status(500).json({ message: 'Failed to create portal session' });
  }
};

// Validate a promo code and return percent_off if applicable
exports.validatePromoCode = async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ message: 'Promo code is invalid' });

    // First: allow env-configured bypass codes (works without Stripe)
    const isProd = (process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production');
    const defaultBypass = isProd ? '' : 'PG-BYPASS-100';
    const bypassList = (process.env.BYPASS_PROMO_CODES || defaultBypass)
      .split(',')
      .map((s) => String(s || '').trim().toLowerCase())
      .filter(Boolean);
    if (bypassList.includes(code.toLowerCase())) {
      // Treat bypass codes as 100% discount for preview purposes
      return res.json({ ok: true, code, percentOff: 100 });
    }

    // Second: check database for promo codes (free trials, etc.)
    const promoResult = await PromoCode.findAndValidate(code, req.user?.id);
    if (promoResult.valid && promoResult.promoCode) {
      return res.json({
        ok: true,
        code: promoResult.promoCode.code,
        percentOff: promoResult.discountPercent || 100,
        type: promoResult.type,
        planType: promoResult.planType,
        durationDays: promoResult.durationDays,
      });
    } else if (promoResult.reason && promoResult.reason !== 'Code not found') {
      // Code found in DB but invalid
      return res.status(400).json({ message: promoResult.reason });
    }

    // Third: validate against Stripe promotion codes
    const stripe = getStripe();
    const list = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
    const pc = list?.data?.[0];
    if (!pc) return res.status(404).json({ message: 'Promo code is invalid' });
    const coupon = pc.coupon;
    if (!coupon || coupon.percent_off == null) {
      return res.status(400).json({ message: 'Promo code is invalid' });
    }
    return res.json({ ok: true, code: pc.code, percentOff: coupon.percent_off, type: 'stripe' });
  } catch (e) {
    console.error('validatePromoCode error', e);
    return res.status(400).json({ message: 'Promo code is invalid' });
  }
};

exports.cancelSubscription = async (req, res) => {
  try {
    const stripe = getStripe();
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const sub = await Subscription.findOne({ user: user._id });
    if (!sub || !sub.stripeSubscriptionId) {
      return res.status(400).json({ message: 'No active Stripe subscription' });
    }

    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    sub.cancelAtPeriodEnd = true;
    sub.status = updated.status || sub.status;
    await sub.save();

    await SubscriptionHistory.create({
      user: user._id,
      subscription: sub._id,
      event: 'cancellation_requested',
      stripeCustomerId: user.stripeCustomerId,
      stripeSubscriptionId: sub.stripeSubscriptionId,
    });

    res.json({ ok: true, cancelAtPeriodEnd: true });
  } catch (err) {
    console.error('cancelSubscription error', err);
    res.status(500).json({ message: 'Failed to cancel subscription' });
  }
};

exports.getMySubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    const sub = await Subscription.findOne({ user: user._id });

    // Check for expired promo code subscriptions (no Stripe subscription ID)
    // These don't get webhook updates, so we need to check expiry manually
    if (sub && sub.status === 'active' && !sub.stripeSubscriptionId && sub.currentPeriodEnd) {
      const now = new Date();
      if (now > new Date(sub.currentPeriodEnd)) {
        // Subscription has expired - update status
        sub.status = 'expired';
        await sub.save();

        // Also update user's hasActiveSubscription flag
        if (user.hasActiveSubscription) {
          user.hasActiveSubscription = false;
          await user.save();
        }

        await SubscriptionHistory.create({
          user: user._id,
          subscription: sub._id,
          event: 'deactivated',
          reason: 'promo_code_expired',
        });
      }
    }

    res.json({
      user: { id: String(user._id), hasActiveSubscription: !!user.hasActiveSubscription },
      subscription: sub || null,
    });
  } catch (err) {
    console.error('getMySubscription error', err);
    res.status(500).json({ message: 'Failed to fetch subscription' });
  }
};

// Get workspace slots allocation
exports.getWorkspaceSlots = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const subscription = await Subscription.findOne({ user: user._id });
    const workspaceCount = await Workspace.countDocuments({ user: user._id });

    const included = subscription?.workspaceSlots?.included || 1;
    const purchased = subscription?.workspaceSlots?.purchased || 0;
    const total = subscription?.workspaceSlots?.total || 1;

    res.json({
      slots: {
        included,
        purchased,
        total,
        used: workspaceCount,
        available: Math.max(0, total - workspaceCount),
      },
    });
  } catch (err) {
    console.error('getWorkspaceSlots error', err);
    res.status(500).json({ message: 'Failed to fetch workspace slots' });
  }
};

// Get billing summary for workspace settings
exports.getBillingSummary = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const subscription = await Subscription.findOne({ user: user._id });
    const workspaceCount = await Workspace.countDocuments({ user: user._id });

    const included = subscription?.workspaceSlots?.included || 1;
    const purchased = subscription?.workspaceSlots?.purchased || 0;
    const total = subscription?.workspaceSlots?.total || 1;

    // Determine if this is a promo subscription (no Stripe subscription ID means they didn't go through Stripe checkout)
    const isPromo = subscription?.status === 'active' && !subscription?.stripeSubscriptionId;

    res.json({
      plan: {
        type: subscription?.planType || 'Free',
        status: subscription?.status || 'none',
        currentPeriodEnd: subscription?.currentPeriodEnd || null,
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd || false,
        isPromo, // true if active subscription without Stripe (promo/bypass code)
      },
      workspaceSlots: {
        included,
        purchased,
        total,
        used: workspaceCount,
        available: Math.max(0, total - workspaceCount),
      },
      billing: {
        stripeCustomerId: user.stripeCustomerId || null,
        hasPaymentMethod: !!user.stripeCustomerId,
      },
    });
  } catch (err) {
    console.error('getBillingSummary error', err);
    res.status(500).json({ message: 'Failed to fetch billing summary' });
  }
};

// Resolve workspace add-on price ID by interval
function resolveWorkspaceAddonPriceId(interval) {
  const i = interval === 'year' ? 'year' : 'month';
  if (i === 'year') {
    return process.env.STRIPE_PRICE_ID_WORKSPACE_ADDON_YEAR || '';
  }
  return process.env.STRIPE_PRICE_ID_WORKSPACE_ADDON_MONTH || '';
}

// Create checkout session for workspace add-on slots
exports.createWorkspaceAddonCheckout = async (req, res) => {
  try {
    const appWebUrl = process.env.APP_WEB_URL || 'http://localhost:3000';
    const quantity = Number(req.body?.quantity) || 1;
    const interval = (req.body?.interval) || 'month';

    if (quantity < 1 || quantity > 100) {
      return res.status(400).json({ message: 'Invalid quantity. Must be between 1 and 100.' });
    }

    const priceId = resolveWorkspaceAddonPriceId(interval);
    if (!priceId) {
      console.error('Workspace addon price ID not configured for interval:', interval);
      return res.status(500).json({ message: 'Workspace addon pricing not configured' });
    }

    const stripe = getStripe();
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Ensure Stripe customer exists
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.fullName || [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
        metadata: { userId: String(user._id) },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    const subscription = await ensureSubscriptionForUser(user);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: priceId,
          quantity: quantity,
        },
      ],
      success_url: `${appWebUrl}/billing/return?status=success&type=workspace_addon&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appWebUrl}/billing/return?status=cancelled&type=workspace_addon`,
      metadata: {
        userId: String(user._id),
        subscriptionId: String(subscription._id),
        type: 'workspace_addon',
        quantity: String(quantity),
      },
    });

    await SubscriptionHistory.create({
      user: user._id,
      subscription: subscription._id,
      event: 'initialized',
      stripeCustomerId: customerId,
      stripeSessionId: session.id,
      meta: { type: 'workspace_addon', quantity },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('createWorkspaceAddonCheckout error', err);
    res.status(500).json({ message: 'Failed to create workspace addon checkout' });
  }
};

// Webhook handler (mounted with express.raw in app.js)
exports.webhook = async (req, res) => {
  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { userId, subscriptionId, type: checkoutType, quantity: addonQuantity } = session.metadata || {};
        const stripeCustomerId = session.customer;
        const stripeSubscriptionId = session.subscription;

        const [user, sub] = await Promise.all([
          userId ? User.findById(userId) : null,
          subscriptionId ? Subscription.findById(subscriptionId) : null,
        ]);

        let subscriptionDoc = sub;
        if (!subscriptionDoc && user) {
          subscriptionDoc = await ensureSubscriptionForUser(user);
        }

        if (user && stripeCustomerId && user.stripeCustomerId !== stripeCustomerId) {
          user.stripeCustomerId = stripeCustomerId;
          await user.save();
        }

        if (subscriptionDoc) {
          // Handle workspace add-on purchase
          if (checkoutType === 'workspace_addon') {
            const qty = Number(addonQuantity) || 1;
            const currentPurchased = subscriptionDoc.workspaceSlots?.purchased || 0;
            const currentIncluded = subscriptionDoc.workspaceSlots?.included || 1;

            subscriptionDoc.workspaceSlots = {
              included: currentIncluded,
              purchased: currentPurchased + qty,
              total: currentIncluded + currentPurchased + qty,
            };
            subscriptionDoc.stripeWorkspaceAddonSubscriptionId = stripeSubscriptionId;
            await subscriptionDoc.save();

            await SubscriptionHistory.create({
              user: user ? user._id : subscriptionDoc.user,
              subscription: subscriptionDoc._id,
              event: 'completed',
              stripeCustomerId,
              stripeSubscriptionId,
              stripeSessionId: session.id,
              meta: { type: 'workspace_addon', quantity: qty },
            });
            break;
          }

          // Standard subscription checkout
          // Fetch Stripe subscription to get period window and final status
          let stripeSub = null;
          if (stripeSubscriptionId) {
            stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId);
          }

          subscriptionDoc.status = (stripeSub && stripeSub.status) || 'active';
          subscriptionDoc.stripeCustomerId = stripeCustomerId || subscriptionDoc.stripeCustomerId;
          subscriptionDoc.stripeSubscriptionId = stripeSubscriptionId || subscriptionDoc.stripeSubscriptionId;
          subscriptionDoc.stripePriceId = (stripeSub && stripeSub.items?.data?.[0]?.price?.id) || subscriptionDoc.stripePriceId;
          subscriptionDoc.stripeProductId = (stripeSub && stripeSub.items?.data?.[0]?.price?.product) || subscriptionDoc.stripeProductId;
          subscriptionDoc.currentPeriodStart = stripeSub ? new Date(stripeSub.current_period_start * 1000) : subscriptionDoc.currentPeriodStart;
          subscriptionDoc.currentPeriodEnd = stripeSub ? new Date(stripeSub.current_period_end * 1000) : subscriptionDoc.currentPeriodEnd;
          subscriptionDoc.renewalDate = subscriptionDoc.currentPeriodEnd || subscriptionDoc.renewalDate;
          await subscriptionDoc.save();

          if (user) {
            // Pro and Enterprise unlock premium features
            user.hasActiveSubscription = (
              ['active', 'trialing'].includes(subscriptionDoc.status) &&
              ['Pro', 'Enterprise'].includes(String(subscriptionDoc.planType || ''))
            );
            user.planSlug = (subscriptionDoc.planType || 'Lite').toLowerCase();
            await user.save();
          }

          await SubscriptionHistory.create({
            user: user ? user._id : subscriptionDoc.user,
            subscription: subscriptionDoc._id,
            event: 'completed',
            stripeCustomerId,
            stripeSubscriptionId,
            stripeSessionId: session.id,
          });
        }
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        const { userId, subscriptionId } = session.metadata || {};
        const sub = subscriptionId ? await Subscription.findById(subscriptionId) : null;
        await SubscriptionHistory.create({
          user: userId || (sub ? sub.user : undefined),
          subscription: sub ? sub._id : undefined,
          event: 'canceled',
          stripeSessionId: session.id,
          reason: 'checkout_session_expired',
        });
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const stripeSubscriptionId = invoice.subscription;
        if (stripeSubscriptionId) {
          const sub = await Subscription.findOne({ stripeSubscriptionId });
          if (sub) {
            sub.status = 'active';
            await sub.save();
            const user = await User.findById(sub.user);
            if (user) {
              user.hasActiveSubscription = (
                ['active', 'trialing'].includes(sub.status) &&
                ['Pro', 'Enterprise'].includes(String(sub.planType || ''))
              );
              user.planSlug = (sub.planType || 'Lite').toLowerCase();
              await user.save();
            }
            await SubscriptionHistory.create({
              user: sub.user,
              subscription: sub._id,
              event: 'activated',
              stripeSubscriptionId,
              stripeInvoiceId: invoice.id,
            });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const stripeSubscriptionId = invoice.subscription;
        if (stripeSubscriptionId) {
          const sub = await Subscription.findOne({ stripeSubscriptionId });
          if (sub) {
            sub.status = 'past_due';
            await sub.save();
            await SubscriptionHistory.create({
              user: sub.user,
              subscription: sub._id,
              event: 'payment_failed',
              stripeSubscriptionId,
              stripeInvoiceId: invoice.id,
              reason: invoice.collection_method,
            });
          }
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object;
        const sub = await Subscription.findOne({ stripeSubscriptionId: stripeSub.id });
        if (sub) {
          sub.status = stripeSub.status || sub.status;
          sub.cancelAtPeriodEnd = !!stripeSub.cancel_at_period_end;
          sub.currentPeriodStart = stripeSub.current_period_start
            ? new Date(stripeSub.current_period_start * 1000)
            : sub.currentPeriodStart;
          sub.currentPeriodEnd = stripeSub.current_period_end
            ? new Date(stripeSub.current_period_end * 1000)
            : sub.currentPeriodEnd;
          sub.renewalDate = sub.currentPeriodEnd || sub.renewalDate;
          await sub.save();

          const user = await User.findById(sub.user);
          if (user) {
            user.hasActiveSubscription = (
              ['active', 'trialing'].includes(sub.status) &&
              ['Pro', 'Enterprise'].includes(String(sub.planType || ''))
            );
            user.planSlug = (sub.planType || 'Lite').toLowerCase();
            await user.save();
          }

          await SubscriptionHistory.create({
            user: sub.user,
            subscription: sub._id,
            event: event.type === 'customer.subscription.deleted' ? 'deactivated' : 'updated',
            stripeSubscriptionId: stripeSub.id,
          });
        }
        break;
      }

      default:
        // No-op for other events but keep 200 OK
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handling error', err);
    res.status(500).json({ message: 'Webhook handler error' });
  }
};
