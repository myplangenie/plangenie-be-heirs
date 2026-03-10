/**
 * AI Agents - Unified Export
 *
 * Five specialized agents for execution support:
 * 1. Priority Coach (Plan Guidance) - What to work on next with SPECIFIC actions
 * 2. Finance Analyst (Financial Validation) - Financial issues + SPECIFIC fixes
 * 3. Strategy Advisor (Strategy Suggestion) - ONE strategic move with implementation steps
 * 4. Project Manager (Progress Status) - Execution status, blockers, and next actions
 * 5. Strategic Integrator - System coherence, tensions, and tradeoff resolution
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
const strategicIntegrator = require('./strategicIntegratorAgent');
const base = require('./base');
const registry = require('./registry');

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

  // Strategic Integrator
  getStrategicIntegration: strategicIntegrator.getStrategicIntegration,

  // Utilities
  invalidateCache: base.invalidateCache,
  buildAgentContext: base.buildAgentContext,
  // Capability registry / resolver
  listCapabilities: registry.listCapabilities,
  resolveAgentForTask: registry.resolveAgentForTask,

  // Individual agent modules for advanced use
  agents: {
    planGuidance,
    financialValidation,
    strategySuggestion,
    progressStatus,
    strategicIntegrator,
  },
};
