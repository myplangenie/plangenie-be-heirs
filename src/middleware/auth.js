const jwt = require('jsonwebtoken');
const { ACCESS_TOKEN_COOKIE } = require('../config/cookies');

function auth(required = true) {
  return (req, res, next) => {
    let token = req.cookies?.[ACCESS_TOKEN_COOKIE.name];

    if (!token) {
      const header = req.headers['authorization'];
      if (header && header.startsWith('Bearer ')) {
        token = header.slice(7);
      }
    }

    // No token present
    if (!token) {
      if (!required) {
        req.user = null;
        return next();
      }

      // IMPORTANT: token missing is a *refreshable* state
      return res.status(401).json({
        message: 'Authorization token missing',
        code: 'TOKEN_MISSING',
      });
    }

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { id: payload.id };
      return next();
    } catch (err) {
      // Token expired = normal refresh flow
      if (err.name === 'TokenExpiredError') {
        if (!required) {
          req.user = null;
          return next();
        }

        return res.status(401).json({
          message: 'Token expired',
          code: 'TOKEN_EXPIRED',
        });
      }

      // Invalid token — still refreshable
      if (!required) {
        req.user = null;
        return next();
      }

      return res.status(401).json({
        message: 'Invalid token',
        code: 'TOKEN_INVALID',
      });
    }
  };
}

module.exports = auth;
