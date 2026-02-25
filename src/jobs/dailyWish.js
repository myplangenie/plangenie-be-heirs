/**
 * Daily Wish Job
 * Sends personalized AI-generated business recommendations daily at 12 noon Eastern Time.
 */

const cron = require('node-cron');
const { Resend } = require('resend');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Onboarding = require('../models/Onboarding');
const DailyWish = require('../models/DailyWish');
const { buildAgentContext, callOpenAIJSON } = require('../agents/base');
const { generateDailyWish } = require('../emails/dailyWish');

let isRunning = false;

// Categories for daily wishes
const CATEGORIES = ['growth', 'operations', 'finance', 'team', 'strategy', 'marketing', 'sales'];

/**
 * Get today's date in YYYY-MM-DD format for Eastern Time
 */
function getTodayDateET() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/**
 * Check if a notification should be sent based on frequency setting
 * @param {string} frequency - 'daily', 'weekly', 'monthly', 'never'
 * @returns {boolean} - true if should send today
 */
function shouldSendByFrequency(frequency) {
  if (!frequency || frequency === 'daily') return true;
  if (frequency === 'never') return false;

  const now = new Date();
  // Convert to Eastern Time
  const etOptions = { timeZone: 'America/Toronto' };
  const etDate = new Date(now.toLocaleString('en-US', etOptions));

  if (frequency === 'weekly') {
    // Send on Monday (day 1)
    return etDate.getDay() === 1;
  }

  if (frequency === 'monthly') {
    // Send on 1st of month
    return etDate.getDate() === 1;
  }

  return true; // Default to sending
}

/**
 * Generate AI recommendation for a user
 */
async function generateWishForUser(context) {
  const categoryRotation = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)];

  const prompt = `You are a business advisor creating a "Daily Wish" - a single actionable recommendation for a business owner to focus on TODAY.

BUSINESS CONTEXT:
${context.businessName ? `Business: ${context.businessName}` : ''}
${context.industry ? `Industry: ${context.industry}` : ''}
${context.ventureType ? `Type: ${context.ventureType}` : ''}
${context.businessStage ? `Stage: ${context.businessStage}` : ''}
${context.teamSize ? `Team Size: ${context.teamSize}` : ''}
${context.ubp ? `Unique Value Proposition: ${context.ubp}` : ''}
${context.purpose ? `Business Purpose: ${context.purpose}` : ''}
${context.vision1y ? `1-Year Goals: ${context.vision1y}` : ''}
${context.marketCustomer ? `Target Customers: ${context.marketCustomer}` : ''}
${context.coreProjectDetails?.length > 0 ? `Active Projects: ${context.coreProjectDetails.map(p => p.title).join(', ')}` : ''}

CATEGORY FOCUS: ${categoryRotation}

Generate a personalized, actionable recommendation that:
1. Is specific to THIS business (reference their actual context when possible)
2. Can be completed or started TODAY
3. Provides concrete value
4. Is encouraging and motivating
5. Focuses on the ${categoryRotation} aspect of their business

Return JSON with this structure:
{
  "title": "Short, action-oriented title (max 60 chars)",
  "message": "2-3 sentences explaining the recommendation and why it matters for their business specifically. Be specific and actionable.",
  "category": "${categoryRotation}"
}`;

  try {
    const { data } = await callOpenAIJSON(prompt, {
      model: 'gpt-4o-mini',
      temperature: 0.8,
      maxTokens: 500,
      systemPrompt: 'You are an encouraging business advisor who provides practical, actionable daily recommendations. Always return valid JSON.',
    });

    if (data?.title && data?.message) {
      return {
        title: String(data.title).slice(0, 100),
        message: String(data.message).slice(0, 1000),
        category: CATEGORIES.includes(data.category) ? data.category : categoryRotation,
      };
    }
  } catch (err) {
    console.error('[dailyWish] AI generation error:', err?.message || err);
  }

  // Fallback if AI fails
  return {
    title: 'Take a moment to review your goals',
    message: `Today is a great day to revisit your business goals and ensure your daily activities align with your long-term vision. Consider: What one action today will move you closest to your objectives?`,
    category: 'strategy',
  };
}

/**
 * Send daily wish to a single user
 */
async function sendWishToUser(user, resend, fromAddress, dashboardUrl) {
  try {
    const todayDate = getTodayDateET();

    // Get user's default workspace with notification preferences
    const workspace = await Workspace.findOne({ user: user._id, defaultWorkspace: true }).lean();
    if (!workspace) {
      return { sent: false, reason: 'no_workspace' };
    }

    // Check notification frequency preference (default to weekly)
    const frequency = workspace.notificationPreferences?.emailFrequency?.dailyWish || 'weekly';
    if (!shouldSendByFrequency(frequency)) {
      return { sent: false, reason: 'frequency_skip' };
    }

    // Check if daily wish emails are disabled entirely
    const dailyWishEnabled = workspace.notificationPreferences?.email?.dailyWish;
    if (dailyWishEnabled === false) {
      return { sent: false, reason: 'disabled' };
    }

    // Check if already sent today for this workspace
    const existingWish = await DailyWish.findOne({
      user: user._id,
      workspace: workspace._id,
      wishDate: todayDate,
    }).lean();

    if (existingWish) {
      return { sent: false, reason: 'already_sent' };
    }

    // Get user's onboarding data
    const ob = await Onboarding.findOne({ user: user._id, workspace: workspace._id }).lean();
    const businessName = ob?.businessProfile?.businessName || '';

    // Build context and generate wish
    const context = await buildAgentContext(user._id, workspace._id);
    const { title, message, category } = await generateWishForUser(context);

    // Save wish to database
    const dailyWish = await DailyWish.create({
      user: user._id,
      workspace: workspace._id,
      wishDate: todayDate,
      title,
      message,
      category,
    });

    // Generate email content
    const userName = user.firstName || user.fullName || user.email.split('@')[0];
    const unsubscribeUrl = `${dashboardUrl}/settings?tab=notifications`;
    const { html, text, subject } = generateDailyWish({
      userName,
      businessName,
      title,
      message,
      category,
      dashboardUrl,
      unsubscribeUrl,
    });

    // Send email with List-Unsubscribe header for better deliverability
    const result = await resend.emails.send({
      from: fromAddress,
      to: user.email,
      subject,
      html,
      text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    if (result?.error) {
      console.error(`[dailyWish] Email send error for ${user.email}:`, result.error?.message || result.error);
      return { sent: false, reason: 'send_error', error: result.error?.message };
    }

    // Update wish record
    await DailyWish.findByIdAndUpdate(dailyWish._id, {
      emailSent: true,
      emailSentAt: new Date(),
    });

    return {
      sent: true,
      title,
      category,
    };
  } catch (err) {
    console.error(`[dailyWish] Error processing user ${user._id}:`, err?.message || err);
    return { sent: false, reason: 'error', error: err?.message || String(err) };
  }
}

/**
 * Process a batch of users concurrently
 */
async function processBatch(users, resend, fromAddress, dashboardUrl) {
  const results = await Promise.allSettled(
    users.map((user) => sendWishToUser(user, resend, fromAddress, dashboardUrl))
  );

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const r = result.value;
      if (r.sent) {
        sent++;
        console.log(`[dailyWish] Sent to ${users[index].email}: "${r.title}" (${r.category})`);
      } else if (r.reason === 'already_sent' || r.reason === 'no_workspace' || r.reason === 'frequency_skip' || r.reason === 'disabled') {
        skipped++;
      } else {
        errors++;
      }
    } else {
      errors++;
      console.error(`[dailyWish] Failed for ${users[index].email}:`, result.reason);
    }
  });

  return { sent, skipped, errors };
}

/**
 * Main job function: send daily wishes to all eligible users
 */
async function runJob() {
  if (isRunning) {
    console.log('[dailyWish] Job already running, skipping');
    return;
  }

  // Check if required env vars are configured
  if (!process.env.RESEND_API_KEY) {
    console.log('[dailyWish] RESEND_API_KEY not configured, skipping');
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.log('[dailyWish] OPENAI_API_KEY not configured, skipping');
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log('[dailyWish] Starting daily wish job...');

  // Concurrency settings
  const BATCH_SIZE = 5; // Smaller batches due to AI calls
  const BATCH_DELAY_MS = 500; // Longer delay for AI rate limits

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromAddress = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://www.plangenie.com/dashboard';

    // Get all active users (exclude collaborators - they view owner's data)
    const users = await User.find({
      isVerified: true,
      status: 'active',
      isCollaborator: { $ne: true },
    })
      .select('_id email firstName fullName')
      .lean();

    console.log(`[dailyWish] Processing ${users.length} users in batches of ${BATCH_SIZE}...`);

    let sentCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    // Process in batches
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(users.length / BATCH_SIZE);

      console.log(`[dailyWish] Processing batch ${batchNum}/${totalBatches}...`);

      const { sent, skipped, errors } = await processBatch(batch, resend, fromAddress, dashboardUrl);
      sentCount += sent;
      skipCount += skipped;
      errorCount += errors;

      // Delay between batches
      if (i + BATCH_SIZE < users.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    const duration = Date.now() - startTime;
    console.log(
      `[dailyWish] Job completed in ${duration}ms. Sent: ${sentCount}, Skipped: ${skipCount}, Errors: ${errorCount}`
    );
  } catch (err) {
    console.error('[dailyWish] Job failed:', err?.message || err);
  } finally {
    isRunning = false;
  }
}

/**
 * Initialize the cron job
 * Runs daily at 12 noon Eastern Time (Canada)
 * Uses timezone option to handle DST automatically
 */
function init() {
  // Run at 12:00 PM Eastern Time daily (handles DST automatically)
  cron.schedule('0 12 * * *', () => {
    runJob().catch((err) => {
      console.error('[dailyWish] Unhandled error:', err);
    });
  }, {
    timezone: 'America/Toronto'
  });

  console.log('[dailyWish] Job scheduled for daily at 12 noon Eastern Time (America/Toronto)');
}

module.exports = {
  init,
  runJob,
  sendWishToUser,
  generateWishForUser,
  getTodayDateET,
};