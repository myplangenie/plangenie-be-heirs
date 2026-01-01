const express = require('express');
const router = express.Router();

// Stubbed Workspaces API — feature disabled in production
// Return safe, minimal payloads so frontend does not error if it accidentally calls.

// GET /api/workspaces
router.get('/', (_req, res) => {
  return res.json({ items: [] });
});

// POST /api/workspaces
router.post('/', (_req, res) => {
  return res.status(403).json({ message: 'Workspaces feature is disabled' });
});

// GET /api/workspaces/:wid
router.get('/:wid', (_req, res) => {
  return res.status(404).json({ message: 'Workspaces feature is disabled' });
});

// PATCH /api/workspaces/:wid
router.patch('/:wid', (_req, res) => {
  return res.status(403).json({ message: 'Workspaces feature is disabled' });
});

// GET /api/workspaces/:wid/this-week
router.get('/:wid/this-week', (_req, res) => {
  return res.json({ thisWeek: { overdueCount: 0, upcoming: [], nextReview: null, focusProject: null } });
});

// Reviews
router.get('/:wid/reviews', (_req, res) => res.json({ items: [] }));
router.post('/:wid/reviews', (_req, res) => res.status(403).json({ message: 'Workspaces feature is disabled' }));
router.get('/:wid/reviews/:rid', (_req, res) => res.status(404).json({ message: 'Workspaces feature is disabled' }));
router.patch('/:wid/reviews/:rid', (_req, res) => res.status(403).json({ message: 'Workspaces feature is disabled' }));

// Decisions
router.get('/:wid/decisions', (_req, res) => res.json({ items: [] }));
router.post('/:wid/decisions', (_req, res) => res.status(403).json({ message: 'Workspaces feature is disabled' }));
router.get('/:wid/decisions/:did', (_req, res) => res.status(404).json({ message: 'Workspaces feature is disabled' }));
router.patch('/:wid/decisions/:did', (_req, res) => res.status(403).json({ message: 'Workspaces feature is disabled' }));

// Assumptions
router.get('/:wid/assumptions', (_req, res) => res.json({ items: [] }));
router.post('/:wid/assumptions', (_req, res) => res.status(403).json({ message: 'Workspaces feature is disabled' }));
router.get('/:wid/assumptions/:aid', (_req, res) => res.status(404).json({ message: 'Workspaces feature is disabled' }));
router.patch('/:wid/assumptions/:aid', (_req, res) => res.status(403).json({ message: 'Workspaces feature is disabled' }));
router.get('/:wid/assumptions/:aid/history', (_req, res) => res.json({ history: [] }));
router.get('/:wid/assumptions/summary', (_req, res) => res.json({ summary: { monthly: { revenue: 0, costs: 0, profit: 0 }, runwayMonths: null, projection: [] } }));

// Scenarios
router.get('/:wid/scenarios', (_req, res) => res.json({ items: [] }));
router.post('/:wid/scenarios', (_req, res) => res.status(403).json({ message: 'Workspaces feature is disabled' }));
router.patch('/:wid/scenarios/:sid', (_req, res) => res.status(403).json({ message: 'Workspaces feature is disabled' }));

module.exports = router;
