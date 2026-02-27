const express = require('express');
const { body, param } = require('express-validator');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const ctrl = require('../controllers/integrationRequest.controller');

const router = express.Router();

// Apply auth, viewAs (for collaborators), and workspace context
router.use(auth(false));
router.use(viewAs);
router.use(workspaceContext);

/**
 * @route   GET /api/integration-requests
 * @desc    List all integration requests for the workspace
 * @access  Viewer+
 */
router.get('/', requireViewer, ctrl.list);

/**
 * @route   POST /api/integration-requests
 * @desc    Create a new integration request
 * @access  Contributor+
 */
router.post(
  '/',
  requireContributor,
  [
    body('system')
      .notEmpty()
      .trim()
      .isIn(['salesforce', 'hubspot', 'zoho', 'quickbooks', 'xero', 'sage', 'netsuite', 'sap-business-one', 'microsoft-dynamics', 'odoo', 'asana', 'monday', 'clickup', 'microsoft-project', 'bamboohr', 'workday', 'adp'])
      .withMessage('Valid system is required'),
    body('category')
      .notEmpty()
      .trim()
      .isIn(['crm', 'finance', 'erp', 'project-management', 'hr'])
      .withMessage('Valid category is required'),
    body('organizationName').notEmpty().trim().withMessage('Organization name is required'),
    body('currentUsageContext').optional().trim(),
    body('primaryGoal').optional().trim(),
    body('urgencyTimeline')
      .optional()
      .isIn(['immediate', 'within-30-days', 'within-90-days', 'exploring']),
    body('notes').optional().trim(),
  ],
  ctrl.create
);

/**
 * @route   POST /api/integration-requests/contact-expert
 * @desc    Send message to integration expert
 * @access  Viewer+
 */
router.post(
  '/contact-expert',
  requireViewer,
  [body('message').notEmpty().trim().withMessage('Message is required')],
  ctrl.contactExpert
);

/**
 * @route   DELETE /api/integration-requests/:id
 * @desc    Cancel an integration request
 * @access  Contributor+
 */
router.delete(
  '/:id',
  requireContributor,
  [param('id').isMongoId().withMessage('Invalid request ID')],
  ctrl.cancel
);

module.exports = router;
