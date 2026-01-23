/**
 * Migration Script: Convert array-based storage to individual collections
 *
 * This script migrates:
 * - answers.coreProjects + answers.coreProjectDetails -> CoreProject collection
 * - answers.actionAssignments -> DepartmentProject collection
 *
 * Safety features:
 * - Does NOT delete original data
 * - Skips already migrated records (idempotent)
 * - Logs all operations
 * - Can be run multiple times safely
 *
 * Usage:
 *   cd /Users/mac/Desktop/code/Bles/Plangenie/be
 *   node scripts/migrate-to-individual-collections.js
 *
 * Options:
 *   --dry-run    Preview what would be migrated without making changes
 *   --verbose    Show detailed logging
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Onboarding = require('../src/models/Onboarding');
const CoreProject = require('../src/models/CoreProject');
const DepartmentProject = require('../src/models/DepartmentProject');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

// Statistics
const stats = {
  onboardingsProcessed: 0,
  coreProjectsCreated: 0,
  coreProjectsSkipped: 0,
  deptProjectsCreated: 0,
  deptProjectsSkipped: 0,
  errors: [],
};

function log(message, level = 'info') {
  const prefix = {
    info: '[INFO]',
    warn: '[WARN]',
    error: '[ERROR]',
    verbose: '[VERBOSE]',
  }[level] || '[INFO]';

  if (level === 'verbose' && !VERBOSE) return;
  console.log(`${prefix} ${message}`);
}

function shortTitle(text, maxLen = 50) {
  if (!text) return '';
  const clean = String(text).trim();
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 3) + '...';
}

async function migrateOnboarding(ob) {
  const workspaceId = ob.workspace;
  const userId = ob.user;
  const answers = ob.answers || {};

  if (!workspaceId) {
    log(`Skipping onboarding ${ob._id} - no workspace`, 'warn');
    return;
  }

  // ----- Migrate Core Projects -----
  const coreProjects = answers.coreProjects || [];
  const coreDetails = answers.coreProjectDetails || [];
  const maxCoreLen = Math.max(coreProjects.length, coreDetails.length);

  for (let i = 0; i < maxCoreLen; i++) {
    const projectText = coreProjects[i] || '';
    const details = coreDetails[i] || {};

    // Determine title
    const title = details.title ||
                  (projectText ? projectText.split(':')[0]?.trim() : null) ||
                  `Project ${i + 1}`;

    // Check if already migrated
    const existing = await CoreProject.findOne({
      workspace: workspaceId,
      $or: [
        { title: title },
        { description: projectText },
      ],
      isDeleted: false,
    }).lean();

    if (existing) {
      log(`Skipping core project "${shortTitle(title)}" - already exists`, 'verbose');
      stats.coreProjectsSkipped++;
      continue;
    }

    const coreProjectData = {
      workspace: workspaceId,
      user: userId,
      title: title,
      description: projectText || undefined,
      goal: details.goal || undefined,
      cost: details.cost || undefined,
      dueWhen: details.dueWhen || undefined,
      priority: details.priority || undefined,
      ownerId: details.ownerId || undefined,
      ownerName: details.ownerName || undefined,
      linkedGoals: Array.isArray(details.linkedGoals) ? details.linkedGoals : undefined,
      departments: Array.isArray(details.departments) ? details.departments : undefined,
      deliverables: Array.isArray(details.deliverables)
        ? details.deliverables.map(d => ({
            text: d.text || '',
            done: Boolean(d.done),
            kpi: d.kpi || undefined,
            dueWhen: d.dueWhen || undefined,
            ownerId: d.ownerId || undefined,
            ownerName: d.ownerName || undefined,
          })).filter(d => d.text)
        : [],
      order: i,
    };

    if (DRY_RUN) {
      log(`[DRY RUN] Would create core project: "${shortTitle(title)}"`, 'info');
    } else {
      try {
        await CoreProject.create(coreProjectData);
        log(`Created core project: "${shortTitle(title)}"`, 'verbose');
      } catch (err) {
        log(`Error creating core project "${shortTitle(title)}": ${err.message}`, 'error');
        stats.errors.push({ type: 'coreProject', title, error: err.message });
        continue;
      }
    }
    stats.coreProjectsCreated++;
  }

  // ----- Migrate Department Projects -----
  const actionAssignments = answers.actionAssignments || {};

  for (const [deptKey, projects] of Object.entries(actionAssignments)) {
    if (!Array.isArray(projects)) continue;

    for (let i = 0; i < projects.length; i++) {
      const p = projects[i];
      if (!p) continue;

      const title = p.title || p.goal || `${deptKey} Project ${i + 1}`;

      // Check if already migrated
      const existing = await DepartmentProject.findOne({
        workspace: workspaceId,
        departmentKey: deptKey,
        $or: [
          { title: title },
          { goal: p.goal },
        ],
        isDeleted: false,
      }).lean();

      if (existing) {
        log(`Skipping dept project "${shortTitle(title)}" in ${deptKey} - already exists`, 'verbose');
        stats.deptProjectsSkipped++;
        continue;
      }

      const deptProjectData = {
        workspace: workspaceId,
        user: userId,
        departmentKey: deptKey,
        title: p.title || undefined,
        goal: p.goal || undefined,
        milestone: p.milestone || undefined,
        resources: p.resources || undefined,
        dueWhen: p.dueWhen || undefined,
        cost: p.cost || undefined,
        firstName: p.firstName || undefined,
        lastName: p.lastName || undefined,
        ownerId: p.ownerId || undefined,
        linkedGoal: typeof p.linkedGoal === 'number' ? p.linkedGoal : undefined,
        // Note: linkedCoreProject will need to be linked separately if needed
        deliverables: Array.isArray(p.deliverables)
          ? p.deliverables.map(d => ({
              text: d.text || '',
              done: Boolean(d.done),
              kpi: d.kpi || undefined,
              dueWhen: d.dueWhen || undefined,
              ownerId: d.ownerId || undefined,
              ownerName: d.ownerName || undefined,
            })).filter(d => d.text)
          : [],
        order: i,
      };

      if (DRY_RUN) {
        log(`[DRY RUN] Would create dept project: "${shortTitle(title)}" in ${deptKey}`, 'info');
      } else {
        try {
          await DepartmentProject.create(deptProjectData);
          log(`Created dept project: "${shortTitle(title)}" in ${deptKey}`, 'verbose');
        } catch (err) {
          log(`Error creating dept project "${shortTitle(title)}": ${err.message}`, 'error');
          stats.errors.push({ type: 'deptProject', title, deptKey, error: err.message });
          continue;
        }
      }
      stats.deptProjectsCreated++;
    }
  }

  stats.onboardingsProcessed++;
}

async function main() {
  log('='.repeat(60));
  log('Migration: Array Storage -> Individual Collections');
  log('='.repeat(60));

  if (DRY_RUN) {
    log('*** DRY RUN MODE - No changes will be made ***', 'warn');
  }

  // Connect to database
  const dbUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!dbUri) {
    log('No MONGODB_URI or MONGO_URI found in environment', 'error');
    process.exit(1);
  }

  log('Connecting to database...');
  await mongoose.connect(dbUri);
  log('Connected to database');

  // Count existing records
  const existingCore = await CoreProject.countDocuments();
  const existingDept = await DepartmentProject.countDocuments();
  log(`Existing CoreProject documents: ${existingCore}`);
  log(`Existing DepartmentProject documents: ${existingDept}`);

  // Get all onboarding documents
  log('Fetching onboarding documents...');
  const onboardings = await Onboarding.find({}).lean();
  log(`Found ${onboardings.length} onboarding documents to process`);

  // Process each onboarding
  for (let i = 0; i < onboardings.length; i++) {
    const ob = onboardings[i];
    log(`Processing ${i + 1}/${onboardings.length}: workspace ${ob.workspace || 'N/A'}`, 'verbose');

    try {
      await migrateOnboarding(ob);
    } catch (err) {
      log(`Error processing onboarding ${ob._id}: ${err.message}`, 'error');
      stats.errors.push({ type: 'onboarding', id: ob._id, error: err.message });
    }
  }

  // Print summary
  log('');
  log('='.repeat(60));
  log('Migration Summary');
  log('='.repeat(60));
  log(`Onboardings processed: ${stats.onboardingsProcessed}`);
  log(`Core Projects created: ${stats.coreProjectsCreated}`);
  log(`Core Projects skipped (already exist): ${stats.coreProjectsSkipped}`);
  log(`Department Projects created: ${stats.deptProjectsCreated}`);
  log(`Department Projects skipped (already exist): ${stats.deptProjectsSkipped}`);

  if (stats.errors.length > 0) {
    log(`Errors encountered: ${stats.errors.length}`, 'warn');
    if (VERBOSE) {
      stats.errors.forEach((e, i) => {
        log(`  ${i + 1}. ${e.type}: ${e.error}`, 'error');
      });
    }
  }

  // Final counts
  const finalCore = await CoreProject.countDocuments();
  const finalDept = await DepartmentProject.countDocuments();
  log('');
  log('Final document counts:');
  log(`  CoreProject: ${existingCore} -> ${finalCore} (+${finalCore - existingCore})`);
  log(`  DepartmentProject: ${existingDept} -> ${finalDept} (+${finalDept - existingDept})`);

  if (DRY_RUN) {
    log('');
    log('*** DRY RUN COMPLETE - No changes were made ***', 'warn');
    log('Run without --dry-run to perform actual migration');
  }

  await mongoose.disconnect();
  log('Migration complete!');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
