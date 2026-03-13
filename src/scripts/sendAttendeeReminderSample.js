/**
 * Send sample Review Attendee Reminder email
 * Usage:
 *   node src/scripts/sendAttendeeReminderSample.js --to you@example.com
 */

require('dotenv').config();
const { Resend } = require('resend');
const { generateReviewAttendeeReminder } = require('../emails/reviewAttendeeReminder');

async function main() {
  const args = process.argv.slice(2);
  let to = null;
  const toEq = args.find(a => a.startsWith('--to='));
  if (toEq) to = toEq.split('=')[1];
  else if (args[0] === '--to' && args[1]) to = args[1];
  else if (args[0] && args[0].includes('@')) to = args[0];
  if (!to) {
    console.error('Usage: node src/scripts/sendAttendeeReminderSample.js --to you@example.com');
    process.exit(1);
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    process.exit(1);
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';

  const data = {
    attendeeName: 'PlanGenie User',
    ownerName: 'Owner Name',
    cadenceType: 'weekly',
    reviewUrl: 'https://app.plangenie.com/reviews',
    reviewStartedAt: new Date(),
    actionItems: [
      { text: 'Update project Alpha timeline', dueWhen: 'Mar 18', status: 'In Progress' },
      { text: 'Share feedback on beta test', dueWhen: 'Mar 20', status: 'Not started' },
    ],
  };
  const { html, text, subject } = generateReviewAttendeeReminder(data);

  console.log('Sending Review Attendee Reminder sample...');
  const result = await resend.emails.send({ from, to, subject, html, text });
  if (result?.error) {
    console.error('Send error:', result.error);
  } else {
    console.log('Sent. id:', result?.data?.id || 'ok');
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

