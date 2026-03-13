/**
 * Send sample branded emails (invite-style header) to a target address.
 * Usage:
 *   node src/scripts/sendSampleEmails.js --to you@example.com
 */

require('dotenv').config();
const { Resend } = require('resend');
const { generateWeeklyDigest } = require('../emails/weeklyDigest');
const { generateDailyWish } = require('../emails/dailyWish');
const { generateReviewReminder } = require('../emails/reviewReminder');

async function main() {
  const args = process.argv.slice(2);
  let to = null;
  const toEq = args.find(a => a.startsWith('--to='));
  if (toEq) to = toEq.split('=')[1];
  else if (args[0] === '--to' && args[1]) to = args[1];
  else if (args[0] && args[0].includes('@')) to = args[0];
  if (!to) {
    console.error('Usage: node src/scripts/sendSampleEmails.js --to you@example.com');
    process.exit(1);
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    process.exit(1);
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';

  const dashboardUrl = process.env.DASHBOARD_URL || 'https://app.plangenie.com';

  // 1) Weekly Digest sample
  const weeklyData = {
    userName: 'PlanGenie User',
    overdueItems: [
      { title: 'Finalize Q2 OKR metrics', dueWhen: 'Mar 01', projectTitle: 'Improve Sales Conversion' },
      { title: 'Send follow-up to leads', dueWhen: 'Mar 02', projectTitle: 'Lead Nurturing' },
    ],
    dueThisWeek: [
      { title: 'Close vendor contract', dueWhen: 'Mar 14', projectTitle: 'Vendor Onboarding' },
      { title: 'Publish pricing page update', dueWhen: 'Mar 16', projectTitle: 'Website Refresh' },
    ],
    dashboardUrl,
  };
  const weekly = generateWeeklyDigest(weeklyData);

  // 2) Daily Wish sample (uses weekly template variables naming but we changed header)
  const wishData = {
    userName: 'PlanGenie User',
    businessName: 'Acme Corp',
    title: 'Focus on closing top 5 opportunities',
    message: 'Review your pipeline and prioritize outreach to the five highest-value opportunities. Confirm next steps and address blockers to maintain momentum.',
    category: 'sales',
    dashboardUrl,
    unsubscribeUrl: dashboardUrl + '/settings?tab=notifications',
  };
  const wish = generateDailyWish(wishData);

  // 3) Review Reminder sample
  const reviewData = {
    userName: 'PlanGenie User',
    cadenceType: 'weekly',
    reviewUrl: dashboardUrl + '/reviews',
    openReviewCount: 1,
    upcomingDeliverables: [
      { title: 'Prepare weekly report', dueWhen: 'Mar 15', projectTitle: 'Core Operations' },
    ],
  };
  const review = generateReviewReminder(reviewData);

  // Send emails sequentially
  async function sendOne(subject, html, text) {
    const result = await resend.emails.send({ from, to: [to], subject, html, text });
    if (result?.error) {
      console.error('Send error:', result.error);
    } else {
      console.log('Sent:', subject, '→ id', result?.data?.id || 'ok');
    }
  }

  console.log('Sending Weekly Digest sample...');
  await sendOne(weekly.subject || 'Your Weekly Plan Genie Update', weekly.html, weekly.text);
  await new Promise(r => setTimeout(r, 800));

  console.log('Sending Daily Wish sample...');
  await sendOne(wish.subject || 'Your Plan Genie Recommendation', wish.html, wish.text);
  await new Promise(r => setTimeout(r, 800));

  console.log('Sending Review Reminder sample...');
  await sendOne(review.subject || 'Time for Your Review', review.html, review.text);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
