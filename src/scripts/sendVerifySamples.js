/**
 * Send sample verification emails (signup verify + email-change verify)
 * Usage:
 *   node src/scripts/sendVerifySamples.js --to you@example.com
 */

require('dotenv').config();
const { Resend } = require('resend');
const { generateVerifyCodeEmail } = require('../emails/verifyCode');

async function main() {
  const args = process.argv.slice(2);
  let to = null;
  const toEq = args.find(a => a.startsWith('--to='));
  if (toEq) to = toEq.split('=')[1];
  else if (args[0] === '--to' && args[1]) to = args[1];
  else if (args[0] && args[0].includes('@')) to = args[0];
  if (!to) {
    console.error('Usage: node src/scripts/sendVerifySamples.js --to you@example.com');
    process.exit(1);
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    process.exit(1);
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';

  // 1) Signup verification
  const otp1 = '349218';
  const v1 = generateVerifyCodeEmail({
    greetingName: 'PlanGenie User',
    title: 'Verify Your Email',
    intro: 'Thanks for signing up for Plan Genie. Your verification code is:',
    otp: otp1,
    expiresText: 'This code expires in 24 hours.'
  });
  console.log('Sending Signup Verification sample...');
  await resend.emails.send({ from, to, subject: 'Your Plan Genie verification code', html: v1.html, text: v1.text });

  // 2) Email change verification
  const otp2 = '902571';
  const v2 = generateVerifyCodeEmail({
    greetingName: 'PlanGenie User',
    title: 'Confirm Your Email Change',
    intro: 'We received a request to change your account email to new@example.com. Enter this verification code to confirm:',
    otp: otp2,
    expiresText: 'This code expires in 15 minutes.'
  });
  console.log('Sending Email Change Verification sample...');
  await resend.emails.send({ from, to, subject: 'Confirm your email change', html: v2.html, text: v2.text });

  console.log('Done.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

