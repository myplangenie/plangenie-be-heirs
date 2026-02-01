/**
 * Generate weDoBetter for all competitors using AI
 *
 * Uses the business context and competitor advantages to generate
 * relevant "What we do better" responses.
 *
 * Run with: node scripts/generate-wedobetter-ai.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });
const mongoose = require('mongoose');
const OpenAI = require('openai');

const Competitor = require('../src/models/Competitor');
const Onboarding = require('../src/models/Onboarding');
const Workspace = require('../src/models/Workspace');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/plangenie';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function connect() {
  console.log('[AI Migration] Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('[AI Migration] Connected to MongoDB');
}

async function disconnect() {
  await mongoose.disconnect();
  console.log('[AI Migration] Disconnected from MongoDB');
}

/**
 * Get business context for a workspace
 */
async function getBusinessContext(workspaceId) {
  const onboarding = await Onboarding.findOne({ workspace: workspaceId }).lean();
  const workspace = await Workspace.findById(workspaceId).lean();

  const businessName = onboarding?.businessProfile?.businessName ||
                       onboarding?.answers?.businessName ||
                       workspace?.name ||
                       'Our company';

  const description = onboarding?.businessProfile?.description ||
                      onboarding?.answers?.ubp ||
                      '';

  const industry = onboarding?.businessProfile?.industry || '';

  const purpose = onboarding?.answers?.purpose || '';

  const valuesCore = onboarding?.answers?.valuesCore || '';

  return {
    businessName,
    description,
    industry,
    purpose,
    valuesCore,
  };
}

/**
 * Generate weDoBetter using AI - same style as "what they do better"
 */
async function generateWeDoBetter(businessContext, competitorName, competitorAdvantage) {
  const { businessName, description, industry, purpose, valuesCore } = businessContext;

  // Build context similar to how it's done in ai.controller.js
  const contextLines = [];
  if (businessName) contextLines.push(`Business Name: ${businessName}`);
  if (industry) contextLines.push(`Industry: ${industry}`);
  if (description) contextLines.push(`Description: ${description}`);
  if (purpose) contextLines.push(`Purpose: ${purpose}`);
  if (valuesCore) contextLines.push(`Core Values: ${valuesCore}`);
  const contextText = contextLines.join('\n');

  const input = `Competitor name: ${competitorName}\nWhat they do better: ${competitorAdvantage || 'Not specified'}`;

  const system = 'You are a helpful business planning assistant. ' +
    'Write crisp, human-sounding suggestions in plain language. ' +
    'Avoid marketing buzzwords. Be specific and concrete. ' +
    'Always keep suggestions consistent with any provided context and user input — do not contradict earlier answers.';

  const userPrompt = `Context:\n${contextText}\n\n${input}\n\nProvide a one-line competitive advantage (what we do better than this competitor). Just the statement, no prefix or label.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content?.trim() || '';
  } catch (err) {
    console.error(`    Error generating for ${competitorName}:`, err.message);
    return '';
  }
}

async function main() {
  try {
    await connect();

    if (!process.env.OPENAI_API_KEY) {
      console.error('[AI Migration] ERROR: OPENAI_API_KEY not set in environment');
      process.exit(1);
    }

    console.log('\n[AI Migration] Generating weDoBetter for competitors without it...\n');

    // Find ALL competitors (overwrite existing weDoBetter)
    const competitors = await Competitor.find({
      isDeleted: false,
    }).lean();

    console.log(`[AI Migration] Found ${competitors.length} competitors - will regenerate weDoBetter for all\n`);

    // Group by workspace to get context once per workspace
    const byWorkspace = {};
    for (const c of competitors) {
      const wsId = c.workspace.toString();
      if (!byWorkspace[wsId]) {
        byWorkspace[wsId] = [];
      }
      byWorkspace[wsId].push(c);
    }

    let totalUpdated = 0;
    let totalFailed = 0;

    for (const [wsId, wsCompetitors] of Object.entries(byWorkspace)) {
      console.log(`[AI Migration] Processing workspace ${wsId} (${wsCompetitors.length} competitors)`);

      // Get business context
      const context = await getBusinessContext(wsId);
      console.log(`  Business: ${context.businessName}`);

      for (const comp of wsCompetitors) {
        console.log(`  - Generating for "${comp.name}"...`);

        const weDoBetter = await generateWeDoBetter(context, comp.name, comp.advantage);

        if (weDoBetter) {
          await Competitor.updateOne(
            { _id: comp._id },
            { $set: { weDoBetter } }
          );
          console.log(`    ✓ "${weDoBetter.substring(0, 60)}..."`);
          totalUpdated++;
        } else {
          console.log(`    ✗ Failed to generate`);
          totalFailed++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log('\n[AI Migration] === COMPLETE ===');
    console.log(`  Total updated: ${totalUpdated}`);
    console.log(`  Total failed: ${totalFailed}`);
    console.log('');

  } catch (err) {
    console.error('[AI Migration] ERROR:', err);
    process.exit(1);
  } finally {
    await disconnect();
  }
}

main();
