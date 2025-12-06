const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const User = require('../models/User');
const { effectivePlan, plans } = require('../config/entitlements');

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

exports.register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Invalid input', details: errors.array() });
  }
  const { firstName, lastName, companyName, fullName, email, password } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ message: 'Email already in use' });
  }

  

  const hashed = await User.hashPassword(password);
  // Generate email verification OTP code
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const otpHash = await bcrypt.hash(otp, 10);
  const vexp = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h
  const combinedFullName = (fullName && String(fullName).trim()) || [firstName, lastName].filter(Boolean).join(' ').trim() || undefined;
  const user = await User.create({
    firstName: firstName || '',
    lastName: lastName || '',
    fullName: combinedFullName,
    companyName: companyName || '',
    email,
    password: hashed,
    verificationCode: otpHash,
    verificationExpires: vexp,
  });
  // Send verification email (best-effort)
  
  try {
  const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const result = await resend.emails.send({
      from,
      to: user.email,
      subject: 'Your Plan Genie verification code',
      html: `<p>Hello${(user.firstName || user.fullName) ? ' ' + (user.firstName || user.fullName) : ''},</p>
             <p>Thanks for signing up for Plan Genie.</p>
             <p>Your verification code is:</p>
             <p style="font-size:24px; font-weight:bold; letter-spacing:3px">${otp}</p>
             <p>This code expires in 24 hours.</p>`,
      text: `Your PlanGenie verification code is ${otp}. It expires in 24 hours.`,
    });
    if (result && result.error) {
      console.error('[email] Resend send error:', result.error?.message || result.error);
    }
    if ((from || '').includes('onboarding@resend.dev') && process.env.NODE_ENV === 'production') {
      console.warn('[email] Using onboarding@resend.dev in production only delivers to your Resend account email. Configure RESEND_FROM with a verified domain sender.');
    }
  } catch (err) {
    console.error('[email] Failed to send verification email:', err?.message || err);
  }
  // Do not auto-login on signup; require verification
  return res.status(201).json({ ok: true });
};

exports.login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Invalid input', details: errors.array() });
  }
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user) return res.status(401).json({ message: 'Invalid credentials' });
  const match = await user.comparePassword(password);
  if (!match) return res.status(401).json({ message: 'Invalid credentials' });
  if (!user.isVerified) {
    try {
      const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const otpHash = await bcrypt.hash(otp, 10);
      const vexp = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h
      await User.findByIdAndUpdate(user._id, { verificationCode: otpHash, verificationExpires: vexp });
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
        const result = await resend.emails.send({
          from,
          to: user.email,
          subject: 'Your Plan Genie verification code',
          html: `<p>Hello${(user.firstName || user.fullName) ? ' ' + (user.firstName || user.fullName) : ''},</p>
                 <p>We noticed you tried to sign in, but your email is not verified yet.</p>
                 <p>Your verification code is:</p>
                 <p style="font-size:24px; font-weight:bold; letter-spacing:3px">${otp}</p>
                 <p>This code expires in 24 hours.</p>`,
          text: `Your PlanGenie verification code is ${otp}. It expires in 24 hours.`,
        });
        if (result && result.error) {
          console.error('[email] Resend send error:', result.error?.message || result.error);
        }
      } catch (err) {
        console.error('[email] Failed to send verification email (login resend):', err?.message || err);
      }
    } catch (err) {
      console.error('[auth] Failed to generate resend OTP on login:', err?.message || err);
    }
    return res.status(403).json({
      message: 'Please verify your email before signing in.',
      details: { reason: 'unverified', resent: true, email: user.email },
    });
  }
  // Update lastActiveAt on login (non-blocking)
  try { await User.findByIdAndUpdate(user._id, { lastActiveAt: new Date() }); } catch {}
  const token = signToken(user._id);
  const safe = user.toSafeJSON();
  if (typeof safe.onboardingDetailCompleted === 'undefined') safe.onboardingDetailCompleted = false;
  const nextRoute = !safe.onboardingDone
    ? '/onboarding'
    : (!safe.onboardingDetailCompleted ? '/onboarding-detail' : '/dashboard');
  const planSlug = effectivePlan(user);
  const planName = plans[planSlug]?.name || planSlug;
  return res.json({ token, user: safe, nextRoute, plan: { slug: planSlug, name: planName } });
};

exports.me = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const safe = user.toSafeJSON();
  if (typeof safe.onboardingDetailCompleted === 'undefined') safe.onboardingDetailCompleted = false;
  const nextRoute = !safe.onboardingDone
    ? '/onboarding'
    : (!safe.onboardingDetailCompleted ? '/onboarding-detail' : '/dashboard');
  const planSlug = effectivePlan(user);
  const planName = plans[planSlug]?.name || planSlug;
  return res.json({ user: safe, nextRoute, plan: { slug: planSlug, name: planName } });
};

exports.markOnboarded = async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.user.id,
    { onboardingDone: true },
    { new: true }
  );
  if (!user) return res.status(404).json({ message: 'User not found' });
  const safe = user.toSafeJSON();
  if (typeof safe.onboardingDetailCompleted === 'undefined') safe.onboardingDetailCompleted = false;
  return res.json({ user: safe, ok: true });
};

// POST /api/auth/onboarding/detail-done
exports.markOnboardingDetailDone = async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.user.id,
    { onboardingDetailCompleted: true },
    { new: true }
  );
  if (!user) return res.status(404).json({ message: 'User not found' });
  const safe = user.toSafeJSON();
  if (typeof safe.onboardingDetailCompleted === 'undefined') safe.onboardingDetailCompleted = false;
  return res.json({ user: safe, ok: true });
};

// POST /api/auth/verify-otp  { email, code }
exports.verifyOtp = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Invalid input', details: errors.array() });
    }
    const { email, code } = req.body || {};
    const user = await User.findOne({ email }).select('+verificationCode +verificationExpires');
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isVerified) return res.json({ ok: true });
    if (!user.verificationCode) return res.status(400).json({ message: 'No verification code set' });
    if (user.verificationExpires && user.verificationExpires < new Date()) {
      return res.status(400).json({ message: 'Code expired' });
    }
    const match = await bcrypt.compare(String(code || ''), user.verificationCode);
    if (!match) return res.status(400).json({ message: 'Invalid code' });
    user.isVerified = true;
    user.verificationCode = undefined;
    user.verificationExpires = undefined;
    await user.save();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

// Keep legacy GET link endpoint but inform about OTP
exports.verifyEmail = async (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res
    .status(410)
    .send('<html><body style="font-family:Arial; padding:24px"><h2>Verification method updated</h2><p>We now use one-time codes. Please enter the verification code sent to your email in the app.</p></body></html>');
};

// POST /api/auth/resend-otp  { email }
exports.resendOtp = async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ message: 'Email required' });
    const user = await User.findOne({ email }).select('_id email isVerified firstName fullName');
    if (!user) return res.status(200).json({ ok: true }); // do not reveal existence
    if (user.isVerified) return res.status(200).json({ ok: true });
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const otpHash = await bcrypt.hash(otp, 10);
    const vexp = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h
    await User.findByIdAndUpdate(user._id, { verificationCode: otpHash, verificationExpires: vexp });
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
      const result = await resend.emails.send({
        from,
        to: user.email,
        subject: 'Your Plan Genie verification code',
        html: `<p>Hello${(user.firstName || user.fullName) ? ' ' + (user.firstName || user.fullName) : ''},</p>
               <p>Your verification code is:</p>
               <p style="font-size:24px; font-weight:bold; letter-spacing:3px">${otp}</p>
               <p>This code expires in 24 hours.</p>`,
        text: `Your PlanGenie verification code is ${otp}. It expires in 24 hours.`,
      });
      if (result && result.error) {
        console.error('[email] Resend send error:', result.error?.message || result.error);
      }
    } catch (err) {
      console.error('[email] Failed to send verification email (resend):', err?.message || err);
    }
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};
