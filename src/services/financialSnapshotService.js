const FinancialSnapshot = require('../models/FinancialSnapshot');
const Onboarding = require('../models/Onboarding');

// Conservative defaults for "Not sure" answers
const CONSERVATIVE_DEFAULTS = {
  revenueGrowthPct: 0,
  recurringPct: 0,
  variableCostsPct: 30,
  expectedFunding: 0,
};

/**
 * Get or create a financial snapshot for a user/workspace
 */
exports.getOrCreate = async (userId, workspaceId = null) => {
  let snapshot = await FinancialSnapshot.findOne({
    user: userId,
    ...(workspaceId ? { workspace: workspaceId } : { workspace: null }),
  });

  if (!snapshot) {
    snapshot = await FinancialSnapshot.create({
      user: userId,
      workspace: workspaceId || null,
    });
  }

  return snapshot;
};

/**
 * Update a section (revenue, costs, or cash)
 */
exports.updateSection = async (userId, workspaceId, section, data) => {
  const snapshot = await exports.getOrCreate(userId, workspaceId);

  // Apply conservative defaults for "not_sure" values
  const cleanedData = {};
  const fieldsProvided = [];
  const fieldsNotSure = [];

  for (const [key, value] of Object.entries(data)) {
    if (value === 'not_sure' || value === null || value === undefined) {
      // fundingMonth must be 1-12 or not set at all (schema min: 1)
      if (key === 'fundingMonth') {
        // Don't set fundingMonth - leave it undefined/unset
        fieldsNotSure.push(key);
        continue;
      }
      cleanedData[key] = CONSERVATIVE_DEFAULTS[key] ?? 0;
      fieldsNotSure.push(key);
    } else {
      cleanedData[key] = value;
      fieldsProvided.push(key);
    }
  }

  // Get existing section data
  const existingSection = snapshot[section] ? snapshot[section].toObject() : {};

  // Update the section
  snapshot[section] = { ...existingSection, ...cleanedData };

  // If fundingMonth was explicitly passed as null, unset it
  if (section === 'cash' && data.fundingMonth === null) {
    snapshot.cash.fundingMonth = undefined;
  }

  // Calculate confidence based on non-default answers
  const totalFields = Object.keys(data).length;
  const answeredCount = fieldsProvided.length;
  snapshot[section].confidence = totalFields > 0 ? Math.round((answeredCount / totalFields) * 100) : 0;

  snapshot.lastUpdatedSection = section;
  await snapshot.save();

  return snapshot;
};

/**
 * Get health tiles for dashboard display
 */
exports.getHealthTiles = async (userId, workspaceId = null) => {
  const snapshot = await exports.getOrCreate(userId, workspaceId);

  const r = snapshot.revenue || {};
  const c = snapshot.costs || {};
  const cash = snapshot.cash || {};
  const m = snapshot.metrics || {};

  return {
    makingMoney: {
      status: m.netProfit >= 0 ? 'positive' : 'negative',
      value: m.netProfit,
      label:
        m.netProfit >= 0
          ? `Making $${Math.abs(m.netProfit).toLocaleString()}/month`
          : `Losing $${Math.abs(m.netProfit).toLocaleString()}/month`,
      confidence: r.confidence || 0,
    },
    cashRunway: {
      status:
        m.monthsOfRunway === null
          ? 'positive'
          : m.monthsOfRunway > 12
          ? 'positive'
          : m.monthsOfRunway > 6
          ? 'warning'
          : 'critical',
      value: m.monthsOfRunway,
      label:
        m.monthsOfRunway === null
          ? 'Not burning cash'
          : `${m.monthsOfRunway} months of cash left`,
      confidence: cash.confidence || 0,
    },
    growthTrajectory: {
      status:
        r.revenueGrowthPct > 10
          ? 'positive'
          : r.revenueGrowthPct > 0
          ? 'neutral'
          : 'negative',
      value: r.revenueGrowthPct,
      label: `${r.revenueGrowthPct || 0}% monthly growth`,
      confidence: r.confidence || 0,
    },
  };
};

/**
 * Get decision support Q&A
 */
exports.getDecisionSupport = async (userId, workspaceId = null) => {
  const snapshot = await exports.getOrCreate(userId, workspaceId);

  const r = snapshot.revenue || {};
  const c = snapshot.costs || {};
  const cash = snapshot.cash || {};
  const m = snapshot.metrics || {};

  const decisions = [];

  // 1. Can I afford to hire?
  const monthlyCostForHire = 5000; // Conservative estimate
  const canHire =
    m.netProfit > monthlyCostForHire ||
    (cash.currentCash || 0) > monthlyCostForHire * 12;
  decisions.push({
    question: 'Can I afford to hire someone?',
    answer: canHire ? 'Likely yes' : 'Not yet',
    reasoning: canHire
      ? m.monthsOfRunway === null
        ? 'You\'re profitable and not burning cash'
        : `You have ${m.monthsOfRunway} months of runway with current burn`
      : `Your monthly profit ($${m.netProfit.toLocaleString()}) may not cover additional salary`,
    actionable: !canHire ? 'Increase revenue or reduce costs first' : null,
  });

  // 2. Should I raise prices?
  const shouldRaisePrices = m.profitMarginPct < 20;
  decisions.push({
    question: 'Should I raise my prices?',
    answer: shouldRaisePrices ? 'Consider it' : 'Probably not needed',
    reasoning: shouldRaisePrices
      ? `Your profit margin is ${m.profitMarginPct}%, below the healthy 20%+ threshold`
      : `Your margin of ${m.profitMarginPct}% is healthy`,
    actionable: shouldRaisePrices ? 'Test a 10-15% price increase with new customers' : null,
  });

  // 3. When will I break even?
  if (m.netProfit < 0) {
    decisions.push({
      question: 'When will I break even?',
      answer: m.breakEvenMonth ? `~${m.breakEvenMonth} months` : 'Unknown',
      reasoning: m.breakEvenMonth
        ? `At ${r.revenueGrowthPct}% monthly growth, you'll cover costs in ${m.breakEvenMonth} months`
        : 'Need positive revenue growth to project break-even',
      actionable: !m.breakEvenMonth ? 'Focus on increasing revenue growth' : null,
    });
  }

  // 4. Do I have enough runway?
  if (m.monthsOfRunway !== null) {
    const runwayOk = m.monthsOfRunway >= 12;
    decisions.push({
      question: 'Do I have enough runway?',
      answer: runwayOk ? 'Yes, comfortable' : 'Getting tight',
      reasoning: runwayOk
        ? `${m.monthsOfRunway} months gives you time to adjust if needed`
        : `${m.monthsOfRunway} months is less than the recommended 12+ months`,
      actionable: !runwayOk ? 'Consider raising funds or cutting costs' : null,
    });
  }

  return decisions;
};

/**
 * Sync financial data from existing onboarding answers
 */
exports.syncFromOnboarding = async (userId, workspaceId = null) => {
  const filter = { user: userId };
  if (workspaceId) filter.workspace = workspaceId;
  const ob = await Onboarding.findOne(filter).lean();
  if (!ob?.answers?.financial) return null;

  const f = ob.answers.financial;
  const snapshot = await exports.getOrCreate(userId, workspaceId);

  // Map existing fields
  if (f.salesVolume) {
    snapshot.revenue.monthlyRevenue = parseFloat(String(f.salesVolume).replace(/[^0-9.-]/g, '')) || 0;
  }
  if (f.salesGrowthPct) {
    snapshot.revenue.revenueGrowthPct = parseFloat(String(f.salesGrowthPct).replace(/[^0-9.-]/g, '')) || 0;
  }
  if (f.fixedOperatingCosts) {
    snapshot.costs.fixedCosts = parseFloat(String(f.fixedOperatingCosts).replace(/[^0-9.-]/g, '')) || 0;
  }
  if (f.startingCash) {
    snapshot.cash.currentCash = parseFloat(String(f.startingCash).replace(/[^0-9.-]/g, '')) || 0;
  }
  if (f.additionalFundingAmount) {
    snapshot.cash.expectedFunding = parseFloat(String(f.additionalFundingAmount).replace(/[^0-9.-]/g, '')) || 0;
  }
  if (f.additionalFundingMonth) {
    // Parse YYYY-MM format (e.g., "2026-01") or plain month number
    const s = String(f.additionalFundingMonth || '');
    let month;
    if (s.includes('-')) {
      const parts = s.split('-').map(Number);
      month = parts[1]; // Get month from YYYY-MM
    } else {
      month = parseInt(s.replace(/[^0-9]/g, ''), 10);
    }
    if (month >= 1 && month <= 12) {
      snapshot.cash.fundingMonth = month;
    }
  }

  // Calculate monthly costs from components if available
  const avgUnitCost = parseFloat(String(f.avgUnitCost || 0).replace(/[^0-9.-]/g, '')) || 0;
  const payroll = parseFloat(String(f.payrollCost || 0).replace(/[^0-9.-]/g, '')) || 0;
  const marketing = parseFloat(String(f.marketingSalesSpend || 0).replace(/[^0-9.-]/g, '')) || 0;
  const fixed = parseFloat(String(f.fixedOperatingCosts || 0).replace(/[^0-9.-]/g, '')) || 0;

  // Estimate monthly costs
  const estimatedMonthlyCosts = payroll + marketing + fixed;
  if (estimatedMonthlyCosts > 0) {
    snapshot.costs.monthlyCosts = estimatedMonthlyCosts;
  }

  await snapshot.save();
  return snapshot;
};

/**
 * Complete financial onboarding
 */
exports.completeOnboarding = async (userId, workspaceId = null) => {
  const snapshot = await exports.getOrCreate(userId, workspaceId);
  snapshot.completedOnboarding = true;
  await snapshot.save();
  return snapshot;
};
