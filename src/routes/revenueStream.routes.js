const express = require('express');
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const ctrl = require('../controllers/revenueStream.controller');
const { requireViewer, requireContributor, requireAdmin } = require('../middleware/workspaceRole');

const router = express.Router();

// Apply auth first, then viewAs (for collaborators), then workspace context
router.use(auth());
router.use(viewAs);
router.use(workspaceContext);

// CRUD endpoints with role enforcement
router.get('/', requireViewer, ctrl.list);
router.get('/aggregate', requireViewer, ctrl.aggregate);
router.get('/:id', requireViewer, ctrl.get);
router.post('/', requireContributor, ctrl.create);
router.post('/bulk', requireContributor, ctrl.bulkCreate);
router.patch('/:id', requireContributor, ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);

module.exports = router;
