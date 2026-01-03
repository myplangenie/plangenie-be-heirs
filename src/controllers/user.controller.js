const { PutObjectCommand } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const User = require('../models/User');
const { getR2Client } = require('../config/r2');

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
