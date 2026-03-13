const mjml2html = require('mjml');
const juice = require('juice');

function textify(html) {
  try {
    // Very light HTML -> text fallback
    return String(html || '')
      .replace(/<\/(p|div|h\d|li)>/gi, '\n')
      .replace(/<li>/gi, '• ')
      .replace(/<br\s*\/?>(\s*)/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } catch (e) {
    return '';
  }
}

/**
 * Compile MJML to HTML and inline CSS for broad client compatibility.
 * Keeps media queries for responsive support.
 */
function renderMjml(mjmlString, opts = {}) {
  const { keepComments = false, minify = false, textFallback } = opts;
  const out = mjml2html(mjmlString, {
    keepComments,
    minify,
    validationLevel: 'soft',
  });
  if (out.errors && out.errors.length) {
    // Log but continue with best-effort output
    console.error('[email] MJML validation warnings:', out.errors.map(e => e.formattedMessage || e.message));
  }
  // Inline CSS while preserving media queries (important for Outlook/others)
  const inlined = juice(out.html, { preserveMediaQueries: true, applyWidthAttributes: true, applyHeightAttributes: true });
  const text = typeof textFallback === 'string' ? textFallback : textify(inlined);
  return { html: inlined, text };
}

module.exports = { renderMjml };

