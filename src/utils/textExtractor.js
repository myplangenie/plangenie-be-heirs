/**
 * Text Extraction Utility
 * Extracts text content from various document formats for RAG
 */

/**
 * Extract text from a buffer based on MIME type
 * @param {Buffer} buffer - File buffer
 * @param {string} mimeType - MIME type of the file
 * @returns {Promise<string>} - Extracted text
 */
async function extractText(buffer, mimeType) {
  if (!buffer || !mimeType) {
    throw new Error('Buffer and mimeType are required');
  }

  switch (mimeType) {
    case 'application/pdf':
      return extractFromPdf(buffer);
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return extractFromDocx(buffer);
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return extractFromXlsx(buffer);
    case 'text/plain':
      return extractFromTxt(buffer);
    default:
      throw new Error(`Unsupported file type: ${mimeType}`);
  }
}

/**
 * Extract text from PDF
 */
async function extractFromPdf(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return cleanText(data.text || '');
  } catch (err) {
    console.error('PDF extraction error:', err.message);
    throw new Error('Failed to extract text from PDF');
  }
}

/**
 * Extract text from DOCX
 */
async function extractFromDocx(buffer) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return cleanText(result.value || '');
  } catch (err) {
    console.error('DOCX extraction error:', err.message);
    throw new Error('Failed to extract text from DOCX');
  }
}

/**
 * Extract text from XLSX
 */
async function extractFromXlsx(buffer) {
  try {
    const XLSX = require('xlsx');
    const workbook = XLSX.read(buffer, { type: 'buffer' });

    const texts = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      // Convert sheet to text with tab-separated values
      const text = XLSX.utils.sheet_to_txt(sheet, { strip: true });
      if (text && text.trim()) {
        texts.push(`[Sheet: ${sheetName}]\n${text}`);
      }
    }

    return cleanText(texts.join('\n\n'));
  } catch (err) {
    console.error('XLSX extraction error:', err.message);
    throw new Error('Failed to extract text from XLSX');
  }
}

/**
 * Extract text from TXT
 */
async function extractFromTxt(buffer) {
  try {
    return cleanText(buffer.toString('utf-8'));
  } catch (err) {
    console.error('TXT extraction error:', err.message);
    throw new Error('Failed to extract text from TXT');
  }
}

/**
 * Clean and normalize extracted text
 */
function cleanText(text) {
  if (!text) return '';

  return text
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove excessive whitespace
    .replace(/[ \t]+/g, ' ')
    // Remove excessive newlines (more than 2)
    .replace(/\n{3,}/g, '\n\n')
    // Trim each line
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    // Final trim
    .trim();
}

module.exports = {
  extractText,
  extractFromPdf,
  extractFromDocx,
  extractFromXlsx,
  extractFromTxt,
  cleanText,
};
