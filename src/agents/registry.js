/**
 * Agent Capability Registry
 *
 * Central directory describing each agent, its core capabilities,
 * and an intent resolver to recommend the right agent for a task.
 */

const AGENTS = [
  {
    key: 'plan-guidance',
    name: 'Priority Coach',
    endpoint: '/api/agents/plan-guidance',
    capabilities: [
      'prioritize_work',
      'what_to_work_on',
      'next_actions',
      'route_request',
    ],
    description: 'Helps you decide what to work on next with concrete, immediate actions.'
  },
  {
    key: 'financial-validate',
    name: 'Finance Analyst',
    endpoint: '/api/agents/financial-validate',
    capabilities: [
      'validate_financials',
      'budget_sanity_check',
      'cost_risk_flags',
      'route_request',
    ],
    description: 'Validates projections, flags risks, and sanity-checks budgets.'
  },
  {
    key: 'strategy-suggest',
    name: 'Strategy Advisor',
    endpoint: '/api/agents/strategy-suggest',
    capabilities: [
      'strategy_suggestions',
      'growth_moves',
      'experiments',
      'route_request',
    ],
    description: 'Recommends one focused strategic move with implementation steps.'
  },
  {
    key: 'progress-status',
    name: 'Project Manager',
    endpoint: '/api/agents/progress-status',
    capabilities: [
      'progress_overview',
      'blockers',
      'deadlines',
      'route_request',
    ],
    description: 'Surfaces execution health, blockers, and critical deadlines.'
  },
  {
    key: 'strategic-integrate',
    name: 'Strategic Integrator',
    endpoint: '/api/agents/strategic-integrate',
    capabilities: [
      'cross_agent_summary',
      'tradeoffs',
      'system_tensions',
      'route_request',
    ],
    description: 'Synthesizes outputs from other agents; highlights tradeoffs and system tensions.'
  },
  // Note: Creation/mutation actions live under Chat tools and CRUD controllers
  // We still expose a pseudo-agent entry so resolvers can point users correctly.
  {
    key: 'actions-executor',
    name: 'Actions Executor',
    endpoint: '/api/chat',
    capabilities: [
      'create_project',
      'create_department_project',
      'create_okr',
      'update_project',
      'assign_owner',
      'reschedule',
      'mark_complete',
    ],
    description: 'Performs concrete changes like creating projects and OKRs via Chat tools.'
  }
];

function listCapabilities() {
  return AGENTS.map(({ key, name, endpoint, capabilities, description }) => ({ key, name, endpoint, capabilities, description }));
}

/**
 * Resolve an agent for a natural-language task string.
 * Returns the best matching agent and a reason.
 */
function resolveAgentForTask(task) {
  const t = String(task || '').toLowerCase();

  // Hard routing for creation/mutation intents → Actions Executor
  const mutateHints = [
    'create project', 'add project', 'new project',
    'create okr', 'add okr', 'new okr',
    'assign owner', 'reschedule', 'mark complete', 'complete task', 'add deliverable', 'delete project',
  ];
  if (mutateHints.some((h) => t.includes(h))) {
    const a = AGENTS.find(a => a.key === 'actions-executor');
    return { agent: a, reason: 'Requires creation/update actions that are executed via Chat tools.' };
  }

  // Finance/budget validation
  if (/(finance|budget|cost|spend|cash|profit|revenue|expense|margin)/.test(t)) {
    const a = AGENTS.find(a => a.key === 'financial-validate');
    return { agent: a, reason: 'Financial question detected (budgets, costs, or margins).' };
  }

  // Progress/status
  if (/(progress|status|overdue|deadline|blocker|velocity|momentum|burndown)/.test(t)) {
    const a = AGENTS.find(a => a.key === 'progress-status');
    return { agent: a, reason: 'Execution status or deadline-related request detected.' };
  }

  // Strategy
  if (/(strategy|growth|position|prioritize|focus|bet|experiment|move)/.test(t)) {
    const a = AGENTS.find(a => a.key === 'strategy-suggest');
    return { agent: a, reason: 'Strategic recommendation or focus area request detected.' };
  }

  // Cross-agent synthesis
  if (/(tradeoff|coherence|integration|synthesize|conflict|tension)/.test(t)) {
    const a = AGENTS.find(a => a.key === 'strategic-integrate');
    return { agent: a, reason: 'Cross-agent synthesis or tradeoff analysis requested.' };
  }

  // Default: Priority coach for general guidance
  const a = AGENTS.find(a => a.key === 'plan-guidance');
  return { agent: a, reason: 'General guidance task; start here.' };
}

module.exports = { AGENTS, listCapabilities, resolveAgentForTask };

