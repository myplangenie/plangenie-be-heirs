const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
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
  const user = await User.create({ fullName, email, password: hashed });
  const token = signToken(user._id);
  return res.status(201).json({ token, user: user.toSafeJSON() });
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
