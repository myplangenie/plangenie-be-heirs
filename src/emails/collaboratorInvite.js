const { renderMjml } = require('./utils/mjmlRenderer');

/**
 * Build the collaborator invite email using MJML.
 * @param {Object} data
 * @param {string} data.ownerName
 * @param {string} data.acceptUrl
 */
function generateCollaboratorInvite({ ownerName = 'A Plan Genie user', acceptUrl }) {
  const safeOwner = ownerName || 'A Plan Genie user';
  const preview = `${safeOwner} invited you to collaborate on Plan Genie`;
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
      <mj-preview>${preview}</mj-preview>
    </mj-head>
    <mj-body background-color="#F8FAFC">
      <mj-section>
        <mj-column>
          <mj-spacer height="24px" />
          <mj-image src="https://logos.plangenie.com/logo.png" alt="PlanGenie" align="center" padding="0 0 8px 0" width="180px" />
        </mj-column>
      </mj-section>

      <mj-section background-color="#ffffff" padding="0" border-radius="12px" css-class="container">
        <mj-column padding="24px 24px 8px 24px">
          <mj-text align="center" color="#1D4374" font-size="20px" font-weight="600" padding="0">Collaboration Invite</mj-text>
          <mj-spacer height="12px" />
          <mj-text>
            <strong>${safeOwner}</strong> has invited you to view their Plan Genie dashboard.
          </mj-text>
          <mj-text color="#6B7280">As a collaborator, you'll be able to view their strategic plans, projects, and progress.</mj-text>
          <mj-spacer height="16px" />
          <mj-button href="${acceptUrl}" align="center">Accept Invitation</mj-button>
          <mj-spacer height="12px" />
          <mj-text color="#6B7280">If the button doesn't work, copy and paste this link into your browser:</mj-text>
          <mj-text><a href="${acceptUrl}" style="color:#1D4374; word-break:break-all;">${acceptUrl}</a></mj-text>
          <mj-spacer height="16px" />
          <mj-text color="#6B7280">This invitation expires in 7 days.</mj-text>
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column>
          <mj-spacer height="16px" />
          <mj-text align="center" color="#9CA3AF" font-size="12px">
            Plan Genie Inc. · Vancouver, Canada<br/>
            You're receiving this because someone invited you to collaborate on Plan Genie.
          </mj-text>
          <mj-spacer height="16px" />
        </mj-column>
      </mj-section>
    </mj-body>
  </mjml>
  `;

  return renderMjml(mjml, { textFallback: `${safeOwner} invited you to collaborate on Plan Genie. Accept: ${acceptUrl}\n\nThis invitation expires in 7 days.` });
}

module.exports = { generateCollaboratorInvite };
