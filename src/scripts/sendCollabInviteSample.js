/**
 * Send a sample Collaborator Invite email (MJML → inlined HTML)
 * Usage:
 *   node src/scripts/sendCollabInviteSample.js --to you@example.com
 */

require('dotenv').config();
const { Resend } = require('resend');
const { generateCollaboratorInvite } = require('../emails/collaboratorInvite');

async function main() {
  const args = process.argv.slice(2);
  let to = null;
  const toEq = args.find(a => a.startsWith('--to='));
  if (toEq) to = toEq.split('=')[1];
  else if (args[0] === '--to' && args[1]) to = args[1];
  else if (args[0] && args[0].includes('@')) to = args[0];
  if (!to) {
    console.error('Usage: node src/scripts/sendCollabInviteSample.js --to you@example.com');
    process.exit(1);
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    process.exit(1);
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
  const appUrl = (process.env.APP_URL || process.env.APP_WEB_URL || 'https://plangenie.com').replace(/\/$/, '');
  const acceptUrl = `${appUrl}/signup?collabToken=sampletoken123&email=${encodeURIComponent(to)}`;
  const ownerName = 'PlanGenie Test';
  const { html, text } = generateCollaboratorInvite({ ownerName, acceptUrl });

  console.log(`Sending Collaborator Invite sample to ${to}...`);
  const result = await resend.emails.send({
    from,
    to,
    subject: `${ownerName} invited you to collaborate`,
    html,
    text,
  });
  if (result?.error) {
    console.error('Send error:', result.error);
    process.exit(1);
  }
  console.log('Sent. id:', result?.data?.id || 'ok');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

