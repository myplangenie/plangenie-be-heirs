/**
 * Financial Insights Agent
 * Provides intelligent financial analysis and decision support.
 *
 * Capabilities:
 * - Explains cause/effect relationships in financial data
 * - Supports decision-making (e.g., "Can we afford to hire?")
 * - Surfaces important signals and patterns
 * - Analyzes baseline vs scenario comparisons
 */

const {
  hashInput,
  getFromCache,
  setCache,
  buildAgentContext,
  callOpenAIJSON,
  formatContextForPrompt,
} = require('./base');

// Add cache TTL for financial insights
const INSIGHTS_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Calculate key ratios and metrics from financial data
 */
function calculateKeyMetrics(baseline) {
  if (!baseline) return null;

  const revenue = baseline.revenue?.totalMonthlyRevenue || 0;
  const deliveryCost = baseline.revenue?.totalMonthlyDeliveryCost || 0;
  const workCosts = baseline.workRelatedCosts?.total || 0;
  const fixedCosts = baseline.fixedCosts?.total || 0;
  const totalCosts = deliveryCost + workCosts + fixedCosts;
  const netSurplus = baseline.metrics?.monthlyNetSurplus || 0;
  const runway = baseline.metrics?.cashRunwayMonths;
  const breakEven = baseline.metrics?.breakEvenRevenue || 0;
  const currentCash = baseline.cash?.currentBalance || 0;

  // Calculate ratios
  const grossMargin = revenue > 0 ? ((revenue - deliveryCost) / revenue) * 100 : 0;
  const operatingMargin = revenue > 0 ? (netSurplus / revenue) * 100 : 0;
  const fixedCostRatio = totalCosts > 0 ? (fixedCosts / totalCosts) * 100 : 0;
  const variableCostRatio = totalCosts > 0 ? ((deliveryCost + workCosts) / totalCosts) * 100 : 0;
  const revenueToBreakEven = breakEven > 0 && revenue > 0 ? (revenue / breakEven) * 100 : 0;
  const burnRate = netSurplus < 0 ? Math.abs(netSurplus) : 0;

  return {
    revenue,
    deliveryCost,
    workCosts,
    fixedCosts,
    totalCosts,
    netSurplus,
    runway,
    breakEven,
    currentCash,
    grossMargin: Math.round(grossMargin * 10) / 10,
    operatingMargin: Math.round(operatingMargin * 10) / 10,
    fixedCostRatio: Math.round(fixedCostRatio * 10) / 10,
    variableCostRatio: Math.round(variableCostRatio * 10) / 10,
    revenueToBreakEven: Math.round(revenueToBreakEven * 10) / 10,
    burnRate,
    isProfitable: netSurplus >= 0,
    isAboveBreakEven: revenue >= breakEven && breakEven > 0,
  };
}

/**
 * Calculate scenario impact metrics
 */
function calculateScenarioImpact(baseline, scenario) {
  if (!baseline || !scenario) return null;

  const baselineMetrics = calculateKeyMetrics(baseline);
  const scenarioMetrics = scenario.scenarioMetrics || scenario.metrics;

  if (!baselineMetrics || !scenarioMetrics) return null;

  return {
    revenueDelta: scenarioMetrics.revenueDelta || 0,
    revenueDeltaPct: baselineMetrics.revenue > 0
      ? ((scenarioMetrics.revenueDelta || 0) / baselineMetrics.revenue) * 100
      : 0,
    costsDelta: scenarioMetrics.costsDelta || 0,
    costsDeltaPct: baselineMetrics.totalCosts > 0
      ? ((scenarioMetrics.costsDelta || 0) / baselineMetrics.totalCosts) * 100
      : 0,
    surplusDelta: scenarioMetrics.surplusDelta || 0,
    runwayDelta: scenarioMetrics.runwayDelta || 0,
    newSurplus: scenarioMetrics.monthlyNetSurplus,
    newRunway: scenarioMetrics.cashRunwayMonths,
  };
}

/**
 * Generate rule-based insights without AI
 */
function generateRuleBasedInsights(metrics, scenarioImpact = null, levers = null) {
  const insights = [];
  const signals = [];
  const causeEffects = [];

  if (!metrics) return { insights, signals, causeEffects };

  // Profitability insights
  if (metrics.isProfitable) {
    insights.push({
      type: 'positive',
      category: 'profitability',
      title: 'Operating profitably',
      message: `You're generating $${metrics.netSurplus.toLocaleString()} monthly surplus.`,
    });
  } else {
    insights.push({
      type: 'warning',
      category: 'profitability',
      title: 'Operating at a loss',
      message: `You're burning $${Math.abs(metrics.netSurplus).toLocaleString()}/month. At this rate, runway is ${metrics.runway || 'unlimited'} months.`,
    });
  }

  // Runway warnings
  if (metrics.runway !== null && metrics.runway < 6) {
    signals.push({
      type: 'critical',
      title: 'Low runway alert',
      message: `Only ${metrics.runway} months of cash remaining. Consider reducing costs or increasing revenue.`,
      priority: 1,
    });
  } else if (metrics.runway !== null && metrics.runway < 12) {
    signals.push({
      type: 'warning',
      title: 'Runway under 12 months',
      message: `${metrics.runway} months of runway. Plan for funding or profitability within this window.`,
      priority: 2,
    });
  }

  // Cost structure insights
  if (metrics.fixedCostRatio > 70) {
    causeEffects.push({
      cause: 'High fixed costs',
      effect: 'Revenue changes have bigger impact on surplus',
      implication: 'A 10% revenue increase adds more to your bottom line than a 10% cost cut.',
    });
  } else if (metrics.fixedCostRatio < 30) {
    causeEffects.push({
      cause: 'High variable costs',
      effect: 'Growth requires proportional cost increases',
      implication: 'Scaling revenue will also scale your costs significantly.',
    });
  }

  // Break-even analysis
  if (metrics.revenueToBreakEven > 0) {
    if (metrics.revenueToBreakEven < 100) {
      const gap = metrics.breakEven - metrics.revenue;
      insights.push({
        type: 'warning',
        category: 'breakeven',
        title: 'Below break-even',
        message: `Need $${gap.toLocaleString()} more monthly revenue to break even.`,
      });
    } else {
      const buffer = ((metrics.revenueToBreakEven - 100) / 100) * metrics.revenue;
      insights.push({
        type: 'positive',
        category: 'breakeven',
        title: 'Above break-even',
        message: `$${buffer.toLocaleString()} revenue buffer above break-even point.`,
      });
    }
  }

  // Margin analysis
  if (metrics.grossMargin < 30) {
    causeEffects.push({
      cause: 'Low gross margin',
      effect: 'Limited room for operating expenses',
      implication: 'Consider pricing increases or delivery cost reductions.',
    });
  }

  // Scenario-specific insights
  if (scenarioImpact && levers) {
    if (levers.pricingAdjustment !== 0) {
      const pricingEffect = scenarioImpact.revenueDelta;
      causeEffects.push({
        cause: `${levers.pricingAdjustment > 0 ? 'Price increase' : 'Price decrease'} of ${Math.abs(levers.pricingAdjustment)}%`,
        effect: `Revenue ${pricingEffect >= 0 ? 'increases' : 'decreases'} by $${Math.abs(pricingEffect).toLocaleString()}/month`,
        implication: levers.pricingAdjustment > 0
          ? 'Assumes volume stays constant. Test price sensitivity with customers.'
          : 'Lower prices may increase volume. Model that separately.',
      });
    }

    if (levers.volumeAdjustment !== 0) {
      causeEffects.push({
        cause: `Volume ${levers.volumeAdjustment > 0 ? 'increase' : 'decrease'} of ${Math.abs(levers.volumeAdjustment)}%`,
        effect: `Both revenue and variable costs adjust proportionally`,
        implication: 'Ensure you have capacity and delivery resources to handle volume changes.',
      });
    }

    if (scenarioImpact.runwayDelta !== 0) {
      const direction = scenarioImpact.runwayDelta > 0 ? 'extends' : 'shortens';
      insights.push({
        type: scenarioImpact.runwayDelta > 0 ? 'positive' : 'warning',
        category: 'scenario',
        title: `Runway ${direction}`,
        message: `This scenario ${direction} your runway by ${Math.abs(scenarioImpact.runwayDelta)} months.`,
      });
    }
  }

  return { insights, signals, causeEffects };
}

/**
 * Generate AI-powered insights for deeper analysis
 */
async function generateAIInsights(baseline, scenario, context) {
  const metrics = calculateKeyMetrics(baseline);
  const scenarioImpact = scenario ? calculateScenarioImpact(baseline, scenario) : null;
  const levers = scenario?.levers;

  const contextStr = formatContextForPrompt(context);

  const prompt = `You are a financial reasoning engine for a business planning tool. Analyze this financial data and provide actionable insights.

BUSINESS CONTEXT:
${contextStr}

CURRENT FINANCIAL STATE:
- Monthly Revenue: $${metrics?.revenue?.toLocaleString() || 0}
- Monthly Costs: $${metrics?.totalCosts?.toLocaleString() || 0}
- Net Surplus: $${metrics?.netSurplus?.toLocaleString() || 0}
- Gross Margin: ${metrics?.grossMargin || 0}%
- Operating Margin: ${metrics?.operatingMargin || 0}%
- Cash Runway: ${metrics?.runway || 'Infinite'} months
- Break-even Revenue: $${metrics?.breakEven?.toLocaleString() || 0}
- Fixed Cost Ratio: ${metrics?.fixedCostRatio || 0}%

${scenario ? `
SCENARIO BEING ANALYZED:
Name: ${scenario.name || 'Unnamed'}
Levers:
- Pricing: ${levers?.pricingAdjustment || 0}%
- Volume: ${levers?.volumeAdjustment || 0}%
- Work Costs: ${levers?.workCostAdjustment || 0}%
- Fixed Costs: ${levers?.fixedCostAdjustment || 0}%
- One-time Expense: $${levers?.oneTimeExpense || 0}
- Additional Monthly Cost: $${levers?.additionalMonthlyCost || 0}

SCENARIO IMPACT:
- Revenue Change: $${scenarioImpact?.revenueDelta?.toLocaleString() || 0} (${scenarioImpact?.revenueDeltaPct?.toFixed(1) || 0}%)
- Costs Change: $${scenarioImpact?.costsDelta?.toLocaleString() || 0} (${scenarioImpact?.costsDeltaPct?.toFixed(1) || 0}%)
- Surplus Change: $${scenarioImpact?.surplusDelta?.toLocaleString() || 0}
- Runway Change: ${scenarioImpact?.runwayDelta || 0} months
` : ''}

Provide financial insights in JSON format. Be specific with numbers. Focus on:
1. Key insight about current financial health
2. The most important lever for improving finances
3. One specific decision the user can make now
${scenario ? '4. Analysis of this scenario\'s trade-offs' : ''}

IMPORTANT: Be concise and specific. Cite actual numbers. No generic advice.

Response format:
{
  "healthSummary": "One sentence about current financial state with specific numbers",
  "primaryLever": {
    "lever": "pricing|volume|costs|timing",
    "explanation": "Why this lever matters most for THIS business, with specific numbers"
  },
  "actionableDecision": {
    "question": "Specific yes/no question they should consider",
    "recommendation": "Your recommendation based on the numbers",
    "impact": "Estimated impact of this decision"
  },
  "scenarioAnalysis": {
    "tradeOffs": "What they gain and lose with this scenario",
    "recommendation": "Whether to proceed and why"
  },
  "hiddenRisk": "One risk they might not have considered"
}`;

  const result = await callOpenAIJSON(prompt, {
    maxTokens: 600,
    temperature: 0.4,
  });

  return result.data;
}

/**
 * Main function to get financial insights
 */
async function getFinancialInsights(userId, baseline, options = {}) {
  const { scenario = null, forceRefresh = false, workspaceId = null } = options;

  // Build input hash for caching
  const inputHash = hashInput({
    baselineId: baseline?._id,
    baselineUpdated: baseline?.updatedAt,
    scenarioId: scenario?._id,
    scenarioUpdated: scenario?.updatedAt,
    levers: scenario?.levers,
  });

  // Check cache
  if (!forceRefresh) {
    const cached = await getFromCache(userId, 'financial-insights', inputHash, workspaceId);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  // Calculate metrics
  const metrics = calculateKeyMetrics(baseline);
  const scenarioImpact = scenario ? calculateScenarioImpact(baseline, scenario) : null;
  const levers = scenario?.levers;

  // Generate rule-based insights first (fast, no AI)
  const ruleBasedResults = generateRuleBasedInsights(metrics, scenarioImpact, levers);

  // Get AI insights for deeper analysis
  let aiInsights = null;
  let generationTimeMs = 0;

  if (metrics && baseline) {
    try {
      const context = await buildAgentContext(userId, workspaceId);
      const startTime = Date.now();
      aiInsights = await generateAIInsights(baseline, scenario, context);
      generationTimeMs = Date.now() - startTime;
    } catch (err) {
      console.error('[FinancialInsightsAgent] AI error:', err.message);
    }
  }

  const response = {
    metrics,
    scenarioImpact,
    insights: ruleBasedResults.insights,
    signals: ruleBasedResults.signals,
    causeEffects: ruleBasedResults.causeEffects,
    ai: aiInsights,
    generatedAt: new Date().toISOString(),
  };

  // Cache the response
  await setCache(userId, 'financial-insights', inputHash, response, generationTimeMs, workspaceId);

  return { ...response, fromCache: false, generationTimeMs };
}

/**
 * Answer a specific financial question
 */
async function answerFinancialQuestion(userId, baseline, question, workspaceId = null) {
  const metrics = calculateKeyMetrics(baseline);
  const context = await buildAgentContext(userId, workspaceId);
  const contextStr = formatContextForPrompt(context);

  const prompt = `You are a financial advisor for a small business. Answer this specific question based on their financial data.

BUSINESS CONTEXT:
${contextStr}

FINANCIAL DATA:
- Monthly Revenue: $${metrics?.revenue?.toLocaleString() || 0}
- Monthly Costs: $${metrics?.totalCosts?.toLocaleString() || 0}
- Net Surplus: $${metrics?.netSurplus?.toLocaleString() || 0}
- Cash Runway: ${metrics?.runway || 'Infinite'} months
- Current Cash: $${metrics?.currentCash?.toLocaleString() || 0}
- Break-even Revenue: $${metrics?.breakEven?.toLocaleString() || 0}

USER QUESTION: "${question}"

Provide a direct, actionable answer. Use specific numbers from their data. If the question is about affordability, include the financial impact.

Response format:
{
  "answer": "Direct answer to their question with specific numbers",
  "reasoning": "Brief explanation of the financial logic",
  "recommendation": "What they should do",
  "caveat": "Any important assumption or limitation"
}`;

  const result = await callOpenAIJSON(prompt, {
    maxTokens: 400,
    temperature: 0.3,
  });

  return result.data;
}

module.exports = {
  getFinancialInsights,
  answerFinancialQuestion,
  calculateKeyMetrics,
  calculateScenarioImpact,
  generateRuleBasedInsights,
};
