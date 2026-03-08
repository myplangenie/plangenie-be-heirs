const OKR = require('../models/OKR');
const VisionGoal = require('../models/VisionGoal');
const CoreProject = require('../models/CoreProject');
const DepartmentProject = require('../models/DepartmentProject');
const { getSpecificFields } = require('../services/workspaceFieldService');

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

// Helper: compute project progress as percent done deliverables
function computeProjectProgress(project) {
  const delivs = Array.isArray(project?.deliverables) ? project.deliverables : [];
  if (delivs.length === 0) return 0;
  const done = delivs.filter(d => d && d.done).length;
  return clamp((done / delivs.length) * 100);
}

async function computeGoalProgressFromOkrs(goalId, workspaceId) {
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
}

async function computeGoalProgressFromProjects(goalId, workspaceId) {
  // Identify the index of this 1‑year goal among ordered 1y goals (legacy project link uses indices)
  const goals = await VisionGoal.find({ workspace: workspaceId, goalType: '1y', isDeleted: false })
    .sort({ order: 1 })
    .select('_id')
    .lean();
  const idx = goals.findIndex(g => String(g._id) === String(goalId));
  if (idx < 0) return 0;

  // Fetch core projects linked to this goal index
  const core = await CoreProject.find({ workspace: workspaceId, isDeleted: false, linkedGoals: idx })
    .select('deliverables linkedGoals')
    .lean();
  // Fetch department projects linked via linkedGoal index
  const dept = await DepartmentProject.find({ workspace: workspaceId, isDeleted: false, linkedGoal: idx })
    .select('deliverables linkedGoal')
    .lean();

  const all = [...core, ...dept];
  if (!all.length) return 0;
  const values = all.map(computeProjectProgress);
  const sum = values.reduce((a, b) => a + b, 0);
  return clamp(sum / values.length);
}

// Compute progress for a 1-year goal from either OKRs or Projects, based on workspace preference
async function computeGoalProgress(goalId, workspaceId) {
  try {
    let mode = 'okrs';
    try {
      const fields = await getSpecificFields(workspaceId, ['goalTrackingMode']);
      if (fields && typeof fields.goalTrackingMode === 'string') {
        mode = String(fields.goalTrackingMode).toLowerCase() === 'projects' ? 'projects' : 'okrs';
      }
    } catch { /* default to okrs */ }

    if (mode === 'projects') {
      return await computeGoalProgressFromProjects(goalId, workspaceId);
    }
    return await computeGoalProgressFromOkrs(goalId, workspaceId);
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
