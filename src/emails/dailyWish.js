/**
 * Daily Wish Email Template
 * Branded HTML email for personalized daily business recommendations
 */

const PRIMARY_COLOR = '#1D4374';
const ACCENT_COLOR = '#F59E0B';
const BG_COLOR = '#F8FAFC';

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
 * @returns {Object} { html, text, subject }
 */
function generateDailyWish(data) {
  const { userName, businessName, title, message, category = 'general', dashboardUrl } = data;

  const firstName = userName?.split(' ')[0] || 'there';
  const categoryStyle = CATEGORY_STYLES[category] || CATEGORY_STYLES.general;
  const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);

  // Get date for display
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Wish - Plan Genie</title>
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
                    <h1 style="margin: 0; color: #FFFFFF; font-size: 24px; font-weight: 700;">
                      Plan Genie
                    </h1>
                    <p style="margin: 8px 0 0 0; color: rgba(255, 255, 255, 0.8); font-size: 14px;">
                      Your Daily Wish
                    </p>
                  </td>
                  <td align="right">
                    <div style="background-color: rgba(255, 255, 255, 0.2); border-radius: 50%; width: 48px; height: 48px; display: inline-block; text-align: center; line-height: 48px;">
                      <span style="font-size: 24px;">✨</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Date -->
          <tr>
            <td style="padding: 24px 32px 0 32px;">
              <p style="margin: 0; color: #9CA3AF; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
                ${escapeHtml(today)}
              </p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding: 16px 32px;">
              <h2 style="margin: 0; color: #1F2937; font-size: 20px; font-weight: 600;">
                Good day, ${escapeHtml(firstName)}!
              </h2>
              <p style="margin: 12px 0 0 0; color: #6B7280; font-size: 15px; line-height: 1.6;">
                Here's your personalized recommendation for ${businessName ? `<strong>${escapeHtml(businessName)}</strong>` : 'your business'} today:
              </p>
            </td>
          </tr>

          <!-- Main Content Card -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <div style="background-color: ${categoryStyle.bgColor}; border: 1px solid ${categoryStyle.color}20; border-radius: 12px; padding: 24px; border-left: 4px solid ${categoryStyle.color};">
                <!-- Category Badge -->
                <div style="margin-bottom: 16px;">
                  <span style="display: inline-block; background-color: ${categoryStyle.color}15; color: ${categoryStyle.color}; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 16px;">
                    ${categoryStyle.icon} ${escapeHtml(categoryLabel)}
                  </span>
                </div>

                <!-- Title -->
                <h3 style="margin: 0 0 12px 0; color: #1F2937; font-size: 18px; font-weight: 600;">
                  ${escapeHtml(title)}
                </h3>

                <!-- Message -->
                <p style="margin: 0; color: #4B5563; font-size: 15px; line-height: 1.7;">
                  ${escapeHtml(message)}
                </p>
              </div>
            </td>
          </tr>

          <!-- CTA Button -->
          <tr>
            <td style="padding: 0 32px 32px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${dashboardUrl}" style="display: inline-block; background-color: ${PRIMARY_COLOR}; color: #FFFFFF; text-decoration: none; font-weight: 600; font-size: 14px; padding: 14px 32px; border-radius: 8px;">
                      Open Your Dashboard
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Motivational Footer -->
          <tr>
            <td style="padding: 0 32px 24px 32px;">
              <div style="text-align: center; padding: 16px; background-color: #FFFBEB; border-radius: 8px; border: 1px solid #FDE68A;">
                <p style="margin: 0; color: #92400E; font-size: 14px; font-style: italic;">
                  "Small consistent actions lead to remarkable results."
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; background-color: #F9FAFB; border-radius: 0 0 12px 12px; border-top: 1px solid #E5E7EB;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <p style="margin: 0; color: #9CA3AF; font-size: 12px; line-height: 1.5;">
                      Your daily wish is personalized based on your business profile and goals.
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
PLAN GENIE - YOUR DAILY WISH
${today}

Good day, ${firstName}!

Here's your personalized recommendation for ${businessName || 'your business'} today:

[${categoryLabel.toUpperCase()}] ${title}

${message}

---

Open your dashboard: ${dashboardUrl}

"Small consistent actions lead to remarkable results."

---
Your daily wish is personalized based on your business profile and goals.
© ${new Date().getFullYear()} Plan Genie. All rights reserved.
  `.trim();

  const subject = `✨ Daily Wish: ${title}`;

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
