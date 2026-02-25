/**
 * Test script to send a sample email
 * Run: node src/scripts/sendTestEmail.js
 */

require('dotenv').config();
const { Resend } = require('resend');

const LOGO_URL = 'https://logos.plangenie.com/logo-white.7ee85271.png';

async function sendTestEmail() {
  const to = process.argv[2] || 'eadelekeife@gmail.com';

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    process.exit(1);
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM || 'Plan Genie <no-reply@plangenie.com>';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #F8FAFC;">
      <div style="background: linear-gradient(135deg, #1D4374 0%, #2563EB 100%); border-radius: 12px 12px 0 0; padding: 32px;">
        <img src="${LOGO_URL}" alt="Plan Genie" style="height: 20px; width: auto; display: block;" />
        <p style="margin: 12px 0 0 0; color: rgba(255, 255, 255, 0.8); font-size: 14px;">
          Test Email
        </p>
      </div>
      <div style="background-color: #FFFFFF; padding: 32px; border-radius: 0 0 12px 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
        <h2 style="color: #1F2937; font-size: 20px; font-weight: 600; margin: 0 0 16px 0;">
          Hi there,
        </h2>
        <p style="color: #4B5563; font-size: 15px; line-height: 1.6;">
          This is a test email to verify the new email template styling with the updated logo and formatting.
        </p>
        <p style="color: #4B5563; font-size: 15px; line-height: 1.6;">
          If you're seeing this, the email templates are working correctly!
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="https://plangenie.com/dashboard" style="display: inline-block; background-color: #1D4374; color: #FFFFFF; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
            Go to Dashboard
          </a>
        </div>
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0;" />
        <p style="color: #9CA3AF; font-size: 12px; text-align: center; line-height: 1.6;">
          Plan Genie Inc. · Vancouver, Canada<br />
          This is a test email sent to verify email template changes.
        </p>
      </div>
    </div>
  `;

  const text = `Hi there,\n\nThis is a test email to verify the new email template styling.\n\nIf you're seeing this, the email templates are working correctly!\n\n---\nPlan Genie Inc. · Vancouver, Canada`;

  try {
    console.log(`Sending test email to ${to}...`);
    const result = await resend.emails.send({
      from,
      to,
      subject: 'Plan Genie - Test Email',
      html,
      text,
    });

    if (result?.error) {
      console.error('Error:', result.error);
    } else {
      console.log('Email sent successfully!');
      console.log('Result:', result);
    }
  } catch (err) {
    console.error('Failed to send email:', err?.message || err);
  }
}

sendTestEmail();
