const express = require('express');
const { body, param, query } = require('express-validator');
const auth = require('../middleware/auth');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const ctrl = require('../controllers/visionGoal.controller');

const router = express.Router();

// Apply auth and workspace context
router.use(auth(false));
router.use(workspaceContext);

/**
 * @route   GET /api/vision-goals
 * @desc    List all vision goals (optionally filtered by type)
 * @access  Viewer+
 * @query   type - Filter by goal type ('1y' or '3y')
 */
router.get(
  '/',
  requireViewer,
  [query('type').optional().isIn(['1y', '3y'])],
  ctrl.list
);

/**
 * @route   GET /api/vision-goals/strings
 * @desc    Get goals as newline-separated strings (backward compatible)
 * @access  Viewer+
 */
router.get('/strings', requireViewer, ctrl.getAsStrings);

/**
 * @route   GET /api/vision-goals/:id
 * @desc    Get a single vision goal
 * @access  Viewer+
 */
router.get(
  '/:id',
  requireViewer,
  [param('id').isMongoId().withMessage('Invalid goal ID')],
  ctrl.get
);

/**
 * @route   POST /api/vision-goals
 * @desc    Create a new vision goal
 * @access  Contributor+
 */
router.post(
  '/',
  requireContributor,
  [
    body('goalType').isIn(['1y', '3y']).withMessage('goalType must be 1y or 3y'),
    body('text').notEmpty().trim().withMessage('Goal text is required'),
    body('notes').optional().trim(),
    body('status').optional().isIn(['not_started', 'in_progress', 'completed', 'deferred']),
  ],
  ctrl.create
);

/**
 * @route   POST /api/vision-goals/bulk
 * @desc    Bulk create goals
 * @access  Contributor+
 */
router.post(
  '/bulk',
  requireContributor,
  [
    body('goalType').isIn(['1y', '3y']).withMessage('goalType must be 1y or 3y'),
    body('goals').isArray().withMessage('Goals array is required'),
  ],
  ctrl.bulkCreate
);

/**
 * @route   PATCH /api/vision-goals/:id
 * @desc    Update a vision goal
 * @access  Contributor+
 */
router.patch(
  '/:id',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid goal ID'),
    body('text').optional().trim(),
    body('notes').optional().trim(),
    body('status').optional().isIn(['not_started', 'in_progress', 'completed', 'deferred']),
    body('order').optional().isInt({ min: 0 }),
  ],
  ctrl.update
);

/**
 * @route   DELETE /api/vision-goals/:id
 * @desc    Soft delete a vision goal
 * @access  Contributor+
 */
router.delete(
  '/:id',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid goal ID')],
  ctrl.delete
);

/**
 * @route   POST /api/vision-goals/:id/restore
 * @desc    Restore a soft-deleted goal
 * @access  Contributor+
 */
router.post(
  '/:id/restore',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid goal ID')],
  ctrl.restore
);

/**
 * @route   POST /api/vision-goals/reorder
 * @desc    Reorder goals within a goal type
 * @access  Contributor+
 */
router.post(
  '/reorder',
  requireContributor,
  [
    body('goalType').isIn(['1y', '3y']).withMessage('goalType must be 1y or 3y'),
    body('goalIds').isArray().withMessage('goalIds array is required'),
  ],
  ctrl.reorder
);

module.exports = router;
