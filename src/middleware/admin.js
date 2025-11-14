const User = require('../models/User');
const auth = require('./auth');

// Combined middleware: ensure auth, then ensure isAdmin
function requireAdmin() {
  const ensureAuth = auth(true);
  return async (req, res, next) => {
    ensureAuth(req, res, async (err) => {
      if (err) return next(err);
      const id = req.user?.id;
      if (!id) return res.status(401).json({ message: 'Unauthorized' });
      try {
        const user = await User.findById(id).lean().exec();
        if (!user) return res.status(401).json({ message: 'Unauthorized' });
        if (!user.isAdmin) return res.status(403).json({ message: 'Forbidden: admin only' });
        return next();
      } catch (e) {
        return res.status(500).json({ message: 'Server error' });
      }
    });
  };
}

module.exports = requireAdmin;

