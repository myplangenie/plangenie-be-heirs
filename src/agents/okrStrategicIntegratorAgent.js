/**
 * OKR Strategic Integrator Agent
 *
 * Purpose: Analyse strategic coherence specifically through the lens of
 * Core and Department OKRs — surfacing alignment gaps, coverage holes,
 * and implicit tradeoffs between objectives.
 *
 * Cross-signal tiles (mapped to same keys the UI expects):
 *  - priority  → Core OKR health  (aligned / partial / misaligned)
 *  - financial → KR metrics health (feasible / constrained / unsustainable)
 *  - execution → Department coverage (executable / strained / breaking)
 */

const OKR = require('../models/OKR');
const {
  hashInput,
  getFromCache,
  setCache,
  buildAgentContext,
  callOpenAIJSON,
  formatContextForPrompt,
} = require('./base');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function krProgress(kr) {
  if (kr.computedProgress !== undefined && kr.computedProgress !== null) {
    return Math.min(100, Math.max(0, kr.computedProgress));
  }
  const baseline = Number(kr.baseline ?? 0);
  const target = Number(kr.target ?? 0);
  const current = Number(kr.current ?? baseline);
  if (!Number.isFinite(target) || target === baseline) return 0;
  const total = kr.direction === 'decrease' ? baseline - target : target - baseline;
  const done  = kr.direction === 'decrease' ? baseline - current : current - baseline;
  return Math.min(100, Math.max(0, (done / total) * 100));
}

function isKrCompleted(kr) {
  if (kr.computedProgress !== undefined && kr.computedProgress !== null) return kr.computedProgress >= 100;
  const baseline = Number(kr.baseline ?? 0);
  const target   = Number(kr.target ?? 0);
  const current  = Number(kr.current ?? baseline);
  if (!Number.isFinite(target) || target === baseline) return false;
  return kr.direction === 'decrease' ? current <= target : current >= target;
}

function isKrOverdue(kr) {
  if (!kr.endAt) return false;
  if (isKrCompleted(kr)) return false;
  const end = new Date(kr.endAt);
  end.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return end < now;
}

// ---------------------------------------------------------------------------
// Signal assessors
// ---------------------------------------------------------------------------

/**
 * priority signal — Core OKR health
 */
function assessCoreOKRHealth(coreOKRs) {
  if (!coreOKRs.length) {
    return { state: 'unknown', context: 'No core OKRs found' };
  }

  const active = coreOKRs.filter(o => o.status !== 'deferred');
  const completed = active.filter(o => o.status === 'completed').length;
  const completionPct = active.length ? Math.round((completed / active.length) * 100) : 0;

  let overdueKRs = 0;
  let totalKRs = 0;
  let totalProgress = 0;

  active.forEach(o => {
    o.keyResults.forEach(kr => {
      totalKRs++;
      totalProgress += krProgress(kr);
      if (isKrOverdue(kr)) overdueKRs++;
    });
  });

  const avgProgress = totalKRs ? Math.round(totalProgress / totalKRs) : 0;

  if (overdueKRs > 2 || avgProgress < 20) {
    return {
      state: 'misaligned',
      context: `${active.length} active core OKRs, ${overdueKRs} overdue KRs, ${avgProgress}% avg KR progress. Core objectives are significantly behind.`,
    };
  }
  if (overdueKRs > 0 || avgProgress < 50) {
    return {
      state: 'partial',
      context: `${active.length} active core OKRs, ${overdueKRs} overdue KR${overdueKRs !== 1 ? 's' : ''}, ${avgProgress}% avg KR progress. Some core objectives are lagging.`,
    };
  }
  return {
    state: 'aligned',
    context: `${active.length} active core OKRs, ${overdueKRs} overdue KRs, ${avgProgress}% avg KR progress, ${completionPct}% of OKRs complete. Core objectives are on track.`,
  };
}

/**
 * financial signal — KR metrics completeness / quality
 */
function assessKRMetricsHealth(allOKRs) {
  const allKRs = allOKRs.flatMap(o => o.keyResults);
  if (!allKRs.length) {
    return { state: 'unknown', context: 'No key results found' };
  }

  const withTarget   = allKRs.filter(kr => kr.target !== undefined && kr.target !== null).length;
  const withBaseline = allKRs.filter(kr => kr.baseline !== undefined && kr.baseline !== null).length;
  const withDates    = allKRs.filter(kr => kr.endAt).length;
  const metricsScore = Math.round(((withTarget + withBaseline + withDates) / (allKRs.length * 3)) * 100);

  if (metricsScore < 40) {
    return {
      state: 'unsustainable',
      context: `${allKRs.length} KRs total — only ${withTarget} have targets, ${withBaseline} have baselines, ${withDates} have due dates. OKRs cannot be measured without complete metrics.`,
    };
  }
  if (metricsScore < 70) {
    return {
      state: 'constrained',
      context: `${allKRs.length} KRs — ${withTarget} with targets, ${withBaseline} with baselines, ${withDates} with due dates (${metricsScore}% metrics completeness). Tracking accuracy is limited.`,
    };
  }
  return {
    state: 'feasible',
    context: `${allKRs.length} KRs with ${metricsScore}% metrics completeness. ${withTarget} have targets, ${withBaseline} baselines, ${withDates} due dates. OKRs are well-instrumented for tracking.`,
  };
}

/**
 * execution signal — Department OKR coverage of core OKRs
 */
function assessDeptCoverage(coreOKRs, deptOKRs) {
  if (!coreOKRs.length) {
    return { state: 'unknown', context: 'No core OKRs to evaluate coverage against' };
  }

  const coreIds = new Set(coreOKRs.map(o => String(o._id)));
  const coveredCoreIds = new Set(
    deptOKRs
      .filter(o => o.anchorCoreOKR)
      .map(o => String(o.anchorCoreOKR))
  );

  const coveredCount = [...coreIds].filter(id => coveredCoreIds.has(id)).length;
  const uncoveredCount = coreIds.size - coveredCount;
  const coveragePct = Math.round((coveredCount / coreIds.size) * 100);

  if (coveragePct < 40 || (uncoveredCount > 2 && deptOKRs.length === 0)) {
    return {
      state: 'breaking',
      context: `Only ${coveredCount} of ${coreIds.size} core OKRs (${coveragePct}%) have department-level support. ${uncoveredCount} core objective${uncoveredCount !== 1 ? 's' : ''} lack execution coverage.`,
    };
  }
  if (coveragePct < 70 || uncoveredCount > 0) {
    return {
      state: 'strained',
      context: `${coveredCount} of ${coreIds.size} core OKRs (${coveragePct}%) covered by ${deptOKRs.length} department OKR${deptOKRs.length !== 1 ? 's' : ''}. ${uncoveredCount} core objective${uncoveredCount !== 1 ? 's' : ''} still need department alignment.`,
    };
  }
  return {
    state: 'executable',
    context: `${coveredCount} of ${coreIds.size} core OKRs (${coveragePct}%) have department-level execution plans. ${deptOKRs.length} department OKRs providing coverage. Strategic execution layer is intact.`,
  };
}

/**
 * Overall coherence from three OKR-specific signals
 */
function determineOKRCoherence(coreHealth, metricsHealth, deptCoverage) {
  const states = [coreHealth.state, metricsHealth.state, deptCoverage.state];

  const hasMisaligned = states.includes('misaligned') || states.includes('unsustainable') || states.includes('breaking');
  const hasPartial    = states.includes('partial') || states.includes('constrained') || states.includes('strained');
  const hasUnknown    = states.includes('unknown');

  if (hasMisaligned) {
    return {
      state: 'misaligned',
      supportingSentence: 'Core and department OKRs show significant coherence gaps. Strategic execution is at risk.',
    };
  }
  if (hasPartial) {
    return {
      state: 'tension',
      supportingSentence: 'OKR coverage and metrics quality show areas of tension. Some objectives may not translate into results.',
    };
  }
  if (hasUnknown) {
    return {
      state: 'aligned',
      supportingSentence: 'Insufficient OKR data to fully assess coherence. Add more OKRs with metrics to unlock deeper insights.',
    };
  }
  return {
    state: 'aligned',
    supportingSentence: 'Core OKRs are well-supported, properly instrumented, and covered by department objectives.',
  };
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

async function getOKRStrategicIntegration(userId, options = {}) {
  const { forceRefresh = false, workspaceId = null } = options;

  // Fetch OKRs
  const filter = { user: userId, isDeleted: false };
  if (workspaceId) filter.workspace = workspaceId;

  const allOKRs = await OKR.find(filter).lean();
  const coreOKRs = allOKRs.filter(o => o.okrType === 'core');
  const deptOKRs = allOKRs.filter(o => o.okrType === 'department');

  // Cache key based on OKR data fingerprint
  const inputHash = hashInput({
    coreCount: coreOKRs.length,
    deptCount: deptOKRs.length,
    statuses: allOKRs.map(o => `${o._id}:${o.status}`).sort(),
    krCount: allOKRs.reduce((s, o) => s + o.keyResults.length, 0),
  });

  if (!forceRefresh) {
    const cached = await getFromCache(userId, 'okr-strategic-integration', inputHash, workspaceId);
    if (cached) {
      console.log('[OKR Strategic Integrator] Returning CACHED response');
      return { ...cached, fromCache: true };
    }
  }
  console.log('[OKR Strategic Integrator] Generating FRESH response');

  // Assess signals
  const coreHealth   = assessCoreOKRHealth(coreOKRs);
  const metricsHealth = assessKRMetricsHealth(allOKRs);
  const deptCoverage  = assessDeptCoverage(coreOKRs, deptOKRs);

  const coherence = determineOKRCoherence(coreHealth, metricsHealth, deptCoverage);

  const crossSignals = {
    priority:  coreHealth,   // labelled "Priority" in UI → maps to Core OKR Health
    financial: metricsHealth, // labelled "Financial" in UI → maps to KR Metrics Health
    execution: deptCoverage,  // labelled "Execution" in UI → maps to Dept Coverage
  };

  // Defaults
  let tensions = [];
  let tradeoff = {
    statement: 'No explicit OKR tradeoff identified',
    prioritizing: null,
    deprioritizing: null,
    isAmbiguous: true,
  };
  let alignmentOptions = [];
  let implications = {
    description: 'Select an alignment option to see implications',
    affectedAgents: [],
  };

  const hasData = allOKRs.length > 0;
  let generationTimeMs = 0;

  if (hasData && coherence.state !== 'aligned') {
    // Build a lean OKR summary for the prompt
    const context = await buildAgentContext(userId, workspaceId);
    const contextStr = formatContextForPrompt(context);

    const okrSummary = [
      `Total OKRs: ${allOKRs.length} (${coreOKRs.length} core, ${deptOKRs.length} department)`,
      '',
      'CORE OKRs:',
      ...coreOKRs.slice(0, 10).map(o => {
        const avgProg = o.keyResults.length
          ? Math.round(o.keyResults.reduce((s, kr) => s + krProgress(kr), 0) / o.keyResults.length)
          : 0;
        const hasDeptSupport = deptOKRs.some(d => String(d.anchorCoreOKR) === String(o._id));
        return `  - "${o.objective}" | status: ${o.status} | avg KR progress: ${avgProg}% | dept support: ${hasDeptSupport ? 'yes' : 'NO'}`;
      }),
      '',
      'DEPARTMENT OKRs:',
      ...deptOKRs.slice(0, 15).map(o => {
        const avgProg = o.keyResults.length
          ? Math.round(o.keyResults.reduce((s, kr) => s + krProgress(kr), 0) / o.keyResults.length)
          : 0;
        return `  - "${o.objective}" | dept: ${o.departmentLabel || o.departmentKey || 'unknown'} | anchored to core: ${o.anchorCoreOKR ? 'yes' : 'NO'} | avg KR progress: ${avgProg}%`;
      }),
      '',
      `SIGNALS:`,
      `Core OKR Health (Priority): ${coreHealth.state} — ${coreHealth.context}`,
      `KR Metrics Health (Financial): ${metricsHealth.state} — ${metricsHealth.context}`,
      `Dept Coverage (Execution): ${deptCoverage.state} — ${deptCoverage.context}`,
    ].join('\n');

    const prompt = `You are a Strategic Integrator analysing a company's OKR system for coherence.

${contextStr}

OKR DATA:
${okrSummary}

Identify strategic tensions, the primary tradeoff, and alignment options specific to these OKRs.
Respond in JSON:

{
  "tensions": [
    {
      "statement": "Clear description of the OKR tension (max 20 words)",
      "tradingOff": "What is being traded off (e.g., 'Revenue growth vs operational stability')"
    }
  ],
  "tradeoff": {
    "statement": "The primary OKR-level tradeoff currently being made (max 30 words)",
    "prioritizing": "What objective type / area is being prioritised",
    "deprioritizing": "What is being deprioritised",
    "isAmbiguous": false
  },
  "alignmentOptions": [
    {
      "description": "A viable path to improve OKR coherence (max 25 words)",
      "primaryImpact": "Which area this primarily affects (core OKRs / department OKRs / KR metrics)",
      "financialImplication": "High-level financial impact of this path (1 sentence)",
      "executionImplication": "High-level execution change needed (1 sentence)"
    }
  ],
  "implications": {
    "description": "What changes if the first alignment option is chosen (max 30 words)",
    "affectedAgents": ["Core OKRs", "Department OKRs", etc.]
  }
}

RULES:
- Maximum 3 tensions, grounded in the actual OKR data above
- Tradeoffs must be stated neutrally — no judgment
- Maximum 3 alignment options, each actionable at the OKR planning level
- Be specific to THIS company's objectives, not generic OKR advice
- If no clear tension exists, return empty tensions array`;

    const result = await callOpenAIJSON(prompt, { maxTokens: 1200, temperature: 0.4 });
    generationTimeMs = result.generationTimeMs;

    if (result.data) {
      if (Array.isArray(result.data.tensions)) tensions = result.data.tensions.slice(0, 3);
      if (result.data.tradeoff) {
        tradeoff = {
          statement: result.data.tradeoff.statement || tradeoff.statement,
          prioritizing: result.data.tradeoff.prioritizing || null,
          deprioritizing: result.data.tradeoff.deprioritizing || null,
          isAmbiguous: result.data.tradeoff.isAmbiguous ?? true,
        };
      }
      if (Array.isArray(result.data.alignmentOptions)) alignmentOptions = result.data.alignmentOptions.slice(0, 3);
      if (result.data.implications) {
        implications = {
          description: result.data.implications.description || implications.description,
          affectedAgents: result.data.implications.affectedAgents || [],
        };
      }
    }
  }

  const response = {
    coherence,
    crossSignals,
    tensions,
    tradeoff,
    alignmentOptions,
    implications,
    hasData,
    generatedAt: new Date().toISOString(),
  };

  await setCache(userId, 'okr-strategic-integration', inputHash, response, generationTimeMs, workspaceId);

  console.log('[OKR Strategic Integrator] Coherence:', response.coherence.state, '| Tensions:', tensions.length);
  return { ...response, fromCache: false, generationTimeMs };
}

module.exports = { getOKRStrategicIntegration };
