const OKR = require('../models/OKR');

// Canonical core metric keys
const CANONICAL_METRICS = new Set(['revenue', 'margin', 'churn', 'growth', 'adoption', 'cost']);

function clamp(n, min = 0, max = 100) {
  n = Number.isFinite(n) ? n : 0;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// Compute progress for a KR from metric values
function computeKrProgress(kr) {
  if (!kr) return 0;
  const baseline = Number(kr.baseline ?? 0);
  const target = Number(kr.target ?? 0);
  const current = Number(kr.current ?? baseline);
  if (!Number.isFinite(baseline) || !Number.isFinite(target) || !Number.isFinite(current)) return 0;
  const distance = target - baseline;
  if (distance === 0) return 0;
  let pct = (current - baseline) / distance * 100;
  // If direction is decrease, invert sense
  if (kr.direction === 'decrease') {
    pct = (baseline - current) / (baseline - target) * 100;
  }
  return clamp(pct);
}

// Compute progress for an OKR = average of KR progress
function computeOkrProgress(okr) {
  const krs = Array.isArray(okr?.keyResults) ? okr.keyResults : [];
  if (krs.length === 0) return 0;
  const values = krs.map(computeKrProgress);
  const sum = values.reduce((a, b) => a + b, 0);
  return clamp(sum / values.length);
}

// Compute progress for a 1-year goal from Core OKRs derived from it
async function computeGoalProgress(goalId, workspaceId) {
  try {
    const okrs = await OKR.find({
      workspace: workspaceId,
      isDeleted: false,
      okrType: 'core',
      derivedFromGoals: goalId,
    }).lean();
    if (!okrs.length) return 0;
    const values = okrs.map(computeOkrProgress);
    const sum = values.reduce((a, b) => a + b, 0);
    return clamp(sum / values.length);
  } catch (_) {
    return 0;
  }
}

function isCanonicalMetricKey(s) {
  return CANONICAL_METRICS.has(String(s || '').toLowerCase());
}

module.exports = {
  CANONICAL_METRICS,
  isCanonicalMetricKey,
  computeKrProgress,
  computeOkrProgress,
  computeGoalProgress,
};

