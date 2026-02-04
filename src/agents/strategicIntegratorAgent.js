/**
 * Strategic Integrator Agent
 *
 * System Level Coherence and Tradeoff Resolution Layer
 *
 * Purpose: Ensure the business is internally coherent by reconciling
 * competing signals across strategy, finance, priorities, and execution.
 *
 * Tile-based UI Structure:
 * - Zone 1: Strategic Coherence (Hero status tile)
 * - Zone 2: Cross Signal Summary (3 tiles: Priority, Financial, Execution)
 * - Zone 3: Strategic Tension Tiles (stacked contradictions)
 * - Zone 4: Tradeoff Clarification Tile
 * - Zone 5: Alignment Options Tile
 * - Zone 6: Implication Preview Tile
 *
 * This agent answers:
 * - Are we aligned?
 * - Where are we contradicting ourselves?
 * - What tradeoffs are we making implicitly?
 * - What strategic tension requires a decision?
 */

const {
  hashInput,
  getFromCache,
  setCache,
  buildAgentContext,
  callOpenAIJSON,
  formatContextForPrompt,
} = require('./base');

// Import other agents to get their outputs
const { generateGuidance } = require('./planGuidanceAgent');
const { validateFinancials } = require('./financialValidationAgent');
const { getProgressStatus } = require('./progressStatusAgent');

/**
 * Determine priority alignment state
 */
function assessPriorityAlignment(guidanceData, context) {
  if (!guidanceData) {
    return {
      state: 'unknown',
      context: 'Priority data unavailable',
    };
  }

  const stats = guidanceData.stats || {};
  const overdueCount = stats.overdueCount || 0;
  const totalItems = stats.totalItems || 0;
  const dueInHorizon = stats.dueInHorizonCount || 0;

  // Check if priorities align with strategic goals
  const hasOverdue = overdueCount > 0;
  const overloadRatio = totalItems > 0 ? dueInHorizon / totalItems : 0;

  if (hasOverdue && overdueCount > 3) {
    return {
      state: 'misaligned',
      context: `${overdueCount} overdue items indicate priority drift from strategic intent`,
    };
  }

  if (hasOverdue || overloadRatio > 0.5) {
    return {
      state: 'partial',
      context: 'Some priorities may not align with current capacity or strategic focus',
    };
  }

  return {
    state: 'aligned',
    context: 'Current priorities reflect strategic intent',
  };
}

/**
 * Determine financial feasibility state
 */
function assessFinancialFeasibility(financialData) {
  if (!financialData || !financialData.hasData) {
    return {
      state: 'unknown',
      context: 'Financial data unavailable',
    };
  }

  const status = financialData.financialState?.status || 'stable';
  const runway = financialData.metrics?.runway;
  const netMargin = financialData.metrics?.netMargin || 0;

  if (status === 'critical' || (runway !== null && runway < 3)) {
    return {
      state: 'unsustainable',
      context: 'Current financial position cannot support strategic ambitions',
    };
  }

  if (status === 'watch' || netMargin < 0 || (runway !== null && runway < 6)) {
    return {
      state: 'constrained',
      context: 'Financial constraints may limit strategic options',
    };
  }

  return {
    state: 'feasible',
    context: 'Financial capacity supports current strategy',
  };
}

/**
 * Determine execution reality state
 */
function assessExecutionReality(progressData, context) {
  if (!progressData) {
    return {
      state: 'unknown',
      context: 'Execution data unavailable',
    };
  }

  const overallProgress = progressData.overallProgress || 0;
  const sections = progressData.sections || [];

  // Check for sections that are lagging significantly
  const laggingSections = sections.filter(s => s.percentage < 30);
  const criticalSections = sections.filter(s => s.percentage < 15);

  if (criticalSections.length >= 2 || overallProgress < 20) {
    return {
      state: 'breaking',
      context: 'Execution capacity is insufficient for current commitments',
    };
  }

  if (laggingSections.length >= 2 || overallProgress < 40) {
    return {
      state: 'strained',
      context: 'Execution is under pressure in multiple areas',
    };
  }

  return {
    state: 'executable',
    context: 'Execution capacity matches current ambition',
  };
}

/**
 * Determine overall coherence state
 */
function determineCoherenceState(priorityAlignment, financialFeasibility, executionReality) {
  const states = [
    priorityAlignment.state,
    financialFeasibility.state,
    executionReality.state,
  ];

  const hasMisaligned = states.includes('misaligned') || states.includes('unsustainable') || states.includes('breaking');
  const hasPartial = states.includes('partial') || states.includes('constrained') || states.includes('strained');
  const hasUnknown = states.includes('unknown');

  if (hasMisaligned) {
    return {
      state: 'misaligned',
      supportingSentence: 'Strategic intent and execution are in significant tension. Leadership attention required.',
    };
  }

  if (hasPartial) {
    return {
      state: 'tension',
      supportingSentence: 'Current priorities, financial capacity, and execution plans show areas of tension.',
    };
  }

  if (hasUnknown) {
    return {
      state: 'aligned',
      supportingSentence: 'Insufficient data to fully assess coherence. Add more business context for complete analysis.',
    };
  }

  return {
    state: 'aligned',
    supportingSentence: 'Strategic intent and execution are broadly aligned.',
  };
}

/**
 * Generate strategic integration analysis
 */
async function getStrategicIntegration(userId, options = {}) {
  const { forceRefresh = false, workspaceId = null } = options;

  // Build context
  const context = await buildAgentContext(userId, workspaceId);

  // Get outputs from other agents (use cached where possible)
  let guidanceData = null;
  let financialData = null;
  let progressData = null;

  try {
    const [guidance, financial, progress] = await Promise.allSettled([
      generateGuidance(userId, { workspaceId, timeHorizon: 'week' }),
      validateFinancials(userId, { workspaceId }),
      getProgressStatus(userId, { workspaceId, includeAIFeedback: false }),
    ]);

    guidanceData = guidance.status === 'fulfilled' ? guidance.value : null;
    financialData = financial.status === 'fulfilled' ? financial.value : null;
    progressData = progress.status === 'fulfilled' ? progress.value : null;
  } catch (err) {
    console.error('[Strategic Integrator] Failed to get agent outputs:', err.message);
  }

  // Create cache key
  const inputHash = hashInput({
    guidance: guidanceData ? {
      stats: guidanceData.stats,
      topPriority: guidanceData.topPriority?.id,
    } : null,
    financial: financialData ? {
      status: financialData.financialState?.status,
      hasData: financialData.hasData,
    } : null,
    progress: progressData ? {
      overallProgress: progressData.overallProgress,
    } : null,
    coreProjects: context.coreProjects?.length || 0,
  });

  // Check cache
  if (!forceRefresh) {
    const cached = await getFromCache(userId, 'strategic-integration', inputHash, workspaceId);
    if (cached) {
      console.log('[Strategic Integrator] Returning CACHED response');
      return { ...cached, fromCache: true };
    }
  }
  console.log('[Strategic Integrator] Generating FRESH response');

  // Assess each dimension
  const priorityAlignment = assessPriorityAlignment(guidanceData, context);
  const financialFeasibility = assessFinancialFeasibility(financialData);
  const executionReality = assessExecutionReality(progressData, context);

  // Zone 1: Strategic Coherence
  const coherence = determineCoherenceState(priorityAlignment, financialFeasibility, executionReality);

  // Zone 2: Cross Signal Summary (already computed above)
  const crossSignals = {
    priority: priorityAlignment,
    financial: financialFeasibility,
    execution: executionReality,
  };

  // Default zones (will be enhanced by AI)
  let tensions = [];
  let tradeoff = {
    statement: 'No explicit tradeoff identified',
    prioritizing: null,
    deprioritizing: null,
    isAmbiguous: true,
  };
  let alignmentOptions = [];
  let implications = {
    description: 'Select an alignment option to see implications',
    affectedAgents: [],
  };

  // Get AI analysis for tensions, tradeoffs, and options
  const hasSignificantData = guidanceData || financialData || progressData;

  let generationTimeMs = 0;

  if (hasSignificantData && coherence.state !== 'aligned') {
    const contextStr = formatContextForPrompt(context);

    const signalsSummary = `CROSS-AGENT SIGNALS:
Priority Alignment: ${priorityAlignment.state} - ${priorityAlignment.context}
Financial Feasibility: ${financialFeasibility.state} - ${financialFeasibility.context}
Execution Reality: ${executionReality.state} - ${executionReality.context}

PRIORITY COACH DATA:
${guidanceData ? `
- Top Priority: ${guidanceData.topPriority?.title || 'None'}
- Overdue Items: ${guidanceData.stats?.overdueCount || 0}
- Total Items: ${guidanceData.stats?.totalItems || 0}
- Decision: ${guidanceData.decisionZone?.decision || 'N/A'}
` : 'No priority data available'}

FINANCE ANALYST DATA:
${financialData ? `
- Financial State: ${financialData.financialState?.status || 'unknown'}
- Gross Margin: ${financialData.metrics?.grossMargin || 0}%
- Net Margin: ${financialData.metrics?.netMargin || 0}%
- Cash Runway: ${financialData.metrics?.runway || 'N/A'} months
- Monthly Revenue: $${financialData.metrics?.monthlyRevenue?.toLocaleString() || 0}
- Monthly Costs: $${financialData.metrics?.monthlyCosts?.toLocaleString() || 0}
` : 'No financial data available'}

EXECUTION DATA:
${progressData ? `
- Overall Progress: ${progressData.overallProgress || 0}%
- Status: ${progressData.overallStatus || 'unknown'}
` : 'No execution data available'}`;

    const prompt = `You are a Strategic Integrator. Your role is to surface tensions, tradeoffs, and alignment options for executive decision-making.

${contextStr}

${signalsSummary}

Analyze the signals and respond in JSON with:

{
  "tensions": [
    {
      "statement": "Clear description of the competing forces (max 20 words)",
      "tradingOff": "What is being traded off (e.g., 'Growth speed vs cash preservation')"
    }
  ],
  "tradeoff": {
    "statement": "The primary tradeoff currently being made (max 30 words)",
    "prioritizing": "What is being prioritized",
    "deprioritizing": "What is being deprioritized",
    "isAmbiguous": false
  },
  "alignmentOptions": [
    {
      "description": "Description of a viable path to restore coherence (max 25 words)",
      "primaryImpact": "Which area this primarily affects (priorities/finances/execution)",
      "financialImplication": "High-level financial impact (1 sentence)",
      "executionImplication": "High-level execution impact (1 sentence)"
    }
  ],
  "implications": {
    "description": "What changes if the first alignment option is chosen (max 30 words)",
    "affectedAgents": ["Priority Coach", "Finance Analyst", etc.]
  }
}

RULES:
- Maximum 3 tensions, grounded in real signals only
- Tradeoffs must be stated neutrally, no judgment
- Maximum 3 alignment options, mutually exclusive where possible
- Options are not instructions, they are choices
- If no clear tension exists, return empty tensions array
- Be specific to THIS business, not generic advice`;

    const result = await callOpenAIJSON(prompt, {
      maxTokens: 1200,
      temperature: 0.4,
    });

    if (result.data) {
      if (result.data.tensions && Array.isArray(result.data.tensions)) {
        tensions = result.data.tensions.slice(0, 3);
      }
      if (result.data.tradeoff) {
        tradeoff = {
          statement: result.data.tradeoff.statement || tradeoff.statement,
          prioritizing: result.data.tradeoff.prioritizing || null,
          deprioritizing: result.data.tradeoff.deprioritizing || null,
          isAmbiguous: result.data.tradeoff.isAmbiguous ?? true,
        };
      }
      if (result.data.alignmentOptions && Array.isArray(result.data.alignmentOptions)) {
        alignmentOptions = result.data.alignmentOptions.slice(0, 3);
      }
      if (result.data.implications) {
        implications = {
          description: result.data.implications.description || implications.description,
          affectedAgents: result.data.implications.affectedAgents || [],
        };
      }
    }

    generationTimeMs = result.generationTimeMs;
  }

  // Build response
  const response = {
    // Zone 1: Strategic Coherence (Hero)
    coherence,

    // Zone 2: Cross Signal Summary
    crossSignals,

    // Zone 3: Strategic Tensions
    tensions,

    // Zone 4: Tradeoff Clarification
    tradeoff,

    // Zone 5: Alignment Options
    alignmentOptions,

    // Zone 6: Implications
    implications,

    // Metadata
    hasData: hasSignificantData,
    generatedAt: new Date().toISOString(),
  };

  // Cache the response
  await setCache(userId, 'strategic-integration', inputHash, response, generationTimeMs, workspaceId);

  console.log('[Strategic Integrator] Response coherence:', response.coherence.state);
  console.log('[Strategic Integrator] Tensions found:', tensions.length);

  return { ...response, fromCache: false, generationTimeMs };
}

module.exports = {
  getStrategicIntegration,
};
