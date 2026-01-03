/**
 * Plan Guidance Agent
 * Suggests what the user should work on next and explains why.
 *
 * Uses priority scoring + AI reasoning to provide actionable guidance.
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

  // Extract and score all items using existing scoring service
  const items = scoringService.extractItems(context._rawAnswers);
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

  // Build prompt for AI reasoning
  const contextStr = formatContextForPrompt(context);
  const prompt = `You are a business planning advisor. Based on the user's business context and current priorities, provide guidance on what they should focus on.

${contextStr}

CURRENT STATUS:
- Total active items: ${scoredItems.length}
- Overdue items: ${overdue.length}
- Due within 7 days: ${dueSoon.length}

TOP PRIORITY ITEMS (by score breakdown):
${topItems.slice(0, 5).map((item, i) =>
  `${i + 1}. "${item.title}" - Total: ${item.totalScore}/100
     Breakdown: Importance=${item.scores?.goalImportance || 0}, Urgency=${item.scores?.dueDateProximity || 0}, Overdue=${item.scores?.overdueScore || 0}, Blocker=${item.scores?.blockerScore || 0}
     Due: ${item.dueWhen || 'No date'}, Type: ${item.source?.type || 'unknown'}`
).join('\n')}

${overdue.length > 0 ? `\nOVERDUE ITEMS:\n${overdue.slice(0, 3).map(item => `- "${item.title}" (was due: ${item.dueWhen})`).join('\n')}` : ''}

${monthlyThrust ? `\nMONTHLY FOCUS PROJECT: "${monthlyThrust.title}"` : ''}

${deprioritizedItems.length > 0 ? `\nITEMS NOT IN TOP 3 (explain why deprioritized):\n${deprioritizedItems.map(item => `- "${item.title}" (Score: ${item.totalScore})`).join('\n')}` : ''}

IMPORTANT TONE GUIDELINES:
- Be direct and specific, not generic
- Encouragement must be brief, grounded in actual progress, and non-generic (avoid fluffy phrases like "you're doing great!")
- Reference specific items or numbers when giving feedback
- Explain WHY something is prioritized over alternatives

Provide guidance in this JSON format:
{
  "focusRecommendation": "One clear sentence about what to focus on today",
  "topPriority": {
    "title": "The #1 thing to work on",
    "reason": "Why this is the top priority - reference specific scores or deadlines",
    "actionSteps": ["Step 1", "Step 2", "Step 3"]
  },
  "weeklyGoals": [
    {"title": "Goal 1", "reason": "Brief reason"},
    {"title": "Goal 2", "reason": "Brief reason"}
  ],
  "deprioritized": [
    {"title": "Item not chosen", "reason": "Why this was deprioritized (e.g., lower urgency, further deadline)"}
  ],
  "warnings": ["Any urgent warnings about overdue or at-risk items"],
  "encouragement": "Brief, specific note grounded in their actual data (e.g., '3 items completed this week' not 'keep going!')"
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

  // Build response
  const response = {
    guidance: data || {
      focusRecommendation: topItems[0]?.title
        ? `Focus on "${topItems[0].title}" - scored ${topItems[0].totalScore}/100 based on urgency and importance.`
        : 'Start by setting up your core strategic projects.',
      topPriority: topItems[0] ? {
        title: topItems[0].title,
        reason: `Highest priority (${topItems[0].totalScore}/100) due to ${topItems[0].scores?.overdueScore > 0 ? 'being overdue' : topItems[0].scores?.dueDateProximity > 70 ? 'upcoming deadline' : 'strategic importance'}.`,
        actionSteps: ['Review the requirements', 'Break into smaller tasks', 'Set a deadline for completion'],
        priorityBreakdown: topItemBreakdown,
      } : null,
      weeklyGoals: weeklyPriorities.slice(0, 3).map(item => ({
        title: item.title,
        reason: `Due: ${item.dueWhen || 'No date set'}`,
      })),
      deprioritized: deprioritizedItems.slice(0, 3).map(item => ({
        title: item.title,
        reason: item.scores?.dueDateProximity < 50
          ? `Lower urgency - due ${item.dueWhen || 'later'}`
          : `Lower overall score (${item.totalScore}/100)`,
      })),
      warnings: overdue.length > 0
        ? [`You have ${overdue.length} overdue item(s) that need attention.`]
        : [],
      encouragement: dueSoon.length > 0
        ? `${dueSoon.length} item(s) due this week - stay focused.`
        : scoredItems.length > 0
          ? `${scoredItems.length} items tracked. Solid progress.`
          : 'Add your first project to get started.',
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
