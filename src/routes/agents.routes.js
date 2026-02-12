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

module.exports = router;
