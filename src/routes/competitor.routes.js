const express = require('express');
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const ctrl = require('../controllers/competitor.controller');

const router = express.Router();

// Apply auth and workspace context
router.use(auth(false));
router.use(workspaceContext);

/**
 * @route   GET /api/competitors
 * @desc    List all competitors for the workspace
 * @access  Viewer+
 */
router.get('/', requireViewer, ctrl.list);

/**
 * @route   GET /api/competitors/arrays
 * @desc    Get competitor names and advantages as arrays (backward compatible)
 * @access  Viewer+
 */
router.get('/arrays', requireViewer, ctrl.getNamesArray);

/**
 * @route   GET /api/competitors/:id
 * @desc    Get a single competitor
 * @access  Viewer+
 */
router.get(
  '/:id',
  requireViewer,
  [param('id').isMongoId().withMessage('Invalid competitor ID')],
  ctrl.get
);

/**
 * @route   POST /api/competitors
 * @desc    Create a new competitor
 * @access  Contributor+
 */
router.post(
  '/',
  requireContributor,
  [
    body('name').notEmpty().trim().withMessage('Competitor name is required'),
    body('advantage').optional().trim(),
    body('website').optional().trim(),
    body('notes').optional().trim(),
    body('threatLevel').optional().isIn(['low', 'medium', 'high', null]),
  ],
  ctrl.create
);

/**
 * @route   POST /api/competitors/bulk
 * @desc    Bulk create competitors
 * @access  Contributor+
 */
router.post(
  '/bulk',
  requireContributor,
  [body('competitors').isArray().withMessage('Competitors array is required')],
  ctrl.bulkCreate
);

/**
 * @route   PATCH /api/competitors/:id
 * @desc    Update a competitor
 * @access  Contributor+
 */
router.patch(
  '/:id',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid competitor ID'),
    body('name').optional().trim(),
    body('advantage').optional().trim(),
    body('website').optional().trim(),
    body('notes').optional().trim(),
    body('threatLevel').optional().isIn(['low', 'medium', 'high', null]),
    body('order').optional().isInt({ min: 0 }),
  ],
  ctrl.update
);

/**
 * @route   DELETE /api/competitors/:id
 * @desc    Soft delete a competitor
 * @access  Contributor+
 */
router.delete(
  '/:id',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid competitor ID')],
  ctrl.delete
);

/**
 * @route   POST /api/competitors/:id/restore
 * @desc    Restore a soft-deleted competitor
 * @access  Contributor+
 */
router.post(
  '/:id/restore',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid competitor ID')],
  ctrl.restore
);

/**
 * @route   POST /api/competitors/reorder
 * @desc    Reorder competitors
 * @access  Contributor+
 */
router.post(
  '/reorder',
  requireContributor,
  [body('competitorIds').isArray().withMessage('competitorIds array is required')],
  ctrl.reorder
);

module.exports = router;
