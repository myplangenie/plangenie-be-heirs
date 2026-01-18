/**
 * Financial Validation Agent
 * Analyzes financial data and flags numbers that are unrealistic or inconsistent.
 * Uses v2 data: FinancialBaseline + RevenueStreams
 *
 * Checks for:
 * - Revenue vs cost ratios
 * - Margin consistency
 * - Cash flow sustainability
 * - Industry benchmarks
 */

const {
  hashInput,
  getFromCache,
  setCache,
  buildAgentContext,
  callOpenAIJSON,
  formatContextForPrompt,
} = require('./base');

// Industry benchmark ranges (can be expanded)
const BENCHMARKS = {
  default: {
    grossMarginMin: 20,
    grossMarginMax: 80,
    burnMultipleMax: 3,
  },
  saas: {
    grossMarginMin: 60,
    grossMarginMax: 90,
  },
  retail: {
    grossMarginMin: 20,
    grossMarginMax: 50,
  },
  services: {
    grossMarginMin: 40,
    grossMarginMax: 70,
  },
};

/**
 * Run basic validation rules using v2 data (FinancialBaseline + RevenueStreams)
 */
function runBasicValidation(context) {
  const warnings = [];
  const errors = [];
  const suggestions = [];

  const baseline = context.financialBaseline;
  const revenueStreams = context.revenueStreams || [];
  const revenueAggregate = context.revenueAggregate;

  // Extract metrics from v2 data
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

  // Get industry benchmarks
  const industry = (context.industry || '').toLowerCase();
  const benchmarks = BENCHMARKS[industry] || BENCHMARKS.default;

  // Validation checks
  if (monthlyRevenue > 0 && monthlyCosts > 0) {
    // Check if costs exceed revenue significantly
    if (monthlyCosts > monthlyRevenue * 2) {
      errors.push({
        type: 'high_burn',
        field: 'costs',
        message: 'Monthly costs are more than 2x your revenue',
        severity: 'error',
        suggestion: 'Review your cost structure or revenue projections',
      });
    }

    // Check gross margin
    if (grossMargin < benchmarks.grossMarginMin) {
      warnings.push({
        type: 'low_margin',
        field: 'grossMargin',
        message: `Gross margin (${grossMargin.toFixed(1)}%) is below typical ${industry || 'industry'} range (${benchmarks.grossMarginMin}%+)`,
        severity: 'warning',
        suggestion: 'Consider increasing prices or reducing delivery costs',
      });
    }

    // Check for negative margins
    if (netMargin < -50) {
      errors.push({
        type: 'negative_margin',
        field: 'netMargin',
        message: `Net margin is severely negative (${netMargin.toFixed(1)}%)`,
        severity: 'error',
        suggestion: 'Your business model may not be sustainable at current projections',
      });
    }
  }

  // Runway checks
  if (runway !== null && runway < 6 && monthlyBurn > 0) {
    errors.push({
      type: 'low_runway',
      field: 'runway',
      message: `Cash runway is only ${runway} months`,
      severity: 'error',
      suggestion: 'You may need additional funding or cost reductions',
    });
  }

  // Missing data checks
  if (monthlyRevenue === 0 && revenueStreams.length === 0) {
    suggestions.push({
      type: 'missing_revenue',
      field: 'revenue',
      message: 'No revenue data entered',
      severity: 'info',
      suggestion: 'Add your products/services with pricing to get better financial insights',
    });
  }

  if (monthlyCosts === 0) {
    suggestions.push({
      type: 'missing_costs',
      field: 'costs',
      message: 'No operating costs entered',
      severity: 'info',
      suggestion: 'Add your work-related and fixed costs for more accurate projections',
    });
  }

  // Revenue stream margin checks
  if (revenueStreams.length > 0) {
    const negativeMarginStreams = revenueStreams.filter(s => {
      const margin = s.metrics?.grossMarginPercent || 0;
      return margin < 0;
    });

    if (negativeMarginStreams.length > 0) {
      errors.push({
        type: 'negative_stream_margin',
        field: 'revenueStreams',
        message: `${negativeMarginStreams.length} product(s)/service(s) have negative margins`,
        severity: 'error',
        suggestion: 'Review pricing - delivery costs exceed revenue for some offerings',
      });
    }

    // Check for low margin streams
    const lowMarginStreams = revenueStreams.filter(s => {
      const margin = s.metrics?.grossMarginPercent || 0;
      return margin > 0 && margin < 20;
    });

    if (lowMarginStreams.length > 0) {
      warnings.push({
        type: 'low_stream_margin',
        field: 'revenueStreams',
        message: `${lowMarginStreams.length} product(s)/service(s) have margins below 20%`,
        severity: 'warning',
        suggestion: 'Consider if these offerings are worth the effort at current margins',
      });
    }
  }

  return {
    errors,
    warnings,
    suggestions,
    metrics: {
      monthlyRevenue,
      monthlyCosts,
      deliveryCost,
      workCosts,
      fixedCosts,
      grossMargin: grossMargin.toFixed(1),
      netMargin: netMargin.toFixed(1),
      monthlyBurn,
      runway,
      currentCash,
      expectedFunding,
      streamCount: revenueStreams.length,
    },
  };
}

/**
 * Generate comprehensive financial validation using v2 data
 * @param {string} userId - User ID
 * @param {Object} options - Optional parameters (workspaceId, forceRefresh)
 * @returns {Object} Validation results with errors, warnings, and suggestions
 */
async function validateFinancials(userId, options = {}) {
  const { forceRefresh = false, workspaceId = null } = options;

  // Build context (includes v2 data)
  const context = await buildAgentContext(userId, workspaceId);

  const financialBaseline = context.financialBaseline;
  const revenueStreams = context.revenueStreams || [];
  const revenueAggregate = context.revenueAggregate;

  // Create cache key from v2 data
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
      return { ...cached, fromCache: true };
    }
  }

  // Run basic validation
  const basicValidation = runBasicValidation(context);

  // If there are significant issues, get AI analysis
  let aiAnalysis = null;
  let generationTimeMs = 0;

  // Check if we have any v2 data
  const hasData = (revenueAggregate?.totalMonthlyRevenue > 0) ||
    (financialBaseline?.workRelatedCosts?.total > 0) ||
    (financialBaseline?.fixedCosts?.total > 0) ||
    (financialBaseline?.cash?.currentBalance > 0) ||
    revenueStreams.length > 0;

  const hasIssues = basicValidation.errors.length > 0 || basicValidation.warnings.length > 0;

  if (hasData && (hasIssues || forceRefresh)) {
    const contextStr = formatContextForPrompt(context);

    const financialDataSection = `FINANCIAL DATA:
Revenue:
- Monthly Revenue: $${revenueAggregate?.totalMonthlyRevenue?.toLocaleString() || 0}
- Monthly Delivery Cost: $${revenueAggregate?.totalMonthlyDeliveryCost?.toLocaleString() || 0}
- Gross Margin: ${revenueAggregate?.grossMarginPercent?.toFixed(1) || 0}%
- Revenue Streams: ${revenueStreams.length}

Costs:
- Work-Related Costs: $${financialBaseline?.workRelatedCosts?.total?.toLocaleString() || 0}/month
- Fixed Costs: $${financialBaseline?.fixedCosts?.total?.toLocaleString() || 0}/month
- Total Monthly Costs: $${basicValidation.metrics.monthlyCosts?.toLocaleString() || 0}

Cash Position:
- Current Balance: $${financialBaseline?.cash?.currentBalance?.toLocaleString() || 0}
- Expected Funding: $${financialBaseline?.cash?.expectedFunding?.toLocaleString() || 0}
- Cash Runway: ${financialBaseline?.metrics?.cashRunwayMonths || 'N/A'} months
- Break-even Revenue: $${financialBaseline?.metrics?.breakEvenRevenue?.toLocaleString() || 0}

PRODUCTS/SERVICES:
${revenueStreams.slice(0, 5).map(s => `- ${s.name} (${s.type}): $${s.metrics?.estimatedMonthlyRevenue?.toLocaleString() || 0}/mo, ${s.metrics?.grossMarginPercent?.toFixed(0) || 0}% margin`).join('\n') || 'No products/services added yet'}`;

    const prompt = `You are a financial analyst reviewing a business plan's financial projections.

${contextStr}

${financialDataSection}

CALCULATED METRICS:
${JSON.stringify(basicValidation.metrics, null, 2)}

ISSUES FOUND:
Errors: ${JSON.stringify(basicValidation.errors)}
Warnings: ${JSON.stringify(basicValidation.warnings)}

Analyze these financials and provide:
1. Are the numbers realistic for this industry and business stage?
2. Are there any inconsistencies between different financial figures?
3. What specific improvements would you recommend?

IMPORTANT TONE GUIDELINES:
- Be direct and specific - cite actual numbers
- Positives must reference specific metrics (e.g., "40% gross margin is solid for retail") not generic praise
- Recommendations must be actionable with specific targets where possible
- Avoid vague language like "looks good" or "seems reasonable"

Respond in JSON format:
{
  "overallAssessment": "healthy|concerning|critical",
  "realism": {
    "score": 1-10,
    "explanation": "Brief explanation citing specific numbers that support this score"
  },
  "consistencyIssues": [
    {"issue": "Specific inconsistency with numbers", "recommendation": "Concrete fix with target values"}
  ],
  "topRecommendations": [
    "Specific actionable recommendation with target numbers",
    "Another specific recommendation"
  ],
  "positives": ["Specific positive citing actual metrics from their data"]
}`;

    const result = await callOpenAIJSON(prompt, {
      maxTokens: 800,
      temperature: 0.4,
    });

    aiAnalysis = result.data;
    generationTimeMs = result.generationTimeMs;
  }

  // Build response
  const response = {
    status: basicValidation.errors.length > 0 ? 'critical' :
      basicValidation.warnings.length > 0 ? 'warning' : 'healthy',
    errors: basicValidation.errors,
    warnings: basicValidation.warnings,
    suggestions: basicValidation.suggestions,
    metrics: basicValidation.metrics,
    aiAnalysis: aiAnalysis || {
      overallAssessment: basicValidation.errors.length > 0 ? 'concerning' : 'healthy',
      realism: { score: hasData ? 7 : 0, explanation: hasData ? 'Numbers appear reasonable' : 'No financial data entered yet' },
      consistencyIssues: [],
      topRecommendations: hasData ? [] : ['Start by adding your products/services in the Financial Forecasting section'],
      positives: [],
    },
    generatedAt: new Date().toISOString(),
  };

  // Cache the response
  await setCache(userId, 'financial-validation', inputHash, response, generationTimeMs, workspaceId);

  return { ...response, fromCache: false, generationTimeMs };
}

module.exports = {
  validateFinancials,
  runBasicValidation,
};
