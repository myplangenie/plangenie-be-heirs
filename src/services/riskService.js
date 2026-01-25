/**
 * Risk Service
 * Detects risks like overdue items, due date clustering, and KPI off-track items.
 */

const { parseDate, daysUntil } = require('./scoringService');

/**
 * Group items by week
 */
function groupByWeek(items) {
  const byWeek = {};

  for (const item of items) {
    const due = parseDate(item.dueWhen);
    if (!due) continue;

    // Get Monday of the week
    const monday = new Date(due);
    monday.setDate(monday.getDate() - monday.getDay() + 1); // Monday
    monday.setHours(0, 0, 0, 0);
    const weekKey = monday.toISOString().slice(0, 10);

    if (!byWeek[weekKey]) {
      byWeek[weekKey] = [];
    }
    byWeek[weekKey].push(item);
  }

  return byWeek;
}

/**
 * Find overdue items
 */
function findOverdueItems(items) {
  const overdue = [];

  for (const item of items) {
    const days = daysUntil(item.dueWhen);
    if (days !== Infinity && days < 0) {
      overdue.push({
        ...item,
        daysOverdue: Math.abs(days),
      });
    }
  }

  // Sort by most overdue first
  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return overdue;
}

/**
 * Find items due soon (within next 3 days)
 */
function findDueSoonItems(items) {
  const dueSoon = [];

  for (const item of items) {
    const days = daysUntil(item.dueWhen);
    if (days >= 0 && days <= 3) {
      dueSoon.push({
        ...item,
        daysUntilDue: days,
      });
    }
  }

  // Sort by soonest first
  dueSoon.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
  return dueSoon;
}

/**
 * Calculate a suggested reschedule date
 * Finds the next week with fewer items
 */
function calculateSuggestedDate(item, currentWeekStart, byWeek) {
  const currentWeek = new Date(currentWeekStart);

  // Look ahead for up to 4 weeks
  for (let i = 1; i <= 4; i++) {
    const nextWeek = new Date(currentWeek);
    nextWeek.setDate(nextWeek.getDate() + 7 * i);
    const weekKey = nextWeek.toISOString().slice(0, 10);

    const itemsInWeek = byWeek[weekKey]?.length || 0;
    if (itemsInWeek < 3) {
      // Calculate a specific date (same day of week as original)
      const originalDue = parseDate(item.dueWhen);
      if (originalDue) {
        const dayOfWeek = originalDue.getDay();
        const suggestedDate = new Date(nextWeek);
        const daysToAdd = (dayOfWeek - 1 + 7) % 7; // Days from Monday
        suggestedDate.setDate(suggestedDate.getDate() + daysToAdd);
        return suggestedDate.toISOString().slice(0, 10);
      }
      // Default to Friday of that week
      nextWeek.setDate(nextWeek.getDate() + 4); // Friday
      return nextWeek.toISOString().slice(0, 10);
    }
  }

  // If no good week found, suggest 2 weeks out from current
  const fallback = new Date(currentWeek);
  fallback.setDate(fallback.getDate() + 14);
  return fallback.toISOString().slice(0, 10);
}

/**
 * Detect clusters (weeks with >3 items due)
 */
function detectClusters(items) {
  const byWeek = groupByWeek(items);
  const clusters = [];

  for (const [weekStart, weekItems] of Object.entries(byWeek)) {
    if (weekItems.length > 3) {
      // Sort items by blocker score (lowest first = safest to move)
      const sorted = [...weekItems].sort((a, b) => {
        const aBlocker = a.scores?.blockerScore || 0;
        const bBlocker = b.scores?.blockerScore || 0;
        return aBlocker - bBlocker;
      });

      const suggestion = sorted[0]
        ? {
            itemTitle: sorted[0].title,
            reason: 'Lowest dependency on other work',
            suggestedDate: calculateSuggestedDate(sorted[0], weekStart, byWeek),
            source: sorted[0].source || null, // Include source for rescheduling
          }
        : null;

      clusters.push({
        weekStart,
        itemCount: weekItems.length,
        items: weekItems.map((i) => ({ title: i.title, dueWhen: i.dueWhen, source: i.source })),
        suggestion,
      });
    }
  }

  return clusters;
}

/**
 * Detect all risks for a set of items
 */
function detectRisks(scoredItems) {
  const risks = [];

  // 1. Overdue critical items
  const overdue = findOverdueItems(scoredItems);
  for (const item of overdue.slice(0, 5)) {
    // Limit to top 5
    const severity = item.daysOverdue > 7 ? 'high' : 'medium';

    // Calculate suggested reschedule dates
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    risks.push({
      type: 'overdue',
      severity,
      message: `"${item.title}" is ${item.daysOverdue} day${item.daysOverdue === 1 ? '' : 's'} overdue`,
      itemTitle: item.title,
      itemDue: item.dueWhen,
      source: item.source || null,
      suggestions: [
        {
          action: 'reschedule',
          label: 'Reschedule to today',
          newDate: today.toISOString().slice(0, 10),
          source: item.source || null,
        },
        {
          action: 'reschedule',
          label: 'Reschedule to next week',
          newDate: nextWeek.toISOString().slice(0, 10),
          source: item.source || null,
        },
        {
          action: 'complete',
          label: 'Mark as complete',
          source: item.source || null,
        },
      ],
    });
  }

  // 2. Items due very soon
  const dueSoon = findDueSoonItems(scoredItems);
  for (const item of dueSoon.slice(0, 3)) {
    // Limit to top 3
    // Calculate extend date (3 days from current due)
    const currentDue = parseDate(item.dueWhen) || new Date();
    const extendDate = new Date(currentDue);
    extendDate.setDate(extendDate.getDate() + 3);

    if (item.daysUntilDue === 0) {
      risks.push({
        type: 'deadline_soon',
        severity: 'high',
        message: `"${item.title}" is due today`,
        itemTitle: item.title,
        itemDue: item.dueWhen,
        source: item.source || null,
        suggestions: [
          {
            action: 'complete',
            label: 'Mark as complete',
            source: item.source || null,
          },
          {
            action: 'reschedule',
            label: 'Extend by 3 days',
            newDate: extendDate.toISOString().slice(0, 10),
            source: item.source || null,
          },
        ],
      });
    } else {
      risks.push({
        type: 'deadline_soon',
        severity: 'warning',
        message: `"${item.title}" is due in ${item.daysUntilDue} day${item.daysUntilDue === 1 ? '' : 's'}`,
        itemTitle: item.title,
        itemDue: item.dueWhen,
        source: item.source || null,
        suggestions: [
          {
            action: 'complete',
            label: 'Mark as complete',
            source: item.source || null,
          },
          {
            action: 'reschedule',
            label: 'Extend by 3 days',
            newDate: extendDate.toISOString().slice(0, 10),
            source: item.source || null,
          },
          {
            action: 'snooze',
            label: 'Snooze for 1 day',
            snoozeDays: 1,
          },
        ],
      });
    }
  }

  // 3. Clustering risks
  const clusters = detectClusters(scoredItems);
  for (const cluster of clusters) {
    risks.push({
      type: 'clustering',
      severity: cluster.itemCount > 5 ? 'high' : 'medium',
      message: `${cluster.itemCount} items due in week of ${formatWeekDate(cluster.weekStart)}`,
      itemTitle: cluster.suggestion?.itemTitle || null,
      source: cluster.suggestion?.source || null,
      suggestion: cluster.suggestion
        ? {
            action: 'reschedule',
            newDate: cluster.suggestion.suggestedDate,
            reason: cluster.suggestion.reason,
            source: cluster.suggestion.source || null,
          }
        : null,
    });
  }

  return risks;
}

/**
 * Format a week start date for display
 */
function formatWeekDate(weekStart) {
  const d = new Date(weekStart);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

/**
 * Full risk analysis for onboarding answers
 */
function analyzeRisks(answers, scoredItems) {
  const risks = detectRisks(scoredItems);
  const clusters = detectClusters(scoredItems);

  return { risks, clusters };
}

module.exports = {
  detectRisks,
  detectClusters,
  findOverdueItems,
  findDueSoonItems,
  groupByWeek,
  calculateSuggestedDate,
  analyzeRisks,
};
