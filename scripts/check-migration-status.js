/**
 * Check Migration Status
 * Verifies if all data from onboardings.answers has been migrated to individual collections
 */

const path = require('path');
const backupDir = path.join(__dirname, '..', 'backups', 'backup_2026-01-23T15-55-23-306Z');

const onboardings = require(path.join(backupDir, 'onboardings.json'));
const coreprojects = require(path.join(backupDir, 'coreprojects.json'));
const deptprojects = require(path.join(backupDir, 'departmentprojects.json'));

console.log('=== Checking Migration Status ===\n');

let missingCore = 0, foundCore = 0;
let missingDept = 0, foundDept = 0;
const missingCoreList = [];
const missingDeptList = [];

onboardings.forEach(ob => {
  const workspaceId = ob.workspace ? ob.workspace.toString() : null;
  if (!workspaceId) return;
  const a = ob.answers || {};

  // Check core projects
  const coreDetails = a.coreProjectDetails || [];
  coreDetails.forEach((d, i) => {
    if (!d) return;
    const title = d.title || `Project ${i + 1}`;
    const exists = coreprojects.some(cp =>
      cp.workspace && cp.workspace.toString() === workspaceId &&
      (cp.title === title || cp.title === d.title)
    );
    if (exists) {
      foundCore++;
    } else {
      missingCore++;
      missingCoreList.push({ workspace: workspaceId, title });
    }
  });

  // Check dept projects
  const assignments = a.actionAssignments || {};
  Object.entries(assignments).forEach(([deptKey, projects]) => {
    if (!Array.isArray(projects)) return;
    projects.forEach((p, i) => {
      if (!p) return;
      const title = p.title || p.goal || `${deptKey} Project ${i + 1}`;
      const exists = deptprojects.some(dp =>
        dp.workspace && dp.workspace.toString() === workspaceId &&
        dp.departmentKey === deptKey &&
        (dp.title === title || dp.goal === p.goal || dp.title === p.title)
      );
      if (exists) {
        foundDept++;
      } else {
        missingDept++;
        missingDeptList.push({ workspace: workspaceId, deptKey, title });
      }
    });
  });
});

console.log('Core Projects from onboardings.answers:');
console.log(`  - Found in CoreProject collection: ${foundCore}`);
console.log(`  - MISSING from collection: ${missingCore}`);
console.log('');
console.log('Department Projects from onboardings.answers:');
console.log(`  - Found in DepartmentProject collection: ${foundDept}`);
console.log(`  - MISSING from collection: ${missingDept}`);
console.log('');

if (missingCore > 0 || missingDept > 0) {
  console.log('⚠️  WARNING: Some data is NOT yet migrated!');
  console.log('   Running the migration script is REQUIRED to preserve user data.\n');

  if (missingCoreList.length > 0 && missingCoreList.length <= 10) {
    console.log('Missing Core Projects:');
    missingCoreList.forEach(m => console.log(`  - Workspace ${m.workspace}: "${m.title}"`));
    console.log('');
  }

  if (missingDeptList.length > 0 && missingDeptList.length <= 10) {
    console.log('Missing Dept Projects:');
    missingDeptList.forEach(m => console.log(`  - Workspace ${m.workspace}, ${m.deptKey}: "${m.title}"`));
    console.log('');
  }
} else {
  console.log('✓ All data from onboardings.answers appears to be migrated to individual collections.');
}
