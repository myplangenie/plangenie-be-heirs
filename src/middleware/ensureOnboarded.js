const User = require('../models/User');

// Ensures the authenticated user has completed onboarding and onboarding detail
module.exports = async function ensureOnboarded(req, res, next) {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: 'Unauthorized' });
    const user = await User.findById(id).lean().exec();
    if (!user) return res.status(401).json({ message: 'Unauthorized' });
    const completed = Boolean(user.onboardingDone);
    const detailCompleted = Boolean(user.onboardingDetailCompleted);
    if (!completed || !detailCompleted) {
      return res.status(403).json({ message: 'Complete onboarding before accessing the dashboard.' });
    }
    return next();
  } catch (_e) {
    return res.status(500).json({ message: 'Server error' });
  }
}
