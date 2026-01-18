/**
 * Weekly Digest Email Template
 * Branded HTML email for Friday notifications
 */

const PRIMARY_COLOR = '#1D4374';
const ACCENT_COLOR = '#F59E0B';
const BG_COLOR = '#F8FAFC';
const LOGO_URL = 'https://logos.plangenie.com/logo.png';

/**
 * Generate the weekly digest email HTML
 * @param {Object} data - Email data
 * @param {string} data.userName - User's name
 * @param {Array} data.overdueItems - Overdue tasks
 * @param {Array} data.dueThisWeek - Tasks due this week
 * @param {string} data.dashboardUrl - URL to the dashboard
 * @returns {Object} { html, text }
 */
function generateWeeklyDigest(data) {
  const { userName, overdueItems = [], dueThisWeek = [], dashboardUrl } = data;

  const firstName = userName?.split(' ')[0] || 'there';
  const hasOverdue = overdueItems.length > 0;
  const hasDueThisWeek = dueThisWeek.length > 0;
  const totalItems = overdueItems.length + dueThisWeek.length;

  // Generate overdue items HTML
  const overdueHtml = overdueItems.length > 0 ? `
    <div style="margin-bottom: 24px;">
      <h3 style="color: #DC2626; font-size: 16px; font-weight: 600; margin: 0 0 12px 0; display: flex; align-items: center;">
        <span style="display: inline-block; width: 8px; height: 8px; background-color: #DC2626; border-radius: 50%; margin-right: 8px;"></span>
        Overdue (${overdueItems.length})
      </h3>
      <div style="background-color: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 16px;">
        ${overdueItems.slice(0, 5).map(item => `
          <div style="padding: 8px 0; border-bottom: 1px solid #FECACA;">
            <div style="font-weight: 500; color: #1F2937;">${escapeHtml(item.title)}</div>
            <div style="font-size: 12px; color: #6B7280; margin-top: 4px;">
              Was due: ${item.dueWhen || 'No date'} ${item.projectTitle ? `| ${escapeHtml(item.projectTitle)}` : ''}
            </div>
          </div>
        `).join('')}
        ${overdueItems.length > 5 ? `
          <div style="padding-top: 8px; font-size: 12px; color: #6B7280;">
            ...and ${overdueItems.length - 5} more overdue items
          </div>
        ` : ''}
      </div>
    </div>
  ` : '';

  // Generate due this week items HTML
  const dueThisWeekHtml = dueThisWeek.length > 0 ? `
    <div style="margin-bottom: 24px;">
      <h3 style="color: ${ACCENT_COLOR}; font-size: 16px; font-weight: 600; margin: 0 0 12px 0; display: flex; align-items: center;">
        <span style="display: inline-block; width: 8px; height: 8px; background-color: ${ACCENT_COLOR}; border-radius: 50%; margin-right: 8px;"></span>
        Due This Week (${dueThisWeek.length})
      </h3>
      <div style="background-color: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 16px;">
        ${dueThisWeek.slice(0, 5).map(item => `
          <div style="padding: 8px 0; border-bottom: 1px solid #FDE68A;">
            <div style="font-weight: 500; color: #1F2937;">${escapeHtml(item.title)}</div>
            <div style="font-size: 12px; color: #6B7280; margin-top: 4px;">
              Due: ${item.dueWhen || 'This week'} ${item.projectTitle ? `| ${escapeHtml(item.projectTitle)}` : ''}
            </div>
          </div>
        `).join('')}
        ${dueThisWeek.length > 5 ? `
          <div style="padding-top: 8px; font-size: 12px; color: #6B7280;">
            ...and ${dueThisWeek.length - 5} more items due this week
          </div>
        ` : ''}
      </div>
    </div>
  ` : '';

  // Determine the subject line
  let subjectLine = 'Your Weekly Plan Genie Update';
  if (hasOverdue && hasDueThisWeek) {
    subjectLine = `${overdueItems.length} overdue + ${dueThisWeek.length} due this week`;
  } else if (hasOverdue) {
    subjectLine = `${overdueItems.length} overdue item${overdueItems.length > 1 ? 's' : ''} need your attention`;
  } else if (hasDueThisWeek) {
    subjectLine = `${dueThisWeek.length} item${dueThisWeek.length > 1 ? 's' : ''} due this week`;
  }

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Weekly Digest - Plan Genie</title>
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
                      Weekly Progress Update
                    </p>
                  </td>
                  <td align="right">
                    <div style="background-color: rgba(255, 255, 255, 0.2); border-radius: 50%; width: 48px; height: 48px; display: inline-block; text-align: center; line-height: 48px;">
                      <span style="font-size: 24px;">&#128202;</span>
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
                ${totalItems > 0
                  ? `Here's your weekly summary. You have <strong>${totalItems} item${totalItems > 1 ? 's' : ''}</strong> that need${totalItems === 1 ? 's' : ''} your attention.`
                  : `Great news! You're all caught up with no overdue or upcoming items this week.`
                }
              </p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              ${overdueHtml}
              ${dueThisWeekHtml}

              ${totalItems === 0 ? `
                <div style="text-align: center; padding: 32px; background-color: #F0FDF4; border-radius: 8px; border: 1px solid #BBF7D0;">
                  <div style="font-size: 48px; margin-bottom: 12px;">&#127881;</div>
                  <p style="margin: 0; color: #166534; font-weight: 500;">All caught up!</p>
                  <p style="margin: 8px 0 0 0; color: #6B7280; font-size: 14px;">No overdue or upcoming items this week.</p>
                </div>
              ` : ''}
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 32px 32px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${dashboardUrl}" style="display: inline-block; background-color: ${PRIMARY_COLOR}; color: #FFFFFF; text-decoration: none; font-weight: 600; font-size: 14px; padding: 14px 32px; border-radius: 8px;">
                      View Your Dashboard
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
                      You're receiving this because you have weekly digest notifications enabled.
                      <br>
                      <a href="${dashboardUrl}/settings" style="color: ${PRIMARY_COLOR}; text-decoration: none;">Manage notification preferences</a>
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

${totalItems > 0
  ? `Here's your weekly summary. You have ${totalItems} item${totalItems > 1 ? 's' : ''} that need${totalItems === 1 ? 's' : ''} your attention.`
  : `Great news! You're all caught up with no overdue or upcoming items this week.`
}

${hasOverdue ? `
OVERDUE (${overdueItems.length}):
${overdueItems.slice(0, 5).map(item => `- ${item.title} (was due: ${item.dueWhen || 'No date'})`).join('\n')}
${overdueItems.length > 5 ? `...and ${overdueItems.length - 5} more` : ''}
` : ''}

${hasDueThisWeek ? `
DUE THIS WEEK (${dueThisWeek.length}):
${dueThisWeek.slice(0, 5).map(item => `- ${item.title} (due: ${item.dueWhen || 'This week'})`).join('\n')}
${dueThisWeek.length > 5 ? `...and ${dueThisWeek.length - 5} more` : ''}
` : ''}

View your dashboard: ${dashboardUrl}

---
You're receiving this because you have weekly digest notifications enabled.
Manage preferences: ${dashboardUrl}/settings
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
  generateWeeklyDigest,
};
