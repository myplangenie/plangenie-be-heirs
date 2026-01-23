/**
 * Check Hal McInerney's data (WMS Financial)
 */

const path = require('path');
const backupDir = path.join(__dirname, '..', 'backups', 'backup_2026-01-23T15-55-23-306Z');

const workspaces = require(path.join(backupDir, 'workspaces.json'));
const onboardings = require(path.join(backupDir, 'onboardings.json'));
const swotentries = require(path.join(backupDir, 'swotentries.json'));
const products = require(path.join(backupDir, 'products.json'));
const competitors = require(path.join(backupDir, 'competitors.json'));
const coreprojects = require(path.join(backupDir, 'coreprojects.json'));
const deptprojects = require(path.join(backupDir, 'departmentprojects.json'));
const users = require(path.join(backupDir, 'users.json'));

// Find Hal's user and workspace
const user = users.find(u => u.email === 'hal@wmsfinancial.ca' || (u.firstName === 'Hal' && u.lastName === 'McInerney'));
const ws = workspaces.find(w => w.name === 'WMS Financial' || (w.slug && w.slug.includes('wms')));

console.log('=== SEARCHING FOR HAL / WMS FINANCIAL ===\n');

if (user) {
  console.log('Found user:', user.email, '-', user.firstName, user.lastName);
  console.log('User ID:', user._id);
}

if (ws) {
  console.log('Found workspace:', ws.name);
  console.log('Workspace ID:', ws._id);
  console.log('Workspace slug:', ws.slug);
} else {
  // Try finding by name containing WMS
  const wsAlt = workspaces.find(w => w.name && w.name.toLowerCase().includes('wms'));
  if (wsAlt) {
    console.log('Found workspace (alt):', wsAlt.name);
    console.log('Workspace ID:', wsAlt._id);
  }
}

// Find onboarding with WMS Financial in businessName
const ob = onboardings.find(o => o.answers && o.answers.businessName && o.answers.businessName.toLowerCase().includes('wms'));

if (ob) {
  console.log('\n=== ONBOARDING FOUND ===');
  console.log('Onboarding ID:', ob._id);
  console.log('Workspace:', ob.workspace);

  const wsId = ob.workspace ? ob.workspace.toString() : null;

  console.log('\n--- ONBOARDING.ANSWERS FIELDS ---');
  const a = ob.answers || {};

  // Key fields for Hal
  const fieldMap = {
    'businessName': a.businessName,
    'userFullName': a.userFullName,
    'ubp': a.ubp,
    'purpose': a.purpose,
    'visionBhag': a.visionBhag,
    'vision1y': a.vision1y,
    'vision3y': a.vision3y,
    'valuesCore': a.valuesCore,
    'cultureFeeling': a.cultureFeeling,
    'marketCustomer': a.marketCustomer,
    'swotStrengths': a.swotStrengths,
    'swotWeaknesses': a.swotWeaknesses,
    'swotOpportunities': a.swotOpportunities,
    'swotThreats': a.swotThreats,
    'products': a.products,
    'coreProjects': a.coreProjects,
    'coreProjectDetails': a.coreProjectDetails,
    'actionAssignments': a.actionAssignments,
  };

  Object.entries(fieldMap).forEach(([key, val]) => {
    if (val !== undefined && val !== null) {
      if (Array.isArray(val)) {
        console.log(`  ${key}: ${val.length} items`);
        if (val.length > 0 && val.length <= 3) {
          val.forEach((v, i) => {
            if (typeof v === 'string') {
              console.log(`    [${i}]: "${v.substring(0, 50)}${v.length > 50 ? '...' : ''}"`);
            }
          });
        }
      } else if (typeof val === 'object') {
        console.log(`  ${key}: ${Object.keys(val).length} keys`);
      } else if (typeof val === 'string') {
        console.log(`  ${key}: "${val.substring(0, 60)}${val.length > 60 ? '...' : ''}"`);
      } else {
        console.log(`  ${key}: ${val}`);
      }
    }
  });

  // Check individual collections
  if (wsId) {
    console.log('\n--- INDIVIDUAL COLLECTIONS FOR THIS WORKSPACE ---');
    const swot = swotentries.filter(s => s.workspace && s.workspace.toString() === wsId);
    const prods = products.filter(p => p.workspace && p.workspace.toString() === wsId);
    const comps = competitors.filter(c => c.workspace && c.workspace.toString() === wsId);
    const cores = coreprojects.filter(c => c.workspace && c.workspace.toString() === wsId);
    const depts = deptprojects.filter(d => d.workspace && d.workspace.toString() === wsId);

    console.log(`  SwotEntry: ${swot.length} entries`);
    console.log(`  Product: ${prods.length} entries`);
    console.log(`  Competitor: ${comps.length} entries`);
    console.log(`  CoreProject: ${cores.length} entries`);
    console.log(`  DepartmentProject: ${depts.length} entries`);

    // Detail SWOT
    if (swot.length > 0) {
      const byType = {};
      swot.forEach(s => { byType[s.type] = (byType[s.type] || 0) + 1; });
      console.log('  SwotEntry by type:', byType);
    }

    // Check what's in answers vs what's in collections
    console.log('\n--- MIGRATION STATUS ---');
    const answersSwot = (a.swotStrengths || []).length + (a.swotWeaknesses || []).length +
                        (a.swotOpportunities || []).length + (a.swotThreats || []).length;
    console.log(`  SWOT: ${answersSwot} in answers, ${swot.length} in SwotEntry collection`);
    console.log(`  Products: ${(a.products || []).length} in answers, ${prods.length} in Product collection`);
    console.log(`  CoreProjects: ${(a.coreProjectDetails || []).length} in answers, ${cores.length} in CoreProject collection`);

    let deptCount = 0;
    if (a.actionAssignments) {
      Object.values(a.actionAssignments).forEach(arr => { deptCount += (arr || []).length; });
    }
    console.log(`  DeptProjects: ${deptCount} in answers, ${depts.length} in DepartmentProject collection`);
  }
} else {
  console.log('No onboarding found with WMS Financial');

  // List all business names
  console.log('\nAll business names in onboardings:');
  onboardings.forEach(o => {
    if (o.answers && o.answers.businessName) {
      console.log('  -', o.answers.businessName);
    }
  });
}
