const jwt = require('jsonwebtoken');

function auth(required = true) {
  return (req, res, next) => {
    const header = req.headers['authorization'];
    const token = header && header.startsWith('Bearer ')
      ? header.slice(7)
      : null;

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
      return res.status(401).json({ message: 'Invalid or expired token' });
    }
  };
}

module.exports = auth;

