const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const User = require('../models/User');
const Collaboration = require('../models/Collaboration');
const Workspace = require('../models/Workspace');
const RefreshToken = require('../models/RefreshToken');
const { effectivePlan, plans } = require('../config/entitlements');
const {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearCookieOptions,
} = require('../config/cookies');

function signToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '30m' });
}

// Helper to issue access + refresh tokens and set httpOnly cookies
async function issueTokensAndSetCookies(res, user, req) {
  // Generate access token (JWT)
  const accessToken = signToken(user._id);

  // Generate opaque refresh token
  const refreshTokenValue = RefreshToken.generateToken();
  const family = RefreshToken.generateFamily();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Store refresh token in DB
  await RefreshToken.create({
    token: refreshTokenValue,
    user: user._id,
    expiresAt,
    family,
    userAgent: req.get('User-Agent') || '',
    ipAddress: req.ip || req.connection?.remoteAddress || '',
  });

  // Set cookies
  res.cookie(ACCESS_TOKEN_COOKIE.name, accessToken, ACCESS_TOKEN_COOKIE.options);
  res.cookie(REFRESH_TOKEN_COOKIE.name, refreshTokenValue, REFRESH_TOKEN_COOKIE.options);

  return { accessToken, refreshTokenValue };
}

exports.register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: 'Invalid input', details: errors.array() });
  }
  const { firstName, lastName, companyName, fullName, email, password, collabToken } = req.body;

  const existing = await User.findOne({ email });
  if (existing) {
    return res.status(409).json({ message: 'Email already in use' });
  }
  
  // Check for collaborator invitation by token (preferred) or by matching email (fallback)
  let collab = null;
  let collabOwnerId = null;
  if (collabToken && typeof collabToken === 'string') {
    collab = await Collaboration.findOne({ acceptToken: String(collabToken).trim() }).exec();
    if (!collab) return res.status(400).json({ message: 'Invalid or expired collaborator invite' });
    if (collab.tokenExpires && collab.tokenExpires < new Date()) return res.status(400).json({ message: 'Invite token expired' });
    if (String(collab.email || '').toLowerCase() !== String(email || '').toLowerCase()) {
      return res.status(400).json({ message: 'This invite was sent to a different email address' });
    }
    collabOwnerId = String(collab.owner);
  }
  // else {
  //   // Fallback: If there is an active collab invite for this email, use it
  //   collab = await Collaboration.findOne({ email: String(email || '').toLowerCase(), status: { $in: ['pending', 'accepted'] } })
  //     .sort({ createdAt: -1 })
  //     .exec();
  //   if (collab) collabOwnerId = String(collab.owner);
  // }

  const hashed = await User.hashPassword(password);
  const combinedFullName = (fullName && String(fullName).trim()) || [firstName, lastName].filter(Boolean).join(' ').trim() || undefined;

  // If collaborator invite is present, auto-verify and skip onboarding
  if (collab) {
    const user = await User.create({
      firstName: firstName || '',
      lastName: lastName || '',
      fullName: combinedFullName,
      companyName: companyName || '',
      email,
      password: hashed,
      isVerified: true,
      onboardingDone: true,
      onboardingDetailCompleted: true,
      isCollaborator: true,
    });
    try {
      // Link collaboration to this user and accept
      collab.status = 'accepted';
      collab.acceptedAt = new Date();
      collab.viewer = user._id;
      collab.collaborator = user._id;
      collab.acceptToken = null;
      collab.tokenExpires = null;
      await collab.save();
    } catch (err) {
      // Non-fatal
      console.error('[collab] Failed to link collaboration on signup:', err?.message || err);
    }
    await issueTokensAndSetCookies(res, user, req);
    const safe = user.toSafeJSON();
    return res.status(201).json({ user: safe, ownerId: collabOwnerId });
  }

  // Default path: create user and send OTP for verification
  const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const otpHash = await bcrypt.hash(otp, 10);
  const vexp = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h
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

  // Auto-create default workspace for the user
  try {
    const workspaceName = companyName || `${firstName || 'My'}'s Workspace`;
    const wid = `ws_${crypto.randomBytes(6).toString('hex')}`;
    await Workspace.create({
      user: user._id,
      wid,
      name: workspaceName,
      defaultWorkspace: true,
    });
  } catch (wsErr) {
    console.error('[auth] Failed to auto-create workspace:', wsErr?.message || wsErr);
  }

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

  // Issue tokens and set httpOnly cookies
  await issueTokensAndSetCookies(res, user, req);

  const safe = user.toSafeJSON();
  if (typeof safe.onboardingDetailCompleted === 'undefined') safe.onboardingDetailCompleted = false;
  const nextRoute = !safe.onboardingDone
    ? '/onboarding'
    : (!safe.onboardingDetailCompleted ? '/onboarding-detail' : '/dashboard');
  const planSlug = effectivePlan(user);
  const planName = plans[planSlug]?.name || planSlug;
  // If user is a viewer/collaborator for any accepted collaboration, include default owner to view-as
  let viewAsOwnerId = undefined;
  try {
    const rows = await Collaboration.find({ status: 'accepted', $or: [ { viewer: user._id }, { collaborator: user._id } ] })
      .select('owner')
      .limit(5)
      .lean()
      .exec();
    if (rows && rows.length) {
      const ids = Array.from(new Set(rows.map((r) => String(r.owner))));
      const owners = await User.find({ _id: { $in: ids } }).select('_id').lean().exec();
      if (owners && owners.length) viewAsOwnerId = String(owners[0]._id);
    }
  } catch {}
  // Return user data (no token in response body - it's in httpOnly cookie)
  return res.json({ user: safe, nextRoute, plan: { slug: planSlug, name: planName }, viewAsOwnerId });
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
  // Provide default owner to view-as for collaborators
  let viewAsOwnerId = undefined;
  try {
    const rows = await Collaboration.find({ status: 'accepted', $or: [ { viewer: user._id }, { collaborator: user._id } ] })
      .select('owner')
      .limit(5)
      .lean()
      .exec();
    if (rows && rows.length) {
      const ids = Array.from(new Set(rows.map((r) => String(r.owner))));
      const owners = await User.find({ _id: { $in: ids } }).select('_id').lean().exec();
      if (owners && owners.length) viewAsOwnerId = String(owners[0]._id);
    }
  } catch {}
  return res.json({ user: safe, nextRoute, plan: { slug: planSlug, name: planName }, viewAsOwnerId });
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

// POST /api/auth/refresh - Refresh access token using refresh token
exports.refresh = async (req, res) => {
  const refreshTokenValue = req.cookies[REFRESH_TOKEN_COOKIE.name];

  if (!refreshTokenValue) {
    return res.status(401).json({ message: 'No refresh token provided' });
  }

  // Find the refresh token in DB
  const tokenDoc = await RefreshToken.findOne({ token: refreshTokenValue });

  if (!tokenDoc) {
    // Token doesn't exist - might be stolen and already rotated
    return res.status(401).json({ message: 'Invalid refresh token' });
  }

  // Check if token is expired
  if (tokenDoc.expiresAt < new Date()) {
    await RefreshToken.deleteOne({ _id: tokenDoc._id });
    return res.status(401).json({ message: 'Refresh token expired' });
  }

  // Check if token was already used (replay attack detection)
  if (tokenDoc.used) {
    // Potential token theft! Invalidate entire token family
    await RefreshToken.deleteMany({ family: tokenDoc.family });
    // Clear cookies
    res.cookie(ACCESS_TOKEN_COOKIE.name, '', clearCookieOptions(ACCESS_TOKEN_COOKIE));
    res.cookie(REFRESH_TOKEN_COOKIE.name, '', clearCookieOptions(REFRESH_TOKEN_COOKIE));
    return res.status(401).json({ message: 'Token reuse detected. All sessions invalidated.' });
  }

  // Mark current token as used
  tokenDoc.used = true;
  await tokenDoc.save();

  // Get user
  const user = await User.findById(tokenDoc.user);
  if (!user) {
    await RefreshToken.deleteOne({ _id: tokenDoc._id });
    return res.status(401).json({ message: 'User not found' });
  }

  // Generate new access token
  const accessToken = signToken(user._id);

  // Generate new refresh token (rotation)
  const newRefreshTokenValue = RefreshToken.generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await RefreshToken.create({
    token: newRefreshTokenValue,
    user: user._id,
    expiresAt,
    family: tokenDoc.family, // Same family for rotation tracking
    userAgent: req.get('User-Agent') || '',
    ipAddress: req.ip || req.connection?.remoteAddress || '',
  });

  // Set new cookies
  res.cookie(ACCESS_TOKEN_COOKIE.name, accessToken, ACCESS_TOKEN_COOKIE.options);
  res.cookie(REFRESH_TOKEN_COOKIE.name, newRefreshTokenValue, REFRESH_TOKEN_COOKIE.options);

  // Update lastActiveAt (non-blocking)
  try { await User.findByIdAndUpdate(user._id, { lastActiveAt: new Date() }); } catch {}

  return res.json({ ok: true });
};

// POST /api/auth/logout - Clear cookies and invalidate refresh token
exports.logout = async (req, res) => {
  const refreshTokenValue = req.cookies[REFRESH_TOKEN_COOKIE.name];

  if (refreshTokenValue) {
    // Find and get the family, then delete all tokens in that family
    const tokenDoc = await RefreshToken.findOne({ token: refreshTokenValue });
    if (tokenDoc) {
      await RefreshToken.deleteMany({ family: tokenDoc.family });
    }
  }

  // Clear cookies
  res.cookie(ACCESS_TOKEN_COOKIE.name, '', clearCookieOptions(ACCESS_TOKEN_COOKIE));
  res.cookie(REFRESH_TOKEN_COOKIE.name, '', clearCookieOptions(REFRESH_TOKEN_COOKIE));

  return res.json({ ok: true });
};
