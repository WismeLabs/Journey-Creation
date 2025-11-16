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

      // Step 4: Diagram detection per MIGRATION.md
      const diagramAnalysis = await this.detectDiagramCritical(
        extractionResult.text,
        pdfPath,
        chapterId
      );
      processingLog.push({ step: 'diagram_detection', ...diagramAnalysis.metadata });

      // Step 5: Clean and convert to markdown
      const markdown = await this.convertToCleanMarkdown(
        structureResult.structuredText,
        structureResult.headings,
        diagramAnalysis
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
          diagram_analysis: diagramAnalysis,
          requires_teacher_review: diagramAnalysis.requiresReview,
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
      
      const ocrResult = await this.performHighSensitivityOCR(pdfPath, chapterId);
      
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
            text_length: ocrResult.text.length,
            processing_time_ms: ocrResult.processingTime
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
  async saveChapterData(chapterId, processedData, metadata = {}) {
    const { grade_band = 'unknown', subject = 'unknown' } = metadata;
    const curriculum = metadata.curriculum || 'CBSE';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const generationId = metadata.generation_id || `gen_${timestamp}`;
    
    const chapterDir = path.join(
      this.outputDir,
      curriculum.toUpperCase(),
      `Grade_${grade_band}`,
      subject.toLowerCase(),
      `chapter_${chapterId}`,
      generationId
    );
    
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
   * Perform high-sensitivity OCR per MIGRATION.md requirements
   * Uses multiple OCR passes with different configurations for maximum accuracy
   */
  async performHighSensitivityOCR(pdfPath, chapterId) {
    const startTime = Date.now();
    
    try {
      logger.info({ action: 'high_sensitivity_ocr_start', chapterId });
      
      // Configuration for high-sensitivity OCR
      const ocrConfigs = [
        {
          name: 'standard',
          options: {
            lang: 'eng',
            oem: 1, // LSTM OCR Engine
            psm: 6, // Uniform block of text
          }
        },
        {
          name: 'high_sensitivity',
          options: {
            lang: 'eng',
            oem: 1,
            psm: 3, // Fully automatic page segmentation
            preserve_interword_spaces: '1',
            tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?()-:;[]{}/"\'%+='
          }
        },
        {
          name: 'document_mode',
          options: {
            lang: 'eng',
            oem: 1,
            psm: 1, // Automatic page segmentation with OSD
            preserve_interword_spaces: '1'
          }
        }
      ];
      
      let bestResult = null;
      let bestQuality = 0;
      
      // Try each configuration and select the best result
      for (const config of ocrConfigs) {
        try {
          logger.info({ action: 'ocr_attempt', config: config.name, chapterId });
          
          const { data: { text, confidence } } = await Tesseract.recognize(
            pdfPath,
            'eng',
            { 
              logger: m => {
                if (m.status === 'recognizing text') {
                  // Log progress periodically
                  if (Math.round(m.progress * 100) % 20 === 0) {
                    logger.info({ 
                      action: 'ocr_progress', 
                      config: config.name,
                      progress: Math.round(m.progress * 100) 
                    });
                  }
                }
              },
              ...config.options
            }
          );
          
          if (text && text.length > 50) {
            const quality = this.assessOCRQuality(text, confidence);
            const errorRate = this.calculateOCRErrorRate(text);
            
            logger.info({
              action: 'ocr_attempt_complete',
              config: config.name,
              textLength: text.length,
              confidence,
              quality,
              errorRate
            });
            
            if (quality > bestQuality) {
              bestResult = {
                text: text.trim(),
                confidence: confidence / 100, // Normalize to 0-1
                quality,
                errorRate,
                config: config.name
              };
              bestQuality = quality;
            }
          }
          
        } catch (configError) {
          logger.warn({ 
            action: 'ocr_config_failed', 
            config: config.name, 
            error: configError.message 
          });
        }
      }
      
      const processingTime = Date.now() - startTime;
      
      if (bestResult && bestResult.errorRate <= this.maxOcrErrorRate) {
        // Apply post-processing improvements
        const cleanedText = this.postProcessOCRText(bestResult.text);
        
        logger.info({
          action: 'high_sensitivity_ocr_success',
          chapterId,
          config: bestResult.config,
          processingTimeMs: processingTime,
          errorRate: bestResult.errorRate,
          confidence: bestResult.confidence
        });
        
        return {
          success: true,
          text: cleanedText,
          confidence: bestResult.confidence,
          errorRate: bestResult.errorRate,
          processingTime,
          method: `high_sensitivity_ocr_${bestResult.config}`
        };
        
      } else {
        // OCR failed quality thresholds
        logger.error({
          action: 'high_sensitivity_ocr_failed',
          chapterId,
          bestErrorRate: bestResult?.errorRate || 'unknown',
          threshold: this.maxOcrErrorRate,
          processingTimeMs: processingTime
        });
        
        return {
          success: false,
          error: 'OCR quality below threshold',
          errorRate: bestResult?.errorRate || 1.0,
          processingTime,
          attempted_configs: ocrConfigs.length
        };
      }
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error({ 
        action: 'high_sensitivity_ocr_error', 
        chapterId, 
        error: error.message,
        processingTimeMs: processingTime
      });
      
      return {
        success: false,
        error: error.message,
        processingTime
      };
    }
  }
  
  /**
   * Assess OCR quality and calculate composite score
   */
  assessOCRQuality(text, confidence) {
    // Composite quality score based on multiple factors
    let qualityScore = 0;
    
    // Factor 1: Tesseract confidence (0-100)
    const confidenceScore = (confidence || 0) / 100;
    qualityScore += confidenceScore * 0.4; // 40% weight
    
    // Factor 2: Text coherence (valid word ratio)
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const validWords = words.filter(word => this.isLikelyValidWord(word));
    const coherenceScore = words.length > 0 ? validWords.length / words.length : 0;
    qualityScore += coherenceScore * 0.3; // 30% weight
    
    // Factor 3: Character error indicators
    const errorIndicators = /[^\w\s.,!?()-:;[\]{}/"'%+=]/g;
    const errorMatches = text.match(errorIndicators) || [];
    const errorScore = Math.max(0, 1 - (errorMatches.length / text.length));
    qualityScore += errorScore * 0.2; // 20% weight
    
    // Factor 4: Sentence structure
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 5);
    const structureScore = Math.min(1, sentences.length / 10); // Normalize to ~10 sentences
    qualityScore += structureScore * 0.1; // 10% weight
    
    return Math.min(1, qualityScore);
  }
  
  /**
   * Calculate OCR error rate based on ambiguous character patterns
   */
  calculateOCRErrorRate(text) {
    const totalChars = text.length;
    if (totalChars === 0) return 1.0;
    
    // Common OCR confusion patterns
    const ambiguousPatterns = [
      /[Il1|]/g,           // l, I, 1, |
      /[O0]/g,             // O, 0
      /[S5]/g,             // S, 5
      /[Z2]/g,             // Z, 2
      /[G6]/g,             // G, 6
      /[B8]/g,             // B, 8
      /[^\w\s.,!?()-:;[\]{}/"'%+=]/g  // Invalid characters
    ];
    
    let ambiguousCount = 0;
    ambiguousPatterns.forEach(pattern => {
      const matches = text.match(pattern) || [];
      ambiguousCount += matches.length;
    });
    
    return Math.min(1, ambiguousCount / totalChars);
  }
  
  /**
   * Check if a word is likely valid (basic heuristics)
   */
  isLikelyValidWord(word) {
    if (word.length < 2) return false;
    if (word.length > 30) return false; // Unreasonably long
    
    // Must contain at least one letter
    if (!/[a-zA-Z]/.test(word)) return false;
    
    // Too many repeated characters (OCR artifacts)
    if (/(.)\1{4,}/.test(word)) return false;
    
    return true;
  }
  
  /**
   * Post-process OCR text for common errors
   */
  postProcessOCRText(text) {
    let cleaned = text;
    
    // Common OCR corrections
    const corrections = [
      [/\bl\b/g, 'I'],      // Standalone 'l' -> 'I'
      [/\b1\b/g, 'I'],      // Standalone '1' -> 'I'
      [/\bO\b/g, '0'],      // Standalone 'O' in numbers -> '0'
      [/([a-z])1([a-z])/g, '$1l$2'], // '1' between letters -> 'l'
      [/([A-Z])l([A-Z])/g, '$1I$2'], // 'l' between caps -> 'I'
      [/\s{2,}/g, ' '],     // Multiple spaces -> single space
      [/^\s+|\s+$/g, '']    // Trim
    ];
    
    corrections.forEach(([pattern, replacement]) => {
      cleaned = cleaned.replace(pattern, replacement);
    });
    
    return cleaned;
  }

  /**
   * Detect diagram-critical chapters per MIGRATION.md
   * Returns: { requiresReview, diagramCount, complexity, metadata }
   */
  async detectDiagramCritical(text, pdfPath, chapterId) {
    const analysis = {
      requiresReview: false,
      diagramCount: 0,
      complexity: 'low',
      diagramTypes: [],
      criticalReasons: [],
      metadata: {
        status: 'completed',
        method: 'text_pattern_analysis'
      }
    };

    try {
      // Text-based diagram indicators
      const diagramIndicators = [
        // Direct references
        /\b(figure|fig\.?|diagram|chart|graph|image|picture|illustration)\s*\d+/gi,
        /\b(see\s+)?(figure|fig\.?|diagram|chart|graph)\s+(above|below|shown)/gi,
        /\b(as\s+shown\s+in|refer\s+to|according\s+to)\s+(figure|fig\.?|diagram|chart)/gi,
        
        // Mathematical/scientific content indicators  
        /\b(equation|formula|structure|cycle|process|flowchart|workflow)\b/gi,
        /\b(chemical\s+structure|molecular|atomic|geometric|anatomical)\b/gi,
        /\b(circuit|pathway|system\s+diagram|block\s+diagram)\b/gi,
        
        // Subject-specific patterns
        /\b(photosynthesis|food\s+chain|life\s+cycle|water\s+cycle|carbon\s+cycle)\b/gi,
        /\b(triangle|rectangle|circle|polygon|angle|coordinate|axis|plot)\b/gi,
        /\b(experiment\s+setup|apparatus|equipment|procedure\s+diagram)\b/gi
      ];

      let totalMatches = 0;
      const foundTypes = new Set();

      // Count and categorize diagram references
      diagramIndicators.forEach((pattern, index) => {
        const matches = text.match(pattern) || [];
        totalMatches += matches.length;
        
        if (matches.length > 0) {
          // Categorize diagram types
          if (index < 3) foundTypes.add('reference_diagrams');
          else if (index < 6) foundTypes.add('scientific_diagrams');
          else if (index < 9) foundTypes.add('process_diagrams');
          else foundTypes.add('geometric_diagrams');
        }
      });

      analysis.diagramCount = totalMatches;
      analysis.diagramTypes = Array.from(foundTypes);

      // Complexity assessment
      if (totalMatches >= 10) {
        analysis.complexity = 'high';
        analysis.criticalReasons.push('high_diagram_density');
      } else if (totalMatches >= 5) {
        analysis.complexity = 'medium';
      }

      // Subject-specific critical patterns
      const criticalPatterns = [
        /\b(complex\s+diagram|detailed\s+illustration|multiple\s+parts?)\b/gi,
        /\b(cross[- ]section|side\s+view|top\s+view|3d|three[- ]dimensional)\b/gi,
        /\b(labeled\s+parts?|components?\s+shown|arrows?\s+indicate)\b/gi,
        /\b(cannot\s+be\s+understood|difficult\s+to\s+explain)\s+without/gi
      ];

      let criticalMatches = 0;
      criticalPatterns.forEach(pattern => {
        const matches = text.match(pattern) || [];
        criticalMatches += matches.length;
      });

      // Decision logic per MIGRATION.md
      if (criticalMatches >= 3) {
        analysis.requiresReview = true;
        analysis.criticalReasons.push('critical_visual_dependency');
      }

      if (totalMatches >= 8) {
        analysis.requiresReview = true;
        analysis.criticalReasons.push('excessive_diagram_references');
      }

      // Check for mathematical/scientific subjects that often need diagrams
      const mathSciencePatterns = [
        /\b(geometry|trigonometry|calculus|physics|chemistry|biology)\b/gi,
        /\b(theorem|proof|derivation|mechanism|reaction)\b/gi
      ];

      let mathSciMatches = 0;
      mathSciencePatterns.forEach(pattern => {
        mathSciMatches += (text.match(pattern) || []).length;
      });

      if (mathSciMatches >= 5 && totalMatches >= 3) {
        analysis.requiresReview = true;
        analysis.criticalReasons.push('math_science_visual_heavy');
      }

      logger.info({
        action: 'diagram_detection',
        chapterId,
        diagramCount: analysis.diagramCount,
        complexity: analysis.complexity,
        requiresReview: analysis.requiresReview,
        reasons: analysis.criticalReasons
      });

      return analysis;

    } catch (error) {
      logger.error('Diagram detection failed:', error);
      
      // Fail safe - assume requires review if detection fails
      return {
        requiresReview: true,
        diagramCount: 0,
        complexity: 'unknown',
        diagramTypes: [],
        criticalReasons: ['detection_error'],
        metadata: {
          status: 'error',
          error: error.message,
          method: 'text_pattern_analysis'
        }
      };
    }
  }

  /**
   * Generate deterministic chapter processing seed per MIGRATION.md
   */
  generateProcessingSeed(chapterId) {
    return crypto.createHash('md5').update(chapterId).digest('hex');
  }
}

module.exports = new PDFProcessor();