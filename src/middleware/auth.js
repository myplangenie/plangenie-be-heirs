const jwt = require('jsonwebtoken');
const { ACCESS_TOKEN_COOKIE } = require('../config/cookies');

function auth(required = true) {
  return (req, res, next) => {
    // Priority: 1) Cookie, 2) Authorization header (for backward compatibility during migration)
    let token = req.cookies?.[ACCESS_TOKEN_COOKIE.name];

    // Fallback to Authorization header for backward compatibility
    if (!token) {
      const header = req.headers['authorization'];
      token = header && header.startsWith('Bearer ')
        ? header.slice(7)
        : null;
    }

    if (!token) {
      if (required) return res.status(401).json({ message: 'Authorization token missing' });
      req.user = null;
      return next();
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { id: payload.id };
      next();
    } catch (err) {
      // Differentiate between expired and invalid tokens
      if (err.name === 'TokenExpiredError') {
        // For optional auth, allow proceeding with null user instead of forcing refresh
        // This prevents errors when token is stale but user doesn't need to be authenticated
        if (!required) {
          req.user = null;
          return next();
        }
        return res.status(401).json({ message: 'Token expired', code: 'TOKEN_EXPIRED' });
      }
      // For invalid tokens with optional auth, proceed with null user
      if (!required) {
        req.user = null;
        return next();
      }
      return res.status(401).json({ message: 'Invalid token' });
    }
  };
}

module.exports = auth;

