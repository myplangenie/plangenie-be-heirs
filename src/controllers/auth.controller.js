const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const crypto = require('crypto');
const { Resend } = require('resend');
const User = require('../models/User');

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

exports.register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Invalid input', details: errors.array() });
  }
  const { fullName, email, password } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ message: 'Email already in use' });
  }

  const hashed = await User.hashPassword(password);
  // Generate email verification token
  const vtoken = crypto.randomBytes(24).toString('hex');
  const vexp = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h
  const user = await User.create({ fullName, email, password: hashed, verificationToken: vtoken, verificationExpires: vexp });
  // Send verification email (best-effort)
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const appWeb = process.env.APP_WEB_URL; // e.g., https://app.plangenie.com
    const apiBase = process.env.APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const link = appWeb
      ? `${appWeb.replace(/\/$/, '')}/verify?token=${encodeURIComponent(vtoken)}`
      : `${apiBase}/api/auth/verify?token=${encodeURIComponent(vtoken)}`;
    await resend.emails.send({
      from,
      to: user.email,
      subject: 'Verify your PlanGenie account',
      html: `<p>Hello${user.fullName ? ' ' + user.fullName : ''},</p><p>Thanks for signing up for PlanGenie. Please verify your email by clicking the link below:</p><p><a href="${link}">Verify my account</a></p><p>This link expires in 24 hours.</p>`,
      text: `Verify your PlanGenie account: ${link}`,
    });
  } catch (_) {}
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
  if (!user.isVerified) return res.status(403).json({ message: 'Please verify your email before signing in.' });
  const token = signToken(user._id);
  return res.json({ token, user: user.toSafeJSON() });
};

exports.me = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  return res.json({ user: user.toSafeJSON() });
};

exports.markOnboarded = async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user.id, { onboardingDone: true }, { new: true });
  if (!user) return res.status(404).json({ message: 'User not found' });
  return res.json({ user: user.toSafeJSON(), ok: true });
};

// GET /api/auth/verify?token=...
exports.verifyEmail = async (req, res) => {
  try {
    const token = String(req.query?.token || '').trim();
    if (!token) return res.status(400).send('Invalid verification link');
    const user = await User.findOne({ verificationToken: token }).select('+verificationToken +verificationExpires');
    if (!user) return res.status(400).send('Invalid or expired verification link');
    if (user.verificationExpires && user.verificationExpires < new Date()) {
      return res.status(400).send('Verification link has expired');
    }
    user.isVerified = true;
    user.verificationToken = undefined;
    user.verificationExpires = undefined;
    await user.save();
    // Basic HTML confirmation
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send('<html><body style="font-family:Arial; padding:24px"><h2>Email verified</h2><p>Your email has been verified successfully. You may now <a href="/signin">sign in</a>.</p></body></html>');
  } catch (err) {
    return res.status(500).send('Server error');
  }
};
