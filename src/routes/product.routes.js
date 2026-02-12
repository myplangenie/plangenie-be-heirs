const express = require('express');
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const ctrl = require('../controllers/product.controller');

const router = express.Router();

// Apply auth, viewAs (for collaborators), and workspace context
router.use(auth(false));
router.use(viewAs);
router.use(workspaceContext);

/**
 * @route   GET /api/products
 * @desc    List all products for the workspace
 * @access  Viewer+
 */
router.get('/', requireViewer, ctrl.list);

/**
 * @route   GET /api/products/:id
 * @desc    Get a single product
 * @access  Viewer+
 */
router.get(
  '/:id',
  requireViewer,
  [param('id').isMongoId().withMessage('Invalid product ID')],
  ctrl.get
);

/**
 * @route   POST /api/products
 * @desc    Create a new product
 * @access  Contributor+
 */
router.post(
  '/',
  requireContributor,
  [
    body('name').notEmpty().trim().withMessage('Product name is required'),
    body('description').optional().trim(),
    body('pricing').optional().trim(),
    body('price').optional().trim(),
    body('unitCost').optional().trim(),
    body('monthlyVolume').optional().trim(),
  ],
  ctrl.create
);

/**
 * @route   POST /api/products/bulk
 * @desc    Bulk create products
 * @access  Contributor+
 */
router.post(
  '/bulk',
  requireContributor,
  [body('products').isArray().withMessage('Products array is required')],
  ctrl.bulkCreate
);

/**
 * @route   PATCH /api/products/:id
 * @desc    Update a product
 * @access  Contributor+
 */
router.patch(
  '/:id',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid product ID'),
    body('name').optional().trim(),
    body('description').optional().trim(),
    body('pricing').optional().trim(),
    body('price').optional().trim(),
    body('unitCost').optional().trim(),
    body('monthlyVolume').optional().trim(),
    body('order').optional().isInt({ min: 0 }),
  ],
  ctrl.update
);

/**
 * @route   DELETE /api/products/:id
 * @desc    Soft delete a product
 * @access  Contributor+
 */
router.delete(
  '/:id',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid product ID')],
  ctrl.delete
);

/**
 * @route   POST /api/products/:id/restore
 * @desc    Restore a soft-deleted product
 * @access  Contributor+
 */
router.post(
  '/:id/restore',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid product ID')],
  ctrl.restore
);

/**
 * @route   POST /api/products/reorder
 * @desc    Reorder products
 * @access  Contributor+
 */
router.post(
  '/reorder',
  requireContributor,
  [body('productIds').isArray().withMessage('productIds array is required')],
  ctrl.reorder
);

module.exports = router;
