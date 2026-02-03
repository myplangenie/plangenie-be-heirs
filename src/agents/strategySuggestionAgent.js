/**
 * Strategy Suggestion Agent (Growth Strategist)
 *
 * VALUE PROPOSITION:
 * Answers the question: "What's the ONE strategic move I should make right now?"
 *
 * This agent helps users:
 * 1. Identify their highest-leverage growth opportunity
 * 2. Get a concrete 3-step action plan to capture it
 * 3. Understand risks that could derail their strategy
 *
 * KEY PRINCIPLES:
 * - ONE primary focus, not a list of suggestions
 * - Every recommendation has a specific action attached
 * - Connects strategy to existing projects and deliverables
 * - Grounded in their actual data (financials, products, market)
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

  // Build focused prompt - ONE strategic move with clear action plan
  const contextStr = formatContextForPrompt(context);
  const prompt = `You are a Growth Strategist. Your job: Identify THE ONE strategic move this business should make right now and give them a concrete action plan.

${contextStr}

${productsSection}

${financialSection}

SWOT: Strengths: ${context.swot?.strengths || 'N/A'} | Weaknesses: ${context.swot?.weaknesses || 'N/A'} | Opportunities: ${context.swot?.opportunities || 'N/A'} | Threats: ${context.swot?.threats || 'N/A'}

Strategy Foundation: ${strategyAssessment.total}/100 | Gaps: ${strategyAssessment.gaps.join(', ') || 'None'}
${focusArea ? `User asked about: ${focusArea}` : ''}

YOUR TASK:
1. Analyze their situation and identify the SINGLE highest-impact strategic move
2. Create a 3-step action plan they can start THIS WEEK
3. Flag any risks that could derail this strategy

RULES:
- Be SPECIFIC: "Increase prices by 20% on premium tier" not "consider pricing changes"
- Be CONCISE: One sentence per field, no fluff
- Be ACTIONABLE: Every output should answer "What do I DO?"
- Reference their actual data: products, margins, competitors, SWOT

Respond in JSON:
{
  "strategicDirection": {
    "currentAssessment": "One sentence diagnosis of their strategic position",
    "recommendedFocus": "THE single strategic priority (be specific - what exactly to do)"
  },
  "actionPlan": [
    {
      "step": 1,
      "action": "Specific action (verb + object + outcome)",
      "timeline": "This week | This month | This quarter"
    },
    {
      "step": 2,
      "action": "Specific action (verb + object + outcome)",
      "timeline": "This week | This month | This quarter"
    },
    {
      "step": 3,
      "action": "Specific action (verb + object + outcome)",
      "timeline": "This week | This month | This quarter"
    }
  ],
  "growthOpportunities": [
    {
      "opportunity": "Specific growth lever from their data",
      "requirements": "What they need to capture it",
      "timeline": "short-term|medium-term|long-term"
    }
  ],
  "quickWins": [
    "Action completable THIS WEEK (verb + object)"
  ],
  "riskAlerts": [
    "Specific risk + what to do about it"
  ]
}`;

  const { data, generationTimeMs, error } = await callOpenAIJSON(prompt, {
    maxTokens: 1500,
    temperature: 0.7,
    systemPrompt: 'You are a world-class business transformation strategist. Every recommendation must be specific to this business\'s industry, stage, competitive position, and goals. Avoid generic advice - provide insights that demonstrate deep understanding of their unique situation.',
  });

  // Build response with focused action-oriented structure
  const response = {
    strategyScore: strategyAssessment.total,
    strategyBreakdown: strategyAssessment.breakdown,
    gaps: strategyAssessment.gaps,
    suggestions: data || {
      strategicDirection: {
        currentAssessment: strategyAssessment.total < 50
          ? 'Strategy foundation incomplete - need to define core positioning before growth planning.'
          : 'Strategy defined but lacks a clear growth initiative.',
        recommendedFocus: strategyAssessment.gaps.length > 0
          ? `Complete ${strategyAssessment.gaps[0]} section - this is blocking strategic clarity`
          : 'Define your primary growth initiative for the next quarter',
      },
      actionPlan: [
        {
          step: 1,
          action: strategyAssessment.gaps.length > 0
            ? `Fill out the ${strategyAssessment.gaps[0]} section in your business plan`
            : 'Review your top-performing product and identify upsell opportunities',
          timeline: 'This week',
        },
        {
          step: 2,
          action: 'Schedule 30 minutes to define your unique value proposition',
          timeline: 'This week',
        },
        {
          step: 3,
          action: 'List 3 competitors and what makes you different from each',
          timeline: 'This week',
        },
      ],
      growthOpportunities: [],
      quickWins: [
        strategyAssessment.gaps.length > 0
          ? `Complete your ${strategyAssessment.gaps[0]} section today`
          : 'Review pricing on your highest-margin offering',
      ],
      riskAlerts: strategyAssessment.gaps.length > 0
        ? [`Strategy gaps in ${strategyAssessment.gaps.slice(0, 2).join(', ')} - address before scaling`]
        : [],
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
