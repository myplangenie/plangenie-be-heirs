/**
 * Review Attendee Reminder Email Template
 * Sent to team members and collaborators who are added to a review
 */

const PRIMARY_COLOR = '#1D4374';
const ACCENT_COLOR = '#EDAE40';
const BG_COLOR = '#F8FAFC';
const LOGO_URL = 'https://logos.plangenie.com/logo.png';
const { renderMjml } = require('./utils/mjmlRenderer');

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

  let html = `
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

          <!-- Header (collaborator-invite style) -->
          <tr>
            <td style="padding: 24px; border-radius: 12px 12px 0 0;">
              <div style="text-align: center; margin-bottom: 8px;">
                <img src="${LOGO_URL}" alt="PlanGenie" style="height: 24px; max-width: 180px; object-fit: contain;" />
              </div>
              <h2 style="color: #1D4374; font-size: 20px; font-weight: 600; margin: 0; text-align: center;">${cadenceLabel} Review Reminder</h2>
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
                    <p style="margin: 0; color: #9CA3AF; font-size: 11px; line-height: 1.6;">
                      Plan Genie Inc. · Vancouver, Canada<br>
                      You're receiving this because you were added as a participant in this review.<br>
                      <a href="${reviewUrl.replace(/\/reviews.*/, '/settings')}?tab=notifications" style="color: #6B7280; text-decoration: underline;">Manage email preferences</a>
                    </p>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top: 12px;">
                    <p style="margin: 0; color: #9CA3AF; font-size: 11px;">
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
Plan Genie Inc. · Vancouver, Canada
You're receiving this because you were added as a participant in this review.
Manage email preferences: ${reviewUrl.replace(/\/reviews.*/, '/settings')}?tab=notifications

© ${new Date().getFullYear()} Plan Genie. All rights reserved.
  `.trim();

  // Build MJML version and override html with inlined, table-based output
  const rows = actionItems.slice(0, 5).map((it) => `
    <tr>
      <td style=\"padding:8px 0; width:10px;\">•</td>
      <td style=\"padding:8px 0; font-weight:500; color:#1F2937;\">${escapeHtml(it.text)}</td>
      <td style=\"padding:8px 0; font-size:12px; color:#6B7280; text-align:right;\">${it.dueWhen ? `Due: ${it.dueWhen}` : 'No due date'} | Status: ${it.status || 'Not started'}</td>
    </tr>
  `).join('');
  const mjml = `
  <mjml>
    <mj-head>
      <mj-attributes>
        <mj-all font-family=\"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif\" />
        <mj-text font-size=\"14px\" line-height=\"1.6\" color=\"#334155\" />
        <mj-section padding=\"0px\" />
        <mj-column padding=\"0px\" />
        <mj-button inner-padding=\"14px 32px\" background-color=\"#EDAE40\" color=\"#ffffff\" font-weight=\"600\" border-radius=\"8px\" />
      </mj-attributes>
      <mj-preview>${cadenceLabel} Review Reminder</mj-preview>
    </mj-head>
    <mj-body background-color=\"#F8FAFC\">
      <mj-section>
        <mj-column>
          <mj-spacer height=\"24px\" />
          <mj-image src=\"${LOGO_URL}\" alt=\"PlanGenie\" align=\"center\" padding=\"0 0 8px 0\" width=\"180px\" />
        </mj-column>
      </mj-section>

      <mj-section background-color=\"#ffffff\" border-radius=\"12px\">
        <mj-column padding=\"24px 24px 0 24px\">
          <mj-text align=\"center\" color=\"#1D4374\" font-size=\"20px\" font-weight=\"600\" padding=\"0\">${cadenceLabel} Review Reminder</mj-text>
        </mj-column>
        <mj-column padding=\"16px 24px 0 24px\">
          <mj-text font-size=\"20px\" color=\"#1F2937\" font-weight=\"600\" padding=\"0\">Hi ${escapeHtml(firstName)},</mj-text>
          <mj-text padding=\"8px 0 0 0\" color=\"#6B7280\">You've been included in ${escapeHtml(ownerFirstName)}'s ${cadenceLabel.toLowerCase()} review session${reviewStartedAt ? ` started on ${reviewDate}` : ''}.</mj-text>
        </mj-column>
        <mj-column padding=\"16px 24px 24px 24px\">
          ${actionItems.length ? `<mj-text color=\"#1D4374\" font-size=\"16px\" font-weight=\"600\" padding=\"0 0 8px 0\">Your Action Items</mj-text>
          <mj-table cellpadding=\"0\" cellspacing=\"0\" width=\"100%\">${rows}${actionItems.length > 5 ? `<tr><td colspan=\"3\" style=\"padding-top:8px; font-size:12px; color:#6B7280;\">...and ${actionItems.length - 5} more action items</td></tr>` : ''}</mj-table>
          <mj-spacer height=\"12px\" />` : ''}
          <mj-text color=\"#166534\" font-weight=\"600\" padding=\"0 0 6px 0\">As a Review Participant</mj-text>
          <mj-text color=\"#166534\">• Review and update your assigned action items<br/>• Provide input on project progress<br/>• Flag any blockers or concerns<br/>• Collaborate on decisions and next steps</mj-text>
          <mj-spacer height=\"12px\" />
          <mj-button href=\"${reviewUrl}\" align=\"center\">View Review</mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column>
          <mj-spacer height=\"12px\" />
          <mj-text align=\"center\" color=\"#9CA3AF\" font-size=\"11px\">
            Plan Genie Inc. · Vancouver, Canada<br/>
            You're receiving this because you were added as a participant in this review.<br/>
            <a href=\"${reviewUrl.replace(/\/reviews.*/, '/settings')}?tab=notifications\" style=\"color:#6B7280; text-decoration:underline;\">Manage email preferences</a>
          </mj-text>
          <mj-text align=\"center\" color=\"#9CA3AF\" font-size=\"11px\">© ${new Date().getFullYear()} Plan Genie. All rights reserved.</mj-text>
          <mj-spacer height=\"16px\" />
        </mj-column>
      </mj-section>
    </mj-body>
  </mjml>`;
  const out = renderMjml(mjml, { textFallback: text });
  html = out.html;
  return { html, text: out.text || text, subject: subjectLine };
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
