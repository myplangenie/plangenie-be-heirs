const { PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const User = require('../models/User');
const { getR2Client } = require('../config/r2');
const bcrypt = require('bcryptjs');
const { Resend } = require('resend');

function parseDataUrl(dataUrl) {
  // data:[<mediatype>][;base64],<data>
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  const isBase64 = !!m[2];
  const data = m[3];
  try {
    const buf = isBase64 ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data), 'utf8');
    return { mime, buf };
  } catch (_) {
    return null;
  }
}

// Mark a specific tour as completed
exports.completeTour = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { tourKey } = req.body || {};
    const validTours = ['onboardingDetail', 'dashboard'];
    if (!tourKey || !validTours.includes(tourKey)) {
      return res.status(400).json({ message: 'Invalid tour key' });
    }

    const update = { [`toursCompleted.${tourKey}`]: true };
    const user = await User.findByIdAndUpdate(userId, update, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });

    return res.json({ ok: true, toursCompleted: user.toursCompleted });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to update tour status' });
  }
};

// Get tour completion status
exports.getTourStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await User.findById(userId).select('toursCompleted');
    if (!user) return res.status(404).json({ message: 'User not found' });

    return res.json({ toursCompleted: user.toursCompleted || {} });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to get tour status' });
  }
};

exports.uploadAvatar = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const { dataUrl } = req.body || {};
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) return res.status(400).json({ message: 'Invalid image payload' });
    const { mime, buf } = parsed;

    // Basic validation
    const allowed = new Set(['image/png', 'image/jpeg', 'image/webp']);
    if (!allowed.has(mime)) return res.status(400).json({ message: 'Unsupported image type' });
    if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ message: 'Image too large (max 8MB)' });

    // Allow override via R2_BUCKET; default to a shared bucket name for profile pictures
    const bucket = process.env.R2_BUCKET || 'profile-pictures';

    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    // Store at the bucket root (no nested folders) using timestamp-only naming per requirement
    const key = `${Date.now()}.${ext}`;

    const s3 = getR2Client();
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: mime }));

    const base = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/$/, '');
    if (!base) return res.status(500).json({ message: 'R2_PUBLIC_BASE_URL not configured' });
    const url = `${base}/${key}`;

    const user = await User.findByIdAndUpdate(userId, { avatarUrl: url }, { new: true });
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json({ ok: true, url, user: user.toSafeJSON() });
  } catch (err) {
    return res.status(500).json({ message: 'Upload failed' });
  }
};

// Schedule account deletion after a grace period (default 30 days)
exports.requestDeletion = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const now = new Date();
    const graceDays = Number(process.env.ACCOUNT_DELETION_GRACE_DAYS || 30);
    const scheduled = new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);

    const user = await User.findByIdAndUpdate(
      userId,
      { deletionRequestedAt: now, deletionScheduledFor: scheduled },
      { new: true }
    ).lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    return res.json({ ok: true, deletionRequestedAt: user.deletionRequestedAt, deletionScheduledFor: user.deletionScheduledFor });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to schedule account deletion' });
  }
};

// Cancel scheduled account deletion
exports.cancelDeletion = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });

    const user = await User.findByIdAndUpdate(
      userId,
      { deletionRequestedAt: null, deletionScheduledFor: null },
      { new: true }
    ).lean();
    if (!user) return res.status(404).json({ message: 'User not found' });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to cancel account deletion' });
  }
};

// Request email change: send OTP to current email
exports.requestEmailChange = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const newEmailRaw = String(req.body?.newEmail || '').trim().toLowerCase();
    if (!newEmailRaw) return res.status(400).json({ message: 'New email is required' });
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmailRaw)) return res.status(400).json({ message: 'Please enter a valid email address' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    // No-op if same as current
    if (String(user.email || '').toLowerCase() === newEmailRaw) {
      return res.json({ ok: true, noop: true });
    }

    // Friendly duplicate email error
    const exists = await User.findOne({ email: newEmailRaw }).select('_id').lean();
    if (exists && String(exists._id) !== String(userId)) {
      return res.status(409).json({ message: 'That email is already in use' });
    }

    // Generate OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpHash = await bcrypt.hash(otp, 10);
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    user.emailChangeNew = newEmailRaw;
    user.emailChangeCode = otpHash;
    user.emailChangeExpires = expires;
    await user.save();

    // Send OTP to current email
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color:#1D4374;">Confirm Your Email Change</h2>
          <p>We received a request to change your account email to <strong>${newEmailRaw}</strong>.</p>
          <p>Enter this verification code to confirm:</p>
          <div style="font-size: 28px; font-weight: bold; letter-spacing: 6px; background:#F3F4F6; padding:12px; text-align:center; border-radius:8px; color:#1D4374;">${otp}</div>
          <p style="color:#6B7280; font-size: 13px;">This code expires in 15 minutes.</p>
        </div>`;
      await resend.emails.send({ from, to: user.email, subject: 'Confirm your email change', html, text: `Your code is ${otp}. It expires in 15 minutes.` });
    } catch (mailErr) {
      console.error('[email-change] Failed to send OTP email:', mailErr?.message || mailErr);
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to initiate email change' });
  }
};

// Confirm email change with OTP
exports.confirmEmailChange = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ message: 'Unauthorized' });
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ message: 'Verification code is required' });

    const user = await User.findById(userId).select('+emailChangeCode +emailChangeExpires +emailChangeNew');
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (!user.emailChangeCode || !user.emailChangeExpires || !user.emailChangeNew) {
      return res.status(400).json({ message: 'No email change pending' });
    }
    if (user.emailChangeExpires < new Date()) {
      // Clear pending
      user.emailChangeCode = undefined;
      user.emailChangeExpires = undefined;
      user.emailChangeNew = undefined;
      await user.save();
      return res.status(400).json({ message: 'Code expired. Please request a new code.' });
    }
    const ok = await bcrypt.compare(code, user.emailChangeCode);
    if (!ok) return res.status(400).json({ message: 'Invalid verification code' });

    // Final duplicate check (race condition protection)
    const newEmail = String(user.emailChangeNew).toLowerCase();
    const exists = await User.findOne({ email: newEmail }).select('_id').lean();
    if (exists && String(exists._id) !== String(userId)) {
      return res.status(409).json({ message: 'That email is already in use' });
    }

    user.email = newEmail;
    user.emailChangeCode = undefined;
    user.emailChangeExpires = undefined;
    user.emailChangeNew = undefined;
    await user.save();
    return res.json({ ok: true, email: user.email });
  } catch (err) {
    return res.status(500).json({ message: 'Failed to confirm email change' });
  }
};
