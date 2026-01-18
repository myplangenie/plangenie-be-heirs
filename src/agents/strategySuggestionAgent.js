/**
 * Strategy Suggestion Agent
 * Recommends business models, positioning tweaks, and strategic improvements.
 * Uses v2 data: RevenueStreams + FinancialBaseline
 *
 * Analyzes:
 * - Current business model
 * - Market positioning
 * - Competitive landscape
 * - Growth opportunities
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
 * Assess current strategy completeness and quality using v2 data
 */
function assessStrategyCompleteness(context) {
  const scores = {
    vision: 0,
    positioning: 0,
    market: 0,
    competitive: 0,
    product: 0,
    financial: 0,
  };

  // Vision & Purpose (0-20)
  if (context.ubp) scores.vision += 8;
  if (context.purpose) scores.vision += 4;
  if (context.vision1y) scores.vision += 4;
  if (context.vision3y) scores.vision += 4;

  // Positioning (0-20)
  if (context.ubp && context.ubp.length > 50) scores.positioning += 10;
  if (context.competitorAdvantages) scores.positioning += 10;

  // Market Understanding (0-20)
  if (context.marketCustomer) scores.market += 8;
  if (context.marketPartners) scores.market += 4;
  if (context.swot?.opportunities) scores.market += 4;
  if (context.swot?.threats) scores.market += 4;

  // Competitive Analysis (0-15)
  if (context.marketCompetitors) scores.competitive += 10;
  if (context.swot?.strengths) scores.competitive += 2.5;
  if (context.swot?.weaknesses) scores.competitive += 2.5;

  // Product Strategy - v2 RevenueStreams (0-15)
  const streams = context.revenueStreams || [];
  if (streams.length > 0) scores.product += 8;
  if (streams.length > 2) scores.product += 4;
  if (streams.some(s => s.metrics?.grossMarginPercent > 0)) scores.product += 3;

  // Financial Health - v2 FinancialBaseline (0-10)
  const baseline = context.financialBaseline;
  const revenueAggregate = context.revenueAggregate;
  if (revenueAggregate?.totalMonthlyRevenue > 0) scores.financial += 4;
  if (baseline?.workRelatedCosts?.total > 0 || baseline?.fixedCosts?.total > 0) scores.financial += 3;
  if (baseline?.cash?.currentBalance > 0) scores.financial += 3;

  const total = Object.values(scores).reduce((a, b) => a + b, 0);

  return {
    total: Math.round(total),
    breakdown: scores,
    gaps: Object.entries(scores)
      .filter(([_, score]) => score < 8)
      .map(([area]) => area),
  };
}

/**
 * Generate strategy suggestions using v2 data
 * @param {string} userId - User ID
 * @param {Object} options - Optional parameters (workspaceId, forceRefresh, focusArea)
 * @returns {Object} Strategy suggestions and recommendations
 */
async function generateStrategySuggestions(userId, options = {}) {
  const { forceRefresh = false, focusArea = null, workspaceId = null } = options;

  // Build context (includes v2 data)
  const context = await buildAgentContext(userId, workspaceId);

  const streams = context.revenueStreams || [];
  const baseline = context.financialBaseline;
  const revenueAggregate = context.revenueAggregate;

  // Create cache key using v2 data
  const inputHash = hashInput({
    ubp: context.ubp,
    purpose: context.purpose,
    industry: context.industry,
    competitors: context.marketCompetitors,
    streamCount: streams.length,
    hasFinancialBaseline: !!baseline,
    focus: focusArea,
  });

  // Check cache
  if (!forceRefresh) {
    const cached = await getFromCache(userId, 'strategy-suggestion', inputHash, workspaceId);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  // Assess current strategy
  const strategyAssessment = assessStrategyCompleteness(context);

  // Build products/services section from v2 data
  const productsSection = streams.length > 0
    ? `PRODUCTS/SERVICES (${streams.length} offerings):
${streams.slice(0, 5).map(s => `- ${s.name} (${s.type}): $${s.metrics?.estimatedMonthlyRevenue?.toLocaleString() || 0}/mo, ${s.metrics?.grossMarginPercent?.toFixed(0) || 0}% margin`).join('\n')}`
    : 'PRODUCTS/SERVICES: Not yet defined';

  // Build financial section from v2 data
  const financialSection = revenueAggregate || baseline
    ? `FINANCIAL POSITION:
- Monthly Revenue: $${revenueAggregate?.totalMonthlyRevenue?.toLocaleString() || 0}
- Gross Margin: ${revenueAggregate?.grossMarginPercent?.toFixed(1) || 0}%
- Monthly Costs: $${((baseline?.workRelatedCosts?.total || 0) + (baseline?.fixedCosts?.total || 0)).toLocaleString()}
- Cash Position: $${baseline?.cash?.currentBalance?.toLocaleString() || 0}
- Runway: ${baseline?.metrics?.cashRunwayMonths || 'N/A'} months`
    : 'FINANCIAL POSITION: Not yet defined';

  // Build comprehensive prompt
  const contextStr = formatContextForPrompt(context);
  const prompt = `You are a strategic business consultant analyzing a company's business strategy.

${contextStr}

${productsSection}

${financialSection}

SWOT ANALYSIS:
- Strengths: ${context.swot?.strengths || 'Not defined'}
- Weaknesses: ${context.swot?.weaknesses || 'Not defined'}
- Opportunities: ${context.swot?.opportunities || 'Not defined'}
- Threats: ${context.swot?.threats || 'Not defined'}

CURRENT STRATEGY SCORE: ${strategyAssessment.total}/100
GAPS IDENTIFIED: ${strategyAssessment.gaps.join(', ') || 'None'}

${focusArea ? `USER WANTS FOCUS ON: ${focusArea}` : ''}

Based on this information, provide strategic recommendations. Consider:
1. Business model improvements or pivots
2. Market positioning enhancements
3. Competitive differentiation strategies
4. Growth opportunities
5. Risk mitigation strategies

IMPORTANT TONE GUIDELINES:
- Be direct and specific to THIS business - no generic advice
- Reference their actual industry, competitors, or products by name when possible
- Quick wins must be truly actionable this week, not vague suggestions
- Risk alerts must cite specific vulnerabilities from their data
- Avoid consultant-speak like "leverage synergies" - be concrete

Respond in JSON format:
{
  "strategicDirection": {
    "currentAssessment": "Brief assessment of current strategy (1-2 sentences)",
    "recommendedFocus": "The #1 strategic priority to focus on"
  },
  "businessModelSuggestions": [
    {
      "suggestion": "Specific business model improvement",
      "rationale": "Why this would help",
      "effort": "low|medium|high",
      "impact": "low|medium|high"
    }
  ],
  "positioningTweaks": [
    {
      "current": "What they're doing now (or not doing)",
      "suggested": "What they should do instead",
      "benefit": "Expected benefit"
    }
  ],
  "competitiveStrategies": [
    {
      "strategy": "Specific competitive strategy",
      "targetCompetitor": "Who this addresses (or 'market' for general)",
      "implementation": "How to implement"
    }
  ],
  "growthOpportunities": [
    {
      "opportunity": "Specific growth opportunity",
      "requirements": "What's needed to pursue this",
      "timeline": "short-term|medium-term|long-term"
    }
  ],
  "quickWins": [
    "Easy improvement #1 that can be done this week",
    "Easy improvement #2"
  ],
  "riskAlerts": [
    "Strategic risk or concern to address"
  ]
}`;

  const { data, generationTimeMs, error } = await callOpenAIJSON(prompt, {
    maxTokens: 1500,
    temperature: 0.7,
    systemPrompt: 'You are a seasoned business strategist with expertise in helping startups and small businesses refine their strategy. Be specific and actionable in your recommendations.',
  });

  // Build response
  const response = {
    strategyScore: strategyAssessment.total,
    strategyBreakdown: strategyAssessment.breakdown,
    gaps: strategyAssessment.gaps,
    suggestions: data || {
      strategicDirection: {
        currentAssessment: 'Unable to generate assessment. Please ensure your business profile is complete.',
        recommendedFocus: 'Complete your business plan sections',
      },
      businessModelSuggestions: [],
      positioningTweaks: [],
      competitiveStrategies: [],
      growthOpportunities: [],
      quickWins: ['Fill in missing business plan sections', 'Define your unique value proposition'],
      riskAlerts: [],
    },
    focusArea,
    generatedAt: new Date().toISOString(),
  };

  // Cache the response
  await setCache(userId, 'strategy-suggestion', inputHash, response, generationTimeMs, workspaceId);

  return { ...response, fromCache: false, generationTimeMs };
}

/**
 * Get suggestions for a specific strategy area
 */
async function getSuggestionsByArea(userId, area) {
  return generateStrategySuggestions(userId, { focusArea: area, forceRefresh: true });
}

module.exports = {
  generateStrategySuggestions,
  getSuggestionsByArea,
  assessStrategyCompleteness,
};
