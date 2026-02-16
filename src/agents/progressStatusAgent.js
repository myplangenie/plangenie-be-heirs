/**
 * Project Manager Agent
 * Execution Integrity and Momentum Control Layer
 *
 * Purpose: Ensure decisions turn into outcomes.
 * This agent monitors execution health, surfaces breakdowns in momentum,
 * identifies blockers and slippage early, and makes execution risk visible.
 *
 * This agent answers:
 * - Is execution holding?
 * - Where is momentum breaking?
 * - What needs intervention?
 * - What will slip next if nothing changes?
 *
 * It never sets priorities. It never defines strategy. It protects execution quality.
 *
 * Tile-based UI Structure:
 * - Zone 1: Execution Health (Hero status tile)
 * - Zone 2: Execution Signals (Delivery, Dependencies, Ownership)
 * - Zone 3: Execution Risk (Slippage Risk, Blockers)
 * - Zone 4: Intervention Focus
 * - Zone 5: Momentum and Throughput
 * - Zone 6: Control and Context (Time Horizon)
 */

const {
  hashInput,
  getFromCache,
  setCache,
  buildAgentContext,
  callOpenAIJSON,
  formatContextForPrompt,
} = require('./base');

/**
 * Assess execution health state
 */
function assessExecutionHealth(deliveryStats, dependencyStats, ownershipStats) {
  const { overdueCount, totalActive, dueSoonCount } = deliveryStats;
  const { blockedCount, criticalChains } = dependencyStats;
  const { overloadedOwners, unassignedCount } = ownershipStats;

  // Calculate risk factors
  const overdueRatio = totalActive > 0 ? overdueCount / totalActive : 0;
  const blockedRatio = totalActive > 0 ? blockedCount / totalActive : 0;

  // Determine state
  if (overdueRatio > 0.3 || blockedCount > 3 || criticalChains > 1) {
    return {
      state: 'compromised',
      supportingSentence: buildHealthSentence('compromised', { overdueCount, blockedCount, criticalChains, overloadedOwners }),
    };
  }

  if (overdueCount > 0 || blockedCount > 0 || overloadedOwners > 0 || dueSoonCount > 3) {
    return {
      state: 'at-risk',
      supportingSentence: buildHealthSentence('at-risk', { overdueCount, blockedCount, dueSoonCount, overloadedOwners }),
    };
  }

  return {
    state: 'on-track',
    supportingSentence: buildHealthSentence('on-track', { totalActive, dueSoonCount }),
  };
}

/**
 * Build health supporting sentence
 */
function buildHealthSentence(state, stats) {
  const { overdueCount, blockedCount, criticalChains, overloadedOwners, totalActive, dueSoonCount } = stats;

  if (state === 'compromised') {
    const issues = [];
    if (overdueCount > 0) issues.push(`${overdueCount} overdue deliverable${overdueCount > 1 ? 's' : ''}`);
    if (blockedCount > 0) issues.push(`${blockedCount} blocked item${blockedCount > 1 ? 's' : ''}`);
    if (criticalChains > 0) issues.push(`${criticalChains} critical dependency chain${criticalChains > 1 ? 's' : ''}`);
    return `Execution is compromised due to ${issues.join(' and ')}.`;
  }

  if (state === 'at-risk') {
    const issues = [];
    if (overdueCount > 0) issues.push(`${overdueCount} overdue`);
    if (blockedCount > 0) issues.push(`${blockedCount} blocked`);
    if (dueSoonCount > 0) issues.push(`${dueSoonCount} due soon`);
    if (overloadedOwners > 0) issues.push(`${overloadedOwners} overloaded owner${overloadedOwners > 1 ? 's' : ''}`);
    return `Execution is at risk: ${issues.join(', ')}.`;
  }

  if (totalActive === 0) {
    return 'No active deliverables. Add projects to track execution.';
  }

  return `Execution is on track with ${totalActive} active deliverable${totalActive > 1 ? 's' : ''}${dueSoonCount > 0 ? ` (${dueSoonCount} due soon)` : ''}.`;
}

/**
 * Calculate delivery statistics
 */
function calculateDeliveryStats(context, timeHorizon = 'week') {
  const coreProjects = context.coreProjects || [];
  const deptProjects = context.departmentProjects || [];

  const allDeliverables = [
    ...coreProjects.flatMap((p, pIdx) => (p.deliverables || []).map((d, dIdx) => ({
      ...d,
      projectName: p.title || p.name,
      projectType: 'core',
      projectOwner: p.ownerName || p.ownerId || '',
      source: {
        type: 'coreProjectDeliverable',
        projectId: p._id?.toString(),
        coreProjectId: p._id?.toString(),
        deliverableIndex: dIdx,
        deliverableId: d._id?.toString(),
      },
    }))),
    ...deptProjects.flatMap((p, pIdx) => (p.deliverables || []).map((d, dIdx) => ({
      ...d,
      projectName: p.title || p.name,
      projectType: 'department',
      projectOwner: p.ownerName || p.ownerId || (p.firstName || p.lastName ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : ''),
      source: {
        type: 'deptProjectDeliverable',
        projectId: p._id?.toString(),
        deptProjectId: p._id?.toString(),
        deliverableIndex: dIdx,
        deliverableId: d._id?.toString(),
      },
    }))),
  ];

  const today = new Date();
  const horizonDays = timeHorizon === 'today' ? 1 : timeHorizon === 'week' ? 7 : 30;
  const horizonDate = new Date(today.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  const activeDeliverables = allDeliverables.filter(d => !d.done);
  const completedDeliverables = allDeliverables.filter(d => d.done);

  const overdueDeliverables = activeDeliverables.filter(d => {
    const due = d.dueWhen ? new Date(d.dueWhen) : null;
    return due && due < today;
  });

  const dueSoonDeliverables = activeDeliverables.filter(d => {
    const due = d.dueWhen ? new Date(d.dueWhen) : null;
    return due && due >= today && due <= horizonDate;
  });

  return {
    totalActive: activeDeliverables.length,
    totalCompleted: completedDeliverables.length,
    totalAll: allDeliverables.length,
    overdueCount: overdueDeliverables.length,
    overdueItems: overdueDeliverables.slice(0, 5),
    dueSoonCount: dueSoonDeliverables.length,
    dueSoonItems: dueSoonDeliverables.slice(0, 5),
  };
}

/**
 * Calculate dependency statistics
 */
function calculateDependencyStats(context) {
  const coreProjects = context.coreProjects || [];
  const deptProjects = context.departmentProjects || [];

  const allDeliverables = [
    ...coreProjects.flatMap((p, pIdx) => (p.deliverables || []).map((d, dIdx) => ({
      ...d,
      projectName: p.title || p.name,
      source: {
        type: 'coreProjectDeliverable',
        projectId: p._id?.toString(),
        coreProjectId: p._id?.toString(),
        deliverableIndex: dIdx,
        deliverableId: d._id?.toString(),
      },
    }))),
    ...deptProjects.flatMap((p, pIdx) => (p.deliverables || []).map((d, dIdx) => ({
      ...d,
      projectName: p.title || p.name,
      source: {
        type: 'deptProjectDeliverable',
        projectId: p._id?.toString(),
        deptProjectId: p._id?.toString(),
        deliverableIndex: dIdx,
        deliverableId: d._id?.toString(),
      },
    }))),
  ];

  // Find deliverables that are blocked by incomplete dependencies
  const blockedDeliverables = allDeliverables.filter(d => {
    if (d.done) return false;
    // Check if has dependencies and they're not complete
    const deps = d.dependencies || d.blockedBy || [];
    if (deps.length === 0) return false;

    // For now, consider it blocked if it has dependencies listed
    // In a more complete implementation, we'd check if those deps are done
    return deps.some(dep => {
      const depItem = allDeliverables.find(item => item.id === dep || item.title === dep);
      return depItem && !depItem.done;
    });
  });

  // Identify critical chains (deliverables that block multiple others)
  const blockingCounts = {};
  allDeliverables.forEach(d => {
    const deps = d.dependencies || d.blockedBy || [];
    deps.forEach(dep => {
      blockingCounts[dep] = (blockingCounts[dep] || 0) + 1;
    });
  });

  const criticalChains = Object.values(blockingCounts).filter(count => count >= 2).length;

  return {
    blockedCount: blockedDeliverables.length,
    blockedItems: blockedDeliverables.slice(0, 5),
    criticalChains,
    totalDependencies: Object.keys(blockingCounts).length,
  };
}

/**
 * Calculate ownership statistics
 */
function calculateOwnershipStats(context) {
  const coreProjects = context.coreProjects || [];
  const deptProjects = context.departmentProjects || [];

  // Map deliverables with their parent project's owner as fallback
  const allDeliverables = [
    ...coreProjects.flatMap(p => (p.deliverables || []).map(d => ({
      ...d,
      projectName: p.title || p.name,
      // Deliverable's own owner (check correct field names from schema)
      deliverableOwner: d.ownerName || d.ownerId || d.owner || d.assignedTo || d.responsible || '',
      // Fallback to project-level owner
      projectOwner: p.ownerName || p.ownerId || '',
    }))),
    ...deptProjects.flatMap(p => (p.deliverables || []).map(d => ({
      ...d,
      projectName: p.title || p.name,
      // Deliverable's own owner (check correct field names from schema)
      deliverableOwner: d.ownerName || d.ownerId || d.owner || d.assignedTo || d.responsible || '',
      // Fallback to project-level owner (department projects use firstName/lastName)
      projectOwner: p.ownerName || p.ownerId || (p.firstName || p.lastName ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : ''),
    }))),
  ];

  const activeDeliverables = allDeliverables.filter(d => !d.done);

  // Count by owner
  const ownerCounts = {};
  let unassignedCount = 0;

  activeDeliverables.forEach(d => {
    // Use deliverable's owner, fallback to project owner
    const owner = d.deliverableOwner || d.projectOwner || '';
    if (!owner || owner.trim() === '') {
      unassignedCount++;
    } else {
      const ownerKey = owner.trim();
      ownerCounts[ownerKey] = (ownerCounts[ownerKey] || 0) + 1;
    }
  });

  // Find overloaded owners (more than 5 active items)
  const OVERLOAD_THRESHOLD = 5;
  const overloadedOwners = Object.entries(ownerCounts)
    .filter(([_, count]) => count > OVERLOAD_THRESHOLD)
    .map(([owner, count]) => ({ owner, count }));

  return {
    ownerCounts,
    overloadedOwners: overloadedOwners.length,
    overloadedOwnersList: overloadedOwners,
    unassignedCount,
    totalOwners: Object.keys(ownerCounts).length,
  };
}

/**
 * Identify slippage risks
 */
function identifySlippageRisks(deliveryStats, dependencyStats, ownershipStats) {
  const risks = [];

  // Deliverables due soon with dependencies
  deliveryStats.dueSoonItems.forEach(d => {
    const deps = d.dependencies || d.blockedBy || [];
    if (deps.length > 0) {
      risks.push({
        deliverable: d.title,
        project: d.projectName,
        reason: 'Has unresolved dependencies',
        likelihood: 'high',
        source: d.source || null,
      });
    }
  });

  // Deliverables assigned to overloaded owners
  ownershipStats.overloadedOwnersList.forEach(({ owner, count }) => {
    risks.push({
      deliverable: `${count} items assigned to ${owner}`,
      project: 'Multiple',
      reason: `Owner is overloaded with ${count} active items`,
      likelihood: 'medium',
      source: null, // No single source for aggregated items
    });
  });

  // Deliverables without clear ownership
  if (ownershipStats.unassignedCount > 0) {
    risks.push({
      deliverable: `${ownershipStats.unassignedCount} unassigned items`,
      project: 'Multiple',
      reason: 'No clear ownership means no accountability',
      likelihood: 'high',
      source: null, // No single source for aggregated items
    });
  }

  return risks.slice(0, 5);
}

/**
 * Identify blockers
 */
function identifyBlockers(deliveryStats, dependencyStats, context) {
  const blockers = [];

  // Dependency blockers
  dependencyStats.blockedItems.forEach(d => {
    blockers.push({
      item: d.title,
      type: 'dependency',
      description: `Waiting on dependencies to complete`,
      project: d.projectName,
      source: d.source || null,
    });
  });

  // Overdue items as blockers (they may be blocking other work)
  deliveryStats.overdueItems.slice(0, 3).forEach(d => {
    blockers.push({
      item: d.title,
      type: 'overdue',
      description: `Overdue and may be blocking downstream work`,
      project: d.projectName,
      source: d.source || null,
    });
  });

  return blockers.slice(0, 5);
}

/**
 * Calculate momentum metrics
 */
function calculateMomentum(context) {
  const coreProjects = context.coreProjects || [];
  const deptProjects = context.departmentProjects || [];

  const allDeliverables = [
    ...coreProjects.flatMap(p => p.deliverables || []),
    ...deptProjects.flatMap(p => p.deliverables || []),
  ];

  const completed = allDeliverables.filter(d => d.done);
  const total = allDeliverables.length;

  // Calculate completion rate
  const completionRate = total > 0 ? Math.round((completed.length / total) * 100) : 0;

  // Determine trend (would need historical data for real trend)
  // For now, base it on completion rate
  let trend = 'stable';
  if (completionRate >= 70) trend = 'accelerating';
  else if (completionRate < 30 && total > 5) trend = 'declining';

  return {
    completedCount: completed.length,
    totalCount: total,
    completionRate,
    trend,
    statement: buildMomentumStatement(completed.length, total, trend),
  };
}

/**
 * Build momentum statement
 */
function buildMomentumStatement(completed, total, trend) {
  if (total === 0) {
    return 'No deliverables to track. Add projects to monitor momentum.';
  }

  const rate = Math.round((completed / total) * 100);

  if (trend === 'accelerating') {
    return `Strong momentum: ${completed} of ${total} deliverables complete (${rate}%).`;
  }

  if (trend === 'declining') {
    return `Momentum declining: Only ${completed} of ${total} deliverables complete (${rate}%).`;
  }

  return `${completed} of ${total} deliverables complete (${rate}%). Throughput is stable.`;
}

/**
 * Generate Project Manager execution report
 * @param {string} userId - User ID
 * @param {Object} options - Optional parameters
 * @returns {Object} Execution report with 6 zones
 */
async function getProgressStatus(userId, options = {}) {
  const { forceRefresh = false, workspaceId = null, timeHorizon = 'week' } = options;

  // Build context
  const context = await buildAgentContext(userId, workspaceId);

  // Calculate all statistics
  const deliveryStats = calculateDeliveryStats(context, timeHorizon);
  const dependencyStats = calculateDependencyStats(context);
  const ownershipStats = calculateOwnershipStats(context);

  // Create cache key
  const inputHash = hashInput({
    totalDeliverables: deliveryStats.totalAll,
    completedCount: deliveryStats.totalCompleted,
    overdueCount: deliveryStats.overdueCount,
    blockedCount: dependencyStats.blockedCount,
    timeHorizon,
  });

  // Check cache
  if (!forceRefresh) {
    const cached = await getFromCache(userId, 'progress-status', inputHash, workspaceId);
    if (cached) {
      console.log('[Project Manager] Returning CACHED response');
      return { ...cached, fromCache: true };
    }
  }
  console.log('[Project Manager] Generating FRESH response');

  // Zone 1: Execution Health
  const executionHealth = assessExecutionHealth(deliveryStats, dependencyStats, ownershipStats);

  // Zone 2: Execution Signals
  const executionSignals = {
    delivery: {
      totalActive: deliveryStats.totalActive,
      overdueCount: deliveryStats.overdueCount,
      dueSoonCount: deliveryStats.dueSoonCount,
      context: deliveryStats.totalActive === 0
        ? 'No active deliverables'
        : deliveryStats.overdueCount > 0
          ? `${deliveryStats.overdueCount} overdue, ${deliveryStats.dueSoonCount} due soon`
          : `${deliveryStats.dueSoonCount} due within ${timeHorizon}`,
    },
    dependencies: {
      blockedCount: dependencyStats.blockedCount,
      criticalChains: dependencyStats.criticalChains,
      context: dependencyStats.blockedCount === 0
        ? 'No blocked deliverables'
        : `${dependencyStats.blockedCount} items blocked by dependencies`,
    },
    ownership: {
      overloadedOwners: ownershipStats.overloadedOwners,
      unassignedCount: ownershipStats.unassignedCount,
      context: ownershipStats.unassignedCount > 0
        ? `${ownershipStats.unassignedCount} items lack ownership`
        : ownershipStats.overloadedOwners > 0
          ? `${ownershipStats.overloadedOwners} owner(s) overloaded`
          : 'Ownership is balanced',
    },
  };

  // Zone 3: Execution Risk
  const slippageRisks = identifySlippageRisks(deliveryStats, dependencyStats, ownershipStats);
  const blockers = identifyBlockers(deliveryStats, dependencyStats, context);

  // Zone 5: Momentum
  const momentum = calculateMomentum(context);

  // Zone 4: Intervention Focus (AI-generated if there are issues)
  let interventionFocus = {
    items: [],
    hasData: false,
  };

  let generationTimeMs = 0;

  const needsIntervention = executionHealth.state !== 'on-track' ||
    deliveryStats.overdueCount > 0 ||
    dependencyStats.blockedCount > 0 ||
    ownershipStats.unassignedCount > 2;

  if (needsIntervention && (deliveryStats.totalActive > 0 || deliveryStats.overdueCount > 0)) {
    const contextStr = formatContextForPrompt(context);

    const executionSummary = `EXECUTION STATUS:
Health: ${executionHealth.state}
Active Deliverables: ${deliveryStats.totalActive}
Overdue: ${deliveryStats.overdueCount}
Due Soon: ${deliveryStats.dueSoonCount}
Blocked: ${dependencyStats.blockedCount}
Unassigned: ${ownershipStats.unassignedCount}
Overloaded Owners: ${ownershipStats.overloadedOwners}

OVERDUE ITEMS:
${deliveryStats.overdueItems.map(d => `- ${d.title} (${d.projectName})`).join('\n') || 'None'}

BLOCKED ITEMS:
${dependencyStats.blockedItems.map(d => `- ${d.title} (${d.projectName})`).join('\n') || 'None'}

SLIPPAGE RISKS:
${slippageRisks.map(r => `- ${r.deliverable}: ${r.reason}`).join('\n') || 'None identified'}`;

    const prompt = `You are the Project Manager Agent. Identify 1-2 execution issues that require leadership intervention.

${contextStr}

${executionSummary}

Respond in JSON:
{
  "items": [
    {
      "issue": "Clear statement of the execution issue (max 15 words)",
      "whyIntervention": "Why leadership attention is needed (max 20 words)",
      "consequence": "What happens if ignored (max 15 words)"
    }
  ]
}

RULES:
- Focus on issues that need LEADERSHIP decision or escalation
- Not operational tasks - things that need authority to resolve
- Maximum 2 items
- Be specific to actual projects and deliverables
- No generic advice`;

    const result = await callOpenAIJSON(prompt, {
      maxTokens: 400,
      temperature: 0.4,
    });

    if (result.data?.items && Array.isArray(result.data.items)) {
      interventionFocus = {
        items: result.data.items.slice(0, 2),
        hasData: true,
      };
    }

    generationTimeMs = result.generationTimeMs;
  }

  // Build response
  const response = {
    // Zone 1: Execution Health (Hero)
    executionHealth,

    // Zone 2: Execution Signals
    executionSignals,

    // Zone 3: Execution Risk
    slippageRisk: {
      items: slippageRisks,
      hasRisks: slippageRisks.length > 0,
    },
    blockers: {
      items: blockers,
      hasBlockers: blockers.length > 0,
    },

    // Zone 4: Intervention Focus
    interventionFocus,

    // Zone 5: Momentum
    momentum,

    // Zone 6: Time Horizon Context
    timeHorizon,

    // Metadata
    stats: {
      totalProjects: (context.coreProjects?.length || 0) + (context.departmentProjects?.length || 0),
      totalDeliverables: deliveryStats.totalAll,
      completedDeliverables: deliveryStats.totalCompleted,
      activeDeliverables: deliveryStats.totalActive,
      overdueCount: deliveryStats.overdueCount,
      blockedCount: dependencyStats.blockedCount,
    },
    hasData: deliveryStats.totalAll > 0,
    generatedAt: new Date().toISOString(),
  };

  // Cache the response
  await setCache(userId, 'progress-status', inputHash, response, generationTimeMs, workspaceId);

  console.log('[Project Manager] Execution health:', response.executionHealth.state);
  console.log('[Project Manager] Active deliverables:', deliveryStats.totalActive);

  return { ...response, fromCache: false, generationTimeMs };
}

module.exports = {
  getProgressStatus,
  calculateDeliveryStats,
  calculateDependencyStats,
  calculateOwnershipStats,
  assessExecutionHealth,
};
