/**
 * AI Agents Routes
 *
 * Endpoints for the 5 AI agents:
 * - POST /api/agents/plan-guidance - What to work on next
 * - POST /api/agents/financial-validate - Validate financial projections
 * - POST /api/agents/strategy-suggest - Get strategy recommendations
 * - GET /api/agents/progress-status - Get plan completion status
 * - POST /api/agents/strategic-integrate - Strategic coherence and tradeoffs
 * - POST /api/agents/invalidate-cache - Clear agent caches
 */

const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const viewAs = require('../middleware/viewAs');
const workspaceContext = require('../middleware/workspace');
const { requireViewer, requireContributor } = require('../middleware/workspaceRole');
const agents = require('../agents');

// Apply auth first, then viewAs (for collaborators), then workspace context to all agent routes
// Note: auth() must run before workspaceContext because workspace needs req.user.id
router.use(auth());
router.use(viewAs);
router.use(workspaceContext);

/**
 * Plan Guidance Agent (Priority Coach)
 * POST /api/agents/plan-guidance
 * Returns tile-based guidance with zones
 *
 * Body params:
 * - forceRefresh: boolean - Skip cache
 * - timeHorizon: 'today' | 'week' | 'month' - Time context for recommendations
 */
router.post('/plan-guidance', requireViewer, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspaceId = req.workspace?._id;
    const { forceRefresh, timeHorizon = 'week' } = req.body;

    // Validate timeHorizon
    const validHorizons = ['today', 'week', 'month'];
    const horizon = validHorizons.includes(timeHorizon) ? timeHorizon : 'week';

    console.log('[Agent] plan-guidance - userId:', userId, 'workspaceId:', workspaceId, 'timeHorizon:', horizon);

    const result = await agents.generateGuidance(userId, {
      forceRefresh,
      workspaceId,
      timeHorizon: horizon,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error('[Agent] Plan guidance error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to generate guidance',
    });
  }
});

/**
 * Financial Validation Agent
 * POST /api/agents/financial-validate
 * Returns validation flags and warnings
 */
router.post('/financial-validate', requireViewer, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspaceId = req.workspace?._id;
    const { forceRefresh } = req.body;

    console.log('[Agent] financial-validate - userId:', userId, 'workspaceId:', workspaceId);

    const result = await agents.validateFinancials(userId, { forceRefresh, workspaceId });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error('[Agent] Financial validation error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to validate financials',
    });
  }
});

/**
 * Strategy Suggestion Agent
 * POST /api/agents/strategy-suggest
 * Returns strategy recommendations
 */
router.post('/strategy-suggest', requireViewer, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspaceId = req.workspace?._id;
    const { forceRefresh, focusArea } = req.body;

    const result = await agents.generateStrategySuggestions(userId, {
      forceRefresh,
      focusArea,
      workspaceId,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error('[Agent] Strategy suggestion error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to generate suggestions',
    });
  }
});

/**
 * Project Manager Agent (Progress Status)
 * POST /api/agents/progress-status
 * Returns execution health and momentum tracking
 *
 * Body params:
 * - forceRefresh: boolean - Skip cache
 * - timeHorizon: 'today' | 'week' | 'month' - Time context for execution view
 */
router.post('/progress-status', requireViewer, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspaceId = req.workspace?._id;
    const { forceRefresh, timeHorizon = 'week' } = req.body;

    // Validate timeHorizon
    const validHorizons = ['today', 'week', 'month'];
    const horizon = validHorizons.includes(timeHorizon) ? timeHorizon : 'week';

    console.log('[Agent] progress-status - userId:', userId, 'workspaceId:', workspaceId, 'timeHorizon:', horizon);

    const result = await agents.getProgressStatus(userId, {
      forceRefresh,
      workspaceId,
      timeHorizon: horizon,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error('[Agent] Progress status error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to get progress status',
    });
  }
});

/**
 * Strategic Integrator Agent
 * POST /api/agents/strategic-integrate
 * Returns strategic coherence, tensions, and tradeoffs
 */
router.post('/strategic-integrate', requireViewer, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspaceId = req.workspace?._id;
    const { forceRefresh } = req.body;

    console.log('[Agent] strategic-integrate - userId:', userId, 'workspaceId:', workspaceId);

    const result = await agents.getStrategicIntegration(userId, { forceRefresh, workspaceId });

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    console.error('[Agent] Strategic integration error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to get strategic integration',
    });
  }
});

/**
 * Invalidate Cache
 * POST /api/agents/invalidate-cache
 * Clears cached agent responses for the user
 */
router.post('/invalidate-cache', requireContributor, async (req, res) => {
  try {
    const userId = req.user.id;
    const { agentType } = req.body; // Optional: specific agent to invalidate

    await agents.invalidateCache(userId, agentType);

    res.json({
      success: true,
      message: agentType
        ? `Cache invalidated for ${agentType}`
        : 'All agent caches invalidated',
    });
  } catch (err) {
    console.error('[Agent] Cache invalidation error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to invalidate cache',
    });
  }
});

/**
 * Get All Agent Status (Dashboard Summary)
 * GET /api/agents/summary
 * Returns a quick summary from all agents for dashboard display
 */
router.get('/summary', requireViewer, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspaceId = req.workspace?._id;

    // Run all agents in parallel for efficiency
    const [guidance, financial, progress] = await Promise.allSettled([
      agents.generateGuidance(userId, { workspaceId }),
      agents.validateFinancials(userId, { workspaceId }),
      agents.getProgressStatus(userId, { includeAIFeedback: false, workspaceId }),
    ]);

    res.json({
      success: true,
      data: {
        guidance: guidance.status === 'fulfilled' ? {
          decision: guidance.value?.decisionZone?.decision,
          topPriority: guidance.value?.topPriority?.title,
          overdueCount: guidance.value?.stats?.overdueCount,
          timeHorizon: guidance.value?.timeHorizon,
        } : null,
        financial: financial.status === 'fulfilled' ? {
          status: financial.value?.financialState?.status,
          errorCount: 0,
          warningCount: financial.value?.financialState?.status === 'watch' ? 1 : 0,
        } : null,
        progress: progress.status === 'fulfilled' ? {
          executionHealth: progress.value?.executionHealth?.state,
          overdueCount: progress.value?.stats?.overdueCount || 0,
          blockedCount: progress.value?.stats?.blockedCount || 0,
          completionRate: progress.value?.momentum?.completionRate || 0,
        } : null,
      },
    });
  } catch (err) {
    console.error('[Agent] Summary error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to get agent summary',
    });
  }
});

/**
 * Execute Agent Action
 * POST /api/agents/execute-action
 * Executes an action recommended by an agent (mark complete, reschedule, etc.)
 */
router.post('/execute-action', requireContributor, async (req, res) => {
  try {
    const userId = req.user.id;
    const workspaceId = req.workspace?._id;
    const { action, source, newValue, itemTitle } = req.body;

    if (!action || !source) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: action and source',
      });
    }

    console.log('[Agent] execute-action - userId:', userId, 'action:', action, 'source:', source);

    // Import models
    const CoreProject = require('../models/CoreProject');
    const DepartmentProject = require('../models/DepartmentProject');

    // Determine project ID from source
    const projectId = source.projectId || source.coreProjectId || source.deptProjectId;

    if (!projectId) {
      return res.status(400).json({
        success: false,
        error: 'Unable to identify target item. Please refresh and try again.',
      });
    }

    let result = { success: false, message: 'Unknown action' };

    switch (action) {
      case 'mark_complete': {
        // Mark a deliverable as complete
        const deliverableIndex = source.deliverableIndex;

        if (typeof deliverableIndex !== 'number') {
          return res.status(400).json({
            success: false,
            error: 'Missing deliverable index for mark_complete action',
          });
        }

        // Determine if core or dept project
        const isCoreProject = source.type === 'coreProjectDeliverable' || source.coreProjectId;
        const Model = isCoreProject ? CoreProject : DepartmentProject;

        const project = await Model.findOne({ _id: projectId, workspace: workspaceId });
        if (!project) {
          return res.status(404).json({
            success: false,
            error: 'Project not found',
          });
        }

        if (!project.deliverables || !project.deliverables[deliverableIndex]) {
          return res.status(404).json({
            success: false,
            error: 'Deliverable not found',
          });
        }

        // Mark as complete
        project.deliverables[deliverableIndex].done = true;
        project.deliverables[deliverableIndex].completedAt = new Date();
        await project.save();

        result = {
          success: true,
          message: `Marked "${itemTitle || project.deliverables[deliverableIndex].description}" as complete`,
        };
        break;
      }

      case 'reschedule': {
        // Reschedule a deliverable or project
        const newDate = newValue;
        if (!newDate) {
          return res.status(400).json({
            success: false,
            error: 'Missing new date for reschedule action',
          });
        }

        const deliverableIndex = source.deliverableIndex;
        const isCoreProject = source.type === 'coreProjectDeliverable' || source.coreProjectId || source.type === 'coreProject';
        const Model = isCoreProject ? CoreProject : DepartmentProject;

        const project = await Model.findOne({ _id: projectId, workspace: workspaceId });
        if (!project) {
          return res.status(404).json({
            success: false,
            error: 'Project not found',
          });
        }

        if (typeof deliverableIndex === 'number') {
          // Reschedule deliverable
          if (!project.deliverables || !project.deliverables[deliverableIndex]) {
            return res.status(404).json({
              success: false,
              error: 'Deliverable not found',
            });
          }
          project.deliverables[deliverableIndex].dueWhen = newDate;
          await project.save();
          result = {
            success: true,
            message: `Rescheduled "${itemTitle || project.deliverables[deliverableIndex].description}" to ${newDate}`,
          };
        } else {
          // Reschedule project
          project.dueWhen = newDate;
          await project.save();
          result = {
            success: true,
            message: `Rescheduled "${itemTitle || project.title}" to ${newDate}`,
          };
        }
        break;
      }

      case 'assign_owner': {
        // Assign an owner to a deliverable
        const deliverableIndex = source.deliverableIndex;
        const newOwner = newValue;

        if (typeof deliverableIndex !== 'number' || !newOwner) {
          return res.status(400).json({
            success: false,
            error: 'Missing deliverable index or owner for assign_owner action',
          });
        }

        const isCoreProject = source.type === 'coreProjectDeliverable' || source.coreProjectId;
        const Model = isCoreProject ? CoreProject : DepartmentProject;

        const project = await Model.findOne({ _id: projectId, workspace: workspaceId });
        if (!project) {
          return res.status(404).json({
            success: false,
            error: 'Project not found',
          });
        }

        if (!project.deliverables || !project.deliverables[deliverableIndex]) {
          return res.status(404).json({
            success: false,
            error: 'Deliverable not found',
          });
        }

        project.deliverables[deliverableIndex].owner = newOwner;
        await project.save();

        result = {
          success: true,
          message: `Assigned "${newOwner}" to "${itemTitle || project.deliverables[deliverableIndex].description}"`,
        };
        break;
      }

      default:
        return res.status(400).json({
          success: false,
          error: `Unknown action: ${action}`,
        });
    }

    // Invalidate agent caches after action
    await agents.invalidateCache(userId);

    res.json(result);
  } catch (err) {
    console.error('[Agent] Execute action error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to execute action',
    });
  }
});

module.exports = router;
