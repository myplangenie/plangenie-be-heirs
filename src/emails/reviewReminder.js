/**
 * Review Reminder Email Template
 * Branded HTML email for review session reminders
 */

const PRIMARY_COLOR = '#1D4374';
const ACCENT_COLOR = '#EDAE40';
const BG_COLOR = '#F8FAFC';
const LOGO_URL = 'https://logos.plangenie.com/logo.png';

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

  const subjectLine = `📋 Time for Your ${cadenceLabel} Review`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${cadenceLabel} Review Reminder - Plan Genie</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${BG_COLOR}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: ${BG_COLOR};">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #FFFFFF; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, ${PRIMARY_COLOR} 0%, #2563EB 100%); padding: 32px; border-radius: 12px 12px 0 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <img src="${LOGO_URL}" alt="Plan Genie" style="height: 40px; width: auto; display: block;" />
                    <p style="margin: 12px 0 0 0; color: rgba(255, 255, 255, 0.8); font-size: 14px;">
                      ${cadenceLabel} Review Reminder
                    </p>
                  </td>
                  <td align="right">
                    <div style="background-color: ${ACCENT_COLOR}; border-radius: 50%; width: 48px; height: 48px; display: inline-block; text-align: center; line-height: 48px;">
                      <span style="font-size: 24px;">📋</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 32px 32px 16px 32px;">
              <h2 style="margin: 0; color: #1F2937; font-size: 20px; font-weight: 600;">
                Hi ${escapeHtml(firstName)},
              </h2>
              <p style="margin: 12px 0 0 0; color: #6B7280; font-size: 15px; line-height: 1.6;">
                ${cadenceMessage} Take a few minutes to reflect on your progress, update project statuses, and plan for the next period.
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              ${openReviewsHtml}
              ${deliverablesHtml}

              <!-- Review tips -->
              <div style="background-color: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 16px;">
                <h4 style="margin: 0 0 12px 0; color: #166534; font-size: 14px; font-weight: 600;">
                  💡 Review Session Tips
                </h4>
                <ul style="margin: 0; padding: 0 0 0 20px; color: #166534; font-size: 13px; line-height: 1.6;">
                  <li>Review progress on your strategic projects</li>
                  <li>Update deliverable statuses and due dates</li>
                  <li>Identify blockers and create action items</li>
                  <li>Use AI insights to spot trends and risks</li>
                </ul>
              </div>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 32px 32px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${reviewUrl}" style="display: inline-block; background-color: ${ACCENT_COLOR}; color: #FFFFFF; text-decoration: none; font-weight: 600; font-size: 14px; padding: 14px 32px; border-radius: 8px;">
                      Start Your Review
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #F9FAFB; border-radius: 0 0 12px 12px; border-top: 1px solid #E5E7EB;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin: 0; color: #9CA3AF; font-size: 12px; line-height: 1.5;">
                      You're receiving this because you have ${cadenceType} review reminders enabled.
                      <br>
                      <a href="${reviewUrl.replace('/reviews', '/settings')}" style="color: ${PRIMARY_COLOR}; text-decoration: none;">Manage notification preferences</a>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 16px;">
                    <p style="margin: 0; color: #9CA3AF; font-size: 12px;">
                      &copy; ${new Date().getFullYear()} Plan Genie. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  // Plain text version
  const text = `
Hi ${firstName},

${cadenceMessage}

Take a few minutes to reflect on your progress, update project statuses, and plan for the next period.

${openReviewCount > 0 ? `Note: You have ${openReviewCount} open review${openReviewCount > 1 ? 's' : ''} that may need to be closed.\n` : ''}
${upcomingDeliverables.length > 0 ? `
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
You're receiving this because you have ${cadenceType} review reminders enabled.
Manage preferences: ${reviewUrl.replace('/reviews', '/settings')}
  `.trim();

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
