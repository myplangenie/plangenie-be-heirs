/**
 * Send invite-style versions of all main emails for visual review.
 * Usage:
 *   node src/scripts/sendInviteStyleSamples.js --to you@example.com
 */

require('dotenv').config();
const { Resend } = require('resend');
const { buildInviteStyleEmail } = require('../emails/utils/inviteLayout');

function escape(s){return String(s||'').replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[c]));}

async function main() {
  let to = null;
  const args = process.argv.slice(2);
  const toEq = args.find(a=>a.startsWith('--to='));
  if (toEq) to = toEq.split('=')[1]; else if (args[0]==='--to'&&args[1]) to=args[1]; else if(args[0]&&args[0].includes('@')) to=args[0];
  if (!to) { console.error('Usage: node src/scripts/sendInviteStyleSamples.js --to you@example.com'); process.exit(1); }
  if (!process.env.RESEND_API_KEY) { console.error('RESEND_API_KEY not configured'); process.exit(1); }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';

  const dashboardUrl = process.env.DASHBOARD_URL || 'https://app.plangenie.com';

  // Weekly Digest (invite-style)
  const weeklyOverdue = [
    { title: 'Finalize Q2 OKR metrics', dueWhen: 'Mar 01', projectTitle: 'Improve Sales Conversion' },
    { title: 'Send follow-up to leads', dueWhen: 'Mar 02', projectTitle: 'Lead Nurturing' },
  ];
  const weeklyDue = [
    { title: 'Close vendor contract', dueWhen: 'Mar 14', projectTitle: 'Vendor Onboarding' },
    { title: 'Publish pricing page update', dueWhen: 'Mar 16', projectTitle: 'Website Refresh' },
  ];
  const total = weeklyOverdue.length + weeklyDue.length;
  let weeklySubject = 'Your Weekly Plan Genie Update';
  if (weeklyOverdue.length && weeklyDue.length) weeklySubject = `${weeklyOverdue.length} overdue + ${weeklyDue.length} due this week`;
  const weeklyLines = [];
  weeklyLines.push(`<strong>Hi PlanGenie User,</strong>`);
  weeklyLines.push(escape(total>0?`Here's your weekly summary. You have ${total} items that need your attention.`:'Great news! You\'re all caught up with no overdue or upcoming items this week.'));
  if (weeklyOverdue.length){
    weeklyLines.push('<br/><strong>Overdue ('+weeklyOverdue.length+')</strong>');
    weeklyLines.push(weeklyOverdue.map(it=>`• ${escape(it.title)} — Was due: ${escape(it.dueWhen)} | ${escape(it.projectTitle)}`).join('<br/>'));
  }
  if (weeklyDue.length){
    weeklyLines.push('<br/><strong>Due This Week ('+weeklyDue.length+')</strong>');
    weeklyLines.push(weeklyDue.map(it=>`• ${escape(it.title)} — Due: ${escape(it.dueWhen)} | ${escape(it.projectTitle)}`).join('<br/>'));
  }
  const weekly = buildInviteStyleEmail({
    title: 'Weekly Progress Update',
    bodyHtml: weeklyLines.join('<br/>'),
    button: { label: 'View Your Dashboard', href: dashboardUrl },
    footerLines: ['Plan Genie Inc. · Vancouver, Canada', "You're receiving this because you signed up for Plan Genie."],
  });
  console.log('Sending Invite-Style Weekly Digest...');
  await resend.emails.send({ from, to, subject: weeklySubject, html: weekly.html, text: weekly.text });

  // Daily Wish (invite-style)
  const wishBody = [
    '<strong>Good day, PlanGenie User!</strong>',
    'Here\'s your personalized recommendation for <strong>Acme Corp</strong> today:',
    '<br/><strong>Strategy</strong>',
    escape('Focus on closing top 5 opportunities'),
    escape('Review your pipeline and prioritize outreach to the five highest-value opportunities. Confirm next steps and address blockers to maintain momentum.'),
  ].join('<br/>' );
  const wish = buildInviteStyleEmail({ title: 'Your Recommendation', bodyHtml: wishBody, button: { label: 'Open Your Dashboard', href: dashboardUrl }, footerLines: ['Plan Genie Inc. · Vancouver, Canada', "You're receiving this because you signed up for Plan Genie."] });
  console.log('Sending Invite-Style Daily Wish...');
  await resend.emails.send({ from, to, subject: 'Weekly Tip: Focus on closing top 5 opportunities', html: wish.html, text: wish.text });

  // Review Reminder (invite-style)
  const deliverables = [
    { title: 'Prepare weekly report', dueWhen: 'Mar 15', projectTitle: 'Core Operations' },
  ];
  const rrLines = [];
  rrLines.push('<strong>Hi PlanGenie User,</strong>');
  rrLines.push('It\'s time for your weekly review session. Take a few minutes to reflect on your progress, update project statuses, and plan for the next period.');
  if (deliverables.length){
    rrLines.push('<br/><strong>Upcoming Deliverables</strong>');
    rrLines.push(deliverables.map(d=>`• ${escape(d.title)} — Due: ${escape(d.dueWhen)} | ${escape(d.projectTitle)}`).join('<br/>'));
  }
  const rr = buildInviteStyleEmail({ title: 'Weekly Review Reminder', bodyHtml: rrLines.join('<br/>'), button: { label: 'Start Your Review', href: dashboardUrl + '/reviews' }, footerLines: ['Plan Genie Inc. · Vancouver, Canada', "You're receiving this because you signed up for Plan Genie."] });
  console.log('Sending Invite-Style Review Reminder...');
  await resend.emails.send({ from, to, subject: 'Time for Your Weekly Review', html: rr.html, text: rr.text });

  // Review Attendee Reminder (invite-style)
  const arLines = [];
  arLines.push('<strong>Hi PlanGenie User,</strong>');
  arLines.push("You've been included in <strong>Owner Name</strong>'s weekly review session.");
  arLines.push('<br/><strong>Your Action Items</strong>');
  arLines.push(['• Update project Alpha timeline — Due: Mar 18 | In Progress','• Share feedback on beta test — Due: Mar 20 | Not started'].join('<br/>'));
  const ar = buildInviteStyleEmail({ title: 'Weekly Review Reminder', bodyHtml: arLines.join('<br/>'), button: { label: 'View Review', href: dashboardUrl + '/reviews' }, footerLines: ['Plan Genie Inc. · Vancouver, Canada', "You\'re receiving this because you were added as a participant in this review."] });
  console.log('Sending Invite-Style Review Attendee Reminder...');
  await resend.emails.send({ from, to, subject: "You're included in Owner's Weekly Review", html: ar.html, text: ar.text });

  // Verification code (invite-style)
  const codeLines = [];
  codeLines.push('<strong>Hello,</strong>');
  codeLines.push('Enter this one-time code:');
  codeLines.push('<br/><span style="letter-spacing:6px; display:inline-block; background:#F3F4F6; padding:12px 16px; border-radius:8px; color:#1D4374; font-weight:700; font-size:22px;">349218</span>');
  codeLines.push('<span style="color:#6B7280;">This code expires in 24 hours.</span>');
  const vc = buildInviteStyleEmail({ title: 'Verify Your Email', bodyHtml: codeLines.join('<br/>'), footerLines: ['Plan Genie Inc. · Vancouver, Canada'] });
  console.log('Sending Invite-Style Verification sample...');
  await resend.emails.send({ from, to, subject: 'Your Plan Genie verification code', html: vc.html, text: vc.text });

  console.log('Done.');
}

main().catch((err)=>{ console.error(err?.message||err); process.exit(1);});

