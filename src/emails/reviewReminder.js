/**
 * Review Reminder Email Template
 * Branded HTML email for review session reminders
 */

const PRIMARY_COLOR = '#1D4374';
const ACCENT_COLOR = '#EDAE40';
const BG_COLOR = '#F8FAFC';
const LOGO_URL = 'https://logos.plangenie.com/logo.png';
const { renderMjml } = require('./utils/mjmlRenderer');

/**
 * Generate the review reminder email HTML
 * @param {Object} data - Email data
 * @param {string} data.userName - User's name
 * @param {string} data.cadenceType - 'weekly', 'monthly', or 'quarterly'
 * @param {string} data.reviewUrl - URL to start/view reviews
 * @param {number} data.openReviewCount - Number of open reviews
 * @param {Array} data.upcomingDeliverables - Deliverables due soon
 * @returns {Object} { html, text, subject }
 */
function generateReviewReminder(data) {
  const {
    userName,
    cadenceType = 'weekly',
    reviewUrl,
    openReviewCount = 0,
    upcomingDeliverables = []
  } = data;

  const firstName = userName?.split(' ')[0] || 'there';

  const cadenceLabel = {
    weekly: 'Weekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly'
  }[cadenceType] || 'Weekly';

  const cadenceMessage = {
    weekly: "It's time for your weekly review session.",
    monthly: "It's time for your monthly review session.",
    quarterly: "It's time for your quarterly review session."
  }[cadenceType] || "It's time for your review session.";

  // Generate upcoming deliverables HTML
  const deliverablesHtml = upcomingDeliverables.length > 0 ? `
    <div style="margin-bottom: 24px;">
      <h3 style="color: ${PRIMARY_COLOR}; font-size: 16px; font-weight: 600; margin: 0 0 12px 0;">
        Upcoming Deliverables to Review
      </h3>
      <div style="background-color: #FEF9E7; border: 1px solid #F9E79F; border-radius: 8px; padding: 16px;">
        ${upcomingDeliverables.slice(0, 5).map(item => `
          <div style="padding: 8px 0; border-bottom: 1px solid #F9E79F;">
            <div style="font-weight: 500; color: #1F2937;">${escapeHtml(item.title)}</div>
            <div style="font-size: 12px; color: #6B7280; margin-top: 4px;">
              Due: ${item.dueWhen || 'Not set'} ${item.projectTitle ? `| ${escapeHtml(item.projectTitle)}` : ''}
            </div>
          </div>
        `).join('')}
        ${upcomingDeliverables.length > 5 ? `
          <div style="padding-top: 8px; font-size: 12px; color: #6B7280;">
            ...and ${upcomingDeliverables.length - 5} more deliverables
          </div>
        ` : ''}
      </div>
    </div>
  ` : '';

  // Open reviews notice
  const openReviewsHtml = openReviewCount > 0 ? `
    <div style="background-color: #EBF5FF; border: 1px solid #90CDF4; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="margin: 0; color: #2C5282; font-size: 14px;">
        <strong>Note:</strong> You have ${openReviewCount} open review${openReviewCount > 1 ? 's' : ''} that may need to be closed.
      </p>
    </div>
  ` : '';

  const subjectLine = `Time for Your ${cadenceLabel} Review`;

  const textPlain = (
`Hi ${firstName},

${cadenceMessage}

Take a few minutes to reflect on your progress, update project statuses, and plan for the next period.

${openReviewCount > 0 ? `Note: You have ${openReviewCount} open review${openReviewCount > 1 ? 's' : ''} that may need to be closed.\n` : ''}${upcomingDeliverables.length > 0 ? `
UPCOMING DELIVERABLES:
${upcomingDeliverables.slice(0, 5).map(item => `- ${item.title} (due: ${item.dueWhen || 'Not set'})`).join('\n')}
${upcomingDeliverables.length > 5 ? `...and ${upcomingDeliverables.length - 5} more` : ''}
` : ''}

REVIEW SESSION TIPS:
- Review progress on your strategic projects
- Update deliverable statuses and due dates
- Identify blockers and create action items
- Use AI insights to spot trends and risks

Start your review: ${reviewUrl}

---
Plan Genie Inc. · Vancouver, Canada
You're receiving this because you signed up for Plan Genie.
Manage email preferences or unsubscribe: ${reviewUrl.replace('/reviews', '/settings')}?tab=notifications

© ${new Date().getFullYear()} Plan Genie. All rights reserved.`).trim();

  const rows = upcomingDeliverables.slice(0, 5).map((it) => `
    <tr>
      <td style="padding:8px 0; width:10px;">•</td>
      <td style="padding:8px 0; font-weight:500; color:#1F2937;">${escapeHtml(it.title)}</td>
      <td style="padding:8px 0; font-size:12px; color:#6B7280; text-align:right;">Due: ${it.dueWhen || 'Not set'}${it.projectTitle ? ` | ${escapeHtml(it.projectTitle)}` : ''}</td>
    </tr>
  `).join('');

  const mjml = `
  <mjml>
    <mj-head>
      <mj-attributes>
        <mj-all font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" />
        <mj-text font-size="14px" line-height="1.6" color="#334155" />
        <mj-section padding="0px" />
        <mj-column padding="0px" />
        <mj-button inner-padding="14px 32px" background-color="#EDAE40" color="#ffffff" font-weight="600" border-radius="8px" />
      </mj-attributes>
      <mj-preview>${cadenceLabel} Review Reminder</mj-preview>
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
          <mj-text align="center" color="#1D4374" font-size="20px" font-weight="600" padding="0">${cadenceLabel} Review Reminder</mj-text>
        </mj-column>
        <mj-column padding="16px 24px 0 24px">
          <mj-text font-size="20px" color="#1F2937" font-weight="600" padding="0">Hi ${escapeHtml(firstName)},</mj-text>
          <mj-text padding="8px 0 0 0" color="#6B7280">${cadenceMessage} Take a few minutes to reflect on your progress, update project statuses, and plan for the next period.</mj-text>
        </mj-column>
        <mj-column padding="16px 24px 24px 24px">
          ${openReviewCount > 0 ? `<mj-text color="#2C5282" padding="0 0 12px 0"><strong>Note:</strong> You have ${openReviewCount} open review${openReviewCount > 1 ? 's' : ''} that may need to be closed.</mj-text>` : ''}
          ${upcomingDeliverables.length ? `<mj-text color="#1D4374" font-size="16px" font-weight="600" padding="0 0 8px 0">Upcoming Deliverables to Review</mj-text>
          <mj-table cellpadding="0" cellspacing="0" width="100%">${rows}${upcomingDeliverables.length > 5 ? `<tr><td colspan="3" style="padding-top:8px; font-size:12px; color:#6B7280;">...and ${upcomingDeliverables.length - 5} more deliverables</td></tr>` : ''}</mj-table>
          <mj-spacer height="12px" />` : ''}
          <mj-text color="#166534" font-weight="600" padding="0 0 6px 0">Review Session Tips</mj-text>
          <mj-text color="#166534">• Review progress on your strategic projects<br/>• Update deliverable statuses and due dates<br/>• Identify blockers and create action items<br/>• Use AI insights to spot trends and risks</mj-text>
          <mj-spacer height="12px" />
          <mj-button href="${reviewUrl}" align="center">Start Your Review</mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column>
          <mj-spacer height="12px" />
          <mj-text align="center" color="#9CA3AF" font-size="11px">
            Plan Genie Inc. · Vancouver, Canada<br/>
            You're receiving this because you signed up for Plan Genie.<br/>
            <a href="${reviewUrl.replace('/reviews', '/settings')}?tab=notifications" style="color:#6B7280; text-decoration:underline;">Manage email preferences</a> or <a href="${reviewUrl.replace('/reviews', '/settings')}?tab=notifications" style="color:#6B7280; text-decoration:underline;">unsubscribe</a>
          </mj-text>
          <mj-text align="center" color="#9CA3AF" font-size="11px">© ${new Date().getFullYear()} Plan Genie. All rights reserved.</mj-text>
          <mj-spacer height="16px" />
        </mj-column>
      </mj-section>
    </mj-body>
  </mjml>`;

  const { html, text } = renderMjml(mjml, { textFallback: textPlain });
  return { html, text, subject: subjectLine };
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
  generateReviewReminder,
};
