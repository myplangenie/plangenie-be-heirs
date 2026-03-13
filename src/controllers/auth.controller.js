const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');
const User = require('../models/User');
const Collaboration = require('../models/Collaboration');
const Workspace = require('../models/Workspace');
const Onboarding = require('../models/Onboarding');
const RefreshToken = require('../models/RefreshToken');
const Notification = require('../models/Notification');
const { effectivePlan, plans } = require('../config/entitlements');
const {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearCookieOptions,
} = require('../config/cookies');

// ── Test account constants ──
const TEST_EMAIL = 'test@plangenie.com';
const TEST_OTP = '123456';
function isTestAccount(email) {
  return String(email || '').toLowerCase().trim() === TEST_EMAIL;
}

// Helper to check workspace-specific onboarding completion
async function getWorkspaceOnboardingStatus(userId, workspaceIdOrWid) {
  if (!workspaceIdOrWid) return false;

  // workspaceIdOrWid could be either a MongoDB ObjectId or a wid string (like "ws_ea1c091967be")
  let workspaceId = workspaceIdOrWid;

  // If it looks like a wid string, look up the actual workspace _id
  if (typeof workspaceIdOrWid === 'string' && workspaceIdOrWid.startsWith('ws_')) {
    const workspace = await Workspace.findOne({ wid: workspaceIdOrWid }).select('_id').lean().exec();
    if (!workspace) return false;
    workspaceId = workspace._id;
  }

  const onboarding = await Onboarding.findOne({ user: userId, workspace: workspaceId }).lean().exec();
  return Boolean(onboarding?.onboardingDetailCompleted);
}

function signToken(userId) {
  // TODO: Revert to '30m' after client testing - temporarily set to 2h per client request
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '2h' });
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

  // Debug: log cookie options being used
  console.log('[auth] Setting cookies with options:', {
    accessCookie: ACCESS_TOKEN_COOKIE.options,
    refreshCookie: REFRESH_TOKEN_COOKIE.options,
    nodeEnv: process.env.NODE_ENV,
    cookieDomain: process.env.COOKIE_DOMAIN,
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

  // ── Test account: signup always succeeds, resets flow flags but keeps data ──
  if (isTestAccount(email) && existing) {
    const otpHash = await bcrypt.hash(TEST_OTP, 10);
    const vexp = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365); // 1 year
    await User.findByIdAndUpdate(existing._id, {
      isVerified: false,
      onboardingDone: false,
      verificationCode: otpHash,
      verificationExpires: vexp,
    });
    // Reset workspace onboarding flag so the full flow runs again
    await Onboarding.updateMany({ user: existing._id }, { onboardingDetailCompleted: false });
    console.log(`[auth] Test account signup reset for ${email}`);
    return res.status(201).json({ ok: true });
  }

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
    // Get owner's default workspace
    const ownerDefaultWs = await Workspace.findOne({ user: collab.owner, defaultWorkspace: true }).select('_id').lean().exec();
    const ownerDefaultWorkspaceId = ownerDefaultWs?._id || null;

    const user = await User.create({
      firstName: firstName || '',
      lastName: lastName || '',
      fullName: combinedFullName,
      companyName: companyName || '',
      email,
      password: hashed,
      isVerified: true,
      onboardingDone: true,
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

      // Also mark onboarding complete for the owner's workspace (collaborator views owner's data)
      if (ownerDefaultWorkspaceId) {
        await Onboarding.findOneAndUpdate(
          { user: user._id, workspace: ownerDefaultWorkspaceId },
          { onboardingDetailCompleted: true },
          { upsert: true, new: true }
        );
      }
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
  let newWorkspace = null;
  try {
    const workspaceName = companyName || `${firstName || 'My'}'s Workspace`;
    const wid = `ws_${crypto.randomBytes(6).toString('hex')}`;
    newWorkspace = await Workspace.create({
      user: user._id,
      wid,
      name: workspaceName,
      defaultWorkspace: true,
    });
  } catch (wsErr) {
    console.error('[auth] Failed to auto-create workspace:', wsErr?.message || wsErr);
  }

  // Create welcome notification for new user
  if (newWorkspace) {
    try {
      await Notification.create({
        user: user._id,
        workspace: newWorkspace._id,
        nid: `welcome_${user._id}`,
        title: 'Welcome to Plan Genie!',
        description: 'We\'re excited to have you on board. Explore your dashboard to track progress, manage projects, and access AI-powered insights for your business.',
        type: 'info',
        severity: 'success',
        time: 'Just now',
        actions: [
          { label: 'View Dashboard', kind: 'primary' },
        ],
      });
    } catch (notifErr) {
      console.error('[auth] Failed to create welcome notification:', notifErr?.message || notifErr);
    }
  }

  // Send verification email (best-effort)
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const { generateVerifyCodeEmail } = require('../emails/verifyCode');
    const { html, text } = generateVerifyCodeEmail({
      greetingName: user.firstName || user.fullName || '',
      title: 'Verify Your Email',
      intro: 'Thanks for signing up for Plan Genie. Your verification code is:',
      otp,
      expiresText: 'This code expires in 24 hours.',
    });
    const result = await resend.emails.send({ from, to: user.email, subject: 'Your Plan Genie verification code', html, text });
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
  const requestedWorkspace = req.headers['x-workspace-id'] || req.body?.workspaceId;
  console.log(`[auth.login] attempt email=${email} requestedWorkspace=${requestedWorkspace || 'none'}`);

  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    console.log(`[auth.login] failed - user not found email=${email}`);
    return res.status(401).json({ message: 'Invalid credentials' });
  }
  const match = await user.comparePassword(password);
  if (!match) return res.status(401).json({ message: 'Invalid credentials' });
  if (!user.isVerified) {
    // ── Test account: set known OTP, skip email ──
    if (isTestAccount(email)) {
      const otpHash = await bcrypt.hash(TEST_OTP, 10);
      const vexp = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
      await User.findByIdAndUpdate(user._id, { verificationCode: otpHash, verificationExpires: vexp });
      return res.status(403).json({
        message: 'Please verify your email before signing in.',
        details: { reason: 'unverified', resent: true, email: user.email },
      });
    }
    try {
      const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
      const otpHash = await bcrypt.hash(otp, 10);
      const vexp = new Date(Date.now() + 1000 * 60 * 60 * 24); // 24h
      await User.findByIdAndUpdate(user._id, { verificationCode: otpHash, verificationExpires: vexp });
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
        const { generateVerifyCodeEmail } = require('../emails/verifyCode');
        const { html, text } = generateVerifyCodeEmail({
          greetingName: user.firstName || user.fullName || '',
          title: 'Verify Your Email',
          intro: 'We noticed you tried to sign in, but your email is not verified yet. Your verification code is:',
          otp,
          expiresText: 'This code expires in 24 hours.',
        });
        const result = await resend.emails.send({ from, to: user.email, subject: 'Your Plan Genie verification code', html, text });
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

  // Use workspace ID from request (already extracted above) or use default
  const workspaceId = requestedWorkspace || user.defaultWorkspace;

  // Check workspace-specific onboarding completion
  const detailCompleted = workspaceId ? await getWorkspaceOnboardingStatus(user._id, workspaceId) : false;
  safe.onboardingDetailCompleted = detailCompleted;

  // Flow: onboarding -> workspace-select -> onboarding-detail -> dashboard
  // After initial onboarding, always route to workspace-select first
  const nextRoute = !safe.onboardingDone
    ? '/onboarding'
    : '/workspace-select';
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

  // [DATA TRACKING] Log successful login
  console.log(`[auth.login] success user=${user._id} email=${email} workspace=${workspaceId || 'none'} defaultWorkspace=${user.defaultWorkspace || 'none'} nextRoute=${nextRoute}`);

  // Return user data (no token in response body - it's in httpOnly cookie)
  return res.json({ user: safe, nextRoute, plan: { slug: planSlug, name: planName }, viewAsOwnerId });
};

exports.me = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });
  const safe = user.toSafeJSON();

  // Get workspace ID from request or use default
  const requestedWorkspace = req.headers['x-workspace-id'] || req.query.workspaceId;
  const workspaceId = requestedWorkspace || user.defaultWorkspace;

  // Check workspace-specific onboarding completion
  const detailCompleted = workspaceId ? await getWorkspaceOnboardingStatus(user._id, workspaceId) : false;
  safe.onboardingDetailCompleted = detailCompleted;

  // Flow: onboarding -> workspace-select -> onboarding-detail -> dashboard
  // After initial onboarding, always route to workspace-select first
  const nextRoute = !safe.onboardingDone
    ? '/onboarding'
    : '/workspace-select';
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
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: 'User not found' });

  // Get workspace ID from header or query, fall back to default
  let workspaceIdOrWid = req.headers['x-workspace-id'] || req.query.workspaceId || user.defaultWorkspace;
  if (!workspaceIdOrWid) {
    return res.status(400).json({ message: 'No workspace selected' });
  }

  // Convert wid string to workspace _id if needed
  let workspaceId = workspaceIdOrWid;
  if (typeof workspaceIdOrWid === 'string' && workspaceIdOrWid.startsWith('ws_')) {
    const workspace = await Workspace.findOne({ wid: workspaceIdOrWid }).select('_id').lean().exec();
    if (!workspace) {
      return res.status(400).json({ message: 'Workspace not found' });
    }
    workspaceId = workspace._id;
  }

  // Update workspace-specific onboarding completion
  await Onboarding.findOneAndUpdate(
    { user: req.user.id, workspace: workspaceId },
    { onboardingDetailCompleted: true },
    { upsert: true, new: true }
  );

  const safe = user.toSafeJSON();
  safe.onboardingDetailCompleted = true;
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

    // ── Test account: always accept 123456 ──
    if (isTestAccount(email) && String(code) === TEST_OTP) {
      user.isVerified = true;
      user.verificationCode = undefined;
      user.verificationExpires = undefined;
      await user.save();
      return res.json({ ok: true });
    }

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

    // ── Test account: skip email, OTP is always 123456 ──
    if (isTestAccount(email)) return res.json({ ok: true });

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
      const { generateVerifyCodeEmail } = require('../emails/verifyCode');
      const { html, text } = generateVerifyCodeEmail({
        greetingName: user.firstName || user.fullName || '',
        title: 'Verify Your Email',
        intro: 'Your verification code is:',
        otp,
        expiresText: 'This code expires in 24 hours.',
      });
      const result = await resend.emails.send({ from, to: user.email, subject: 'Your Plan Genie verification code', html, text });
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

exports.refresh = async (req, res) => {
  const refreshTokenValue = req.cookies[REFRESH_TOKEN_COOKIE.name];
  const requestedWorkspace = req.headers['x-workspace-id'];

  if (!refreshTokenValue) {
    return res.status(401).json({
      message: 'No refresh token provided',
      code: 'REFRESH_MISSING',
    });
  }

  const tokenDoc = await RefreshToken.findOne({ token: refreshTokenValue });

  if (!tokenDoc) {
    return res.status(401).json({
      message: 'Invalid refresh token',
      code: 'REFRESH_INVALID',
    });
  }

  // Expired refresh token → logout
  if (tokenDoc.expiresAt < new Date()) {
    await RefreshToken.deleteOne({ _id: tokenDoc._id });
    return res.status(401).json({
      message: 'Refresh token expired',
      code: 'REFRESH_EXPIRED',
    });
  }

  /**
   * Graceful reuse handling
   * Allow reuse within a short window (browser concurrency)
   */
  if (tokenDoc.used) {
    const reusedWithinGrace =
      Date.now() - tokenDoc.updatedAt.getTime() < 20_000;

    if (!reusedWithinGrace) {
      console.warn(
        `[auth.refresh] suspicious reuse user=${tokenDoc.user} family=${tokenDoc.family}`
      );

      // Soft-fail: do NOT destroy family immediately
      return res.status(401).json({
        message: 'Refresh token already used',
        code: 'REFRESH_REUSED',
      });
    }
  }

  // Mark token as used (atomic intent)
  tokenDoc.used = true;
  await tokenDoc.save();

  const user = await User.findById(tokenDoc.user);
  if (!user) {
    await RefreshToken.deleteOne({ _id: tokenDoc._id });
    return res.status(401).json({
      message: 'User not found',
      code: 'USER_NOT_FOUND',
    });
  }

  // Issue new tokens
  const accessToken = signToken(user._id);
  const newRefreshTokenValue = RefreshToken.generateToken();

  await RefreshToken.create({
    token: newRefreshTokenValue,
    user: user._id,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    family: tokenDoc.family,
    userAgent: req.get('User-Agent') || '',
    ipAddress: req.ip,
  });

  res.cookie(ACCESS_TOKEN_COOKIE.name, accessToken, ACCESS_TOKEN_COOKIE.options);
  res.cookie(
    REFRESH_TOKEN_COOKIE.name,
    newRefreshTokenValue,
    REFRESH_TOKEN_COOKIE.options
  );

  // Non-blocking activity update
  User.findByIdAndUpdate(user._id, { lastActiveAt: new Date() }).catch(() => {});

  return res.json({ ok: true });
};

// POST /api/auth/logout - Clear cookies and invalidate refresh token
exports.logout = async (req, res) => {
  const refreshTokenValue = req.cookies[REFRESH_TOKEN_COOKIE.name];
  const requestedWorkspace = req.headers['x-workspace-id'];
  let userId = 'unknown';

  if (refreshTokenValue) {
    // Find and get the family, then delete all tokens in that family
    const tokenDoc = await RefreshToken.findOne({ token: refreshTokenValue });
    if (tokenDoc) {
      userId = tokenDoc.user;
      await RefreshToken.deleteMany({ family: tokenDoc.family });
    }
  }

  console.log(`[auth.logout] user=${userId} workspace=${requestedWorkspace || 'none'}`);

  // Clear cookies
  res.cookie(ACCESS_TOKEN_COOKIE.name, '', clearCookieOptions(ACCESS_TOKEN_COOKIE));
  res.cookie(REFRESH_TOKEN_COOKIE.name, '', clearCookieOptions(REFRESH_TOKEN_COOKIE));

  return res.json({ ok: true });
};
