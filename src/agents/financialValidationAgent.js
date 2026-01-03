/**
 * Financial Validation Agent
 * Analyzes financial data and flags numbers that are unrealistic or inconsistent.
 *
 * Checks for:
 * - Revenue vs cost ratios
 * - Growth rate realism
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
    growthRateMax: 200, // 200% YoY is very aggressive
    burnMultipleMax: 3, // Burn rate vs growth
  },
  saas: {
    grossMarginMin: 60,
    grossMarginMax: 90,
    growthRateMax: 300,
  },
  retail: {
    grossMarginMin: 20,
    grossMarginMax: 50,
    growthRateMax: 100,
  },
  services: {
    grossMarginMin: 40,
    grossMarginMax: 70,
    growthRateMax: 100,
  },
};

/**
 * Parse a number from various formats
 */
function parseNumber(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const str = String(val).replace(/[^0-9.\-]/g, '');
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Run basic validation rules (no AI needed)
 */
function runBasicValidation(financial, products, context) {
  const warnings = [];
  const errors = [];
  const suggestions = [];

  // Extract financial metrics
  const monthlyRevenue = parseNumber(financial.salesVolume) * parseNumber(financial.avgPrice || products?.[0]?.price || 0);
  const monthlyCosts = parseNumber(financial.fixedOperatingCosts) +
    parseNumber(financial.marketingSalesSpend) +
    parseNumber(financial.payrollCost) +
    parseNumber(financial.avgUnitCost) * parseNumber(financial.salesVolume);
  const growthRate = parseNumber(financial.salesGrowthPct);
  const startingCash = parseNumber(financial.startingCash);
  const additionalFunding = parseNumber(financial.additionalFundingAmount);

  const grossMargin = monthlyRevenue > 0
    ? ((monthlyRevenue - (parseNumber(financial.avgUnitCost) * parseNumber(financial.salesVolume))) / monthlyRevenue) * 100
    : 0;

  const netMargin = monthlyRevenue > 0
    ? ((monthlyRevenue - monthlyCosts) / monthlyRevenue) * 100
    : 0;

  const monthlyBurn = Math.max(0, monthlyCosts - monthlyRevenue);
  const runway = monthlyBurn > 0 ? Math.round((startingCash + additionalFunding) / monthlyBurn) : null;

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
        suggestion: 'Consider increasing prices or reducing unit costs',
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

  // Growth rate checks
  if (growthRate > benchmarks.growthRateMax) {
    warnings.push({
      type: 'high_growth',
      field: 'salesGrowthPct',
      message: `Growth rate of ${growthRate}% is very aggressive`,
      severity: 'warning',
      suggestion: 'Consider if this growth rate is achievable with your resources',
    });
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
  if (!financial.salesVolume && !financial.monthlyRevenue) {
    suggestions.push({
      type: 'missing_revenue',
      field: 'salesVolume',
      message: 'No revenue projections entered',
      severity: 'info',
      suggestion: 'Add your expected sales volume to get better financial insights',
    });
  }

  if (!financial.fixedOperatingCosts && !financial.payrollCost) {
    suggestions.push({
      type: 'missing_costs',
      field: 'costs',
      message: 'No operating costs entered',
      severity: 'info',
      suggestion: 'Add your expected costs for more accurate projections',
    });
  }

  // Product pricing consistency
  if (products && products.length > 0) {
    const prices = products.map(p => parseNumber(p.price)).filter(p => p > 0);
    const costs = products.map(p => parseNumber(p.unitCost)).filter(c => c > 0);

    if (prices.length > 0 && costs.length > 0) {
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
      const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length;

      if (avgCost >= avgPrice) {
        errors.push({
          type: 'negative_unit_margin',
          field: 'products',
          message: 'Your average unit cost equals or exceeds your average price',
          severity: 'error',
          suggestion: 'Review your pricing strategy - you may be selling at a loss',
        });
      }
    }
  }

  return {
    errors,
    warnings,
    suggestions,
    metrics: {
      monthlyRevenue,
      monthlyCosts,
      grossMargin: grossMargin.toFixed(1),
      netMargin: netMargin.toFixed(1),
      monthlyBurn,
      runway,
      growthRate,
    },
  };
}

/**
 * Generate comprehensive financial validation
 * @param {string} userId - User ID
 * @param {Object} options - Optional parameters (workspaceId, forceRefresh)
 * @returns {Object} Validation results with errors, warnings, and suggestions
 */
async function validateFinancials(userId, options = {}) {
  const { forceRefresh = false, workspaceId = null } = options;

  // Build context
  const context = await buildAgentContext(userId, workspaceId);
  const financial = context.financial || context._rawAnswers?.financial || {};
  const products = context.products || [];

  // Create cache key from financial data
  const inputHash = hashInput({
    financial,
    products: products.map(p => ({ price: p.price, unitCost: p.unitCost })),
  });

  // Check cache
  if (!forceRefresh) {
    const cached = await getFromCache(userId, 'financial-validation', inputHash, workspaceId);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  // Run basic validation
  const basicValidation = runBasicValidation(financial, products, context);

  // If there are significant issues, get AI analysis
  let aiAnalysis = null;
  let generationTimeMs = 0;

  const hasData = Object.values(financial).some(v => v && v !== '0');
  const hasIssues = basicValidation.errors.length > 0 || basicValidation.warnings.length > 0;

  if (hasData && (hasIssues || forceRefresh)) {
    const contextStr = formatContextForPrompt(context);
    const prompt = `You are a financial analyst reviewing a business plan's financial projections.

${contextStr}

FINANCIAL DATA:
${JSON.stringify(financial, null, 2)}

PRODUCTS/SERVICES:
${JSON.stringify(products.slice(0, 5), null, 2)}

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
      topRecommendations: hasData ? [] : ['Start by entering your revenue projections'],
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
