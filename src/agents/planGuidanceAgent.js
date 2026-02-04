/**
 * Plan Guidance Agent (Priority Coach)
 *
 * Tile-based UI Structure:
 * - Zone 1: Decision Zone (single dominant tile with one decision)
 * - Zone 2: Context Zone (strategic impact, dependencies, risk exposure)
 * - Zone 3: Commitment & Tradeoff Zone (commitment tile, tradeoff tile)
 * - Zone 4: Consequence Zone (conditional - only if delay has impact)
 * - Zone 5: Control & Momentum Zone (time horizon selector, momentum tile)
 *
 * Time Horizons: Today, This Week, This Month
 */

const {
  hashInput,
  getFromCache,
  setCache,
  buildAgentContext,
  callOpenAIJSON,
  formatContextForPrompt,
} = require('./base');

const scoringService = require('../services/scoringService');

/**
 * Generate plan guidance for a user
 * @param {string} userId - User ID
 * @param {Object} options - Optional parameters
 * @returns {Object} Guidance structured for tile-based UI
 */
async function generateGuidance(userId, options = {}) {
  const {
    forceRefresh = false,
    workspaceId = null,
    timeHorizon = 'week' // 'today', 'week', 'month'
  } = options;

  // Build context and create cache key
  const context = await buildAgentContext(userId, workspaceId);
  const inputHash = hashInput({
    projects: context.coreProjectDetails?.map(p => ({ title: p.title, dueWhen: p.dueWhen })),
    assignments: Object.keys(context.actionAssignments || {}),
    timeHorizon,
    updatedAt: new Date().toISOString().split('T')[0], // Daily cache
  });

  // Check cache unless forced refresh
  if (!forceRefresh) {
    const cached = await getFromCache(userId, 'plan-guidance', inputHash, workspaceId);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  // Extract and score all items using CRUD models
  const items = await scoringService.extractItemsFromModels(userId, workspaceId);
  const scoringContext = { allItems: items };

  const scoredItems = items.map((item) => {
    const { scores, totalScore } = scoringService.calculateScore(item, scoringContext);
    return { ...item, scores, totalScore };
  });

  // Sort by score
  const sortedItems = scoredItems.sort((a, b) => b.totalScore - a.totalScore);

  // Get time-horizon specific data
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const horizonDays = timeHorizon === 'today' ? 1 : timeHorizon === 'week' ? 7 : 30;
  const horizonEnd = new Date(today);
  horizonEnd.setDate(today.getDate() + horizonDays);

  // Categorize items
  const overdue = scoredItems.filter(item => {
    const days = scoringService.daysUntil(item.dueWhen);
    return days < 0;
  });

  const dueInHorizon = scoredItems.filter(item => {
    const days = scoringService.daysUntil(item.dueWhen);
    return days >= 0 && days <= horizonDays;
  });

  // Get top priority for this horizon
  const topPriority = sortedItems[0];

  // Get deprioritized items (items 2-4 that didn't make #1)
  const deprioritizedItems = sortedItems.slice(1, 4);

  // Calculate dependencies (items that depend on top priority)
  const dependentItems = scoredItems.filter(item => {
    // Check if this item's linked core project matches top priority
    if (topPriority && item.linkedCoreProject === topPriority._id) return true;
    // Check if same department
    if (topPriority && item.departmentKey === topPriority.departmentKey && item._id !== topPriority._id) return true;
    return false;
  });

  // Calculate completed items for momentum
  const completedDeliverables = [];
  scoredItems.forEach(item => {
    if (Array.isArray(item.deliverables)) {
      item.deliverables.forEach(d => {
        if (d.done) {
          completedDeliverables.push({
            text: d.text,
            projectTitle: item.title,
          });
        }
      });
    }
  });

  // Build horizon-specific labels
  const horizonLabel = timeHorizon === 'today' ? 'today' :
                       timeHorizon === 'week' ? 'this week' :
                       'this month';

  // Build prompt for AI reasoning
  const contextStr = formatContextForPrompt(context);
  const prompt = `You are the Priority Coach. Generate tile-based guidance for the "${horizonLabel}" time horizon.

${contextStr}

STATUS: ${scoredItems.length} items | ${overdue.length} overdue | ${dueInHorizon.length} due ${horizonLabel}

TOP PRIORITY (Score ${topPriority?.totalScore || 0}/100):
${topPriority ? `"${topPriority.title}" - Due: ${topPriority.dueWhen || 'No date'}` : 'No items found'}

DEPRIORITIZED (not the focus ${horizonLabel}):
${deprioritizedItems.slice(0, 3).map((item, i) => `${i + 1}. "${item.title}" [Score: ${item.totalScore}]`).join('\n')}

DEPENDENCIES: ${dependentItems.length} items depend on the top priority
COMPLETED RECENTLY: ${completedDeliverables.length} deliverables

TIME HORIZON: ${timeHorizon.toUpperCase()}

Generate JSON response for tile-based UI. Each zone has specific content rules:

{
  "decisionZone": {
    "decision": "ONE clear decision or outcome statement (max 20 words) - what to focus on ${horizonLabel}",
    "reasoning": "ONE sentence explaining why this matters at this time horizon (max 25 words)"
  },
  "contextZone": {
    "strategicImpact": {
      "statement": "How this priority advances their goals (max 30 words)",
      "linkedGoals": ["Goal 1", "Goal 2"]
    },
    "dependencies": {
      "count": ${dependentItems.length},
      "description": "What depends on this decision (max 20 words)",
      "items": ["Item 1", "Item 2"]
    },
    "riskExposure": {
      "statement": "Risk from delay or inaction (max 25 words, neutral tone)",
      "timeframe": "When the risk materializes"
    }
  },
  "commitmentZone": {
    "outcome": "What success looks like ${horizonLabel} (max 20 words)",
    "successCriteria": "Conceptual success criteria (max 20 words)"
  },
  "tradeoffZone": {
    "items": [
      {"title": "Deprioritized item", "reason": "Why it can wait (max 15 words)"}
    ],
    "noTradeoffs": false
  },
  "consequenceZone": {
    "shouldRender": true/false,
    "statement": "Clear consequence of delay (max 30 words, no speculation)",
    "impact": "Measurable impact description"
  },
  "momentumZone": {
    "completedCount": ${completedDeliverables.length},
    "statement": "Subtle progress reinforcement (max 20 words, not celebratory)"
  }
}

RULES:
- Decision Zone: ONE decision only, never multiple priorities
- Context Zone: Analytical, not instructional - explain WHY, not HOW
- Commitment Zone: Outcome-focused, no tasks or checklists
- Tradeoff Zone: MANDATORY - if no tradeoffs, set noTradeoffs: true
- Consequence Zone: Only render if delay produces measurable impact
- Momentum Zone: Low visual weight, never celebratory
- Never show tasks, steps, or tool references
- If uncertain about priority, state uncertainty explicitly`;

  const { data, generationTimeMs, error } = await callOpenAIJSON(prompt, {
    maxTokens: 1200,
    temperature: 0.5,
  });

  // Build response with tile structure
  const response = {
    timeHorizon,

    // Zone 1: Decision Zone
    decisionZone: data?.decisionZone || {
      decision: topPriority
        ? `Focus on completing "${topPriority.title}" ${horizonLabel}.`
        : 'No clear priority identified. Review your projects to set goals.',
      reasoning: topPriority
        ? `This has the highest strategic impact with ${topPriority.totalScore}/100 priority score.`
        : 'Add projects with due dates to enable priority recommendations.',
    },

    // Zone 2: Context Zone
    contextZone: {
      strategicImpact: data?.contextZone?.strategicImpact || {
        statement: topPriority
          ? `Completing this advances your strategic objectives and maintains execution momentum.`
          : 'No strategic impact to analyze.',
        linkedGoals: [],
      },
      dependencies: data?.contextZone?.dependencies || {
        count: dependentItems.length,
        description: dependentItems.length > 0
          ? `${dependentItems.length} items are waiting on this priority.`
          : 'No downstream dependencies identified.',
        items: dependentItems.slice(0, 3).map(i => i.title),
      },
      riskExposure: data?.contextZone?.riskExposure || {
        statement: overdue.length > 0
          ? `${overdue.length} overdue items may affect upcoming targets.`
          : 'No immediate risk from current timeline.',
        timeframe: overdue.length > 0 ? 'Immediate' : 'None identified',
      },
    },

    // Zone 3: Commitment & Tradeoff Zone
    commitmentZone: data?.commitmentZone || {
      outcome: topPriority
        ? `Complete the primary deliverable for "${topPriority.title}".`
        : 'Define your first strategic priority.',
      successCriteria: topPriority
        ? 'Meaningful progress visible in project status.'
        : 'At least one project created with clear goals.',
    },

    tradeoffZone: data?.tradeoffZone || {
      items: deprioritizedItems.slice(0, 2).map(item => ({
        title: item.title,
        reason: `Lower priority score (${item.totalScore}/100) - focus on higher impact items first.`,
      })),
      noTradeoffs: deprioritizedItems.length === 0,
    },

    // Zone 4: Consequence Zone (conditional)
    consequenceZone: data?.consequenceZone || {
      shouldRender: overdue.length > 0 || dueInHorizon.length > 2,
      statement: overdue.length > 0
        ? `Continued delay on overdue items may cascade into missed ${horizonLabel === 'today' ? 'daily' : horizonLabel === 'this week' ? 'weekly' : 'monthly'} targets.`
        : dueInHorizon.length > 2
        ? `${dueInHorizon.length} items due ${horizonLabel} require attention to stay on track.`
        : '',
      impact: overdue.length > 0
        ? `${overdue.length} items already past deadline`
        : '',
    },

    // Zone 5: Momentum Zone
    momentumZone: data?.momentumZone || {
      completedCount: completedDeliverables.length,
      statement: completedDeliverables.length > 0
        ? `${completedDeliverables.length} deliverables completed. Progress continues.`
        : 'Begin tracking deliverables to see momentum.',
    },

    // Metadata
    stats: {
      totalItems: scoredItems.length,
      overdueCount: overdue.length,
      dueInHorizonCount: dueInHorizon.length,
      dependencyCount: dependentItems.length,
      completedDeliverables: completedDeliverables.length,
    },

    // Raw data for UI rendering
    topPriority: topPriority ? {
      id: topPriority._id,
      title: topPriority.title,
      score: topPriority.totalScore,
      dueWhen: topPriority.dueWhen,
      source: topPriority.source,
    } : null,

    generatedAt: new Date().toISOString(),
  };

  // Cache the response
  await setCache(userId, 'plan-guidance', inputHash, response, generationTimeMs, workspaceId);

  return { ...response, fromCache: false, generationTimeMs };
}

module.exports = {
  generateGuidance,
};
