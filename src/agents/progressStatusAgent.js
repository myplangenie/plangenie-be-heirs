/**
 * Progress and Plan Status Agent
 * Assesses how complete a business plan is and suggests next steps.
 * Uses v2 data: RevenueStreams + FinancialBaseline
 *
 * Evaluates:
 * - Section completeness
 * - Content quality
 * - Overall plan readiness
 */

const {
  hashInput,
  getFromCache,
  setCache,
  buildAgentContext,
  callOpenAIJSON,
} = require('./base');

// Plan sections with their weights and required fields
const PLAN_SECTIONS = {
  userProfile: {
    name: 'User Profile',
    weight: 5,
    fields: ['fullName', 'role'],
    description: 'Your personal information and role',
  },
  businessProfile: {
    name: 'Business Profile',
    weight: 15,
    fields: ['businessName', 'industry', 'businessStage', 'ventureType', 'teamSize'],
    description: 'Core business information',
  },
  vision: {
    name: 'Vision & Purpose',
    weight: 15,
    fields: ['ubp', 'purpose', 'vision1y', 'vision3y'],
    description: 'Your business purpose and goals',
  },
  values: {
    name: 'Values & Culture',
    weight: 10,
    fields: ['valuesCore', 'cultureFeeling'],
    description: 'Company values and culture',
  },
  market: {
    name: 'Market Analysis',
    weight: 15,
    checkMarket: true, // Uses new Competitor CRUD model via context._competitors
    description: 'Target market and competitive landscape',
  },
  swot: {
    name: 'SWOT Analysis',
    weight: 10,
    checkSwot: true, // Uses new SwotEntry CRUD model via context.swot
    description: 'Strengths, weaknesses, opportunities, threats',
  },
  products: {
    name: 'Products & Services',
    weight: 10,
    checkV2: 'revenueStreams', // Uses v2 RevenueStreams
    minItems: 1,
    description: 'Your product/service offerings with pricing',
  },
  financial: {
    name: 'Financial Projections',
    weight: 10,
    checkV2Financial: true, // Uses v2 FinancialBaseline
    description: 'Revenue, costs, and cash position',
  },
  projects: {
    name: 'Strategic Projects',
    weight: 10,
    requiresArray: 'coreProjectDetails',
    minItems: 1,
    description: 'Core strategic initiatives',
  },
};

/**
 * Calculate completion for each section using v2 data
 */
function calculateSectionCompletion(context) {
  const sections = [];
  const answers = context._rawAnswers || {};

  for (const [key, config] of Object.entries(PLAN_SECTIONS)) {
    let filled = 0;
    let total = 0;
    let status = 'empty';
    const missingFields = [];

    if (config.checkSwot) {
      // Check SWOT from new SwotEntry CRUD model (via context.swot)
      const swot = context.swot || {};
      const swotFields = ['strengths', 'weaknesses', 'opportunities', 'threats'];
      total = swotFields.length;
      for (const field of swotFields) {
        const value = swot[field];
        if (value && String(value).trim().length > 0) {
          filled++;
        } else {
          missingFields.push(`swot${field.charAt(0).toUpperCase() + field.slice(1)}`);
        }
      }
    } else if (config.checkMarket) {
      // Check Market from answers + new Competitor CRUD model
      total = 3; // marketCustomer, marketPartners, competitors

      // Check marketCustomer (also check targetCustomer as alternate field name)
      const customerValue = answers.marketCustomer || answers.targetCustomer || context.marketCustomer || '';
      if (customerValue.trim().length > 0) {
        filled++;
      } else {
        missingFields.push('marketCustomer');
      }

      // Check marketPartners (also check partners as alternate field name)
      const partnersValue = answers.marketPartners || answers.partners || context.marketPartners || '';
      if (partnersValue.trim().length > 0) {
        filled++;
      } else {
        missingFields.push('marketPartners');
      }

      // Check competitors from Competitor CRUD model only
      const competitors = context._competitors || [];
      if (competitors.length > 0) {
        filled++;
      } else {
        missingFields.push('marketCompetitors');
      }
    } else if (config.fields) {
      // Regular field checks
      total = config.fields.length;
      for (const field of config.fields) {
        const value = answers[field] ||
          context[field] ||
          (key === 'businessProfile' ? context[field] : null);

        if (value && String(value).trim().length > 0) {
          filled++;
        } else {
          missingFields.push(field);
        }
      }
    } else if (config.checkV2) {
      // Check v2 RevenueStreams
      total = config.minItems || 1;
      const arr = context[config.checkV2] || [];
      filled = Math.min(arr.length, total);
      if (arr.length === 0) {
        missingFields.push('products/services');
      }
    } else if (config.checkV2Financial) {
      // Check v2 FinancialBaseline
      const baseline = context.financialBaseline;
      const revenueAggregate = context.revenueAggregate;
      const streams = context.revenueStreams || [];

      // Check for revenue data (from RevenueStreams)
      const hasRevenue = streams.length > 0 || (revenueAggregate?.totalMonthlyRevenue > 0);
      // Check for costs data
      const hasCosts = (baseline?.workRelatedCosts?.total > 0) || (baseline?.fixedCosts?.total > 0);
      // Check for cash data
      const hasCash = (baseline?.cash?.currentBalance > 0);

      total = 3; // Revenue, Costs, Cash
      if (hasRevenue) filled++;
      else missingFields.push('revenue (products/services)');
      if (hasCosts) filled++;
      else missingFields.push('costs');
      if (hasCash) filled++;
      else missingFields.push('cash position');
    } else if (config.requiresArray) {
      total = config.minItems || 1;
      const arr = context[config.requiresArray] || [];
      filled = Math.min(arr.length, total);
      if (arr.length === 0) {
        missingFields.push(config.requiresArray);
      }
    }

    const percentage = total > 0 ? Math.round((filled / total) * 100) : 0;

    if (percentage === 100) status = 'complete';
    else if (percentage >= 50) status = 'partial';
    else if (percentage > 0) status = 'started';
    else status = 'empty';

    sections.push({
      key,
      name: config.name,
      description: config.description,
      weight: config.weight,
      filled,
      total,
      percentage,
      status,
      missingFields,
      weightedScore: (percentage / 100) * config.weight,
    });
  }

  return sections;
}

/**
 * Determine next priority actions
 */
function determineNextSteps(sections) {
  const steps = [];

  // Sort by: empty first, then partial, weighted by importance
  const prioritized = [...sections].sort((a, b) => {
    // Prioritize empty and partial sections
    if (a.status === 'empty' && b.status !== 'empty') return -1;
    if (b.status === 'empty' && a.status !== 'empty') return 1;
    if (a.status === 'partial' && b.status === 'complete') return -1;
    if (b.status === 'partial' && a.status === 'complete') return 1;
    // Then by weight (higher weight = more important)
    return b.weight - a.weight;
  });

  for (const section of prioritized) {
    if (section.status === 'complete') continue;

    if (section.status === 'empty') {
      steps.push({
        section: section.name,
        action: `Start filling out "${section.name}"`,
        reason: section.description,
        priority: 'high',
        estimatedTime: '5-10 minutes',
      });
    } else if (section.status === 'partial' || section.status === 'started') {
      const missing = section.missingFields.slice(0, 2).join(', ');
      steps.push({
        section: section.name,
        action: `Complete "${section.name}" - missing: ${missing}`,
        reason: `${section.percentage}% done, needs ${100 - section.percentage}% more`,
        priority: section.percentage < 50 ? 'high' : 'medium',
        estimatedTime: '2-5 minutes',
      });
    }

    if (steps.length >= 5) break; // Limit to 5 next steps
  }

  return steps;
}

/**
 * Generate progress status report using v2 data
 * @param {string} userId - User ID
 * @param {Object} options - Optional parameters (workspaceId, forceRefresh, includeAIFeedback)
 * @returns {Object} Progress report with sections and recommendations
 */
async function getProgressStatus(userId, options = {}) {
  const { forceRefresh = false, includeAIFeedback = true, workspaceId = null } = options;

  // Build context (includes v2 data)
  const context = await buildAgentContext(userId, workspaceId);

  // Create cache key using v2 data
  const inputHash = hashInput({
    businessName: context.businessName,
    answersKeys: Object.keys(context._rawAnswers || {}),
    revenueStreamsCount: context.revenueStreams?.length || 0,
    hasFinancialBaseline: !!context.financialBaseline,
    projectsCount: context.coreProjectDetails?.length || 0,
  });

  // Check cache
  if (!forceRefresh) {
    const cached = await getFromCache(userId, 'progress-status', inputHash, workspaceId);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  }

  // Calculate section completion
  const sections = calculateSectionCompletion(context);

  // Calculate overall progress
  const totalWeight = sections.reduce((sum, s) => sum + s.weight, 0);
  const earnedWeight = sections.reduce((sum, s) => sum + s.weightedScore, 0);
  const overallProgress = Math.round((earnedWeight / totalWeight) * 100);

  // Determine status
  let overallStatus = 'getting-started';
  if (overallProgress >= 90) overallStatus = 'ready';
  else if (overallProgress >= 70) overallStatus = 'almost-there';
  else if (overallProgress >= 40) overallStatus = 'making-progress';
  else if (overallProgress >= 10) overallStatus = 'getting-started';

  // Get next steps
  const nextSteps = determineNextSteps(sections);

  // Get AI feedback if requested and plan is substantially complete
  let aiFeedback = null;
  let generationTimeMs = 0;

  if (includeAIFeedback && overallProgress >= 50) {
    const completeSections = sections.filter(s => s.status === 'complete').map(s => s.name);
    const incompleteSections = sections.filter(s => s.status !== 'complete').map(s => `${s.name} (${s.percentage}%)`);

    // Include v2 financial data in prompt
    const revenueAggregate = context.revenueAggregate;
    const baseline = context.financialBaseline;
    const financialSummary = revenueAggregate || baseline ? `
Financial Summary:
- Revenue Streams: ${context.revenueStreams?.length || 0}
- Monthly Revenue: $${revenueAggregate?.totalMonthlyRevenue?.toLocaleString() || 0}
- Total Costs: $${((baseline?.workRelatedCosts?.total || 0) + (baseline?.fixedCosts?.total || 0)).toLocaleString()}
- Cash Position: $${baseline?.cash?.currentBalance?.toLocaleString() || 0}` : '';

    const prompt = `You are reviewing a business plan's progress.

Business: ${context.businessName || 'Unnamed Business'}
Industry: ${context.industry || 'Unknown'}
Overall Progress: ${overallProgress}%

COMPLETE SECTIONS:
${completeSections.join(', ') || 'None'}

INCOMPLETE SECTIONS:
${incompleteSections.join(', ') || 'None'}

UBP: ${context.ubp || 'Not defined'}
Purpose: ${context.purpose || 'Not defined'}
${financialSummary}

IMPORTANT TONE GUIDELINES:
- Be specific - reference actual section names and percentages
- Encouragement must be brief and grounded (e.g., "3 sections complete" not "you're doing amazing!")
- Strengths should cite what they actually completed
- Avoid generic phrases like "great job" or "keep it up"

Provide brief feedback in JSON format:
{
  "overallFeedback": "1-2 sentence assessment citing their ${overallProgress}% progress and specific sections",
  "strengths": ["Specific completed section or strong area"],
  "priorities": ["Most important section to complete next with why"],
  "encouragement": "Brief, grounded note referencing their actual progress"
}`;

    const result = await callOpenAIJSON(prompt, {
      maxTokens: 400,
      temperature: 0.6,
    });

    aiFeedback = result.data;
    generationTimeMs = result.generationTimeMs;
  }

  // Build response
  const response = {
    overallProgress,
    overallStatus,
    statusLabels: {
      'getting-started': 'Getting Started',
      'making-progress': 'Making Progress',
      'almost-there': 'Almost There',
      'ready': 'Ready to Execute',
    },
    sections: sections.map(s => ({
      key: s.key,
      name: s.name,
      percentage: s.percentage,
      status: s.status,
      weight: s.weight,
    })),
    sectionDetails: sections,
    nextSteps,
    aiFeedback: aiFeedback || {
      overallFeedback: overallProgress < 30
        ? "You're just getting started. Focus on completing your business profile and vision first."
        : overallProgress < 60
          ? "Good progress! Keep filling in the remaining sections to complete your plan."
          : "You're almost there! Complete the final sections to have a comprehensive plan.",
      strengths: sections.filter(s => s.status === 'complete').map(s => `${s.name} is complete`).slice(0, 2),
      priorities: nextSteps.slice(0, 2).map(s => s.action),
      encouragement: "Every step forward brings you closer to a complete business plan!",
    },
    generatedAt: new Date().toISOString(),
  };

  // Cache the response
  await setCache(userId, 'progress-status', inputHash, response, generationTimeMs, workspaceId);

  return { ...response, fromCache: false, generationTimeMs };
}

module.exports = {
  getProgressStatus,
  calculateSectionCompletion,
  determineNextSteps,
  PLAN_SECTIONS,
};
