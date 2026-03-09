// Centralized plan configuration and helpers

const plans = {
  lite: {
    name: 'Lite',
    features: {
      financials: false,
      aiCompetitors: false,
      aiCustomerAnalysis: false,
      // Allow AI for Core Projects in Lite
      aiCoreProjects: true,
      // Departmental action-plan AI remains off for Lite
      aiActionPlans: false,
      financialAutoLinkage: false,
      orgChartImage: false,
      planEdit: false,
      departmentPlans: false,
      multiUserTeam: true,
      assumptionScenarios: false,
    },
    limits: {
      maxPlans: 1,
      maxJourneys: 1,
      maxWorkspaces: 1,
      maxGoals: 3,
      maxCoreProjects: 3,
      maxCollaborators: 2,
      reviewsPerMonth: 2,
      decisionsPerMonth: 10,
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
      assumptionScenarios: true,
    },
    limits: {
      maxPlans: 1000,
      maxJourneys: 1000,
      maxWorkspaces: 1000,
      maxGoals: 1000,
      maxCoreProjects: 1000,
      maxCollaborators: 0, // 0 = unlimited
      reviewsPerMonth: 100000,
      decisionsPerMonth: 100000,
    },
  },
  enterprise: {
    name: 'Enterprise',
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
      assumptionScenarios: true,
    },
    limits: {
      maxPlans: 1000,
      maxJourneys: 1000,
      maxWorkspaces: 1000,
      maxGoals: 1000,
      maxCoreProjects: 1000,
      maxCollaborators: 0, // 0 = unlimited
      reviewsPerMonth: 100000,
      decisionsPerMonth: 100000,
    },
  },
};

function effectivePlan(user) {
  if (user && user.hasActiveSubscription) {
    // Use planSlug if available to distinguish pro vs enterprise
    if (user.planSlug === 'enterprise') return 'enterprise';
    return 'pro';
  }
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

/**
 * Get workspace limit considering purchased add-on slots.
 * @param {Object} user - User object with hasActiveSubscription flag
 * @param {Object} subscription - Subscription object with workspaceSlots
 * @returns {number} Total allowed workspaces (base + purchased)
 */
function getWorkspaceLimit(user, subscription) {
  // If subscription has explicit slot tracking, use that
  if (subscription?.workspaceSlots?.total) {
    return subscription.workspaceSlots.total;
  }
  // Fall back to plan-based limit
  return getLimit(user, 'maxWorkspaces');
}

module.exports = { plans, effectivePlan, hasFeature, getLimit, getWorkspaceLimit };
