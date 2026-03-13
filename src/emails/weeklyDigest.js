/**
 * Weekly Digest Email Template
 * Branded HTML email for Friday notifications
 */

const PRIMARY_COLOR = '#1D4374';
const ACCENT_COLOR = '#F59E0B';
const BG_COLOR = '#F8FAFC';
const LOGO_URL = 'https://logos.plangenie.com/logo.png';
const { renderMjml } = require('./utils/mjmlRenderer');

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

  let html = `
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

          <!-- Header (collaborator-invite style) -->
          <tr>
            <td style="padding: 24px; border-radius: 12px 12px 0 0;">
              <div style="text-align: center; margin-bottom: 8px;">
                <img src="${LOGO_URL}" alt="PlanGenie" style="height: 24px; max-width: 180px; object-fit: contain;" />
              </div>
              <h2 style="color: #1D4374; font-size: 20px; font-weight: 600; margin: 0; text-align: center;">Weekly Progress Update</h2>
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
                    <p style="margin: 0; color: #9CA3AF; font-size: 11px; line-height: 1.6;">
                      Plan Genie Inc. · Vancouver, Canada<br>
                      You're receiving this because you signed up for Plan Genie.<br>
                      <a href="${dashboardUrl}/settings?tab=notifications" style="color: #6B7280; text-decoration: underline;">Manage email preferences</a> or <a href="${dashboardUrl}/settings?tab=notifications" style="color: #6B7280; text-decoration: underline;">unsubscribe</a>
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
Plan Genie Inc. · Vancouver, Canada
You're receiving this because you signed up for Plan Genie.
Manage email preferences or unsubscribe: ${dashboardUrl}/settings?tab=notifications

© ${new Date().getFullYear()} Plan Genie. All rights reserved.
  `.trim();

  // Build MJML version and override html with inlined, table-based output
  const overdueRows = overdueItems.slice(0, 5).map((it) => `
    <tr>
      <td style=\"padding:8px 0; width:10px;\">•</td>
      <td style=\"padding:8px 0; font-weight:500; color:#1F2937;\">${escapeHtml(it.title)}</td>
      <td style=\"padding:8px 0; font-size:12px; color:#6B7280; text-align:right;\">Was due: ${it.dueWhen || 'No date'}${it.projectTitle ? ` | ${escapeHtml(it.projectTitle)}` : ''}</td>
    </tr>
  `).join('');
  const dueRows = dueThisWeek.slice(0, 5).map((it) => `
    <tr>
      <td style=\"padding:8px 0; width:10px;\">•</td>
      <td style=\"padding:8px 0; font-weight:500; color:#1F2937;\">${escapeHtml(it.title)}</td>
      <td style=\"padding:8px 0; font-size:12px; color:#6B7280; text-align:right;\">Due: ${it.dueWhen || 'This week'}${it.projectTitle ? ` | ${escapeHtml(it.projectTitle)}` : ''}</td>
    </tr>
  `).join('');
  const summaryText = totalItems > 0
    ? `Here's your weekly summary. You have ${totalItems} item${totalItems > 1 ? 's' : ''} that need${totalItems === 1 ? 's' : ''} your attention.`
    : `Great news! You're all caught up with no overdue or upcoming items this week.`;
  const mjml = `
  <mjml>
    <mj-head>
      <mj-attributes>
        <mj-all font-family=\"-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif\" />
        <mj-text font-size=\"14px\" line-height=\"1.6\" color=\"#334155\" />
        <mj-section padding=\"0px\" />
        <mj-column padding=\"0px\" />
        <mj-button inner-padding=\"14px 32px\" background-color=\"#1D4374\" color=\"#ffffff\" font-weight=\"600\" border-radius=\"8px\" />
      </mj-attributes>
      <mj-preview>${summaryText}</mj-preview>
    </mj-head>
    <mj-body background-color=\"#F8FAFC\">
      <mj-section>
        <mj-column>
          <mj-spacer height=\"24px\" />
          <mj-image src=\"${LOGO_URL}\" alt=\"PlanGenie\" align=\"center\" padding=\"0 0 8px 0\" width=\"180px\" />
        </mj-column>
      </mj-section>

      <!-- Header row (full width) -->
      <mj-section background-color=\"#ffffff\" border-radius=\"12px 12px 0 0\">
        <mj-column width=\"100%\" padding=\"24px 24px 8px 24px\">
          <mj-text align=\"center\" color=\"#1D4374\" font-size=\"20px\" font-weight=\"600\" padding=\"0\">Weekly Progress Update</mj-text>
        </mj-column>
      </mj-section>

      <!-- Content row: two columns -->
      <mj-section background-color=\"#ffffff\">
        <mj-column width=\"58%\" padding=\"8px 24px 24px 24px\">
          <mj-text font-size=\"20px\" color=\"#1F2937\" font-weight=\"600\" padding=\"0\">Hi ${escapeHtml(firstName)},</mj-text>
          <mj-text padding=\"8px 0 0 0\" color=\"#6B7280\">${escapeHtml(summaryText)}</mj-text>
        </mj-column>
        <mj-column width=\"42%\" padding=\"8px 24px 24px 0\">
          ${overdueItems.length ? `<mj-text color=\"#DC2626\" font-size=\"16px\" font-weight=\"600\" padding=\"0 0 8px 0\">Overdue (${overdueItems.length})</mj-text><mj-table width=\"100%\">${overdueRows}${overdueItems.length > 5 ? `<tr><td colspan=\"3\" style=\"padding-top:8px; font-size:12px; color:#6B7280;\">...and ${overdueItems.length - 5} more overdue items</td></tr>` : ''}</mj-table><mj-spacer height=\"16px\" />` : ''}
          ${dueThisWeek.length ? `<mj-text color=\"#F59E0B\" font-size=\"16px\" font-weight=\"600\" padding=\"0 0 8px 0\">Due This Week (${dueThisWeek.length})</mj-text><mj-table width=\"100%\">${dueRows}${dueThisWeek.length > 5 ? `<tr><td colspan=\"3\" style=\"padding-top:8px; font-size:12px; color:#6B7280;\">...and ${dueThisWeek.length - 5} more items due this week</td></tr>` : ''}</mj-table><mj-spacer height=\"16px\" />` : ''}
          ${totalItems === 0 ? `<mj-text align=\"center\" color=\"#166534\" font-weight=\"600\">All caught up!</mj-text><mj-text align=\"center\" color=\"#6B7280\" font-size=\"14px\">No overdue or upcoming items this week.</mj-text><mj-spacer height=\"8px\" />` : ''}
          <mj-button href=\"${dashboardUrl}\" align=\"center\">View Your Dashboard</mj-button>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column>
          <mj-spacer height=\"12px\" />
          <mj-text align=\"center\" color=\"#9CA3AF\" font-size=\"11px\">Plan Genie Inc. · Vancouver, Canada<br/>You're receiving this because you signed up for Plan Genie.<br/><a href=\"${dashboardUrl}/settings?tab=notifications\" style=\"color:#6B7280; text-decoration:underline;\">Manage email preferences</a> or <a href=\"${dashboardUrl}/settings?tab=notifications\" style=\"color:#6B7280; text-decoration:underline;\">unsubscribe</a></mj-text>
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
  generateWeeklyDigest,
};
