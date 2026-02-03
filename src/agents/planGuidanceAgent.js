/**
 * Plan Guidance Agent (Priority Coach)
 * Suggests what the user should work on next with specific action steps.
 *
 * Key improvements:
 * - Outputs are action-oriented with specific next steps
 * - Concise recommendations (not verbose)
 * - Explains trade-offs when deprioritizing items
 * - Integrates project management guidance
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
 * @param {Object} options - Optional parameters (workspaceId, forceRefresh)
 * @returns {Object} Guidance with priorities and reasoning
 */
async function generateGuidance(userId, options = {}) {
  const { forceRefresh = false, workspaceId = null } = options;

  // Build context and create cache key
  const context = await buildAgentContext(userId, workspaceId);
  const inputHash = hashInput({
    projects: context.coreProjectDetails?.map(p => ({ title: p.title, dueWhen: p.dueWhen })),
    assignments: Object.keys(context.actionAssignments || {}),
    updatedAt: new Date().toISOString().split('T')[0], // Daily cache
  });

  // Check cache unless forced refresh
  if (!forceRefresh) {
    const cached = await getFromCache(userId, 'plan-guidance', inputHash, workspaceId);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  // Extract and score all items using new CRUD models (CoreProject, DepartmentProject)
  const items = await scoringService.extractItemsFromModels(userId, workspaceId);
  const scoringContext = { allItems: items };

  const scoredItems = items.map((item) => {
    const { scores, totalScore } = scoringService.calculateScore(item, scoringContext);
    return { ...item, scores, totalScore };
  });

  // Get top priorities
  const weeklyPriorities = scoringService.getWeeklyTop3(scoredItems);
  const monthlyThrust = scoringService.getMonthlyThrust(scoredItems);

  // Prepare data for AI reasoning
  const topItems = scoredItems
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 10);

  const overdue = scoredItems.filter(item => {
    const days = scoringService.daysUntil(item.dueWhen);
    return days < 0;
  });

  const dueSoon = scoredItems.filter(item => {
    const days = scoringService.daysUntil(item.dueWhen);
    return days >= 0 && days <= 7;
  });

  // Identify deprioritized items (items 4-6 that didn't make top 3)
  const deprioritizedItems = topItems.slice(3, 6);

  // Build prompt for AI reasoning - CONCISE and ACTION-ORIENTED
  const contextStr = formatContextForPrompt(context);
  const prompt = `You are a Priority Coach. Your ONE job: Tell the user exactly what to work on TODAY and give them the first action step.

${contextStr}

STATUS: ${scoredItems.length} items | ${overdue.length} overdue | ${dueSoon.length} due in 7 days

TOP 5 BY PRIORITY:
${topItems.slice(0, 5).map((item, i) =>
  `${i + 1}. "${item.title}" [Score: ${item.totalScore}] Due: ${item.dueWhen || 'No date'}`
).join('\n')}
${overdue.length > 0 ? `\nOVERDUE: ${overdue.slice(0, 3).map(item => `"${item.title}"`).join(', ')}` : ''}

RULES:
- MAX 15 words per field unless it's actionSteps
- Every action must be EXECUTABLE: "Open X, do Y, update Z"
- No motivational fluff - just facts and actions
- Reference their actual project names

Respond in JSON:
{
  "focusRecommendation": "Do [specific action] on [specific project] - max 15 words",
  "topPriority": {
    "title": "Exact project title from their data",
    "reason": "One sentence why this is #1",
    "actionSteps": ["Step 1: verb + object", "Step 2: verb + object", "Step 3: verb + object"]
  },
  "weeklyGoals": [
    {"title": "Project title", "reason": "Next action in 10 words or less"}
  ],
  "deprioritized": [
    {"title": "Project title", "reason": "Why it can wait (10 words)"}
  ],
  "warnings": ["Issue + fix in one sentence"],
  "encouragement": "Factual progress statement with numbers"
}`;

  const { data, generationTimeMs, error } = await callOpenAIJSON(prompt, {
    maxTokens: 1000,
    temperature: 0.6,
  });

  // Build priority breakdown for top item
  const topItemBreakdown = topItems[0]?.scores ? {
    importance: Math.round(topItems[0].scores.goalImportance * 0.30),
    urgency: Math.round(topItems[0].scores.dueDateProximity * 0.25),
    overdue: Math.round(topItems[0].scores.overdueScore * 0.20),
    blocker: Math.round(topItems[0].scores.blockerScore * 0.15),
    kpiImpact: Math.round((topItems[0].scores.kpiWeight || 0) * 0.10),
  } : null;

  // Build response - action-oriented structure with backward-compatible field names
  const response = {
    guidance: data || {
      focusRecommendation: topItems[0]?.title
        ? `Complete "${topItems[0].title}" - open it and work on the next deliverable.`
        : 'Create your first strategic project to get started.',
      topPriority: topItems[0] ? {
        title: topItems[0].title,
        reason: `Score ${topItems[0].totalScore}/100 - ${topItems[0].scores?.overdueScore > 0 ? 'overdue, needs immediate attention' : topItems[0].scores?.dueDateProximity > 70 ? 'deadline approaching' : 'highest strategic impact'}`,
        actionSteps: [
          'Open this project and review deliverables',
          'Mark the next incomplete deliverable as in-progress',
          'Set a specific time block to complete it today'
        ],
        priorityBreakdown: topItemBreakdown,
      } : null,
      weeklyGoals: weeklyPriorities.slice(0, 3).map(item => ({
        title: item.title,
        reason: `Due ${item.dueWhen || 'soon'} - schedule time to complete`,
      })),
      deprioritized: deprioritizedItems.slice(0, 2).map(item => ({
        title: item.title,
        reason: item.scores?.dueDateProximity < 50
          ? `Due ${item.dueWhen || 'later'} - focus on urgent items first`
          : `Lower impact score (${item.totalScore}/100)`,
      })),
      warnings: overdue.length > 0
        ? [`${overdue.length} overdue item(s) - reschedule or complete today: ${overdue.slice(0, 2).map(i => i.title).join(', ')}`]
        : [],
      encouragement: scoredItems.length > 0
        ? `Tracking ${scoredItems.length} items, ${dueSoon.length} due this week.`
        : 'Add projects to start tracking progress.',
    },
    stats: {
      totalItems: scoredItems.length,
      overdueCount: overdue.length,
      dueSoonCount: dueSoon.length,
      completedToday: 0, // Could track this with activity log
    },
    priorities: {
      weekly: weeklyPriorities.slice(0, 5).map(item => ({
        title: item.title,
        dueWhen: item.dueWhen,
        score: item.totalScore,
        scoreBreakdown: item.scores ? {
          importance: Math.round(item.scores.goalImportance * 0.30),
          urgency: Math.round(item.scores.dueDateProximity * 0.25),
          overdue: Math.round(item.scores.overdueScore * 0.20),
          blocker: Math.round(item.scores.blockerScore * 0.15),
        } : null,
        source: item.source,
      })),
      monthlyThrust: monthlyThrust ? {
        title: monthlyThrust.title,
        dueWhen: monthlyThrust.dueWhen,
        score: monthlyThrust.totalScore,
      } : null,
    },
    generatedAt: new Date().toISOString(),
  };

  // Cache the response
  await setCache(userId, 'plan-guidance', inputHash, response, generationTimeMs, workspaceId);

  return { ...response, fromCache: false, generationTimeMs };
}

module.exports = {
  generateGuidance,
};
