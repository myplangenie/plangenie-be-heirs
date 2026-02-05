const express = require('express');
const { body, param, query } = require('express-validator');
const auth = require('../middleware/auth');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const ctrl = require('../controllers/okr.controller');

const router = express.Router();

// Apply auth and workspace context
router.use(auth(false));
router.use(workspaceContext);

/**
 * @route   GET /api/okrs
 * @desc    List all OKRs (optionally filtered by timeframe)
 * @access  Viewer+
 * @query   timeframe - Filter by timeframe ('1y', '3-5y', 'quarterly', 'other')
 */
router.get(
  '/',
  requireViewer,
  [query('timeframe').optional().isIn(['1y', '3-5y', 'quarterly', 'other'])],
  ctrl.list
);

/**
 * @route   GET /api/okrs/:id
 * @desc    Get a single OKR
 * @access  Viewer+
 */
router.get(
  '/:id',
  requireViewer,
  [param('id').isMongoId().withMessage('Invalid OKR ID')],
  ctrl.get
);

/**
 * @route   POST /api/okrs
 * @desc    Create a new OKR
 * @access  Contributor+
 */
router.post(
  '/',
  requireContributor,
  [
    body('objective').notEmpty().trim().withMessage('Objective is required'),
    body('keyResults').optional().isArray(),
    body('notes').optional().trim(),
    body('status').optional().isIn(['not_started', 'in_progress', 'completed', 'deferred']),
    body('timeframe').optional().isIn(['1y', '3-5y', 'quarterly', 'other']),
  ],
  ctrl.create
);

/**
 * @route   POST /api/okrs/bulk
 * @desc    Bulk create OKRs
 * @access  Contributor+
 */
router.post(
  '/bulk',
  requireContributor,
  [
    body('okrs').isArray().withMessage('OKRs array is required'),
  ],
  ctrl.bulkCreate
);

/**
 * @route   PATCH /api/okrs/:id
 * @desc    Update an OKR
 * @access  Contributor+
 */
router.patch(
  '/:id',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid OKR ID'),
    body('objective').optional().trim(),
    body('keyResults').optional().isArray(),
    body('notes').optional().trim(),
    body('status').optional().isIn(['not_started', 'in_progress', 'completed', 'deferred']),
    body('timeframe').optional().isIn(['1y', '3-5y', 'quarterly', 'other']),
    body('order').optional().isInt({ min: 0 }),
  ],
  ctrl.update
);

/**
 * @route   DELETE /api/okrs/:id
 * @desc    Soft delete an OKR
 * @access  Contributor+
 */
router.delete(
  '/:id',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid OKR ID')],
  ctrl.delete
);

/**
 * @route   POST /api/okrs/:id/restore
 * @desc    Restore a soft-deleted OKR
 * @access  Contributor+
 */
router.post(
  '/:id/restore',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid OKR ID')],
  ctrl.restore
);

/**
 * @route   POST /api/okrs/reorder
 * @desc    Reorder OKRs
 * @access  Contributor+
 */
router.post(
  '/reorder',
  requireContributor,
  [
    body('okrIds').isArray().withMessage('okrIds array is required'),
  ],
  ctrl.reorder
);

module.exports = router;
