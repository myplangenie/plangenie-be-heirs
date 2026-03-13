const { renderMjml } = require('./mjmlRenderer');

/**
 * Build an email using the same single-column invite card layout
 * used by collaborator invites. This layout is robust across clients.
 *
 * @param {Object} opts
 * @param {string} opts.title - Card title (centered)
 * @param {string} opts.bodyHtml - Inner HTML for the card body (use basic tags and <br/>)
 * @param {{label:string, href:string}=} opts.button - Optional CTA button
 * @param {string[]=} opts.footerLines - Optional footer lines under the card (centered, muted)
 * @returns {{html:string, text:string}}
 */
function buildInviteStyleEmail({ title, bodyHtml, button, footerLines }) {
  const safeTitle = String(title || '').trim() || 'Plan Genie';
  const btn = button && button.href && button.label ? button : null;
  const footer = Array.isArray(footerLines) && footerLines.length
    ? footerLines
    : [
        'Plan Genie Inc. · Vancouver, Canada',
        "You're receiving this because you interacted with Plan Genie.",
      ];

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
      <mj-preview>${safeTitle}</mj-preview>
    </mj-head>
    <mj-body background-color="#F8FAFC">
      <mj-section>
        <mj-column>
          <mj-spacer height="24px" />
          <mj-image src="https://logos.plangenie.com/logo.png" alt="PlanGenie" align="center" padding="0 0 8px 0" width="180px" />
        </mj-column>
      </mj-section>

      <mj-section background-color="#ffffff" padding="0" border-radius="12px">
        <mj-column padding="24px 24px 16px 24px">
          <mj-text align="center" color="#1D4374" font-size="20px" font-weight="600" padding="0">${escapeHtml(safeTitle)}</mj-text>
          <mj-spacer height="12px" />
          <mj-text>${bodyHtml}</mj-text>
          ${btn ? `<mj-spacer height=\"16px\" /><mj-button href=\"${btn.href}\" align=\"center\">${escapeHtml(btn.label)}</mj-button>` : ''}
        </mj-column>
      </mj-section>

      <mj-section>
        <mj-column>
          <mj-spacer height="16px" />
          <mj-text align="center" color="#9CA3AF" font-size="12px">
            ${footer.map(f => escapeHtml(f)).join('<br/>')}
          </mj-text>
          <mj-spacer height="16px" />
        </mj-column>
      </mj-section>
    </mj-body>
  </mjml>`;

  const text = buildText(bodyHtml, footer);
  return renderMjml(mjml, { textFallback: text });
}

function buildText(bodyHtml, footerLines) {
  const plain = String(bodyHtml || '')
    .replace(/<\/(p|div|h\d|li)>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const footer = (footerLines || []).join('\n');
  return [plain, footer].filter(Boolean).join('\n\n');
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

module.exports = { buildInviteStyleEmail };

