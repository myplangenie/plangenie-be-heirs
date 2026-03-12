/**
 * Workspace Field Service
 *
 * Provides helper functions to read workspace fields from Workspace.fields Map.
 * Used by controllers that need access to vision, values, market, financial data.
 */

const Workspace = require('../models/Workspace');
const { normalizeDepartmentKey } = require('../utils/departmentNormalize');

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
 * @returns {Promise<Object>} - Object with market fields (raw values for frontend)
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
 * Ensure canonical departments registry (fields.actionSections) contains provided names/keys.
 * Merges with existing entries and preserves existing labels.
 * @param {string} workspaceId
 * @param {string[]} namesOrKeys
 */
async function ensureActionSections(workspaceId, namesOrKeys) {
  try {
    if (!workspaceId || !Array.isArray(namesOrKeys) || namesOrKeys.length === 0) return;
    const ws = await Workspace.findById(workspaceId);
    if (!ws) return;
    if (!ws.fields) ws.fields = new Map();

    const existing = ws.fields.get('actionSections');
    const sections = Array.isArray(existing) ? existing : [];
    const map = new Map();
    // Seed map with existing entries
    for (const s of sections) {
      const key = normalizeDepartmentKey(String((s && s.key) || (s && s.label) || ''));
      if (!key) continue;
      const label = String((s && s.label) || '').trim() || labelize(key);
      map.set(key, { key, label });
    }
    // Merge incoming
    for (const n of namesOrKeys) {
      const raw = String(n || '').trim();
      if (!raw) continue;
      const key = normalizeDepartmentKey(raw);
      if (!key) continue;
      // Prefer original raw as label when it looks human (has space or capitalized), else derive from key
      const label = hasHumanLabel(raw) ? raw : labelize(key);
      map.set(key, { key, label });
    }

    const next = Array.from(map.values());
    ws.fields.set('actionSections', next);
    ws.markModified('fields');
    await ws.save();
  } catch {
    // Non-fatal
  }
}

function hasHumanLabel(s = '') {
  // Heuristics: contains space, starts with capital, or contains '&'
  return /\s/.test(s) || /^[A-Z]/.test(s) || /&/.test(s);
}

function labelize(key = '') {
  // From camelCase or kebab/underscore to Title Case
  const spaced = String(key)
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Parse targetMarket JSON to human-readable string
 * @param {string} value - JSON string or legacy string
 * @returns {string} - Human-readable customer type description
 */
function parseTargetMarketToReadable(value) {
  if (!value) return '';
  try {
    const data = JSON.parse(value);
    const parts = [];
    if (Array.isArray(data.audienceTypes) && data.audienceTypes.length > 0) {
      parts.push(`Audience: ${data.audienceTypes.join(', ')}`);
    }
    if (Array.isArray(data.businessSizes) && data.businessSizes.length > 0) {
      parts.push(`Business sizes: ${data.businessSizes.join(', ')}`);
    }
    if (Array.isArray(data.orgTypes) && data.orgTypes.length > 0) {
      parts.push(`Organization types: ${data.orgTypes.join(', ')}`);
    }
    if (Array.isArray(data.individualTypes) && data.individualTypes.length > 0) {
      parts.push(`Individual types: ${data.individualTypes.join(', ')}`);
    }
    if (data.primaryAudience) {
      parts.push(`Primary audience: ${data.primaryAudience}`);
    }
    return parts.length > 0 ? parts.join('. ') : value;
  } catch {
    return value; // Legacy format, return as-is
  }
}

/**
 * Parse targetCustomer JSON to human-readable string
 * @param {string} value - JSON string or legacy string
 * @returns {string} - Human-readable customer description
 */
function parseTargetCustomerToReadable(value) {
  if (!value) return '';
  try {
    const data = JSON.parse(value);
    const parts = [];
    if (Array.isArray(data.environments) && data.environments.length > 0) {
      parts.push(`Customer environment: ${data.environments.join(', ')}`);
    }
    if (data.description && data.description.trim()) {
      parts.push(`Description: ${data.description.trim()}`);
    }
    return parts.length > 0 ? parts.join('. ') : value;
  } catch {
    return value; // Legacy format, return as-is
  }
}

/**
 * Build a context object similar to what was previously built from Onboarding.answers
 * This is used by AI controllers and agents
 * @param {string} workspaceId - The workspace ID
 * @returns {Promise<Object>} - Context object with all relevant fields
 */
async function buildContextFromWorkspace(workspaceId) {
  const fields = await getWorkspaceFields(workspaceId);

  // Parse market fields to human-readable format for AI context
  const targetMarketReadable = parseTargetMarketToReadable(fields.targetMarket);
  const targetCustomerReadable = parseTargetCustomerToReadable(fields.targetCustomer);

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

    // Market - use human-readable versions for AI context
    targetMarket: targetMarketReadable,
    custType: targetMarketReadable, // alias
    targetCustomer: targetCustomerReadable,
    marketCustomer: targetCustomerReadable, // alias
    // Also store raw JSON for components that need it
    targetMarketRaw: fields.targetMarket || '',
    targetCustomerRaw: fields.targetCustomer || '',
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
  ensureActionSections,
  buildContextFromWorkspace,
};
