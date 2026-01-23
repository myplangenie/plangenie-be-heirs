/**
 * Check All Migration Status
 * Compares data in onboarding.answers vs individual collections for ALL users
 */

const path = require('path');
const backupDir = path.join(__dirname, '..', 'backups', 'backup_2026-01-23T15-55-23-306Z');

const onboardings = require(path.join(backupDir, 'onboardings.json'));
const swotentries = require(path.join(backupDir, 'swotentries.json'));
const visiongoals = require(path.join(backupDir, 'visiongoals.json'));
const products = require(path.join(backupDir, 'products.json'));
const competitors = require(path.join(backupDir, 'competitors.json'));
const coreprojects = require(path.join(backupDir, 'coreprojects.json'));
const deptprojects = require(path.join(backupDir, 'departmentprojects.json'));
const workspaces = require(path.join(backupDir, 'workspaces.json'));

// Parse newline-separated text into array of non-empty items
function parseLines(str) {
  return String(str || '').split('\n').map(s => s.trim()).filter(Boolean);
}

console.log('=== COMPREHENSIVE MIGRATION STATUS CHECK ===\n');

const issues = [];

onboardings.forEach(ob => {
  const wsId = ob.workspace ? ob.workspace.toString() : null;
  if (!wsId) return;

  const a = ob.answers || {};
  const ws = workspaces.find(w => w._id && w._id.toString() === wsId);
  const wsName = ws?.name || 'Unknown Workspace';

  const wsFilter = (arr, field = 'workspace') =>
    arr.filter(x => x[field] && x[field].toString() === wsId && !x.isDeleted);

  // Check SWOT
  const answersSwotStrengths = parseLines(a.swotStrengths);
  const answersSwotWeaknesses = parseLines(a.swotWeaknesses);
  const answersSwotOpportunities = parseLines(a.swotOpportunities);
  const answersSwotThreats = parseLines(a.swotThreats);
  const totalAnswersSwot = answersSwotStrengths.length + answersSwotWeaknesses.length +
                           answersSwotOpportunities.length + answersSwotThreats.length;

  const collectionSwot = wsFilter(swotentries);
  const collectionSwotCount = collectionSwot.length;

  if (totalAnswersSwot > 0 && collectionSwotCount === 0) {
    issues.push({
      workspace: wsName,
      wsId,
      type: 'SWOT',
      inAnswers: totalAnswersSwot,
      inCollection: 0,
      status: 'NEEDS MIGRATION'
    });
  }

  // Check Vision Goals (1y and 3y)
  const answersVision1y = parseLines(a.vision1y);
  const answersVision3y = parseLines(a.vision3y);
  const totalAnswersVision = answersVision1y.length + answersVision3y.length;

  // Try to load visiongoals if it exists
  let collectionVisionCount = 0;
  try {
    const collectionVision = wsFilter(visiongoals);
    collectionVisionCount = collectionVision.length;
  } catch (e) {
    // visiongoals collection might not exist
  }

  if (totalAnswersVision > 0 && collectionVisionCount === 0) {
    issues.push({
      workspace: wsName,
      wsId,
      type: 'VisionGoals',
      inAnswers: totalAnswersVision,
      inCollection: 0,
      status: 'NEEDS MIGRATION'
    });
  }

  // Check Products
  const answersProducts = Array.isArray(a.products) ? a.products.length : 0;
  const collectionProducts = wsFilter(products).length;

  if (answersProducts > 0 && collectionProducts === 0) {
    issues.push({
      workspace: wsName,
      wsId,
      type: 'Products',
      inAnswers: answersProducts,
      inCollection: 0,
      status: 'NEEDS MIGRATION'
    });
  }

  // Check Competitors
  const answersCompetitors = Array.isArray(a.competitorNames) ? a.competitorNames.filter(Boolean).length : 0;
  const collectionCompetitors = wsFilter(competitors).length;

  if (answersCompetitors > 0 && collectionCompetitors === 0) {
    issues.push({
      workspace: wsName,
      wsId,
      type: 'Competitors',
      inAnswers: answersCompetitors,
      inCollection: 0,
      status: 'NEEDS MIGRATION'
    });
  }

  // Check CoreProjects
  const answersCoreProjects = Array.isArray(a.coreProjectDetails) ? a.coreProjectDetails.filter(Boolean).length : 0;
  const collectionCoreProjects = wsFilter(coreprojects).length;

  if (answersCoreProjects > 0 && collectionCoreProjects === 0) {
    issues.push({
      workspace: wsName,
      wsId,
      type: 'CoreProjects',
      inAnswers: answersCoreProjects,
      inCollection: 0,
      status: 'NEEDS MIGRATION'
    });
  }

  // Check DepartmentProjects
  let answersDeptProjects = 0;
  if (a.actionAssignments && typeof a.actionAssignments === 'object') {
    Object.values(a.actionAssignments).forEach(arr => {
      if (Array.isArray(arr)) answersDeptProjects += arr.length;
    });
  }
  const collectionDeptProjects = wsFilter(deptprojects).length;

  if (answersDeptProjects > 0 && collectionDeptProjects === 0) {
    issues.push({
      workspace: wsName,
      wsId,
      type: 'DepartmentProjects',
      inAnswers: answersDeptProjects,
      inCollection: 0,
      status: 'NEEDS MIGRATION'
    });
  }
});

if (issues.length === 0) {
  console.log('✅ All data has been migrated! No issues found.\n');
} else {
  console.log(`⚠️  Found ${issues.length} migration issues:\n`);

  // Group by workspace
  const byWorkspace = {};
  issues.forEach(i => {
    if (!byWorkspace[i.workspace]) byWorkspace[i.workspace] = [];
    byWorkspace[i.workspace].push(i);
  });

  Object.entries(byWorkspace).forEach(([ws, wsIssues]) => {
    console.log(`📁 ${ws}:`);
    wsIssues.forEach(i => {
      console.log(`   - ${i.type}: ${i.inAnswers} in answers, ${i.inCollection} in collection → ${i.status}`);
    });
    console.log('');
  });
}

// Summary
console.log('=== SUMMARY ===');
const types = ['SWOT', 'VisionGoals', 'Products', 'Competitors', 'CoreProjects', 'DepartmentProjects'];
types.forEach(t => {
  const typeIssues = issues.filter(i => i.type === t);
  if (typeIssues.length > 0) {
    console.log(`${t}: ${typeIssues.length} workspaces need migration`);
  }
});

if (issues.length > 0) {
  console.log('\n⚠️  RUN: node scripts/migrate-onboarding-to-collections.js');
}
