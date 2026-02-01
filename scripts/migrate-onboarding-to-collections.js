/**
 * One-time migration script: Onboarding.answers → Individual Collections
 *
 * This script reads data from the old Onboarding.answers JSON blob and
 * migrates it to the new individual collections:
 * - CoreProject
 * - DepartmentProject
 * - Product
 * - Competitor
 * - OrgPosition
 * - SwotEntry
 * - VisionGoal
 *
 * Run with: node scripts/migrate-onboarding-to-collections.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');

// Models
const Onboarding = require('../src/models/Onboarding');
const CoreProject = require('../src/models/CoreProject');
const DepartmentProject = require('../src/models/DepartmentProject');
const Product = require('../src/models/Product');
const Competitor = require('../src/models/Competitor');
const OrgPosition = require('../src/models/OrgPosition');
const SwotEntry = require('../src/models/SwotEntry');
const VisionGoal = require('../src/models/VisionGoal');
const Workspace = require('../src/models/Workspace');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/plangenie';

async function connect() {
  console.log('[Migration] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[Migration] Connected to MongoDB');
}

async function disconnect() {
  await mongoose.disconnect();
  console.log('[Migration] Disconnected from MongoDB');
}

/**
 * Parse newline-separated text into array
 */
function parseLines(str) {
  return String(str || '').split('\n').map(s => s.trim()).filter(Boolean);
}

/**
 * Parse compNotes text to extract competitor data including weDoBetter
 * Format:
 *   Competitor Name
 *   What they do better: advantage text
 *   What we do better: weDoBetter text
 *
 * Blocks separated by double newlines
 */
function parseCompNotes(compNotes) {
  if (!compNotes) return [];

  const blocks = String(compNotes).split(/\n\n+/).filter(b => b.trim());
  const competitors = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length === 0) continue;

    // First line is the competitor name (may have bullet prefix)
    const name = lines[0].replace(/^[-•*]\s*/, '').trim();
    if (!name) continue;

    let theyDoBetter = '';
    let weDoBetter = '';

    // Parse remaining lines for "What they do better" and "What we do better"
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for "What they do better:" pattern
      const theyMatch = line.match(/^what they do better[:\s]*(.*)$/i);
      if (theyMatch) {
        theyDoBetter = theyMatch[1].trim();
        continue;
      }

      // Check for "What we do better:" pattern
      const weMatch = line.match(/^what we do better[:\s]*(.*)$/i);
      if (weMatch) {
        weDoBetter = weMatch[1].trim();
        continue;
      }
    }

    competitors.push({ name, theyDoBetter, weDoBetter });
  }

  return competitors;
}

/**
 * Normalize priority value to lowercase enum
 */
function normalizePriority(val) {
  if (!val) return null;
  const lower = String(val).toLowerCase();
  if (['high', 'medium', 'low'].includes(lower)) {
    return lower;
  }
  return null;
}

/**
 * Migrate a single onboarding document
 */
async function migrateOnboarding(ob) {
  const userId = ob.user;
  const workspaceId = ob.workspace;
  const answers = ob.answers || {};

  if (!workspaceId) {
    console.log(`[Migration] Skipping onboarding ${ob._id} - no workspace`);
    return { skipped: true };
  }

  const stats = {
    coreProjects: 0,
    departmentProjects: 0,
    products: 0,
    competitors: 0,
    orgPositions: 0,
    swotEntries: 0,
    visionGoals: 0,
  };

  const wsFilter = { workspace: workspaceId, user: userId };

  // 1. Migrate Core Projects from coreProjectDetails
  const coreProjectDetails = answers.coreProjectDetails || [];
  if (coreProjectDetails.length > 0) {
    // Check if already migrated
    const existingCoreProjects = await CoreProject.countDocuments({ ...wsFilter, isDeleted: false });
    if (existingCoreProjects === 0) {
      for (let i = 0; i < coreProjectDetails.length; i++) {
        const cp = coreProjectDetails[i];
        if (!cp.title) continue;

        await CoreProject.create({
          workspace: workspaceId,
          user: userId,
          title: cp.title,
          goal: cp.goal || '',
          cost: cp.cost || '',
          dueWhen: cp.dueWhen || '',
          priority: normalizePriority(cp.priority),
          ownerId: cp.ownerId || '',
          ownerName: cp.ownerName || '',
          deliverables: (cp.deliverables || []).map(d => ({
            text: d.text || '',
            done: d.done || false,
            kpi: d.kpi || '',
            dueWhen: d.dueWhen || '',
          })),
          order: i,
        });
        stats.coreProjects++;
      }
      console.log(`  - Migrated ${stats.coreProjects} core projects`);
    } else {
      console.log(`  - Skipping core projects (${existingCoreProjects} already exist)`);
    }
  }

  // 2. Migrate Department Projects from actionAssignments
  const actionAssignments = answers.actionAssignments || {};
  const deptKeys = Object.keys(actionAssignments);
  if (deptKeys.length > 0) {
    // Check if already migrated
    const existingDeptProjects = await DepartmentProject.countDocuments({ ...wsFilter, isDeleted: false });
    if (existingDeptProjects === 0) {
      for (const deptKey of deptKeys) {
        const projects = actionAssignments[deptKey] || [];
        for (let i = 0; i < projects.length; i++) {
          const p = projects[i];
          await DepartmentProject.create({
            workspace: workspaceId,
            user: userId,
            departmentKey: deptKey,
            title: p.title || '',
            goal: p.goal || '',
            milestone: p.milestone || '',
            resources: p.resources || '',
            dueWhen: p.dueWhen || '',
            cost: p.cost || '',
            firstName: p.firstName || '',
            lastName: p.lastName || '',
            deliverables: (p.deliverables || []).map(d => ({
              text: d.text || '',
              done: d.done || false,
              kpi: d.kpi || '',
              dueWhen: d.dueWhen || '',
            })),
            order: i,
          });
          stats.departmentProjects++;
        }
      }
      console.log(`  - Migrated ${stats.departmentProjects} department projects`);
    } else {
      console.log(`  - Skipping department projects (${existingDeptProjects} already exist)`);
    }
  }

  // 3. Migrate Products
  const products = answers.products || [];
  if (products.length > 0) {
    const existingProducts = await Product.countDocuments({ ...wsFilter, isDeleted: false });
    if (existingProducts === 0) {
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        if (!p.product && !p.name) continue;

        await Product.create({
          workspace: workspaceId,
          user: userId,
          name: p.product || p.name || '',
          description: p.description || '',
          pricing: p.pricing || p.price || '',
          price: p.price || p.pricing || '',
          unitCost: p.unitCost || '',
          monthlyVolume: p.monthlyVolume || '',
          order: i,
        });
        stats.products++;
      }
      console.log(`  - Migrated ${stats.products} products`);
    } else {
      console.log(`  - Skipping products (${existingProducts} already exist)`);
    }
  }

  // 4. Migrate Competitors
  // Try to parse compNotes first to get weDoBetter data, then fall back to arrays
  const compNotes = answers.compNotes || answers.competitorsNotes || '';
  const parsedCompetitors = parseCompNotes(compNotes);
  const competitorNames = answers.competitorNames || [];
  const competitorAdvantages = answers.competitorAdvantages || [];

  // Determine which source to use
  const hasCompNotes = parsedCompetitors.length > 0;
  const hasArrays = competitorNames.length > 0;

  if (hasCompNotes || hasArrays) {
    const existingCompetitors = await Competitor.countDocuments({ ...wsFilter, isDeleted: false });
    if (existingCompetitors === 0) {
      if (hasCompNotes) {
        // Use parsed compNotes (has weDoBetter data)
        for (let i = 0; i < parsedCompetitors.length; i++) {
          const c = parsedCompetitors[i];
          if (!c.name) continue;

          await Competitor.create({
            workspace: workspaceId,
            user: userId,
            name: c.name,
            advantage: c.theyDoBetter || '',
            weDoBetter: c.weDoBetter || '',
            order: i,
          });
          stats.competitors++;
        }
        console.log(`  - Migrated ${stats.competitors} competitors from compNotes (with weDoBetter)`);
      } else {
        // Fall back to arrays (no weDoBetter data available)
        for (let i = 0; i < competitorNames.length; i++) {
          const name = competitorNames[i];
          if (!name?.trim()) continue;

          await Competitor.create({
            workspace: workspaceId,
            user: userId,
            name: name.trim(),
            advantage: competitorAdvantages[i] || '',
            order: i,
          });
          stats.competitors++;
        }
        console.log(`  - Migrated ${stats.competitors} competitors from arrays (no weDoBetter)`);
      }
    } else {
      console.log(`  - Skipping competitors (${existingCompetitors} already exist)`);
    }
  }

  // 5. Migrate Org Positions
  const orgPositions = answers.orgPositions || [];
  if (orgPositions.length > 0) {
    const existingOrgPositions = await OrgPosition.countDocuments({ ...wsFilter, isDeleted: false });
    if (existingOrgPositions === 0) {
      for (let i = 0; i < orgPositions.length; i++) {
        const p = orgPositions[i];
        if (!p.position && !p.name) continue;

        await OrgPosition.create({
          workspace: workspaceId,
          user: userId,
          position: p.position || '',
          role: p.role || '',
          name: p.name || '',
          department: p.department || '',
          legacyParentId: p.parentId || p.parentPosition || '',
          order: i,
        });
        stats.orgPositions++;
      }
      console.log(`  - Migrated ${stats.orgPositions} org positions`);
    } else {
      console.log(`  - Skipping org positions (${existingOrgPositions} already exist)`);
    }
  }

  // 6. Migrate SWOT Entries
  const swotStrengths = parseLines(answers.swotStrengths);
  const swotWeaknesses = parseLines(answers.swotWeaknesses);
  const swotOpportunities = parseLines(answers.swotOpportunities);
  const swotThreats = parseLines(answers.swotThreats);

  const totalSwot = swotStrengths.length + swotWeaknesses.length + swotOpportunities.length + swotThreats.length;
  if (totalSwot > 0) {
    const existingSwot = await SwotEntry.countDocuments({ ...wsFilter, isDeleted: false });
    if (existingSwot === 0) {
      let order = 0;

      for (const text of swotStrengths) {
        await SwotEntry.create({
          workspace: workspaceId,
          user: userId,
          entryType: 'strength',
          text,
          order: order++,
        });
        stats.swotEntries++;
      }

      for (const text of swotWeaknesses) {
        await SwotEntry.create({
          workspace: workspaceId,
          user: userId,
          entryType: 'weakness',
          text,
          order: order++,
        });
        stats.swotEntries++;
      }

      for (const text of swotOpportunities) {
        await SwotEntry.create({
          workspace: workspaceId,
          user: userId,
          entryType: 'opportunity',
          text,
          order: order++,
        });
        stats.swotEntries++;
      }

      for (const text of swotThreats) {
        await SwotEntry.create({
          workspace: workspaceId,
          user: userId,
          entryType: 'threat',
          text,
          order: order++,
        });
        stats.swotEntries++;
      }

      console.log(`  - Migrated ${stats.swotEntries} SWOT entries`);
    } else {
      console.log(`  - Skipping SWOT entries (${existingSwot} already exist)`);
    }
  }

  // 7. Migrate Vision Goals from vision1y and vision3y
  const vision1yGoals = parseLines(answers.vision1y);
  const vision3yGoals = parseLines(answers.vision3y);
  const totalVisionGoals = vision1yGoals.length + vision3yGoals.length;

  if (totalVisionGoals > 0) {
    const existingVisionGoals = await VisionGoal.countDocuments({ ...wsFilter, isDeleted: false });
    if (existingVisionGoals === 0) {
      let order = 0;

      for (const text of vision1yGoals) {
        await VisionGoal.create({
          workspace: workspaceId,
          user: userId,
          goalType: '1y',
          text,
          order: order++,
        });
        stats.visionGoals++;
      }

      // Reset order for 3-year goals
      order = 0;
      for (const text of vision3yGoals) {
        await VisionGoal.create({
          workspace: workspaceId,
          user: userId,
          goalType: '3y',
          text,
          order: order++,
        });
        stats.visionGoals++;
      }

      console.log(`  - Migrated ${stats.visionGoals} vision goals`);
    } else {
      console.log(`  - Skipping vision goals (${existingVisionGoals} already exist)`);
    }
  }

  return stats;
}

async function main() {
  try {
    await connect();

    console.log('\n[Migration] Starting migration from Onboarding.answers to individual collections...\n');

    // Get all onboarding documents
    const onboardings = await Onboarding.find({}).lean();
    console.log(`[Migration] Found ${onboardings.length} onboarding documents\n`);

    let totalStats = {
      coreProjects: 0,
      departmentProjects: 0,
      products: 0,
      competitors: 0,
      orgPositions: 0,
      swotEntries: 0,
      visionGoals: 0,
      skipped: 0,
    };

    for (const ob of onboardings) {
      console.log(`[Migration] Processing onboarding ${ob._id} (workspace: ${ob.workspace})`);

      const stats = await migrateOnboarding(ob);

      if (stats.skipped) {
        totalStats.skipped++;
      } else {
        totalStats.coreProjects += stats.coreProjects || 0;
        totalStats.departmentProjects += stats.departmentProjects || 0;
        totalStats.products += stats.products || 0;
        totalStats.competitors += stats.competitors || 0;
        totalStats.orgPositions += stats.orgPositions || 0;
        totalStats.swotEntries += stats.swotEntries || 0;
        totalStats.visionGoals += stats.visionGoals || 0;
      }
    }

    console.log('\n[Migration] === MIGRATION COMPLETE ===');
    console.log(`  Total Core Projects: ${totalStats.coreProjects}`);
    console.log(`  Total Department Projects: ${totalStats.departmentProjects}`);
    console.log(`  Total Products: ${totalStats.products}`);
    console.log(`  Total Competitors: ${totalStats.competitors}`);
    console.log(`  Total Org Positions: ${totalStats.orgPositions}`);
    console.log(`  Total SWOT Entries: ${totalStats.swotEntries}`);
    console.log(`  Total Vision Goals: ${totalStats.visionGoals}`);
    console.log(`  Skipped (no workspace): ${totalStats.skipped}`);
    console.log('');

  } catch (err) {
    console.error('[Migration] ERROR:', err);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

main();
