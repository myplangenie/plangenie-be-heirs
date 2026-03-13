const { buildInviteStyleEmail } = require('./utils/inviteLayout');

/**
 * Build a verification code email using MJML with inlined CSS.
 * @param {Object} data
 * @param {string} data.greetingName - Name to greet (optional)
 * @param {string} data.title - Heading/title (e.g., 'Verify Your Email')
 * @param {string} data.intro - Introductory message line
 * @param {string} data.otp - The 6-digit code
 * @param {string} data.expiresText - Expiry hint (e.g., 'This code expires in 24 hours.')
 */
function generateVerifyCodeEmail({ greetingName = '', title = 'Verify Your Email', intro = 'Use this one-time code to verify your email and continue:', otp = '', expiresText = 'This code expires in 24 hours.' }) {
  const greet = greetingName ? `Hi ${escapeHtml(greetingName)},` : 'Hello,';
  const appUrl = (process.env.APP_URL || process.env.APP_WEB_URL || 'https://plangenie.com').replace(/\/$/, '');
  const body = [
    `<strong>${greet}</strong>`,
    escapeHtml(intro),
    '<br/>',
    `<div style="text-align:center; margin:8px 0 12px;">
      <span style="letter-spacing:6px; display:inline-block; background:#F3F4F6; padding:12px 16px; border-radius:8px; color:#1D4374; font-weight:700; font-size:22px;">${escapeHtml(otp)}</span>
    </div>`,
    `<span style="color:#6B7280;">${escapeHtml(expiresText)}</span>`,
    '<br/>',
    '<span style="color:#6B7280;">If you didn’t request this, you can safely ignore this email.</span>',
    '<span style="color:#6B7280;">Need help? Contact <a href="mailto:support@plangenie.com" style="color:#1D4374; text-decoration:underline;">support@plangenie.com</a>.</span>'
  ].join('<br/>');

  const { html, text } = buildInviteStyleEmail({
    title,
    bodyHtml: body,
    button: { label: 'Open Plan Genie', href: appUrl },
    footerLines: [ 'Plan Genie Inc. · Vancouver, Canada' ],
  });
  return { html, text };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = { generateVerifyCodeEmail };
