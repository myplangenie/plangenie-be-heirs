// Centralized error handler
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  const message = err.message || 'Server error';
  const details = err.details || undefined;
  res.status(status).json({ message, ...(details ? { details } : {}) });
}

module.exports = errorHandler;

