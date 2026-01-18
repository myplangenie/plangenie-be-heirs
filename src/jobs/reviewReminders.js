/**
 * Review Reminders Job
 * Sends review reminder emails based on user's cadence settings (weekly/monthly/quarterly)
 */

const cron = require('node-cron');
const { Resend } = require('resend');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Journey = require('../models/Journey');
const Onboarding = require('../models/Onboarding');
const ReviewSession = require('../models/ReviewSession');
const scoringService = require('../services/scoringService');
const { generateReviewReminder } = require('../emails/reviewReminder');

let isRunning = false;

/**
 * Get the current day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
 */
function getCurrentDayOfWeek() {
  return new Date().getDay();
}

/**
 * Get the current day of month (1-31)
 */
function getCurrentDayOfMonth() {
  return new Date().getDate();
}

/**
 * Get the current month (1-12)
 */
function getCurrentMonth() {
  return new Date().getMonth() + 1;
}

/**
 * Check if today is a quarterly review day
 * Quarterly reviews happen on the specified dayOfMonth in months 1, 4, 7, 10
 */
function isQuarterlyReviewDay(dayOfMonth) {
  const currentMonth = getCurrentMonth();
  const currentDay = getCurrentDayOfMonth();
  const quarterMonths = [1, 4, 7, 10]; // January, April, July, October
  return quarterMonths.includes(currentMonth) && currentDay === dayOfMonth;
}

/**
 * Check if user should receive a reminder today based on their cadence settings
 * @param {Object} cadence - { weekly, monthly, quarterly, dayOfWeek, dayOfMonth }
 * @returns {string|null} - The cadence type to remind for, or null if no reminder today
 */
function shouldRemindToday(cadence) {
  if (!cadence) return null;

  const currentDayOfWeek = getCurrentDayOfWeek();
  const currentDayOfMonth = getCurrentDayOfMonth();

  // Check weekly
  if (cadence.weekly) {
    const targetDayOfWeek = cadence.dayOfWeek ?? 1; // Default Monday
    if (currentDayOfWeek === targetDayOfWeek) {
      return 'weekly';
    }
  }

  // Check monthly
  if (cadence.monthly) {
    const targetDayOfMonth = cadence.dayOfMonth ?? 1; // Default 1st
    // Handle end of month edge case (if target is 31 but month has fewer days)
    const lastDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const effectiveDay = Math.min(targetDayOfMonth, lastDayOfMonth);
    if (currentDayOfMonth === effectiveDay) {
      return 'monthly';
    }
  }

  // Check quarterly
  if (cadence.quarterly) {
    const targetDayOfMonth = cadence.dayOfMonth ?? 1; // Default 1st
    if (isQuarterlyReviewDay(targetDayOfMonth)) {
      return 'quarterly';
    }
  }

  return null;
}

/**
 * Get upcoming deliverables for a user (due in next 7 days)
 */
function getUpcomingDeliverables(scoredItems) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const nextWeek = new Date(now);
  nextWeek.setDate(now.getDate() + 7);
  nextWeek.setHours(23, 59, 59, 999);

  return scoredItems.filter((item) => {
    const due = scoringService.parseDate(item.dueWhen);
    if (!due) return false;
    return due >= now && due <= nextWeek;
  }).slice(0, 10); // Limit to 10 items
}

/**
 * Count open reviews for a workspace
 */
async function countOpenReviews(workspaceId) {
  try {
    const count = await ReviewSession.countDocuments({ workspace: workspaceId, status: 'open' });
    return count;
  } catch (err) {
    console.error('[reviewReminders] Error counting open reviews:', err.message);
    return 0;
  }
}

/**
 * Send review reminder to a single user
 */
async function sendReminderToUser(user, resend, fromAddress, dashboardUrl) {
  try {
    // Get user's default workspace with notification preferences
    const workspace = await Workspace.findOne({ user: user._id, defaultWorkspace: true }).lean();
    if (!workspace) {
      return { sent: false, reason: 'no_workspace' };
    }

    // Check if review reminders are enabled (in-app setting)
    const reviewRemindersEnabled = workspace.notificationPreferences?.inApp?.reviewReminders;
    if (reviewRemindersEnabled === false) {
      return { sent: false, reason: 'disabled' };
    }

    // Get user's default journey and its cadence settings
    const journey = await Journey.findOne({ user: user._id, defaultJourney: true }).lean();

    // Use journey cadence if available, otherwise fall back to workspace cadence
    const cadence = journey?.reviewCadence || workspace.reviewCadence || { weekly: true, dayOfWeek: 1 };

    // Check if user should receive a reminder today
    const cadenceType = shouldRemindToday(cadence);
    if (!cadenceType) {
      return { sent: false, reason: 'not_today' };
    }

    // Get onboarding data for deliverables
    const ob = await Onboarding.findOne({ user: user._id, workspace: workspace._id }).lean();
    const answers = ob?.answers || {};

    // Extract and score items
    const items = scoringService.extractItems(answers);
    const context = { allItems: items };

    const scoredItems = items.map((item) => {
      const { scores, totalScore } = scoringService.calculateScore(item, context);
      return { ...item, scores, totalScore };
    });

    // Get upcoming deliverables
    const upcomingDeliverables = getUpcomingDeliverables(scoredItems).map((item) => ({
      title: item.title,
      dueWhen: item.dueWhen,
      projectTitle: item.projectTitle || null,
    }));

    // Count open reviews
    const openReviewCount = await countOpenReviews(workspace._id);

    // Generate email content
    const userName = user.firstName || user.fullName || user.email.split('@')[0];
    const reviewUrl = `${dashboardUrl}/reviews`;

    const { html, text, subject } = generateReviewReminder({
      userName,
      cadenceType,
      reviewUrl,
      openReviewCount,
      upcomingDeliverables,
    });

    // Send email
    const result = await resend.emails.send({
      from: fromAddress,
      to: user.email,
      subject,
      html,
      text,
    });

    if (result?.error) {
      console.error(`[reviewReminders] Email send error for ${user.email}:`, result.error?.message || result.error);
      return { sent: false, reason: 'send_error', error: result.error?.message };
    }

    // Update last sent timestamp
    await User.findByIdAndUpdate(user._id, {
      'notifications.lastReviewReminderSent': new Date(),
    });

    return {
      sent: true,
      cadenceType,
      upcomingCount: upcomingDeliverables.length,
    };
  } catch (err) {
    console.error(`[reviewReminders] Error processing user ${user._id}:`, err?.message || err);
    return { sent: false, reason: 'error', error: err?.message || String(err) };
  }
}

/**
 * Process a batch of users concurrently
 */
async function processBatch(users, resend, fromAddress, dashboardUrl) {
  const results = await Promise.allSettled(
    users.map((user) => sendReminderToUser(user, resend, fromAddress, dashboardUrl))
  );

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const r = result.value;
      if (r.sent) {
        sent++;
        console.log(`[reviewReminders] Sent ${r.cadenceType} reminder to ${users[index].email}`);
      } else if (['not_today', 'no_workspace', 'disabled'].includes(r.reason)) {
        skipped++;
      } else {
        errors++;
      }
    } else {
      errors++;
      console.error(`[reviewReminders] Failed for ${users[index].email}:`, result.reason);
    }
  });

  return { sent, skipped, errors };
}

/**
 * Main job function: send review reminders to all eligible users
 */
async function runJob() {
  if (isRunning) {
    console.log('[reviewReminders] Job already running, skipping');
    return;
  }

  // Check if Resend is configured
  if (!process.env.RESEND_API_KEY) {
    console.log('[reviewReminders] RESEND_API_KEY not configured, skipping');
    return;
  }

  isRunning = true;
  const startTime = Date.now();
  console.log('[reviewReminders] Starting review reminders job...');

  // Concurrency settings
  const BATCH_SIZE = 10;
  const BATCH_DELAY_MS = 200;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const fromAddress = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
    const dashboardUrl = process.env.DASHBOARD_URL || 'https://www.plangenie.com/dashboard';

    // Get all verified active users (exclude collaborators)
    const users = await User.find({
      isVerified: true,
      status: 'active',
      isCollaborator: { $ne: true },
    })
      .select('_id email firstName fullName notifications')
      .lean();

    console.log(`[reviewReminders] Processing ${users.length} users in batches of ${BATCH_SIZE}...`);

    let sentCount = 0;
    let skipCount = 0;
    let errorCount = 0;

    // Process in batches
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      const batch = users.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(users.length / BATCH_SIZE);

      console.log(`[reviewReminders] Processing batch ${batchNum}/${totalBatches}...`);

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
      `[reviewReminders] Job completed in ${duration}ms. Sent: ${sentCount}, Skipped: ${skipCount}, Errors: ${errorCount}`
    );
  } catch (err) {
    console.error('[reviewReminders] Job failed:', err?.message || err);
  } finally {
    isRunning = false;
  }
}

/**
 * Initialize the cron job
 * Runs every day at 8 AM Eastern Time (Canada)
 * Cron: minute hour dayOfMonth month dayOfWeek
 * 0 13 * * * = At 13:00 UTC daily = 8 AM EST / 9 AM EDT
 */
function init() {
  cron.schedule('0 13 * * *', () => {
    runJob().catch((err) => {
      console.error('[reviewReminders] Unhandled error:', err);
    });
  });

  console.log('[reviewReminders] Job scheduled for daily at 8 AM Eastern (13:00 UTC)');
}

module.exports = {
  init,
  runJob,
  sendReminderToUser,
  shouldRemindToday,
};
