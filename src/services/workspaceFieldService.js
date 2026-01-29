/**
 * Workspace Field Service
 *
 * Provides helper functions to read workspace fields from Workspace.fields Map.
 * Used by controllers that need access to vision, values, market, financial data.
 */

const Workspace = require('../models/Workspace');

/**
 * Get all workspace fields as a plain object
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<Object>} - Plain object with all field values
 */
async function getWorkspaceFields(workspaceId) {
  if (!workspaceId) return {};

  const ws = await Workspace.findById(workspaceId).lean();
  if (!ws || !ws.fields) return {};

  // Convert Map to plain object (Mongoose may return it as object already when using .lean())
  if (ws.fields instanceof Map) {
    return Object.fromEntries(ws.fields);
  }

  // If it's already an object (from .lean()), return it directly
  if (typeof ws.fields === 'object') {
    return ws.fields;
  }

  return {};
}

/**
 * Get specific workspace fields
 * @param {string} workspaceId - The workspace ID
 * @param {string[]} fieldNames - Array of field names to retrieve
 * @returns {Promise<Object>} - Object with requested field values
 */
async function getSpecificFields(workspaceId, fieldNames) {
  const allFields = await getWorkspaceFields(workspaceId);
  const result = {};

  for (const name of fieldNames) {
    result[name] = allFields[name] ?? null;
  }

  return result;
}

/**
 * Get vision/purpose fields
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<Object>} - Object with vision/purpose fields
 */
async function getVisionPurposeFields(workspaceId) {
  return getSpecificFields(workspaceId, [
    'ubp',
    'purpose',
    'bhag',
    'visionBhag', // legacy name
    'vision1y',
    'vision3y',
    'visionStatement',
    'missionStatement',
    'identitySummary',
  ]);
}

/**
 * Get values/culture fields
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<Object>} - Object with values/culture fields
 */
async function getValuesCultureFields(workspaceId) {
  return getSpecificFields(workspaceId, [
    'valuesCore',
    'valuesCoreKeywords',
    'cultureFeeling',
  ]);
}

/**
 * Get market fields
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<Object>} - Object with market fields
 */
async function getMarketFields(workspaceId) {
  return getSpecificFields(workspaceId, [
    'targetMarket',
    'targetCustomer',
    'partners',
    'partnersYN',
    'competitorsNotes',
  ]);
}

/**
 * Get financial fields
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<Object>} - Object with financial fields
 */
async function getFinancialFields(workspaceId) {
  return getSpecificFields(workspaceId, [
    'finSalesVolume',
    'finSalesGrowthPct',
    'finAvgUnitCost',
    'finFixedOperatingCosts',
    'finMarketingSalesSpend',
    'finPayrollCost',
    'finStartingCash',
    'finAdditionalFundingAmount',
    'finAdditionalFundingMonth',
    'finPaymentCollectionDays',
    'finTargetProfitMarginPct',
    'finMonthlyRevenue',
    'finRevenueGrowthPct',
    'finIsRecurring',
    'finRecurringPct',
    'finMonthlyCosts',
    'finFixedCosts',
    'finVariableCostsPct',
    'finBiggestCostCategory',
    'finCurrentCash',
    'finExpectedFunding',
    'finFundingMonth',
    'finFundingYear',
    'finIsNonprofit',
    'financialForecast',
  ]);
}

/**
 * Update workspace fields
 * @param {string} workspaceId - The workspace ID
 * @param {Object} updates - Object with field names and values to update
 * @returns {Promise<void>}
 */
async function updateWorkspaceFields(workspaceId, updates) {
  if (!workspaceId || !updates || Object.keys(updates).length === 0) return;

  const ws = await Workspace.findById(workspaceId);
  if (!ws) return;

  if (!ws.fields) ws.fields = new Map();

  for (const [key, value] of Object.entries(updates)) {
    ws.fields.set(key, value);
  }

  ws.markModified('fields');
  await ws.save();
}

/**
 * Build a context object similar to what was previously built from Onboarding.answers
 * This is used by AI controllers and agents
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<Object>} - Context object with all relevant fields
 */
async function buildContextFromWorkspace(workspaceId) {
  const fields = await getWorkspaceFields(workspaceId);

  // Return in the same format that was used before (answers-like structure)
  return {
    // Vision & Purpose
    ubp: fields.ubp || '',
    purpose: fields.purpose || '',
    visionBhag: fields.bhag || fields.visionBhag || '',
    bhag: fields.bhag || fields.visionBhag || '',
    vision1y: fields.vision1y || '',
    vision3y: fields.vision3y || '',
    visionStatement: fields.visionStatement || '',
    missionStatement: fields.missionStatement || '',
    identitySummary: fields.identitySummary || '',

    // Values & Culture
    valuesCore: fields.valuesCore || '',
    valuesCoreKeywords: fields.valuesCoreKeywords || [],
    cultureFeeling: fields.cultureFeeling || '',

    // Market
    targetMarket: fields.targetMarket || '',
    custType: fields.targetMarket || '', // alias
    targetCustomer: fields.targetCustomer || '',
    marketCustomer: fields.targetCustomer || '', // alias
    partners: fields.partners || '',
    partnersDesc: fields.partners || '', // alias
    marketPartners: fields.partners || '', // alias
    partnersYN: fields.partnersYN || '',
    competitorsNotes: fields.competitorsNotes || '',
    compNotes: fields.competitorsNotes || '', // alias

    // Financial
    finSalesVolume: fields.finSalesVolume || '',
    finSalesGrowthPct: fields.finSalesGrowthPct || '',
    finAvgUnitCost: fields.finAvgUnitCost || '',
    finFixedOperatingCosts: fields.finFixedOperatingCosts || '',
    finMarketingSalesSpend: fields.finMarketingSalesSpend || '',
    finPayrollCost: fields.finPayrollCost || '',
    finStartingCash: fields.finStartingCash || '',
    finAdditionalFundingAmount: fields.finAdditionalFundingAmount || '',
    finAdditionalFundingMonth: fields.finAdditionalFundingMonth || '',
    finPaymentCollectionDays: fields.finPaymentCollectionDays || '',
    finTargetProfitMarginPct: fields.finTargetProfitMarginPct || '',
    finIsNonprofit: fields.finIsNonprofit || '',
  };
}

module.exports = {
  getWorkspaceFields,
  getSpecificFields,
  getVisionPurposeFields,
  getValuesCultureFields,
  getMarketFields,
  getFinancialFields,
  updateWorkspaceFields,
  buildContextFromWorkspace,
};
