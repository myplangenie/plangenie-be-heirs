/**
 * Financial Validation Agent (Finance Analyst)
 *
 * Tile-based UI Structure:
 * - Zone 1: Financial State (Hero status tile)
 * - Zone 2: Core Financial Signals (3 metric tiles)
 * - Zone 3: Financial Drivers & Diagnosis (cost + revenue diagnostics)
 * - Zone 4: Time and Risk Exposure
 * - Zone 5: Financial Options and Levers
 *
 * Purpose: Establish financial truth, consequence, and options.
 * Never prioritizes work - only informs decisions.
 */

const {
  hashInput,
  getFromCache,
  setCache,
  buildAgentContext,
  callOpenAIJSON,
  formatContextForPrompt,
} = require('./base');

// Industry benchmark ranges
const BENCHMARKS = {
  default: {
    grossMarginMin: 20,
    grossMarginMax: 80,
    grossMarginTarget: 50,
    netMarginTarget: 15,
    runwayMinMonths: 6,
  },
  saas: {
    grossMarginMin: 60,
    grossMarginMax: 90,
    grossMarginTarget: 75,
    netMarginTarget: 20,
  },
  retail: {
    grossMarginMin: 20,
    grossMarginMax: 50,
    grossMarginTarget: 35,
    netMarginTarget: 10,
  },
  services: {
    grossMarginMin: 40,
    grossMarginMax: 70,
    grossMarginTarget: 55,
    netMarginTarget: 15,
  },
};

/**
 * Compute financial metrics from v2 data
 */
function computeMetrics(context) {
  const baseline = context.financialBaseline;
  const revenueStreams = context.revenueStreams || [];
  const revenueAggregate = context.revenueAggregate;

  const monthlyRevenue = baseline?.revenue?.totalMonthlyRevenue || revenueAggregate?.totalMonthlyRevenue || 0;
  const deliveryCost = baseline?.revenue?.totalMonthlyDeliveryCost || revenueAggregate?.totalMonthlyDeliveryCost || 0;
  const workCosts = baseline?.workRelatedCosts?.total || 0;
  const fixedCosts = baseline?.fixedCosts?.total || 0;
  const monthlyCosts = deliveryCost + workCosts + fixedCosts;

  const grossMargin = revenueAggregate?.grossMarginPercent ||
    (monthlyRevenue > 0 ? ((monthlyRevenue - deliveryCost) / monthlyRevenue) * 100 : 0);
  const netMargin = monthlyRevenue > 0 ? ((monthlyRevenue - monthlyCosts) / monthlyRevenue) * 100 : 0;

  const currentCash = baseline?.cash?.currentBalance || 0;
  const expectedFunding = baseline?.cash?.expectedFunding || 0;
  const monthlyBurn = Math.max(0, monthlyCosts - monthlyRevenue);
  const runway = baseline?.metrics?.cashRunwayMonths ||
    (monthlyBurn > 0 ? Math.round((currentCash + expectedFunding) / monthlyBurn) : null);

  const industry = (context.industry || '').toLowerCase();
  const benchmarks = BENCHMARKS[industry] || BENCHMARKS.default;

  return {
    monthlyRevenue,
    monthlyCosts,
    deliveryCost,
    workCosts,
    fixedCosts,
    grossMargin: parseFloat(grossMargin.toFixed(1)),
    netMargin: parseFloat(netMargin.toFixed(1)),
    monthlyBurn,
    runway,
    currentCash,
    expectedFunding,
    streamCount: revenueStreams.length,
    benchmarks,
  };
}

/**
 * Determine financial health status
 */
function determineFinancialState(metrics) {
  const { grossMargin, netMargin, runway, monthlyBurn, monthlyRevenue, monthlyCosts, benchmarks } = metrics;

  // Critical conditions
  if (runway !== null && runway < 3 && monthlyBurn > 0) {
    return {
      status: 'critical',
      supportingSentence: `Cash runway of ${runway} months requires immediate action to extend sustainability.`,
    };
  }

  if (netMargin < -100) {
    return {
      status: 'critical',
      supportingSentence: 'Current costs significantly exceed revenue, creating immediate sustainability risk.',
    };
  }

  if (monthlyCosts > monthlyRevenue * 2 && monthlyRevenue > 0) {
    return {
      status: 'critical',
      supportingSentence: 'Monthly costs are more than double revenue, indicating an unsustainable cost structure.',
    };
  }

  // Watch conditions
  if (runway !== null && runway < 6 && monthlyBurn > 0) {
    return {
      status: 'watch',
      supportingSentence: `${runway} months of runway provides limited time to achieve profitability or secure funding.`,
    };
  }

  if (netMargin < 0) {
    return {
      status: 'watch',
      supportingSentence: 'Operating at a loss - revenue growth or cost reduction needed to reach profitability.',
    };
  }

  if (grossMargin < benchmarks.grossMarginMin) {
    return {
      status: 'watch',
      supportingSentence: `Gross margin of ${grossMargin}% is below industry minimum, limiting reinvestment capacity.`,
    };
  }

  // Stable
  if (monthlyRevenue === 0 && monthlyCosts === 0) {
    return {
      status: 'stable',
      supportingSentence: 'Add financial data to receive a comprehensive health assessment.',
    };
  }

  if (netMargin >= 10) {
    return {
      status: 'stable',
      supportingSentence: `Net margin of ${netMargin}% indicates healthy profitability with room for growth investment.`,
    };
  }

  return {
    status: 'stable',
    supportingSentence: 'Financial position is sustainable with current revenue and cost structure.',
  };
}

/**
 * Generate core financial signals with context
 */
function generateCoreSignals(metrics) {
  const { grossMargin, netMargin, runway, benchmarks, monthlyBurn, monthlyRevenue } = metrics;

  return {
    grossMargin: {
      value: `${grossMargin}%`,
      context: grossMargin >= benchmarks.grossMarginTarget
        ? `Above target of ${benchmarks.grossMarginTarget}%`
        : grossMargin >= benchmarks.grossMarginMin
          ? `Within range, target is ${benchmarks.grossMarginTarget}%`
          : `Below minimum of ${benchmarks.grossMarginMin}%`,
      status: grossMargin >= benchmarks.grossMarginTarget ? 'good' : grossMargin >= benchmarks.grossMarginMin ? 'neutral' : 'warning',
    },
    netMargin: {
      value: `${netMargin}%`,
      context: netMargin >= benchmarks.netMarginTarget
        ? `Exceeds target of ${benchmarks.netMarginTarget}%`
        : netMargin >= 0
          ? `Positive but below ${benchmarks.netMarginTarget}% target`
          : 'Operating at a loss',
      status: netMargin >= benchmarks.netMarginTarget ? 'good' : netMargin >= 0 ? 'neutral' : 'warning',
    },
    cashRunway: {
      value: runway !== null ? `${runway} months` : monthlyRevenue > 0 ? 'Profitable' : 'N/A',
      context: runway === null
        ? (monthlyBurn <= 0 ? 'Not burning cash' : 'Unable to calculate')
        : runway >= 12
          ? 'Comfortable runway'
          : runway >= 6
            ? 'Adequate runway'
            : 'Runway needs attention',
      status: runway === null ? (monthlyBurn <= 0 ? 'good' : 'neutral') : runway >= 12 ? 'good' : runway >= 6 ? 'neutral' : 'warning',
    },
  };
}

/**
 * Generate comprehensive financial validation using tile-based structure
 */
async function validateFinancials(userId, options = {}) {
  const { forceRefresh = false, workspaceId = null } = options;

  // Build context
  const context = await buildAgentContext(userId, workspaceId);

  const financialBaseline = context.financialBaseline;
  const revenueStreams = context.revenueStreams || [];
  const revenueAggregate = context.revenueAggregate;

  // Create cache key
  const inputHash = hashInput({
    baseline: financialBaseline ? {
      revenue: financialBaseline.revenue,
      workRelatedCosts: financialBaseline.workRelatedCosts,
      fixedCosts: financialBaseline.fixedCosts,
      cash: financialBaseline.cash,
      metrics: financialBaseline.metrics,
    } : null,
    revenueAggregate,
    streamCount: revenueStreams.length,
    streamIds: revenueStreams.map(s => s._id?.toString()),
  });

  // Check cache
  if (!forceRefresh) {
    const cached = await getFromCache(userId, 'financial-validation', inputHash, workspaceId);
    if (cached) {
      console.log('[Financial Agent] Returning CACHED response');
      return { ...cached, fromCache: true };
    }
  }
  console.log('[Financial Agent] Generating FRESH response (no cache hit)');

  // Compute metrics
  const metrics = computeMetrics(context);

  // Check if we have data
  const hasData = (revenueAggregate?.totalMonthlyRevenue > 0) ||
    (financialBaseline?.workRelatedCosts?.total > 0) ||
    (financialBaseline?.fixedCosts?.total > 0) ||
    (financialBaseline?.cash?.currentBalance > 0) ||
    revenueStreams.length > 0;

  console.log('[Financial Agent] Data check:');
  console.log('  - revenueAggregate:', revenueAggregate);
  console.log('  - financialBaseline exists:', !!financialBaseline);
  console.log('  - revenueStreams.length:', revenueStreams.length);
  console.log('  - hasData:', hasData);

  // Zone 1: Financial State
  const financialState = determineFinancialState(metrics);

  // Zone 2: Core Financial Signals
  const coreSignals = generateCoreSignals(metrics);

  // Default zones (will be enhanced by AI)
  let costDiagnostic = {
    explanation: 'Add cost data to see how your expenses relate to revenue.',
    keyDrivers: [],
  };

  let revenueDiagnostic = {
    explanation: 'Add revenue streams to analyze revenue quality.',
    concentration: null,
    pricingEffectiveness: null,
  };

  let timeRisk = {
    runwayInTime: metrics.runway !== null ? `${metrics.runway} months` : 'Not applicable',
    consequenceIfNoAction: 'Add financial data to see time-based projections.',
    escalationThresholds: [],
  };

  let financialOptions = [];

  // Get AI analysis if we have data
  let generationTimeMs = 0;

  if (hasData) {
    const contextStr = formatContextForPrompt(context);

    const financialDataSection = `FINANCIAL DATA:
Revenue: $${metrics.monthlyRevenue.toLocaleString()}/month
Delivery Cost: $${metrics.deliveryCost.toLocaleString()}/month
Work Costs: $${metrics.workCosts.toLocaleString()}/month
Fixed Costs: $${metrics.fixedCosts.toLocaleString()}/month
Total Costs: $${metrics.monthlyCosts.toLocaleString()}/month
Gross Margin: ${metrics.grossMargin}%
Net Margin: ${metrics.netMargin}%
Monthly Burn: $${metrics.monthlyBurn.toLocaleString()}
Current Cash: $${metrics.currentCash.toLocaleString()}
Cash Runway: ${metrics.runway || 'N/A'} months
Revenue Streams: ${revenueStreams.length}

PRODUCTS/SERVICES:
${revenueStreams.slice(0, 5).map(s => `- ${s.name}: $${s.metrics?.estimatedMonthlyRevenue?.toLocaleString() || 0}/mo, ${s.metrics?.grossMarginPercent?.toFixed(0) || 0}% margin`).join('\n') || 'None added'}`;

    const prompt = `You are a Finance Analyst. Analyze the financial data and provide structured insights.

${contextStr}

${financialDataSection}

Respond in JSON with these sections:

{
  "costDiagnostic": {
    "explanation": "Plain language explanation of cost-to-revenue relationship (max 40 words)",
    "keyDrivers": ["Cost category 1 driving imbalance", "Cost category 2"]
  },
  "revenueDiagnostic": {
    "explanation": "Revenue stability and scalability assessment (max 40 words)",
    "concentration": "High/Medium/Low - explanation of customer/product concentration",
    "pricingEffectiveness": "Assessment of pricing relative to value and margins"
  },
  "timeRisk": {
    "consequenceIfNoAction": "What happens in X months if nothing changes (specific, max 30 words)",
    "escalationThresholds": ["Threshold 1 that triggers concern", "Threshold 2"]
  },
  "financialOptions": [
    {
      "action": "Specific action to take",
      "quantifiedImpact": "+$X/month or X% improvement",
      "timeToEffect": "X weeks/months",
      "riskNote": "Key assumption or risk"
    }
  ]
}

RULES:
- Be factual, not fear-based
- All numbers must come from the data provided
- Options must be realistic and ranked by impact
- Maximum 3 options
- No generic advice - be specific to this business`;

    const result = await callOpenAIJSON(prompt, {
      maxTokens: 1000,
      temperature: 0.4,
    });

    if (result.data) {
      if (result.data.costDiagnostic) {
        costDiagnostic = result.data.costDiagnostic;
      }
      if (result.data.revenueDiagnostic) {
        revenueDiagnostic = result.data.revenueDiagnostic;
      }
      if (result.data.timeRisk) {
        timeRisk = {
          runwayInTime: metrics.runway !== null ? `${metrics.runway} months` : 'Not burning cash',
          consequenceIfNoAction: result.data.timeRisk.consequenceIfNoAction || timeRisk.consequenceIfNoAction,
          escalationThresholds: result.data.timeRisk.escalationThresholds || [],
        };
      }
      if (result.data.financialOptions && Array.isArray(result.data.financialOptions)) {
        financialOptions = result.data.financialOptions.slice(0, 3);
      }
    }

    generationTimeMs = result.generationTimeMs;
  }

  // Build response with tile structure
  const response = {
    // Zone 1: Financial State (Hero)
    financialState,

    // Zone 2: Core Financial Signals
    coreSignals,

    // Zone 3: Financial Drivers & Diagnosis
    costDiagnostic,
    revenueDiagnostic,

    // Zone 4: Time and Risk
    timeRisk,

    // Zone 5: Financial Options
    financialOptions,

    // Metadata
    metrics: {
      monthlyRevenue: metrics.monthlyRevenue,
      monthlyCosts: metrics.monthlyCosts,
      grossMargin: metrics.grossMargin,
      netMargin: metrics.netMargin,
      monthlyBurn: metrics.monthlyBurn,
      runway: metrics.runway,
    },

    hasData,
    generatedAt: new Date().toISOString(),
  };

  // Cache the response
  await setCache(userId, 'financial-validation', inputHash, response, generationTimeMs, workspaceId);

  console.log('[Financial Agent] Response coreSignals:', JSON.stringify(response.coreSignals));
  console.log('[Financial Agent] Response hasData:', response.hasData);

  return { ...response, fromCache: false, generationTimeMs };
}

module.exports = {
  validateFinancials,
  computeMetrics,
};
