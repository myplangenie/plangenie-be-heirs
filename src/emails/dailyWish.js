/**
 * Daily Wish Email Template
 * Branded HTML email for personalized daily business recommendations
 */

const PRIMARY_COLOR = '#1D4374';
const ACCENT_COLOR = '#F59E0B';
const BG_COLOR = '#F8FAFC';
const LOGO_URL = 'https://logos.plangenie.com/logo.png';
const { renderMjml } = require('./utils/mjmlRenderer');

// Category colors and icons
const CATEGORY_STYLES = {
  growth: { color: '#059669', bgColor: '#ECFDF5', icon: '📈' },
  operations: { color: '#0891B2', bgColor: '#ECFEFF', icon: '⚙️' },
  finance: { color: '#7C3AED', bgColor: '#F5F3FF', icon: '💰' },
  team: { color: '#DB2777', bgColor: '#FDF2F8', icon: '👥' },
  strategy: { color: '#1D4374', bgColor: '#EFF6FF', icon: '🎯' },
  marketing: { color: '#EA580C', bgColor: '#FFF7ED', icon: '📣' },
  sales: { color: '#16A34A', bgColor: '#F0FDF4', icon: '💼' },
  general: { color: '#6B7280', bgColor: '#F9FAFB', icon: '💡' },
};

/**
 * Generate the daily wish email HTML
 * @param {Object} data - Email data
 * @param {string} data.userName - User's name
 * @param {string} data.businessName - Business name
 * @param {string} data.title - Wish title
 * @param {string} data.message - AI-generated recommendation message
 * @param {string} data.category - Category of the recommendation
 * @param {string} data.dashboardUrl - URL to the dashboard
 * @param {string} data.unsubscribeUrl - URL to unsubscribe from emails
 * @returns {Object} { html, text, subject }
 */
function generateDailyWish(data) {
  const { userName, businessName, title, message, category = 'general', dashboardUrl, unsubscribeUrl } = data;

  const firstName = userName?.split(' ')[0] || 'there';
  const categoryStyle = CATEGORY_STYLES[category] || CATEGORY_STYLES.general;
  const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);

  // Get date for display
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const textPlain = (
`PLAN GENIE - YOUR WEEKLY RECOMMENDATION
${today}

Good day, ${firstName}!

Here's your personalized recommendation for ${businessName || 'your business'} today:

[${categoryLabel.toUpperCase()}] ${title}

${message}

---

Open your dashboard: ${dashboardUrl}

"Small consistent actions lead to remarkable results."

---
Plan Genie Inc. · Vancouver, Canada
Your weekly recommendation is personalized based on your business profile and goals.

Manage email preferences: ${unsubscribeUrl || dashboardUrl + '/settings'}

© ${new Date().getFullYear()} Plan Genie. All rights reserved.`).trim();

  const mjml = `
  <mjml>
    <mj-head>
      <mj-attributes>
        <mj-all font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" />
        <mj-text font-size="14px" line-height="1.6" color="#334155" />
        <mj-section padding="0px" />
        <mj-column padding="0px" />
        <mj-button inner-padding="14px 32px" background-color="#1D4374" color="#ffffff" font-weight="600" border-radius="8px" />
      </mj-attributes>
      <mj-preview>${escapeHtml(title)}</mj-preview>
    </mj-head>
    <mj-body background-color="#F8FAFC">
      <mj-section>
        <mj-column>
          <mj-spacer height="24px" />
          <mj-image src="${LOGO_URL}" alt="PlanGenie" align="center" padding="0 0 8px 0" width="180px" />
        </mj-column>
      </mj-section>

      <mj-section background-color="#ffffff" border-radius="12px">
        <mj-column padding="24px 24px 0 24px">
          <mj-text align="center" color="#1D4374" font-size="20px" font-weight="600" padding="0">Your Recommendation</mj-text>
        </mj-column>
        <mj-column padding="12px 24px 0 24px">
          <mj-text color="#9CA3AF" font-size="12px" padding="0">${escapeHtml(today)}</mj-text>
        </mj-column>
        <mj-column padding="12px 24px 0 24px">
          <mj-text font-size="20px" color="#1F2937" font-weight="600" padding="0">Good day, ${escapeHtml(firstName)}!</mj-text>
          <mj-text padding="8px 0 0 0" color="#6B7280">Here's your personalized recommendation for ${businessName ? escapeHtml(businessName) : 'your business'} today:</mj-text>
        </mj-column>
        <mj-column padding="16px 24px 24px 24px">
          <mj-text padding="0 0 8px 0"><span style="display:inline-block;background-color:${categoryStyle.color}15;color:${categoryStyle.color};font-size:12px;font-weight:600;padding:4px 12px;border-radius:16px;">${categoryStyle.icon} ${escapeHtml(categoryLabel)}</span></mj-text>
          <mj-text font-size="18px" color="#1F2937" font-weight="600" padding="0 0 8px 0">${escapeHtml(title)}</mj-text>
          <mj-text color="#4B5563">${escapeHtml(message)}</mj-text>
          <mj-spacer height="12px" />
          <mj-button href="${dashboardUrl}" align="center">Open Your Dashboard</mj-button>
          <mj-spacer height="12px" />
          <mj-text align="center" color="#92400E" font-size="14px" padding="0">"Small consistent actions lead to remarkable results."</mj-text>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column>
          <mj-spacer height="12px" />
          <mj-text align="center" color="#9CA3AF" font-size="12px">Your weekly recommendation is personalized based on your business profile and goals.</mj-text>
          <mj-text align="center" color="#9CA3AF" font-size="11px">
            Plan Genie Inc. · Vancouver, Canada<br/>
            You're receiving this because you signed up for Plan Genie.<br/>
            <a href="${unsubscribeUrl || dashboardUrl + '/settings'}" style="color:#6B7280; text-decoration:underline;">Manage email preferences</a> or <a href="${unsubscribeUrl || dashboardUrl + '/settings'}" style="color:#6B7280; text-decoration:underline;">unsubscribe</a>
          </mj-text>
          <mj-text align="center" color="#9CA3AF" font-size="11px">© ${new Date().getFullYear()} Plan Genie. All rights reserved.</mj-text>
          <mj-spacer height="16px" />
        </mj-column>
      </mj-section>
    </mj-body>
  </mjml>`;

  const { html, text } = renderMjml(mjml, { textFallback: textPlain });
  const subject = `Weekly Tip: ${title}`;
  return { html, text, subject };
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  generateDailyWish,
  CATEGORY_STYLES,
};
