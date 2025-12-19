const pdf = require('pdf-parse');
const fs = require('fs');

/**
 * Extract text content from PDF buffer
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @returns {Object} - Extracted text and metadata
 */
async function extractTextFromPDF(pdfBuffer) {
  try {
    const data = await pdf(pdfBuffer);
    
    return {
      success: true,
      text: data.text,
      pages: data.numpages,
      info: data.info,
      wordCount: data.text.split(/\s+/).length,
      extractedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('PDF extraction error:', error);
    return {
      success: false,
      error: error.message,
      text: null
    };
  }
}

/**
 * Clean and format extracted text for better processing
 * @param {string} rawText - Raw extracted text
 * @returns {string} - Cleaned text
 */
function cleanExtractedText(rawText) {
  return rawText
    // Remove excessive whitespace
    .replace(/\s+/g, ' ')
    // Remove page numbers and headers/footers (basic patterns)
    .replace(/Page \d+/gi, '')
    .replace(/^\d+\s*$/gm, '')
    // Clean up line breaks
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

/**
 * Validate PDF content for educational processing
 * @param {string} text - Extracted text
 * @returns {Object} - Validation result
 */
function validateEducationalContent(text) {
  const wordCount = text.split(/\s+/).length;
  const minWords = 100;
  const maxWords = 50000;
  
  const validation = {
    isValid: true,
    warnings: [],
    errors: []
  };
  
  if (wordCount < minWords) {
    validation.isValid = false;
    validation.errors.push(`Content too short: ${wordCount} words (minimum: ${minWords})`);
  }
  
  if (wordCount > maxWords) {
    validation.warnings.push(`Content very long: ${wordCount} words (maximum recommended: ${maxWords})`);
  }
  
  // Check for basic educational content indicators
  const hasEducationalKeywords = /chapter|lesson|concept|definition|example|exercise/i.test(text);
  if (!hasEducationalKeywords) {
    validation.warnings.push('Content may not be educational material');
  }
  
  return validation;
}

module.exports = {
  extractTextFromPDF,
  cleanExtractedText,
  validateEducationalContent
};