exports.generatePlan = async (req, res) => {
  // Temporarily disabled per product decision; use general plan downloads instead
  return res.status(503).json({ ok: false, message: 'Gamma integration is temporarily disabled. Please use the general business plan download.' });
};

exports.generateMyPlan = async (req, res) => {
  // Temporarily disabled per product decision; use general plan downloads instead
  return res.status(503).json({ ok: false, message: 'Gamma integration is temporarily disabled. Please use the general business plan download.' });
};
