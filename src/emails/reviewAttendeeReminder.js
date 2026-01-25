/**
 * Review Attendee Reminder Email Template
 * Sent to team members and collaborators who are added to a review
 */

const PRIMARY_COLOR = '#1D4374';
const ACCENT_COLOR = '#EDAE40';
const BG_COLOR = '#F8FAFC';
const LOGO_URL = 'https://logos.plangenie.com/logo.png';

/**
 * Generate the review attendee reminder email HTML
 * @param {Object} data - Email data
 * @param {string} data.attendeeName - Attendee's name
 * @param {string} data.ownerName - Review owner's name
 * @param {string} data.cadenceType - 'weekly', 'monthly', or 'quarterly'
 * @param {string} data.reviewUrl - URL to view the review
 * @param {Date} data.reviewStartedAt - When the review was started
 * @param {Array} data.actionItems - Action items assigned to this attendee
 * @returns {Object} { html, text, subject }
 */
function generateReviewAttendeeReminder(data) {
  const {
    attendeeName,
    ownerName,
    cadenceType = 'weekly',
    reviewUrl,
    reviewStartedAt,
    actionItems = []
  } = data;

  const firstName = attendeeName?.split(' ')[0] || 'there';
  const ownerFirstName = ownerName?.split(' ')[0] || 'your team';

  const cadenceLabel = {
    weekly: 'Weekly',
    monthly: 'Monthly',
    quarterly: 'Quarterly'
  }[cadenceType] || 'Weekly';

  const reviewDate = reviewStartedAt
    ? new Date(reviewStartedAt).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      })
    : 'recently';

  // Generate action items HTML if any are assigned to this attendee
  const actionItemsHtml = actionItems.length > 0 ? `
    <div style="margin-bottom: 24px;">
      <h3 style="color: ${PRIMARY_COLOR}; font-size: 16px; font-weight: 600; margin: 0 0 12px 0;">
        Your Action Items
      </h3>
      <div style="background-color: #FEF9E7; border: 1px solid #F9E79F; border-radius: 8px; padding: 16px;">
        ${actionItems.slice(0, 5).map(item => `
          <div style="padding: 8px 0; border-bottom: 1px solid #F9E79F;">
            <div style="font-weight: 500; color: #1F2937;">${escapeHtml(item.text)}</div>
            <div style="font-size: 12px; color: #6B7280; margin-top: 4px;">
              ${item.dueWhen ? `Due: ${item.dueWhen}` : 'No due date'} | Status: ${item.status || 'Not started'}
            </div>
          </div>
        `).join('')}
        ${actionItems.length > 5 ? `
          <div style="padding-top: 8px; font-size: 12px; color: #6B7280;">
            ...and ${actionItems.length - 5} more action items
          </div>
        ` : ''}
      </div>
    </div>
  ` : '';

  const subjectLine = `You're included in ${ownerFirstName}'s ${cadenceLabel} Review`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Review Reminder - Plan Genie</title>
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
                      <span style="font-size: 24px;">👥</span>
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
                You've been included in <strong>${escapeHtml(ownerFirstName)}'s</strong> ${cadenceLabel.toLowerCase()} review session${reviewStartedAt ? ` started on ${reviewDate}` : ''}.
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              ${actionItemsHtml}

              <!-- What to expect -->
              <div style="background-color: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 16px;">
                <h4 style="margin: 0 0 12px 0; color: #166534; font-size: 14px; font-weight: 600;">
                  💡 As a Review Participant
                </h4>
                <ul style="margin: 0; padding: 0 0 0 20px; color: #166534; font-size: 13px; line-height: 1.6;">
                  <li>Review and update your assigned action items</li>
                  <li>Provide input on project progress</li>
                  <li>Flag any blockers or concerns</li>
                  <li>Collaborate on decisions and next steps</li>
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
                      View Review
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
                      You're receiving this because you were added as a participant in this review.
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

You've been included in ${ownerFirstName}'s ${cadenceLabel.toLowerCase()} review session${reviewStartedAt ? ` started on ${reviewDate}` : ''}.

${actionItems.length > 0 ? `
YOUR ACTION ITEMS:
${actionItems.slice(0, 5).map(item => `- ${item.text} (${item.dueWhen || 'No due date'} | ${item.status || 'Not started'})`).join('\n')}
${actionItems.length > 5 ? `...and ${actionItems.length - 5} more` : ''}
` : ''}

AS A REVIEW PARTICIPANT:
- Review and update your assigned action items
- Provide input on project progress
- Flag any blockers or concerns
- Collaborate on decisions and next steps

View the review: ${reviewUrl}

---
You're receiving this because you were added as a participant in this review.
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
  generateReviewAttendeeReminder,
};
