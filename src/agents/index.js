/**
 * AI Agents - Unified Export
 *
 * Four specialized agents for business plan guidance:
 * 1. Plan Guidance Agent - What to work on next
 * 2. Financial Validation Agent - Flag unrealistic numbers
 * 3. Strategy Suggestion Agent - Business model and positioning
 * 4. Progress Status Agent - Plan completeness
 */

const planGuidance = require('./planGuidanceAgent');
const financialValidation = require('./financialValidationAgent');
const strategySuggestion = require('./strategySuggestionAgent');
const progressStatus = require('./progressStatusAgent');
const base = require('./base');

module.exports = {
  // Plan Guidance
  generateGuidance: planGuidance.generateGuidance,

  // Financial Validation
  validateFinancials: financialValidation.validateFinancials,

  // Strategy Suggestions
  generateStrategySuggestions: strategySuggestion.generateStrategySuggestions,
  getSuggestionsByArea: strategySuggestion.getSuggestionsByArea,

  // Progress Status
  getProgressStatus: progressStatus.getProgressStatus,

  // Utilities
  invalidateCache: base.invalidateCache,
  buildAgentContext: base.buildAgentContext,

  // Individual agent modules for advanced use
  agents: {
    planGuidance,
    financialValidation,
    strategySuggestion,
    progressStatus,
  },
};
