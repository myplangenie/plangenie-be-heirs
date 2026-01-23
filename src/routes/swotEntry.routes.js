const express = require('express');
const { body, param, query } = require('express-validator');
const auth = require('../middleware/auth');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const ctrl = require('../controllers/swotEntry.controller');

const router = express.Router();

// Apply auth and workspace context
router.use(auth(false));
router.use(workspaceContext);

/**
 * @route   GET /api/swot
 * @desc    List all SWOT entries (optionally filtered by type)
 * @access  Viewer+
 * @query   type - Filter by entry type
 */
router.get(
  '/',
  requireViewer,
  [query('type').optional().isIn(['strength', 'weakness', 'opportunity', 'threat'])],
  ctrl.list
);

/**
 * @route   GET /api/swot/grouped
 * @desc    Get all SWOT entries grouped by type
 * @access  Viewer+
 */
router.get('/grouped', requireViewer, ctrl.getGrouped);

/**
 * @route   GET /api/swot/strings
 * @desc    Get SWOT as newline-separated strings (backward compatible)
 * @access  Viewer+
 */
router.get('/strings', requireViewer, ctrl.getAsStrings);

/**
 * @route   GET /api/swot/:id
 * @desc    Get a single SWOT entry
 * @access  Viewer+
 */
router.get(
  '/:id',
  requireViewer,
  [param('id').isMongoId().withMessage('Invalid entry ID')],
  ctrl.get
);

/**
 * @route   POST /api/swot
 * @desc    Create a new SWOT entry
 * @access  Contributor+
 */
router.post(
  '/',
  requireContributor,
  [
    body('entryType').isIn(['strength', 'weakness', 'opportunity', 'threat']).withMessage('Valid entryType is required'),
    body('text').notEmpty().trim().withMessage('Entry text is required'),
    body('priority').optional().isIn(['low', 'medium', 'high', null]),
    body('notes').optional().trim(),
  ],
  ctrl.create
);

/**
 * @route   POST /api/swot/bulk
 * @desc    Bulk create SWOT entries
 * @access  Contributor+
 */
router.post(
  '/bulk',
  requireContributor,
  [
    body('entryType').isIn(['strength', 'weakness', 'opportunity', 'threat']).withMessage('Valid entryType is required'),
    body('entries').isArray().withMessage('Entries array is required'),
  ],
  ctrl.bulkCreate
);

/**
 * @route   PATCH /api/swot/:id
 * @desc    Update a SWOT entry
 * @access  Contributor+
 */
router.patch(
  '/:id',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid entry ID'),
    body('text').optional().trim(),
    body('priority').optional().isIn(['low', 'medium', 'high', null]),
    body('notes').optional().trim(),
    body('order').optional().isInt({ min: 0 }),
  ],
  ctrl.update
);

/**
 * @route   DELETE /api/swot/:id
 * @desc    Soft delete a SWOT entry
 * @access  Contributor+
 */
router.delete(
  '/:id',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid entry ID')],
  ctrl.delete
);

/**
 * @route   POST /api/swot/:id/restore
 * @desc    Restore a soft-deleted entry
 * @access  Contributor+
 */
router.post(
  '/:id/restore',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid entry ID')],
  ctrl.restore
);

/**
 * @route   POST /api/swot/reorder
 * @desc    Reorder entries within an entry type
 * @access  Contributor+
 */
router.post(
  '/reorder',
  requireContributor,
  [
    body('entryType').isIn(['strength', 'weakness', 'opportunity', 'threat']).withMessage('Valid entryType is required'),
    body('entryIds').isArray().withMessage('entryIds array is required'),
  ],
  ctrl.reorder
);

module.exports = router;
