const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
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
    const from = process.env.RESEND_FROM || 'Plan Genie <onboarding@resend.dev>';
    await resend.emails.send({
      from,
      to: user.email,
      subject: 'Your PlanGenie verification code',
      html: `<p>Hello${(user.firstName || user.fullName) ? ' ' + (user.firstName || user.fullName) : ''},</p>
             <p>Thanks for signing up for PlanGenie.</p>
             <p>Your verification code is:</p>
             <p style="font-size:24px; font-weight:bold; letter-spacing:3px">${otp}</p>
             <p>This code expires in 24 hours.</p>`,
      text: `Your PlanGenie verification code is ${otp}. It expires in 24 hours.`,
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
