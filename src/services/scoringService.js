/**
 * Scoring Service
 * Calculates priority scores for deliverables and projects based on multiple factors.
 */

const Onboarding = require('../models/Onboarding');
const PriorityCache = require('../models/PriorityCache');
const CoreProject = require('../models/CoreProject');
const DepartmentProject = require('../models/DepartmentProject');

// Scoring weights
const WEIGHTS = {
  goalImportance: 0.30,
  dueDateProximity: 0.25,
  overdueScore: 0.20,
  blockerScore: 0.15,
  kpiWeight: 0.10,
};

/**
 * Parse a date string into a Date object
 */
function parseDate(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Calculate days until a due date (negative if overdue)
 */
function daysUntil(dueDate) {
  if (!dueDate) return Infinity;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  due.setHours(0, 0, 0, 0);
  return Math.round((due - now) / (1000 * 60 * 60 * 24));
}

/**
 * Calculate goal importance score (0-100)
 * Items linked to 1-year goals score higher
 */
function calculateGoalImportance(item, context) {
  let score = 50; // Base score

  // If item is part of a core project, it's more important
  if (item.source?.type === 'project') {
    score += 30;
  }

  // Items with explicit goals score higher
  if (item.goal) {
    score += 20;
  }

  return Math.min(100, score);
}

/**
 * Calculate due date proximity score (0-100)
 * Items due soon score higher
 */
function calculateDueDateProximity(dueWhen) {
  const days = daysUntil(dueWhen);

  if (days === Infinity) return 0; // No due date
  if (days <= 0) return 0; // Handled by overdue score
  if (days <= 3) return 100; // Due within 3 days
  if (days <= 7) return 85; // Due within a week
  if (days <= 14) return 70; // Due within 2 weeks
  if (days <= 30) return 50; // Due within a month
  if (days <= 60) return 30; // Due within 2 months
  return 10; // Further out
}

/**
 * Calculate overdue score (0-100)
 * Items that are overdue score highest
 */
function calculateOverdueScore(dueWhen) {
  const days = daysUntil(dueWhen);

  if (days === Infinity) return 0; // No due date
  if (days >= 0) return 0; // Not overdue

  const daysOverdue = Math.abs(days);
  if (daysOverdue >= 14) return 100; // 2+ weeks overdue
  if (daysOverdue >= 7) return 80; // 1-2 weeks overdue
  if (daysOverdue >= 3) return 60; // 3-7 days overdue
  return 40; // 1-3 days overdue
}

/**
 * Calculate blocker score (0-100)
 * Items that block other work score higher
 */
function calculateBlockerScore(item, allItems) {
  // For now, a simple heuristic:
  // Items earlier in the project timeline that have dependents are blockers
  // Projects themselves are blockers for their deliverables

  if (item.source?.type === 'project') {
    // Projects with multiple deliverables are blockers
    const deliverableCount = item.deliverableCount || 0;
    if (deliverableCount >= 5) return 100;
    if (deliverableCount >= 3) return 70;
    if (deliverableCount >= 1) return 40;
    return 20;
  }

  // Deliverables - check if they're early in the timeline
  const itemDue = parseDate(item.dueWhen);
  if (!itemDue) return 0;

  // Count how many items are due after this one
  let laterItems = 0;
  for (const other of allItems) {
    const otherDue = parseDate(other.dueWhen);
    if (otherDue && otherDue > itemDue) {
      laterItems++;
    }
  }

  const ratio = laterItems / Math.max(1, allItems.length);
  return Math.round(ratio * 100);
}

/**
 * Calculate KPI weight score (0-100)
 */
function calculateKpiWeight(item) {
  return item.kpi ? 50 : 0;
}

/**
 * Calculate total score for an item
 */
function calculateScore(item, context) {
  const scores = {
    goalImportance: calculateGoalImportance(item, context),
    dueDateProximity: calculateDueDateProximity(item.dueWhen),
    overdueScore: calculateOverdueScore(item.dueWhen),
    blockerScore: calculateBlockerScore(item, context.allItems || []),
    kpiWeight: calculateKpiWeight(item),
  };

  const total = Object.entries(scores).reduce(
    (sum, [key, value]) => sum + value * WEIGHTS[key],
    0
  );

  return {
    scores,
    totalScore: Math.round(total),
  };
}

/**
 * Get weekly priorities (items due within current calendar week Sunday-Saturday, plus overdue)
 */
function getWeeklyTop3(scoredItems) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Get start of current week (Sunday)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay()); // Go back to Sunday
  startOfWeek.setHours(0, 0, 0, 0);

  // Get end of current week (Saturday 23:59:59)
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6); // Saturday
  endOfWeek.setHours(23, 59, 59, 999);

  const relevant = scoredItems.filter((item) => {
    const due = parseDate(item.dueWhen);
    if (!due) return false;

    // Include if overdue (before today)
    if (due < now) return true;

    // Include if due within current week (Sunday to Saturday)
    return due >= startOfWeek && due <= endOfWeek;
  });

  // Sort by total score descending
  relevant.sort((a, b) => b.totalScore - a.totalScore);

  // Return all relevant items (no limit)
  return relevant;
}

/**
 * Get upcoming items (due beyond this week)
 * Used when weeklyFocus is empty to always show something
 * Prioritizes items within 30 days, but extends to all future items if none found
 */
function getUpcomingItems(scoredItems, limit = 5) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Get end of current week (Saturday 23:59:59)
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  // Get ALL items due after this week (with valid due dates)
  const allUpcoming = scoredItems.filter((item) => {
    const due = parseDate(item.dueWhen);
    if (!due) return false;
    return due > endOfWeek;
  });

  // Sort by due date ascending (soonest first)
  allUpcoming.sort((a, b) => {
    const dateA = parseDate(a.dueWhen);
    const dateB = parseDate(b.dueWhen);
    return dateA - dateB;
  });

  // Mark as upcoming for frontend display
  return allUpcoming.slice(0, limit).map((item) => ({
    ...item,
    isUpcoming: true,
  }));
}

/**
 * Get monthly thrust (most important project/goal for the month)
 */
function getMonthlyThrust(scoredItems) {
  // Filter to project-level items
  const projects = scoredItems.filter((item) => item.source?.type === 'project');

  if (projects.length === 0) {
    // Fall back to highest-priority item overall
    const sorted = [...scoredItems].sort((a, b) => b.totalScore - a.totalScore);
    return sorted[0] || null;
  }

  // Sort by total score descending
  projects.sort((a, b) => b.totalScore - a.totalScore);
  return projects[0];
}

/**
 * Extract items directly from new CRUD models (CoreProject, DepartmentProject)
 * This replaces extractItems for new API usage
 */
async function extractItemsFromModels(userId, workspaceId) {
  const items = [];
  const crudFilter = { user: userId, isDeleted: { $ne: true } };
  if (workspaceId) crudFilter.workspace = workspaceId;

  // Fetch from new CRUD models in parallel
  const [coreProjects, deptProjects] = await Promise.all([
    CoreProject.find(crudFilter).sort({ order: 1 }).lean(),
    DepartmentProject.find(crudFilter).sort({ order: 1 }).lean(),
  ]);

  // Extract from CoreProjects
  coreProjects.forEach((p, pIndex) => {
    const projectTitle = String(p?.title || '').trim();
    if (!projectTitle) return;

    // Get active (non-completed) deliverables
    const deliverables = Array.isArray(p?.deliverables) ? p.deliverables : [];
    const activeDeliverables = deliverables.filter(d => {
      const text = String(d?.text || '').trim();
      return text && !d?.done;
    });

    // If project has active deliverables, track those instead of the project
    if (activeDeliverables.length > 0) {
      activeDeliverables.forEach((d, dIndex) => {
        const originalIndex = deliverables.indexOf(d);
        items.push({
          title: String(d?.text || '').trim(),
          dueWhen: d?.dueWhen || null,
          goal: p?.goal || null,
          kpi: d?.kpi || null,
          source: { type: 'deliverable', projectIndex: pIndex, deliverableIndex: originalIndex, projectId: p._id?.toString(), deliverableId: d._id?.toString() },
          projectTitle,
          owner: p?.ownerName || null,
        });
      });
    } else {
      // No active deliverables - track the project itself
      items.push({
        title: projectTitle,
        dueWhen: p?.dueWhen || null,
        goal: p?.goal || null,
        kpi: null,
        source: { type: 'project', projectIndex: pIndex, projectId: p._id?.toString() },
        deliverableCount: 0,
        owner: p?.ownerName || null,
      });
    }
  });

  // Extract from DepartmentProjects
  deptProjects.forEach((assignment, aIndex) => {
    const projectTitle = String(assignment?.title || '').trim();
    if (!projectTitle) return;

    // Skip completed projects
    const status = String(assignment?.status || '').toLowerCase();
    if (status === 'completed') return;

    const dept = assignment?.departmentKey || 'general';
    const owner = [assignment?.firstName, assignment?.lastName].filter(Boolean).join(' ').trim();

    // Get active (non-completed) deliverables
    const deliverables = Array.isArray(assignment?.deliverables) ? assignment.deliverables : [];
    const activeDeliverables = deliverables.filter(d => {
      const text = String(d?.text || '').trim();
      return text && !d?.done;
    });

    // If project has active deliverables, track those instead of the project
    if (activeDeliverables.length > 0) {
      activeDeliverables.forEach((d) => {
        const originalIndex = deliverables.indexOf(d);
        items.push({
          title: String(d?.text || '').trim(),
          dueWhen: d?.dueWhen || null,
          goal: assignment?.goal || null,
          kpi: d?.kpi || null,
          source: { type: 'dept_deliverable', department: dept, goalIndex: aIndex, deliverableIndex: originalIndex, projectId: assignment._id?.toString(), deliverableId: d._id?.toString() },
          projectTitle,
          owner,
        });
      });
    } else {
      // No active deliverables - track the project itself
      items.push({
        title: projectTitle,
        dueWhen: assignment?.dueWhen || null,
        goal: assignment?.goal || null,
        kpi: null,
        source: { type: 'goal', department: dept, goalIndex: aIndex, projectId: assignment._id?.toString() },
        owner,
        deliverableCount: 0,
      });
    }
  });

  return items;
}

/**
 * Recalculate and cache priorities for a user's workspace
 * Uses new CRUD models (CoreProject, DepartmentProject) instead of Onboarding.answers
 */
async function recalculateAndCache(userId, workspaceId) {
  try {
    // Extract items from new CRUD models
    const items = await extractItemsFromModels(userId, workspaceId);
    const context = { allItems: items };

    const scoredItems = items.map((item) => {
      const { scores, totalScore } = calculateScore(item, context);
      return { ...item, scores, totalScore };
    });

    // Get priorities
    const weeklyTop3 = getWeeklyTop3(scoredItems);
    const monthlyThrust = getMonthlyThrust(scoredItems);
    const upcomingItems = getUpcomingItems(scoredItems);

    // Update or create cache
    await PriorityCache.findOneAndUpdate(
      { user: userId, workspace: workspaceId },
      {
        user: userId,
        workspace: workspaceId,
        weeklyTop3,
        monthlyThrust,
        upcomingItems,
        calculatedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    return { weeklyTop3, monthlyThrust, upcomingItems, itemCount: items.length };
  } catch (err) {
    console.error('[scoringService] recalculateAndCache error:', err?.message || err);
    throw err;
  }
}

/**
 * Get cached priorities for a workspace
 */
async function getCachedPriorities(userId, workspaceId) {
  const cache = await PriorityCache.findOne({ user: userId, workspace: workspaceId }).lean();
  return cache;
}

module.exports = {
  WEIGHTS,
  calculateScore,
  extractItemsFromModels,
  getWeeklyTop3,
  getUpcomingItems,
  getMonthlyThrust,
  recalculateAndCache,
  getCachedPriorities,
  parseDate,
  daysUntil,
};
