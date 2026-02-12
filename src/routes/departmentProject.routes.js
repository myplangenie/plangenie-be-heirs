const express = require('express');
const { body, param, query } = require('express-validator');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const ctrl = require('../controllers/departmentProject.controller');

const router = express.Router();

// Apply auth, viewAs (for collaborators), and workspace context
router.use(auth(false));
router.use(viewAs);
router.use(workspaceContext);

/**
 * @route   GET /api/department-projects
 * @desc    List all department projects (optionally filtered by department)
 * @access  Viewer+
 * @query   department - Filter by department key
 * @query   grouped - If 'true', return projects grouped by department
 */
router.get(
  '/',
  requireViewer,
  [
    query('department').optional().trim(),
    query('grouped').optional().isIn(['true', 'false']),
  ],
  ctrl.list
);

/**
 * @route   GET /api/department-projects/:id
 * @desc    Get a single department project
 * @access  Viewer+
 */
router.get(
  '/:id',
  requireViewer,
  [param('id').isMongoId().withMessage('Invalid project ID')],
  ctrl.get
);

/**
 * @route   POST /api/department-projects
 * @desc    Create a new department project
 * @access  Contributor+
 */
router.post(
  '/',
  requireContributor,
  [
    body('departmentKey').notEmpty().trim().withMessage('Department key is required'),
    body('title').optional().trim(),
    body('goal').optional().trim(),
    body('milestone').optional().trim(),
    body('resources').optional().trim(),
    body('dueWhen').optional().trim(),
    body('cost').optional().trim(),
    body('priority').optional().isIn(['high', 'medium', 'low', null, '']),
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('ownerId').optional(),
    body('linkedCoreProject').optional().isMongoId(),
    body('linkedGoal').optional().isInt(),
    body('deliverables').optional().isArray(),
  ],
  ctrl.create
);

/**
 * @route   POST /api/department-projects/bulk
 * @desc    Create multiple projects for a department
 * @access  Contributor+
 */
router.post(
  '/bulk',
  requireContributor,
  [
    body('departmentKey').notEmpty().trim().withMessage('Department key is required'),
    body('projects').isArray().withMessage('Projects array is required'),
  ],
  ctrl.bulkCreate
);

/**
 * @route   PATCH /api/department-projects/:id
 * @desc    Update a department project
 * @access  Contributor+
 */
router.patch(
  '/:id',
  requireContributor,
  [
    param('id').isMongoId().withMessage('Invalid project ID'),
    body('departmentKey').optional().trim(),
    body('title').optional().trim(),
    body('goal').optional().trim(),
    body('milestone').optional().trim(),
    body('resources').optional().trim(),
    body('dueWhen').optional().trim(),
    body('cost').optional().trim(),
    body('priority').optional().isIn(['high', 'medium', 'low', null, '']),
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('ownerId').optional(),
    body('linkedCoreProject').optional(),
    body('linkedGoal').optional(),
    body('deliverables').optional().isArray(),
    body('order').optional().isInt({ min: 0 }),
  ],
  ctrl.update
);

/**
 * @route   DELETE /api/department-projects/:id
 * @desc    Soft delete a department project
 * @access  Contributor+
 */
router.delete(
  '/:id',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid project ID')],
  ctrl.delete
);

/**
 * @route   POST /api/department-projects/:id/restore
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
 * @route   POST /api/department-projects/:id/deliverables
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
 * @route   PATCH /api/department-projects/:id/deliverables/:deliverableId
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
 * @route   DELETE /api/department-projects/:id/deliverables/:deliverableId
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
 * @route   POST /api/department-projects/reorder
 * @desc    Reorder projects within a department
 * @access  Contributor+
 */
router.post(
  '/reorder',
  requireContributor,
  [
    body('departmentKey').notEmpty().trim().withMessage('Department key is required'),
    body('projectIds').isArray().withMessage('projectIds array is required'),
  ],
  ctrl.reorder
);

module.exports = router;
