const express = require('express');
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const ctrl = require('../controllers/coreProject.controller');

const router = express.Router();

// Apply auth, viewAs (for collaborators), and workspace context
router.use(auth(false));
router.use(viewAs);
router.use(workspaceContext);

/**
 * @route   GET /api/core-projects
 * @desc    List all core projects for the workspace
 * @access  Viewer+
 */
router.get('/', requireViewer, ctrl.list);

/**
 * @route   GET /api/core-projects/:id
 * @desc    Get a single core project
 * @access  Viewer+
 */
router.get(
  '/:id',
  requireViewer,
  [param('id').isMongoId().withMessage('Invalid project ID')],
  ctrl.get
);

/**
 * @route   POST /api/core-projects
 * @desc    Create a new core project
 * @access  Contributor+
 */
router.post(
  '/',
  requireContributor,
  [
    body('title').notEmpty().trim().withMessage('Title is required'),
    body('description').optional().trim(),
    body('goal').optional().trim(),
    body('cost').optional().trim(),
    body('dueWhen').optional().trim(),
    body('priority').optional().isIn(['high', 'medium', 'low', null]),
    body('ownerId').optional(),
    body('ownerName').optional().trim(),
    body('executiveSponsorName').notEmpty().trim().withMessage('Executive Sponsor is required'),
    body('responsibleLeadName').notEmpty().trim().withMessage('Responsible Project Lead is required'),
    body('linkedCoreOKR').isMongoId().withMessage('linkedCoreOKR (Core OKR id) is required'),
    body('linkedCoreKrId').isMongoId().withMessage('linkedCoreKrId (Core KR id) is required'),
    body('linkedGoals').optional().isArray(),
    body('departments').isArray().withMessage('Involved Departments are required'),
    body('deliverables').optional().isArray(),
  ],
  ctrl.create
);

/**
 * @route   PATCH /api/core-projects/:id
 * @desc    Update a core project
 * @access  Contributor+
 */
router.patch(
  '/:id',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid project ID'),
    body('title').optional().trim(),
    body('description').optional().trim(),
    body('goal').optional().trim(),
    body('cost').optional().trim(),
    body('dueWhen').optional().trim(),
    body('priority').optional().isIn(['high', 'medium', 'low', null, '']),
    body('ownerId').optional(),
    body('ownerName').optional().trim(),
    body('executiveSponsorName').optional().trim(),
    body('responsibleLeadName').optional().trim(),
    body('linkedCoreOKR').optional().isMongoId(),
    body('linkedCoreKrId').optional().isMongoId(),
    body('linkedGoals').optional().isArray(),
    body('departments').optional().isArray(),
    body('deliverables').optional().isArray(),
    body('order').optional().isInt({ min: 0 }),
  ],
  ctrl.update
);

/**
 * @route   DELETE /api/core-projects/:id
 * @desc    Soft delete a core project
 * @access  Contributor+
 */
router.delete(
  '/:id',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid project ID')],
  ctrl.delete
);

/**
 * @route   POST /api/core-projects/:id/restore
 * @desc    Restore a soft-deleted project
 * @access  Contributor+
 */
router.post(
  '/:id/restore',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid project ID')],
  ctrl.restore
);

/**
 * @route   POST /api/core-projects/:id/deliverables
 * @desc    Add a deliverable to a project
 * @access  Contributor+
 */
router.post(
  '/:id/deliverables',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid project ID'),
    body('text').notEmpty().trim().withMessage('Deliverable text is required'),
    body('kpi').optional().trim(),
    body('dueWhen').optional().trim(),
    body('ownerId').optional(),
    body('ownerName').optional().trim(),
  ],
  ctrl.addDeliverable
);

/**
 * @route   PATCH /api/core-projects/:id/deliverables/:deliverableId
 * @desc    Update a deliverable
 * @access  Contributor+
 */
router.patch(
  '/:id/deliverables/:deliverableId',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid project ID'),
    param('deliverableId').isMongoId().withMessage('Invalid deliverable ID'),
    body('text').optional().trim(),
    body('done').optional().isBoolean(),
    body('kpi').optional().trim(),
    body('dueWhen').optional().trim(),
    body('ownerId').optional(),
    body('ownerName').optional().trim(),
  ],
  ctrl.updateDeliverable
);

/**
 * @route   DELETE /api/core-projects/:id/deliverables/:deliverableId
 * @desc    Delete a deliverable
 * @access  Contributor+
 */
router.delete(
  '/:id/deliverables/:deliverableId',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid project ID'),
    param('deliverableId').isMongoId().withMessage('Invalid deliverable ID'),
  ],
  ctrl.deleteDeliverable
);

/**
 * @route   POST /api/core-projects/reorder
 * @desc    Reorder projects
 * @access  Contributor+
 */
router.post(
  '/reorder',
  requireContributor,
  [body('projectIds').isArray().withMessage('projectIds array is required')],
  ctrl.reorder
);

/**
 * @route   POST /api/core-projects/:id/generate
 * @desc    Generate AI details for a project
 * @access  Contributor+
 */
router.post(
  '/:id/generate',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid project ID')],
  ctrl.generateDetails
);

module.exports = router;
