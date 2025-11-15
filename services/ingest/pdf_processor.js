const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const Tesseract = require('tesseract.js');
const winston = require('winston');
const crypto = require('crypto');

// Configure structured logging per MIGRATION.md requirements
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.prettyPrint()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/pdf_processor.log'),
      maxsize: 50000000, // 50MB
      maxFiles: 5
    })
  ]
});

/**
 * Complete PDF Processing Service per MIGRATION.md requirements
 * Handles: PDF text extraction, OCR fallback, structure recovery, 
 * markdown conversion, and quality validation
 */
class PDFProcessor {
  constructor() {
    this.outputDir = path.join(__dirname, '../../outputs');
    this.chapterPDFDir = path.join(__dirname, '../../Chapter_PDF');
    this.tempDir = path.join(__dirname, '../../temp');
    this.ocrConfidenceThreshold = 0.7; // Per MIGRATION.md
    this.maxOcrErrorRate = 0.02; // 2% max ambiguous characters
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dirs = [this.outputDir, this.chapterPDFDir, this.tempDir];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        logger.info({ action: 'directory_created', path: dir });
      }
    });
  }

  /**
   * Main processing function per MIGRATION.md requirements
   * Returns: { success, markdown, rawText, metadata, errorReport }
   */
  async processChapter(pdfFile, chapterId, metadata = {}) {
    const startTime = Date.now();
    const processingLog = [];
    
    try {
      logger.info({ 
        action: 'chapter_processing_start', 
        chapterId, 
        metadata,
        timestamp: new Date().toISOString() 
      });

      // Step 1: Save and validate PDF
      const pdfPath = await this.savePDF(pdfFile, chapterId);
      processingLog.push({ step: 'pdf_save', status: 'completed', path: pdfPath });

      // Step 2: Extract text with fallback chain
      const extractionResult = await this.extractWithFallback(pdfPath, chapterId);
      processingLog.push({ step: 'text_extraction', ...extractionResult.metadata });

      if (!extractionResult.success) {
        return {
          success: false,
          errorReport: {
            chapter_id: chapterId,
            failed_stage: 'text_extraction',
            fail_reasons: extractionResult.errors,
            processing_time_ms: Date.now() - startTime,
            suggested_action: 'human_review_required'
          }
        };
      }

      // Step 3: Structure recovery
      const structureResult = await this.recoverStructureAdvanced(
        extractionResult.text, 
        extractionResult.confidence
      );
      processingLog.push({ step: 'structure_recovery', ...structureResult.metadata });

      // Step 4: Clean and convert to markdown
      const markdown = await this.convertToCleanMarkdown(
        structureResult.structuredText,
        structureResult.headings
      );
      processingLog.push({ step: 'markdown_conversion', status: 'completed' });

      // Step 5: Quality validation
      const qualityCheck = await this.validateQuality(markdown, extractionResult.text);
      processingLog.push({ step: 'quality_validation', ...qualityCheck });

      const processingTimeMs = Date.now() - startTime;
      
      logger.info({ 
        action: 'chapter_processing_complete', 
        chapterId, 
        processingTimeMs,
        success: true 
      });

      return {
        success: true,
        markdown: markdown,
        rawText: extractionResult.text,
        metadata: {
          chapter_id: chapterId,
          processing_time_ms: processingTimeMs,
          extraction_method: extractionResult.method,
          structure_confidence: structureResult.confidence,
          quality_score: qualityCheck.score,
          word_count: this.countWords(markdown),
          generated_at: new Date().toISOString(),
          generation_version: 'content_pipeline_v1'
        },
        processingLog: processingLog
      };

    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      logger.error({ 
        action: 'chapter_processing_failed', 
        chapterId, 
        error: error.message,
        processingTimeMs 
      });

      return {
        success: false,
        errorReport: {
          chapter_id: chapterId,
          failed_stage: 'processing_error',
          fail_reasons: [error.message],
          processing_time_ms: processingTimeMs,
          suggested_action: 'retry_with_debug'
        }
      };
    }
  }

  /**
   * Save uploaded PDF with validation
   */
  async savePDF(pdfFile, chapterId) {
    const pdfPath = path.join(this.chapterPDFDir, `${chapterId}.pdf`);
    
    // Validate file size and type
    if (pdfFile.size > 50 * 1024 * 1024) { // 50MB limit
      throw new Error('PDF file too large (>50MB)');
    }
    
    if (!pdfFile.mimetype.includes('pdf')) {
      throw new Error('Invalid file type - must be PDF');
    }

    await pdfFile.mv(pdfPath);
    logger.info({ action: 'pdf_saved', path: pdfPath, size: pdfFile.size });
    
    return pdfPath;
  }

  /**
   * Text extraction with OCR fallback per MIGRATION.md
   */
  async extractWithFallback(pdfPath, chapterId) {
    const pdfBuffer = fs.readFileSync(pdfPath);
    
    // Method 1: Direct PDF text extraction
    try {
      const pdfData = await pdf(pdfBuffer);
      const extractedText = pdfData.text.trim();
      
      if (extractedText.length > 100) { // Minimum threshold
        const confidence = this.assessTextQuality(extractedText);
        
        if (confidence > 0.8) {
          logger.info({ 
            action: 'text_extraction_success', 
            method: 'direct_pdf',
            length: extractedText.length,
            confidence 
          });
          
          return {
            success: true,
            text: extractedText,
            method: 'direct_pdf',
            confidence: confidence,
            metadata: { method: 'direct_pdf', confidence, text_length: extractedText.length }
          };
        }
      }
    } catch (pdfError) {
      logger.warn({ action: 'direct_pdf_failed', error: pdfError.message });
    }

    // Method 2: High-sensitivity OCR per MIGRATION.md
    // If direct PDF extraction had some text but low confidence, try OCR
    try {
      logger.info({ action: 'ocr_fallback_start', chapterId });
      
      const ocrResult = await this.performHighSensitivityOCR(pdfPath);
      
      if (ocrResult.success && ocrResult.errorRate <= this.maxOcrErrorRate) {
        return {
          success: true,
          text: ocrResult.text,
          method: 'high_sensitivity_ocr',
          confidence: ocrResult.confidence,
          metadata: { 
            method: 'ocr', 
            confidence: ocrResult.confidence,
            error_rate: ocrResult.errorRate,
            text_length: ocrResult.text.length 
          }
        };
      } else {
        logger.warn({ 
          action: 'ocr_quality_insufficient',
          errorRate: ocrResult.errorRate,
          threshold: this.maxOcrErrorRate
        });
        
        // Fall back to direct PDF text if it exists (even with lower confidence)
        try {
          const pdfData = await pdf(pdfBuffer);
          const fallbackText = pdfData.text.trim();
          
          if (fallbackText.length > 50) {
            logger.info({ 
              action: 'fallback_to_direct_pdf',
              reason: 'ocr_quality_insufficient',
              textLength: fallbackText.length
            });
            
            return {
              success: true,
              text: fallbackText,
              method: 'fallback_direct_pdf',
              confidence: 0.6, // Lower confidence due to OCR failure
              metadata: { 
                method: 'fallback_pdf',
                confidence: 0.6,
                text_length: fallbackText.length,
                ocr_failed: true
              }
            };
          }
        } catch (fallbackError) {
          logger.error({ action: 'fallback_pdf_failed', error: fallbackError.message });
        }
        
        return {
          success: false,
          errors: [`OCR_error_rate_too_high: ${ocrResult.errorRate}`, 'no_fallback_available'],
          metadata: { method: 'ocr_failed', error_rate: ocrResult.errorRate }
        };
      }
    } catch (ocrError) {
      logger.error({ action: 'ocr_failed', error: ocrError.message });
      
      // Try to return direct PDF text as final fallback
      try {
        const pdfData = await pdf(pdfBuffer);
        const fallbackText = pdfData.text.trim();
        
        if (fallbackText.length > 50) {
          logger.info({ 
            action: 'emergency_fallback_to_direct_pdf',
            reason: 'ocr_completely_failed',
            textLength: fallbackText.length
          });
          
          return {
            success: true,
            text: fallbackText,
            method: 'emergency_fallback_pdf',
            confidence: 0.5, // Even lower confidence
            metadata: { 
              method: 'emergency_pdf',
              confidence: 0.5,
              text_length: fallbackText.length,
              ocr_error: ocrError.message
            }
          };
        }
      } catch (emergencyError) {
        logger.error({ action: 'emergency_fallback_failed', error: emergencyError.message });
      }
      
      return {
        success: false,
        errors: ['text_extraction_failed', 'ocr_failed', 'no_fallback_available'],
        metadata: { 
          method: 'all_failed',
          ocr_error: ocrError.message
        }
      };
    }
  }

  /**
   * High-sensitivity OCR with error rate calculation
   * First converts PDF to images, then performs OCR
   */
  async performHighSensitivityOCR(pdfPath) {
    try {
      // First attempt: Convert PDF to images for OCR
      // Note: This requires GraphicsMagick to be installed
      logger.info({ action: 'pdf_to_image_conversion_start', pdfPath });
      
      const convert = require('pdf2pic').fromPath(pdfPath, {
        density: 300,           // High DPI for better OCR
        saveFilename: "page",
        savePath: this.tempDir,
        format: "png",
        width: 2480,
        height: 3508
      });
      
      const results = await convert.bulk(-1); // Convert all pages
      
      if (!results || results.length === 0) {
        throw new Error('PDF to image conversion failed - no pages converted');
      }
      
      logger.info({ 
        action: 'pdf_to_image_success', 
        pages: results.length,
        firstImage: results[0].path 
      });

      // Perform OCR on first page (can be extended for multi-page)
      const imagePath = results[0].path;
      const worker = await Tesseract.createWorker('eng');
      
      await worker.setParameters({
        tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .,!?;:()-[]{}"\'/+=*&%$#@<>|\\~`^_',
        tessedit_pageseg_mode: Tesseract.PSM.AUTO_ONLY
      });

      const { data: { text, confidence } } = await worker.recognize(imagePath);
      await worker.terminate();

      // Clean up temporary images
      results.forEach(result => {
        try {
          fs.unlinkSync(result.path);
        } catch (cleanupError) {
          logger.warn({ action: 'temp_file_cleanup_failed', file: result.path, error: cleanupError.message });
        }
      });

      const errorRate = this.calculateOCRErrorRate(text);
      
      logger.info({ 
        action: 'ocr_completed', 
        confidence, 
        errorRate, 
        textLength: text.length 
      });

      return {
        success: true,
        text: text.trim(),
        confidence: confidence / 100, // Normalize to 0-1
        errorRate: errorRate
      };

    } catch (error) {
      logger.error({ action: 'ocr_error', error: error.message });
      
      // If OCR fails (e.g., GraphicsMagick not installed), return graceful failure
      return {
        success: false,
        text: '',
        confidence: 0,
        errorRate: 1.0,
        error: error.message
      };
    }
  }

  /**
   * Calculate OCR error rate by detecting ambiguous characters
   */
  calculateOCRErrorRate(text) {
    const ambiguousPatterns = [
      /[Il1|]/g, // Common OCR confusions
      /[O0]/g,
      /[5S]/g,
      /[6G]/g,
      /[8B]/g,
      /[2Z]/g,
      /[rn]/g, // 'rn' vs 'm'
    ];
    
    let ambiguousCharCount = 0;
    ambiguousPatterns.forEach(pattern => {
      const matches = text.match(pattern);
      if (matches) ambiguousCharCount += matches.length;
    });

    return ambiguousCharCount / text.length;
  }

  /**
   * Assess text quality for direct PDF extraction
   */
  assessTextQuality(text) {
    let score = 1.0;
    
    // Check for encoding issues
    if (text.includes('�') || text.includes('□')) score -= 0.3;
    
    // Check for reasonable word/space ratio
    const words = text.split(/\\s+/).length;
    const totalChars = text.length;
    const avgWordLength = totalChars / words;
    if (avgWordLength < 2 || avgWordLength > 15) score -= 0.2;
    
    // Check for reasonable sentence structure
    const sentences = text.split(/[.!?]+/).length;
    if (sentences < words / 20) score -= 0.2; // Too few sentences
    
    // Check for excessive line breaks (OCR artifact)
    const lineBreaks = text.split('\\n').length;
    if (lineBreaks > words / 5) score -= 0.2;
    
    return Math.max(0, score);
  }

  /**
   * Advanced structure recovery using multiple heuristics
   */
  async recoverStructureAdvanced(text, confidence) {
    const lines = text.split('\\n').map(line => line.trim()).filter(line => line.length > 0);
    const structuredElements = [];
    const headings = [];
    let structureConfidence = confidence;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const context = {
        previous: i > 0 ? lines[i-1] : null,
        next: i < lines.length - 1 ? lines[i+1] : null,
        position: i / lines.length
      };

      const classification = this.classifyLine(line, context);
      
      if (classification.type === 'heading') {
        headings.push({
          text: line,
          level: classification.level,
          confidence: classification.confidence,
          lineIndex: i
        });
        
        structuredElements.push({
          type: 'heading',
          level: classification.level,
          text: line,
          markdown: '#'.repeat(classification.level) + ' ' + line
        });
      } else if (classification.type === 'list_item') {
        structuredElements.push({
          type: 'list_item',
          text: line,
          markdown: '- ' + line.replace(/^[-•*]\\s*/, '')
        });
      } else {
        structuredElements.push({
          type: 'paragraph',
          text: line,
          markdown: line
        });
      }

      // Reduce confidence for uncertain classifications
      if (classification.confidence < 0.7) {
        structureConfidence *= 0.95;
      }
    }

    // Apply structural fixes based on patterns
    const fixedElements = this.applyStructuralFixes(structuredElements);
    const structuredText = fixedElements.map(el => el.markdown).join('\\n\\n');

    return {
      structuredText: structuredText,
      headings: headings,
      confidence: structureConfidence,
      metadata: {
        total_lines: lines.length,
        headings_found: headings.length,
        confidence: structureConfidence
      }
    };
  }

  /**
   * Classify line type using multiple heuristics
   */
  classifyLine(line, context) {
    // Heading detection patterns per MIGRATION.md
    const headingPatterns = [
      { regex: /^\\d+\\.?\\s+[A-Z][^.]*$/, level: 1, confidence: 0.9 }, // "1. Chapter Title"
      { regex: /^\\d+\\.\\d+\\.?\\s+[A-Z]/, level: 2, confidence: 0.8 }, // "1.1. Section"
      { regex: /^[A-Z][A-Z\\s]{3,30}$/, level: 1, confidence: 0.7 }, // "CHAPTER TITLE"
      { regex: /^[A-Z][a-z\\s]{5,50}$/, level: 2, confidence: 0.6 }, // "Section Title"
    ];

    // Check if next line is underline (common in textbooks)
    if (context.next && /^[-=]{3,}$/.test(context.next)) {
      return { type: 'heading', level: 1, confidence: 0.95 };
    }

    // Check heading patterns
    for (const pattern of headingPatterns) {
      if (pattern.regex.test(line)) {
        return { 
          type: 'heading', 
          level: pattern.level, 
          confidence: pattern.confidence 
        };
      }
    }

    // List item detection
    if (/^[-•*]\\s+/.test(line) || /^\\d+\\.\\s+/.test(line)) {
      return { type: 'list_item', confidence: 0.8 };
    }

    // Default to paragraph
    return { type: 'paragraph', confidence: 0.9 };
  }

  /**
   * Apply structural fixes for common issues
   */
  applyStructuralFixes(elements) {
    const fixed = [];
    
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      
      // Fix broken headings (OCR artifacts)
      if (element.type === 'heading') {
        element.markdown = this.fixHeadingText(element.text, element.level);
      }
      
      // Merge fragmented paragraphs
      if (element.type === 'paragraph' && i > 0 && 
          fixed[fixed.length - 1].type === 'paragraph' &&
          element.text.length < 50 && 
          !element.text.endsWith('.') && 
          !element.text.endsWith('!') && 
          !element.text.endsWith('?')) {
        
        // Merge with previous paragraph
        fixed[fixed.length - 1].markdown += ' ' + element.text;
        continue;
      }
      
      fixed.push(element);
    }
    
    return fixed;
  }

  /**
   * Fix common heading text issues
   */
  fixHeadingText(text, level) {
    // Fix common OCR errors in headings
    let fixed = text
      .replace(/([a-z])([A-Z])/g, '$1 $2') // Insert spaces in camelCase
      .replace(/\\bl\\b/g, '1') // Common OCR: l -> 1
      .replace(/\\bO\\b/g, '0') // Common OCR: O -> 0
      .replace(/([0-9])([A-Z])/g, '$1. $2') // Add periods after numbers
      .trim();

    return '#'.repeat(level) + ' ' + fixed;
  }

  /**
   * Convert structured elements to clean markdown
   */
  async convertToCleanMarkdown(structuredText, headings) {
    let markdown = structuredText;
    
    // Normalize spacing
    markdown = markdown.replace(/\\n{3,}/g, '\\n\\n');
    
    // Ensure proper spacing around headings
    markdown = markdown.replace(/(^|\\n)(#{1,6}[^\\n]+)(\\n|$)/g, '\\n\\n$2\\n\\n');
    
    // Clean up list formatting
    markdown = markdown.replace(/(\\n- [^\\n]+)(\\n)(?=- )/g, '$1\\n');
    
    // Remove excessive whitespace
    markdown = markdown.trim();
    
    // Add metadata comment at top
    const metadataComment = `<!-- Generated by Journey Creation Content Pipeline -->\\n<!-- Processing timestamp: ${new Date().toISOString()} -->\\n\\n`;
    
    return metadataComment + markdown;
  }

  /**
   * Validate content quality per MIGRATION.md requirements
   */
  async validateQuality(markdown, originalText) {
    const checks = {
      word_count: this.countWords(markdown),
      heading_count: (markdown.match(/^#{1,6}/gm) || []).length,
      list_count: (markdown.match(/^- /gm) || []).length,
      paragraph_count: markdown.split('\\n\\n').length,
      original_length: originalText.length,
      processed_length: markdown.length
    };

    // Calculate quality score
    let score = 1.0;
    
    // Check minimum content
    if (checks.word_count < 100) score -= 0.4;
    if (checks.heading_count === 0) score -= 0.2;
    
    // Check processing loss
    const contentLoss = 1 - (checks.processed_length / checks.original_length);
    if (contentLoss > 0.3) score -= 0.3; // More than 30% content lost
    
    const qualityLevel = score > 0.8 ? 'excellent' : 
                        score > 0.6 ? 'good' : 
                        score > 0.4 ? 'fair' : 'poor';

    return {
      score: score,
      level: qualityLevel,
      checks: checks,
      status: score > 0.4 ? 'passed' : 'failed'
    };
  }

  /**
   * Count words in text
   */
  countWords(text) {
    return text.split(/\\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Save processed chapter data with proper structure per MIGRATION.md
   */
  async saveChapterData(chapterId, processedData) {
    const chapterDir = path.join(this.outputDir, `chapter_${chapterId}`);
    
    if (!fs.existsSync(chapterDir)) {
      fs.mkdirSync(chapterDir, { recursive: true });
    }

    // Save chapter.md (per MIGRATION.md output contract)
    const markdownPath = path.join(chapterDir, 'chapter.md');
    fs.writeFileSync(markdownPath, processedData.markdown, 'utf8');
    
    // Save raw text for reference
    if (processedData.rawText) {
      const rawTextPath = path.join(chapterDir, 'raw_text.txt');
      fs.writeFileSync(rawTextPath, processedData.rawText, 'utf8');
    }

    // Save processing metadata
    const metadataPath = path.join(chapterDir, 'processing_metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(processedData.metadata, null, 2), 'utf8');
    
    // Save processing log
    if (processedData.processingLog) {
      const logPath = path.join(chapterDir, 'processing_log.json');
      fs.writeFileSync(logPath, JSON.stringify(processedData.processingLog, null, 2), 'utf8');
    }
    
    logger.info({ 
      action: 'chapter_data_saved', 
      chapterId, 
      outputDir: chapterDir,
      files: ['chapter.md', 'raw_text.txt', 'processing_metadata.json'] 
    });
    
    return chapterDir;
  }

  /**
   * Generate deterministic chapter processing seed per MIGRATION.md
   */
  generateProcessingSeed(chapterId) {
    return crypto.createHash('md5').update(chapterId).digest('hex');
  }
}

module.exports = new PDFProcessor();