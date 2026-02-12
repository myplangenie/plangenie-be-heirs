const express = require('express');
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const ctrl = require('../controllers/workspaceField.controller');

const router = express.Router();

// Apply auth, viewAs (for collaborators), and workspace context
router.use(auth(false));
router.use(viewAs);
router.use(workspaceContext);

/**
 * @route   GET /api/workspace-fields
 * @desc    List all available field names
 * @access  Viewer+
 */
router.get('/', requireViewer, ctrl.listFields);

/**
 * @route   POST /api/workspace-fields/batch
 * @desc    Get multiple fields at once
 * @access  Viewer+
 */
router.post(
  '/batch',
  requireViewer,
  [body('fields').isArray().withMessage('Fields array is required')],
  ctrl.getFields
);

/**
 * @route   PUT /api/workspace-fields/batch
 * @desc    Update multiple fields at once (atomic)
 * @access  Contributor+
 */
router.put(
  '/batch',
  requireContributor,
  [body('fields').isObject().withMessage('Fields object is required')],
  ctrl.updateFields
);

/**
 * @route   GET /api/workspace-fields/:fieldName
 * @desc    Get a single field value
 * @access  Viewer+
 */
router.get(
  '/:fieldName',
  requireViewer,
  [param('fieldName').notEmpty().withMessage('Field name is required')],
  ctrl.getField
);

/**
 * @route   PATCH /api/workspace-fields/:fieldName
 * @desc    Update a single field value
 * @access  Contributor+
 */
router.patch(
  '/:fieldName',
  requireContributor,
  [param('fieldName').notEmpty().withMessage('Field name is required')],
  ctrl.updateField
);

/**
 * @route   DELETE /api/workspace-fields/:fieldName
 * @desc    Delete/clear a single field value
 * @access  Contributor+
 */
router.delete(
  '/:fieldName',
  requireContributor,
  [param('fieldName').notEmpty().withMessage('Field name is required')],
  ctrl.deleteField
);

module.exports = router;
