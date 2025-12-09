const Stripe = require('stripe');
const Subscription = require('../models/Subscription');
const SubscriptionHistory = require('../models/SubscriptionHistory');
const User = require('../models/User');

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

exports.createCheckoutSession = async (req, res) => {
  try {
    // Always prefer explicit app base URL from environment for billing return pages
    const appWebUrl = process.env.APP_WEB_URL || 'http://localhost:3000';
    const interval = (req.body && req.body.interval) || 'month';
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
      sub.planType = 'Pro';
      sub.amountCents = 0;
      const now = new Date();
      sub.currentPeriodStart = now;
      const addDays = interval === 'year' ? 365 : 30;
      sub.currentPeriodEnd = new Date(now.getTime() + addDays * 24 * 60 * 60 * 1000);
      sub.renewalDate = sub.currentPeriodEnd;
      await sub.save();
      user.hasActiveSubscription = true;
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

    // Normal Stripe flow
    const stripe = getStripe();
    const priceId = requireEnv('STRIPE_PRICE_ID');

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
      { $set: { status: 'initialized', stripeCustomerId: customerId, stripePriceId: priceId } }
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
      return_url: `${appWebUrl}/settings/billing`,
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

    // Otherwise, validate against Stripe promotion codes
    const stripe = getStripe();
    const list = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
    const pc = list?.data?.[0];
    if (!pc) return res.status(404).json({ message: 'Promo code is invalid' });
    const coupon = pc.coupon;
    if (!coupon || coupon.percent_off == null) {
      return res.status(400).json({ message: 'Promo code is invalid' });
    }
    return res.json({ ok: true, code: pc.code, percentOff: coupon.percent_off });
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
    res.json({
      user: { id: String(user._id), hasActiveSubscription: !!user.hasActiveSubscription },
      subscription: sub || null,
    });
  } catch (err) {
    console.error('getMySubscription error', err);
    res.status(500).json({ message: 'Failed to fetch subscription' });
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
        const { userId, subscriptionId } = session.metadata || {};
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
            user.hasActiveSubscription = ['active', 'trialing'].includes(subscriptionDoc.status);
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
              user.hasActiveSubscription = true;
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
            user.hasActiveSubscription = ['active', 'trialing'].includes(sub.status);
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
