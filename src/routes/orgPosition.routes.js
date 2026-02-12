const express = require('express');
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const ctrl = require('../controllers/orgPosition.controller');

const router = express.Router();

// Apply auth, viewAs (for collaborators), and workspace context
router.use(auth(false));
router.use(viewAs);
router.use(workspaceContext);

/**
 * @route   GET /api/org-positions
 * @desc    List all org positions for the workspace
 * @access  Viewer+
 */
router.get('/', requireViewer, ctrl.list);

/**
 * @route   GET /api/org-positions/tree
 * @desc    Get org chart as tree structure
 * @access  Viewer+
 */
router.get('/tree', requireViewer, ctrl.getTree);

/**
 * @route   GET /api/org-positions/:id
 * @desc    Get a single org position
 * @access  Viewer+
 */
router.get(
  '/:id',
  requireViewer,
  [param('id').isMongoId().withMessage('Invalid position ID')],
  ctrl.get
);

/**
 * @route   POST /api/org-positions
 * @desc    Create a new org position
 * @access  Contributor+
 */
router.post(
  '/',
  requireContributor,
  [
    body('position').notEmpty().trim().withMessage('Position title is required'),
    body('role').optional().trim(),
    body('name').optional().trim(),
    body('email').optional().trim().isEmail().withMessage('Invalid email format'),
    body('department').optional().trim(),
    body('parentId').optional(),
  ],
  ctrl.create
);

/**
 * @route   POST /api/org-positions/bulk
 * @desc    Bulk create positions
 * @access  Contributor+
 */
router.post(
  '/bulk',
  requireContributor,
  [body('positions').isArray().withMessage('Positions array is required')],
  ctrl.bulkCreate
);

/**
 * @route   PATCH /api/org-positions/:id
 * @desc    Update an org position
 * @access  Contributor+
 */
router.patch(
  '/:id',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid position ID'),
    body('position').optional().trim(),
    body('role').optional().trim(),
    body('name').optional().trim(),
    body('email').optional().trim().isEmail().withMessage('Invalid email format'),
    body('department').optional().trim(),
    body('parentId').optional(),
    body('order').optional().isInt({ min: 0 }),
  ],
  ctrl.update
);

/**
 * @route   DELETE /api/org-positions/:id
 * @desc    Soft delete an org position
 * @access  Contributor+
 */
router.delete(
  '/:id',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid position ID')],
  ctrl.delete
);

/**
 * @route   POST /api/org-positions/:id/restore
 * @desc    Restore a soft-deleted position
 * @access  Contributor+
 */
router.post(
  '/:id/restore',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid position ID')],
  ctrl.restore
);

/**
 * @route   POST /api/org-positions/reorder
 * @desc    Reorder positions
 * @access  Contributor+
 */
router.post(
  '/reorder',
  requireContributor,
  [body('positionIds').isArray().withMessage('positionIds array is required')],
  ctrl.reorder
);

module.exports = router;
