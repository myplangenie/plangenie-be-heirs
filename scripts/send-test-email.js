#!/usr/bin/env node
// Simple script to send a test email via Resend using env config

const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const { Resend } = require('resend');

async function main() {
  const args = process.argv.slice(2);
  const toArgIndex = args.findIndex((a) => a === '--to' || a === '-t');
  const to = toArgIndex >= 0 ? args[toArgIndex + 1] : 'eadelekeife@gmail.com';
  const fromArgIndex = args.findIndex((a) => a === '--from' || a === '-f');

  if (!to || to.startsWith('--')) {
    console.error('Error: missing recipient. Use --to <email>');
    process.exit(1);
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error('Error: RESEND_API_KEY is not set in .env');
    process.exit(1);
  }

  const from = (fromArgIndex >= 0 ? args[fromArgIndex + 1] : null) || process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';
  const resend = new Resend(apiKey);

  const now = new Date();
  const subject = `PlanGenie Test Email (${now.toISOString()})`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif; line-height:1.5">
      <h2>PlanGenie Email Service Test</h2>
      <p>This is a test email sent via <strong>Resend</strong> from the PlanGenie backend.</p>
      <p><strong>Timestamp:</strong> ${now.toUTCString()}</p>
      <p>If you received this, email sending is working ✅</p>
    </div>
  `;
  const text = `PlanGenie Email Service Test\n\nThis is a test email sent via Resend from the PlanGenie backend.\nTimestamp: ${now.toUTCString()}\nIf you received this, email sending is working.`;

  console.log(`Sending test email to ${to} ...`);
  try {
    const result = await resend.emails.send({ from, to, subject, html, text });
    if (result && result.error) {
      console.error('Resend error:', result.error.message || result.error);
      process.exit(1);
    }
    console.log('Email sent. Result:', result?.data || result);
    process.exit(0);
  } catch (err) {
    console.error('Failed to send email:', err?.message || err);
    process.exit(1);
  }
}

main();
