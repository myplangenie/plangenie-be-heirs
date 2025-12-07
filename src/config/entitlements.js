// Centralized plan configuration and helpers

const plans = {
  lite: {
    name: 'Lite',
    features: {
      financials: false,
      aiCompetitors: false,
      aiCustomerAnalysis: false,
      // Allow AI for Core Strategic Projects in Lite
      aiCoreProjects: true,
      // Departmental action-plan AI remains off for Lite
      aiActionPlans: false,
      financialAutoLinkage: false,
      orgChartImage: false,
      planEdit: false,
      departmentPlans: false,
      multiUserTeam: false,
    },
    limits: {
      maxPlans: 1,
      maxGoals: 3,
      maxCoreProjects: 3,
    },
  },
  pro: {
    name: 'Pro',
    features: {
      financials: true,
      aiCompetitors: true,
      aiCustomerAnalysis: true,
      aiCoreProjects: true,
      aiActionPlans: true,
      financialAutoLinkage: true,
      orgChartImage: true,
      planEdit: true,
      departmentPlans: true,
      multiUserTeam: true,
    },
    limits: {
      maxPlans: 1000,
      maxGoals: 1000,
      maxCoreProjects: 1000,
    },
  },
};

function effectivePlan(user) {
  if (user && user.hasActiveSubscription) return 'pro';
  return 'lite';
}

function hasFeature(user, feature) {
  const plan = effectivePlan(user);
  return !!plans[plan]?.features?.[feature];
}

function getLimit(user, key) {
  const plan = effectivePlan(user);
  const v = plans[plan]?.limits?.[key];
  return typeof v === 'number' ? v : 0;
}

module.exports = { plans, effectivePlan, hasFeature, getLimit };
