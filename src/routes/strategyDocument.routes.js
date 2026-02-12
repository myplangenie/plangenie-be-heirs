const express = require('express');
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const ctrl = require('../controllers/strategyDocument.controller');

const router = express.Router();

// Apply auth, viewAs (for collaborators), and workspace context
router.use(auth(false));
router.use(viewAs);
router.use(workspaceContext);

const validCategories = ['strategy-vision', 'okrs-goals', 'board-decisions', 'operating-plans', 'other'];

/**
 * @route   GET /api/strategy-documents
 * @desc    List all strategy documents for the workspace
 * @access  Viewer+
 */
router.get('/', requireViewer, ctrl.list);

/**
 * @route   GET /api/strategy-documents/context
 * @desc    Get extracted text context for AI generation
 * @access  Viewer+
 */
router.get('/context', requireViewer, ctrl.getContext);

/**
 * @route   GET /api/strategy-documents/:id
 * @desc    Get a single strategy document
 * @access  Viewer+
 */
router.get(
  '/:id',
  requireViewer,
  [param('id').isMongoId().withMessage('Invalid document ID')],
  ctrl.get
);

/**
 * @route   POST /api/strategy-documents/upload
 * @desc    Upload a new strategy document
 * @access  Contributor+
 */
router.post(
  '/upload',
  requireContributor,
  [
    body('title').notEmpty().trim().withMessage('Title is required'),
    body('description').optional().trim(),
    body('category').optional().isIn(validCategories).withMessage('Invalid category'),
    body('dataUrl').notEmpty().withMessage('File data is required'),
    body('originalFilename').optional().trim(),
  ],
  ctrl.upload
);

/**
 * @route   PATCH /api/strategy-documents/:id
 * @desc    Update a strategy document's metadata
 * @access  Contributor+
 */
router.patch(
  '/:id',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid document ID'),
    body('title').optional().trim(),
    body('description').optional().trim(),
    body('category').optional().isIn(validCategories).withMessage('Invalid category'),
    body('order').optional().isInt({ min: 0 }),
  ],
  ctrl.update
);

/**
 * @route   DELETE /api/strategy-documents/:id
 * @desc    Soft delete a strategy document
 * @access  Contributor+
 */
router.delete(
  '/:id',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid document ID')],
  ctrl.delete
);

/**
 * @route   POST /api/strategy-documents/:id/restore
 * @desc    Restore a soft-deleted document
 * @access  Contributor+
 */
router.post(
  '/:id/restore',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid document ID')],
  ctrl.restore
);

/**
 * @route   DELETE /api/strategy-documents/:id/permanent
 * @desc    Permanently delete a document
 * @access  Contributor+
 */
router.delete(
  '/:id/permanent',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid document ID')],
  ctrl.permanentDelete
);

/**
 * @route   POST /api/strategy-documents/reorder
 * @desc    Reorder documents
 * @access  Contributor+
 */
router.post(
  '/reorder',
  requireContributor,
  [body('documentIds').isArray().withMessage('documentIds array is required')],
  ctrl.reorder
);

module.exports = router;
