const Journey = require('../models/Journey');

// Reads X-Journey-Id header (or query ?journey) and ensures req.journey if present/valid.
// If user has no journeys, creates a default one.
module.exports = async function journeyContext(req, res, next) {
  try {
    const userId = req.user && req.user.id;
    if (!userId) return next();
    const header = String(req.headers['x-journey-id'] || req.query?.journey || '').trim();
    let current = null;
    if (header) {
      current = await Journey.findOne({ user: userId, jid: header }).lean().exec();
    }
    if (!current) {
      // Fallback to user's default journey, if any (do not create one)
      current = await Journey.findOne({ user: userId, defaultJourney: true }).lean().exec();
    }
    req.journey = current || null;
    return next();
  } catch (err) {
    return res.status(500).json({ message: err?.message || 'Failed to resolve journey' });
  }
}
