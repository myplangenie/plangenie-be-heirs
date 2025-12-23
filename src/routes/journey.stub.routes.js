const express = require('express');
const router = express.Router();

// Stubbed Journeys API — feature disabled in production
// Return safe, minimal payloads so frontend does not error if it accidentally calls.

// GET /api/journeys
router.get('/', (_req, res) => {
  return res.json({ items: [] });
});

// POST /api/journeys
router.post('/', (_req, res) => {
  return res.status(403).json({ message: 'Journeys feature is disabled' });
});

// GET /api/journeys/:jid
router.get('/:jid', (_req, res) => {
  return res.status(404).json({ message: 'Journeys feature is disabled' });
});

// PATCH /api/journeys/:jid
router.patch('/:jid', (_req, res) => {
  return res.status(403).json({ message: 'Journeys feature is disabled' });
});

// GET /api/journeys/:jid/this-week
router.get('/:jid/this-week', (_req, res) => {
  return res.json({ thisWeek: { overdueCount: 0, upcoming: [], nextReview: null, focusProject: null } });
});

// Reviews
router.get('/:jid/reviews', (_req, res) => res.json({ items: [] }));
router.post('/:jid/reviews', (_req, res) => res.status(403).json({ message: 'Journeys feature is disabled' }));
router.get('/:jid/reviews/:rid', (_req, res) => res.status(404).json({ message: 'Journeys feature is disabled' }));
router.patch('/:jid/reviews/:rid', (_req, res) => res.status(403).json({ message: 'Journeys feature is disabled' }));

// Decisions
router.get('/:jid/decisions', (_req, res) => res.json({ items: [] }));
router.post('/:jid/decisions', (_req, res) => res.status(403).json({ message: 'Journeys feature is disabled' }));
router.get('/:jid/decisions/:did', (_req, res) => res.status(404).json({ message: 'Journeys feature is disabled' }));
router.patch('/:jid/decisions/:did', (_req, res) => res.status(403).json({ message: 'Journeys feature is disabled' }));

// Assumptions
router.get('/:jid/assumptions', (_req, res) => res.json({ items: [] }));
router.post('/:jid/assumptions', (_req, res) => res.status(403).json({ message: 'Journeys feature is disabled' }));
router.get('/:jid/assumptions/:aid', (_req, res) => res.status(404).json({ message: 'Journeys feature is disabled' }));
router.patch('/:jid/assumptions/:aid', (_req, res) => res.status(403).json({ message: 'Journeys feature is disabled' }));
router.get('/:jid/assumptions/:aid/history', (_req, res) => res.json({ history: [] }));
router.get('/:jid/assumptions/summary', (_req, res) => res.json({ summary: { monthly: { revenue: 0, costs: 0, profit: 0 }, runwayMonths: null, projection: [] } }));

// Scenarios
router.get('/:jid/scenarios', (_req, res) => res.json({ items: [] }));
router.post('/:jid/scenarios', (_req, res) => res.status(403).json({ message: 'Journeys feature is disabled' }));
router.patch('/:jid/scenarios/:sid', (_req, res) => res.status(403).json({ message: 'Journeys feature is disabled' }));

module.exports = router;

