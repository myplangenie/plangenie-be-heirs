/**
 * AI Agents - Unified Export
 *
 * Four specialized agents for execution support:
 * 1. Priority Coach (Plan Guidance) - What to work on next with SPECIFIC actions
 * 2. Finance Analyst (Financial Validation) - Financial issues + SPECIFIC fixes
 * 3. Strategy Advisor (Strategy Suggestion) - ONE strategic move with implementation steps
 * 4. Project Manager (Progress Status) - Execution status, blockers, and next actions
 *
 * All agents are ACTION-ORIENTED:
 * - Every insight includes a specific, executable action
 * - Outputs are concise and focused, not verbose lists
 * - Recommendations reference the user's actual business data
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
