const axios = require('axios');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class ValidationController {
  constructor() {
    this.llmServiceUrl = process.env.LLM_SERVICE_URL || 'http://127.0.0.1:8000';
    this.maxRetries = 3;
    
    // Validation rules from MIGRATION.md
    this.validationRules = {
      script: {
        minWords: 450,
        maxWords: 1100,
        minSpeakerTagging: 0.95, // 95% of lines must have speaker tags
        forbiddenWords: ['teacher', 'instructor', 'lesson', 'today we will learn', 'as we discussed'],
        requiredSections: ['hook', 'core1', 'mini-summary'],
        maxStoryDuration: 30 // seconds
      },
      mcq: {
        minQuestions: 3,
        maxQuestions: 6,
        requiredTypes: ['recall', 'concept', 'understanding'],
        minRecallPercent: 0.4,
        minConceptPercent: 0.3
      },
      audio: {
        maxDurationVariance: 0.1, // ±10%
        minSilenceDuration: 200, // ms
        maxSilenceDuration: 400, // ms
        targetRMSLevel: -20 // dB
      }
    };
  }

  /**
   * Auto-repair orchestration per MIGRATION.md - fully idempotent with retry limits
   */
  async repairEpisodeWithRetries(episodeContent, episodeConfig) {
    const maxRetries = this.maxRetries;
    const repairLog = {
      attempts: [],
      finalStatus: 'unknown',
      totalAttempts: 0,
      errorCount: 0
    };
    
    let currentContent = { ...episodeContent };
    let allErrors = [];
    
    try {
      // Initial validation
      let validationResult = await this.validateEpisode(currentContent, episodeConfig);
      
      if (validationResult.isValid) {
        repairLog.finalStatus = 'no_repair_needed';
        return { success: true, repairedEpisode: currentContent, repairLog };
      }
      
      // Track unique error types to avoid infinite loops
      const seenErrorTypes = new Set();
      let retryCount = 0;
      
      while (!validationResult.isValid && retryCount < maxRetries) {
        retryCount++;
        repairLog.totalAttempts++;
        
        const attemptLog = {
          attempt: retryCount,
          errors: validationResult.errors,
          repairs: [],
          result: 'unknown'
        };
        
        let repairedAny = false;
        
        // Group errors by type for batch processing
        const errorTypes = this.categorizeErrors(validationResult.errors);
        
        // Process each error type with appropriate regeneration prompt
        for (const [errorType, errors] of Object.entries(errorTypes)) {
          if (errors.length === 0) continue;
          
          // Skip if we've seen this error type too many times
          const errorKey = `${errorType}_${errors.join('|')}`;
          if (seenErrorTypes.has(errorKey)) {
            attemptLog.repairs.push({ errorType, result: 'skipped_duplicate' });
            continue;
          }
          seenErrorTypes.add(errorKey);
          
          try {
            const repairResult = await this.executeRepair(errorType, currentContent, errors, episodeConfig);
            
            if (repairResult.success) {
              currentContent = repairResult.repairedContent;
              repairedAny = true;
              attemptLog.repairs.push({ 
                errorType, 
                result: 'success', 
                prompt: repairResult.promptUsed,
                changesSummary: repairResult.changesSummary 
              });
            } else {
              attemptLog.repairs.push({ 
                errorType, 
                result: 'failed', 
                error: repairResult.error 
              });
            }
            
          } catch (repairError) {
            logger.error(`Repair failed for ${errorType}:`, repairError);
            attemptLog.repairs.push({ 
              errorType, 
              result: 'error', 
              error: repairError.message 
            });
          }
        }
        
        // Re-validate after repairs
        if (repairedAny) {
          validationResult = await this.validateEpisode(currentContent, episodeConfig);
          attemptLog.result = validationResult.isValid ? 'validation_passed' : 'validation_failed';
        } else {
          attemptLog.result = 'no_repairs_applied';
          break; // No point continuing if no repairs were applied
        }
        
        repairLog.attempts.push(attemptLog);
        allErrors.push(...validationResult.errors);
        
        // Break if validation passes
        if (validationResult.isValid) {
          break;
        }
      }
      
      // Final status determination
      if (validationResult.isValid) {
        repairLog.finalStatus = 'repaired_successfully';
        return { success: true, repairedEpisode: currentContent, repairLog };
      } else {
        repairLog.finalStatus = 'repair_failed_max_retries';
        repairLog.errorCount = allErrors.length;
        
        // Generate error report per MIGRATION.md
        const errorReport = this.generateErrorReport(episodeConfig, allErrors, repairLog);
        
        return { 
          success: false, 
          repairedEpisode: currentContent, 
          repairLog,
          errorReport,
          requiresTeacherReview: true 
        };
      }
      
    } catch (error) {
      logger.error('Auto-repair orchestration failed:', error);
      repairLog.finalStatus = 'orchestration_error';
      repairLog.error = error.message;
      
      return { 
        success: false, 
        repairedEpisode: currentContent, 
        repairLog,
        error: error.message 
      };
    }
  }
  
  /**
   * Categorize validation errors by type for appropriate regeneration prompts
   */
  categorizeErrors(errors) {
    const categories = {
      script_length: [],
      tone_issues: [],
      mcq_sync: [],
      hallucination: [],
      pronunciation: [],
      structure: [],
      other: []
    };
    
    for (const error of errors) {
      const errorText = error.toLowerCase();
      
      if (errorText.includes('too short') || errorText.includes('word count')) {
        categories.script_length.push(error);
      } else if (errorText.includes('forbidden') || errorText.includes('tone') || errorText.includes('teacher')) {
        categories.tone_issues.push(error);
      } else if (errorText.includes('mcq') || errorText.includes('timestamp')) {
        categories.mcq_sync.push(error);
      } else if (errorText.includes('source') || errorText.includes('hallucination')) {
        categories.hallucination.push(error);
      } else if (errorText.includes('pronunciation')) {
        categories.pronunciation.push(error);
      } else if (errorText.includes('structure') || errorText.includes('section')) {
        categories.structure.push(error);
      } else {
        categories.other.push(error);
      }
    }
    
    return categories;
  }
  
  /**
   * Execute specific repair using appropriate regeneration prompt
   */
  async executeRepair(errorType, content, errors, episodeConfig) {
    const promptMap = {
      script_length: errors[0].includes('too short') ? 'regen_short_script' : 'regen_long_script',
      tone_issues: 'regen_tone_fix',
      mcq_sync: 'regen_mcq_sync',
      hallucination: 'regen_remove_hallucination',
      pronunciation: 'regen_pronunciation_map',
      structure: 'regen_structure_fix'
    };
    
    const promptType = promptMap[errorType] || 'regen_dedup';
    
    try {
      const response = await fetch(`${this.llmServiceUrl}/regenerate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt_type: promptType,
          input_data: {
            current_content: content,
            errors: errors,
            episode_config: episodeConfig
          },
          temperature: 0.0 // Deterministic regeneration per MIGRATION.md
        })
      });
      
      if (!response.ok) {
        throw new Error(`Regeneration API failed: ${response.status}`);
      }
      
      const result = await response.json();
      
      return {
        success: true,
        repairedContent: result.repaired_content || content,
        promptUsed: promptType,
        changesSummary: result.change_log || 'No change log provided'
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Generate error report per MIGRATION.md structure
   */
  generateErrorReport(episodeConfig, errors, repairLog) {
    return {
      chapter_id: episodeConfig.chapter_id || 'unknown',
      episode_index: episodeConfig.ep || 'unknown',
      failed_stage: 'validation_and_repair',
      fail_reasons: [...new Set(errors.map(e => this.categorizeError(e)))],
      attempts: repairLog.attempts,
      suggested_action: 'teacher_review_required',
      timestamp: new Date().toISOString(),
      total_attempts: repairLog.totalAttempts,
      final_error_count: errors.length
    };
  }
  
  /**
   * Categorize single error for reporting
   */
  categorizeError(error) {
    const errorText = error.toLowerCase();
    
    if (errorText.includes('too short')) return 'too_short';
    if (errorText.includes('too long')) return 'too_long';
    if (errorText.includes('hallucination') || errorText.includes('source')) return 'hallucination';
    if (errorText.includes('forbidden') || errorText.includes('tone')) return 'tone_drift';
    if (errorText.includes('mcq')) return 'mcq_mismatch';
    if (errorText.includes('pronunciation')) return 'pronunciation';
    if (errorText.includes('structure')) return 'structure_issues';
    
    return 'other';
  }

  /**
   * Validate complete episode content
   */
  async validateEpisode(episodeContent, episodeConfig) {
    try {
      logger.info(`Validating episode ${episodeConfig.ep}`);

      const validationResults = {
        isValid: true,
        errors: [],
        warnings: [],
        validations: {
          script: null,
          mcqs: null,
          metadata: null,
          audio: null
        }
      };

      // Step 1: Script validation
      if (episodeContent.script) {
        validationResults.validations.script = await this.validateScript(
          episodeContent.script, 
          episodeConfig
        );
      }

      // Step 2: MCQ validation
      if (episodeContent.mcqs) {
        validationResults.validations.mcqs = await this.validateMCQs(
          episodeContent.mcqs, 
          episodeContent.script,
          episodeConfig
        );
      }

      // Step 3: Metadata validation
      validationResults.validations.metadata = await this.validateMetadata(
        episodeContent,
        episodeConfig
      );

      // Step 4: Audio validation (if audio exists)
      if (episodeContent.audioPath) {
        validationResults.validations.audio = await this.validateAudio(
          episodeContent.audioPath,
          episodeContent.script
        );
      }

      // Aggregate results
      for (const [key, result] of Object.entries(validationResults.validations)) {
        if (result && !result.isValid) {
          validationResults.isValid = false;
          validationResults.errors.push(...result.errors.map(e => `${key}: ${e}`));
        }
        if (result && result.warnings) {
          validationResults.warnings.push(...result.warnings.map(w => `${key}: ${w}`));
        }
      }

      logger.info(`Episode validation completed. Valid: ${validationResults.isValid}, Errors: ${validationResults.errors.length}`);
      return validationResults;

    } catch (error) {
      logger.error(`Episode validation failed: ${error.message}`);
      return {
        isValid: false,
        errors: [`Validation system error: ${error.message}`],
        warnings: [],
        validations: {}
      };
    }
  }

  /**
   * Validate script content and structure
   */
  async validateScript(scriptData, episodeConfig) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      // Word count validation
      const wordCount = scriptData.word_count || this.countWords(scriptData.script_text || '');
      if (wordCount < this.validationRules.script.minWords) {
        validation.errors.push(`Script too short: ${wordCount} words (min: ${this.validationRules.script.minWords})`);
      }
      if (wordCount > this.validationRules.script.maxWords) {
        validation.errors.push(`Script too long: ${wordCount} words (max: ${this.validationRules.script.maxWords})`);
      }

      // Speaker tagging validation
      const scriptText = scriptData.script_text || '';
      const lines = scriptText.split('\n').filter(line => line.trim().length > 0);
      const taggedLines = lines.filter(line => /^Student[AB]:\s/.test(line.trim()));
      const taggingRatio = lines.length > 0 ? taggedLines.length / lines.length : 0;
      
      if (taggingRatio < this.validationRules.script.minSpeakerTagging) {
        validation.errors.push(`Insufficient speaker tagging: ${Math.round(taggingRatio * 100)}% (min: ${Math.round(this.validationRules.script.minSpeakerTagging * 100)}%)`);
      }

      // Forbidden words/phrases check
      const lowerScript = scriptText.toLowerCase();
      for (const forbidden of this.validationRules.script.forbiddenWords) {
        if (lowerScript.includes(forbidden.toLowerCase())) {
          validation.errors.push(`Contains forbidden phrase: "${forbidden}"`);
        }
      }

      // Required sections check
      if (scriptData.sections) {
        const sectionIds = scriptData.sections.map(s => s.id);
        for (const requiredSection of this.validationRules.script.requiredSections) {
          if (!sectionIds.includes(requiredSection)) {
            validation.errors.push(`Missing required section: ${requiredSection}`);
          }
        }

        // Story duration check
        const storySection = scriptData.sections.find(s => s.id === 'micro-example');
        if (storySection) {
          const storyDuration = (storySection.end || 0) - (storySection.start || 0);
          if (storyDuration > this.validationRules.script.maxStoryDuration) {
            validation.warnings.push(`Story section too long: ${storyDuration}s (max: ${this.validationRules.script.maxStoryDuration}s)`);
          }
        }
      }

      // Grade-appropriate language check
      const readingLevel = this.checkReadingLevel(scriptText, episodeConfig.grade_band);
      if (readingLevel.issues.length > 0) {
        validation.warnings.push(...readingLevel.issues);
      }

      // Source alignment check (hallucination guard)
      const sourceAlignment = await this.checkSourceAlignment(scriptText, episodeConfig);
      if (sourceAlignment.issues.length > 0) {
        validation.errors.push(...sourceAlignment.issues);
      }

      validation.isValid = validation.errors.length === 0;

    } catch (error) {
      validation.isValid = false;
      validation.errors.push(`Script validation error: ${error.message}`);
    }

    return validation;
  }

  /**
   * Validate MCQ content and alignment
   */
  async validateMCQs(mcqData, scriptData, episodeConfig) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      const mcqs = mcqData.mcqs || [];

      // Question count validation
      if (mcqs.length < this.validationRules.mcq.minQuestions) {
        validation.errors.push(`Too few MCQs: ${mcqs.length} (min: ${this.validationRules.mcq.minQuestions})`);
      }
      if (mcqs.length > this.validationRules.mcq.maxQuestions) {
        validation.errors.push(`Too many MCQs: ${mcqs.length} (max: ${this.validationRules.mcq.maxQuestions})`);
      }

      // Concept alignment validation
      const episodeConcepts = episodeConfig.concepts || [];
      const mcqConcepts = mcqs.map(q => q.concept_id).filter(Boolean);
      const unmappedConcepts = episodeConcepts.filter(concept => !mcqConcepts.includes(concept));
      
      if (unmappedConcepts.length > 0) {
        validation.warnings.push(`Concepts without MCQs: ${unmappedConcepts.join(', ')}`);
      }

      // Timestamp validation
      const episodeDuration = episodeConfig.target_minutes * 60;
      for (const mcq of mcqs) {
        if (mcq.timestamp_ref > episodeDuration) {
          validation.errors.push(`MCQ ${mcq.qid} timestamp out of range: ${mcq.timestamp_ref}s > ${episodeDuration}s`);
        }
      }

      // Question type distribution validation
      const typeDistribution = this.calculateMCQTypeDistribution(mcqs);
      if (typeDistribution.recall < this.validationRules.mcq.minRecallPercent) {
        validation.warnings.push(`Low recall question ratio: ${Math.round(typeDistribution.recall * 100)}% (target: ${Math.round(this.validationRules.mcq.minRecallPercent * 100)}%)`);
      }

      // Script-MCQ alignment check
      const alignmentIssues = await this.checkMCQScriptAlignment(mcqs, scriptData);
      validation.errors.push(...alignmentIssues);

      validation.isValid = validation.errors.length === 0;

    } catch (error) {
      validation.isValid = false;
      validation.errors.push(`MCQ validation error: ${error.message}`);
    }

    return validation;
  }

  /**
   * Validate episode metadata
   */
  async validateMetadata(episodeContent, episodeConfig) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      // Required fields check
      const requiredFields = ['episode_index', 'title', 'concept_ids'];
      for (const field of requiredFields) {
        if (!episodeContent[field]) {
          validation.errors.push(`Missing required field: ${field}`);
        }
      }

      // Concept ID alignment
      if (episodeContent.concept_ids && episodeConfig.concepts) {
        const misalignedConcepts = episodeContent.concept_ids.filter(
          id => !episodeConfig.concepts.includes(id)
        );
        if (misalignedConcepts.length > 0) {
          validation.errors.push(`Misaligned concept IDs: ${misalignedConcepts.join(', ')}`);
        }
      }

      // Duration estimates
      if (episodeContent.estimated_duration_seconds && episodeConfig.target_minutes) {
        const targetSeconds = episodeConfig.target_minutes * 60;
        const estimatedSeconds = episodeContent.estimated_duration_seconds;
        const variance = Math.abs(estimatedSeconds - targetSeconds) / targetSeconds;
        
        if (variance > 0.25) { // 25% variance threshold
          validation.warnings.push(`Duration estimate variance: ${Math.round(variance * 100)}% from target`);
        }
      }

      validation.isValid = validation.errors.length === 0;

    } catch (error) {
      validation.isValid = false;
      validation.errors.push(`Metadata validation error: ${error.message}`);
    }

    return validation;
  }

  /**
   * Validate generated audio quality
   */
  async validateAudio(audioPath, scriptData) {
    const validation = {
      isValid: true,
      errors: [],
      warnings: []
    };

    try {
      const fs = require('fs');
      const { execSync } = require('child_process');
      
      if (!fs.existsSync(audioPath)) {
        validation.errors.push('Audio file does not exist');
        validation.isValid = false;
        return validation;
      }

      // Get audio metadata using ffprobe (if available)
      try {
        const ffprobeCmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`;
        const durationOutput = execSync(ffprobeCmd, { encoding: 'utf8' });
        const actualDuration = parseFloat(durationOutput.trim());
        
        // Validate duration within ±10% of estimated per MIGRATION.md
        const estimatedDuration = scriptData.estimated_duration_seconds || 360;
        const durationVariance = Math.abs(actualDuration - estimatedDuration) / estimatedDuration;
        
        if (durationVariance > this.validationRules.audio.maxDurationVariance) {
          validation.errors.push(
            `Audio duration variance too high: ${(durationVariance * 100).toFixed(1)}% ` +
            `(expected ${estimatedDuration}s, got ${actualDuration.toFixed(1)}s)`
          );
        }
        
        // Check for silence detection (placeholder - requires audio analysis library)
        // In production, use libraries like audiowaveform or custom FFmpeg silence detect
        validation.warnings.push('Silence detection requires additional audio analysis tools');
        
        // Check RMS normalization (placeholder - requires audio analysis)
        validation.warnings.push('RMS level validation requires audio analysis tools');
        
      } catch (ffprobeError) {
        validation.warnings.push(
          'Audio validation limited - ffprobe not available. ' +
          'Install FFmpeg for full audio quality checks.'
        );
      }

    } catch (error) {
      validation.isValid = false;
      validation.errors.push(`Audio validation error: ${error.message}`);
    }

    return validation;
  }

  /**
   * Repair episode content using regeneration prompts
   */
  async repairEpisode(episodeContent, validationErrors) {
    try {
      logger.info('Starting episode repair process');
      
      let repairedContent = { ...episodeContent };
      const repairLog = [];
      let totalAttempts = 0;

      for (const error of validationErrors) {
        if (totalAttempts >= this.maxRetries) {
          logger.warn('Max repair attempts reached, flagging for human review');
          break;
        }

        const repairResult = await this.attemptRepair(error, repairedContent);
        repairLog.push(repairResult);
        
        if (repairResult.success) {
          repairedContent = repairResult.repairedContent;
        }
        
        totalAttempts++;
      }

      repairedContent.repairLog = repairLog;
      repairedContent.needsHumanReview = totalAttempts >= this.maxRetries;

      return repairedContent;

    } catch (error) {
      logger.error(`Episode repair failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Attempt to repair specific validation error
   */
  async attemptRepair(error, content) {
    try {
      const repairType = this.identifyRepairType(error);
      
      const repairRequest = {
        prompt_type: repairType,
        input_data: content,
        temperature: 0.0 // Deterministic for repairs
      };

      const response = await axios.post(`${this.llmServiceUrl}/regenerate`, repairRequest);
      
      if (response.data && !response.data.error) {
        return {
          success: true,
          repairType: repairType,
          repairedContent: { ...content, ...response.data },
          attempt: 1
        };
      } else {
        return {
          success: false,
          repairType: repairType,
          error: response.data.error || 'Unknown repair error',
          attempt: 1
        };
      }

    } catch (error) {
      return {
        success: false,
        repairType: 'unknown',
        error: error.message,
        attempt: 1
      };
    }
  }

  /**
   * Identify appropriate repair prompt based on error
   */
  identifyRepairType(error) {
    const errorText = error.toLowerCase();
    
    if (errorText.includes('too short')) return 'regen_short_script';
    if (errorText.includes('too long')) return 'regen_long_script';
    if (errorText.includes('forbidden') || errorText.includes('teacher')) return 'regen_tone_fix';
    if (errorText.includes('mcq') && errorText.includes('alignment')) return 'regen_mcq_sync';
    if (errorText.includes('source') || errorText.includes('hallucination')) return 'regen_remove_hallucination';
    if (errorText.includes('pronunciation')) return 'regen_pronunciation_map';
    
    return 'regen_tone_fix'; // Default fallback
  }

  /**
   * Helper: Count words in text
   */
  countWords(text) {
    return (text.match(/\b\w+\b/g) || []).length;
  }

  /**
   * Helper: Check reading level appropriateness
   */
  checkReadingLevel(text, gradeBand) {
    const issues = [];
    
    try {
      // Simple readability analysis using word/sentence length
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const words = text.split(/\s+/).filter(w => w.length > 0);
      const avgWordsPerSentence = words.length / Math.max(sentences.length, 1);
      
      // Simple grade level estimate: 0.39 * avgWordsPerSentence + 11.8 * avgSyllablesPerWord - 15.59
      // Simplified to just use sentence length as primary indicator
      const estimatedGrade = Math.max(1, Math.min(12, Math.round(avgWordsPerSentence * 0.5 + 2)));
      const targetGrade = parseInt(gradeBand) || 7;
      
      if (estimatedGrade > targetGrade + 2) {
        issues.push(`Reading level may be too high: ~Grade ${estimatedGrade} (target: ${targetGrade})`);
      }
      if (estimatedGrade < targetGrade - 2) {
        issues.push(`Reading level may be too low: ~Grade ${estimatedGrade} (target: ${targetGrade})`);
      }
      
    } catch (error) {
      issues.push(`Could not assess reading level: ${error.message}`);
    }
    
    return { issues };
  }

  /**
   * Helper: Check source alignment (hallucination guard) per MIGRATION.md
   */
  async checkSourceAlignment(scriptData, episodeConfig) {
    const issues = [];
    
    try {
      // Check if script has source reference structure
      if (!scriptData.sections) {
        issues.push('Script missing sections structure for source alignment');
        return { issues };
      }
      
      let totalFactualStatements = 0;
      let sourcedStatements = 0;
      let inferredStatements = 0;
      let unsourcedStatements = 0;
      
      // Analyze each section for source alignment
      for (const section of scriptData.sections) {
        const sectionText = section.text || '';
        const sectionRefs = section.source_references || [];
        const sectionInferred = section.inferred_statements || [];
        
        // Extract assertive sentences (potential factual statements)
        const sentences = this.extractAssertiveSentences(sectionText);
        totalFactualStatements += sentences.length;
        
        // Check source references
        if (sectionRefs.length > 0) {
          sourcedStatements += Math.min(sentences.length, sectionRefs.length);
        }
        
        // Check inferred statements
        if (sectionInferred.length > 0) {
          inferredStatements += sectionInferred.length;
          
          // Validate soft language for inferred statements
          for (const inferredText of sectionInferred) {
            if (!this.hasSoftLanguage(inferredText)) {
              issues.push(`Inferred statement lacks soft language: "${inferredText}"`);
            }
          }
        }
        
        // Calculate unsourced statements
        const sectionUnsourced = sentences.length - sectionRefs.length - sectionInferred.length;
        if (sectionUnsourced > 0) {
          unsourcedStatements += sectionUnsourced;
          issues.push(`Section "${section.id}" has ${sectionUnsourced} unsourced factual statements`);
        }
      }
      
      // Calculate alignment metrics
      const sourcedPercentage = totalFactualStatements > 0 ? sourcedStatements / totalFactualStatements : 1;
      const unsourcedPercentage = totalFactualStatements > 0 ? unsourcedStatements / totalFactualStatements : 0;
      
      // Apply MIGRATION.md thresholds
      if (unsourcedPercentage > 0.1) { // More than 10% unsourced
        issues.push(`High unsourced statement rate: ${(unsourcedPercentage * 100).toFixed(1)}% (${unsourcedStatements}/${totalFactualStatements})`);
      }
      
      // If teacher_review=false and high-confidence factual mismatch exists, reject
      if (episodeConfig.teacher_review === false && unsourcedPercentage > 0.05) {
        issues.push('High-confidence factual mismatches detected - requires teacher review or regeneration');
      }
      
      // Store alignment metadata for metrics
      if (scriptData.source_alignment) {
        scriptData.source_alignment.total_factual_statements = totalFactualStatements;
        scriptData.source_alignment.sourced_statements = sourcedStatements;
        scriptData.source_alignment.inferred_statements = inferredStatements;
      }
      
    } catch (error) {
      issues.push(`Source alignment check failed: ${error.message}`);
    }
    
    return { issues };
  }
  
  /**
   * Extract assertive sentences that could contain factual claims
   */
  extractAssertiveSentences(text) {
    const sentences = text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 10);
    
    // Filter for assertive/declarative sentences (excluding questions and greetings)
    return sentences.filter(sentence => {
      const lower = sentence.toLowerCase();
      
      // Skip questions and conversational elements
      if (lower.includes('?') || 
          lower.startsWith('hey') || 
          lower.startsWith('hi') ||
          lower.startsWith('so,') ||
          lower.includes('i think') ||
          lower.includes('i believe')) {
        return false;
      }
      
      // Include statements with scientific/educational content
      return lower.includes('is ') || 
             lower.includes('are ') || 
             lower.includes('causes') ||
             lower.includes('results') ||
             lower.includes('contains') ||
             lower.includes('occurs') ||
             lower.includes('happens');
    });
  }
  
  /**
   * Check if text uses soft language for inferred content
   */
  hasSoftLanguage(text) {
    const softPhrases = [
      'scientists think',
      'it is believed',
      'researchers suggest',
      'studies indicate', 
      'it appears',
      'may be',
      'could be',
      'might be',
      'seems to',
      'appears to'
    ];
    
    const lower = text.toLowerCase();
    return softPhrases.some(phrase => lower.includes(phrase));
  }

  /**
   * Helper: Calculate MCQ type distribution
   */
  calculateMCQTypeDistribution(mcqs) {
    const total = mcqs.length;
    if (total === 0) return { recall: 0, concept: 0, understanding: 0, application: 0 };
    
    const counts = mcqs.reduce((acc, mcq) => {
      acc[mcq.type] = (acc[mcq.type] || 0) + 1;
      return acc;
    }, {});
    
    return {
      recall: (counts.recall || 0) / total,
      concept: (counts.concept || 0) / total, 
      understanding: (counts.understanding || 0) / total,
      application: (counts.application || 0) / total
    };
  }

  /**
   * Helper: Check MCQ alignment with script content
   */
  async checkMCQScriptAlignment(mcqs, scriptData) {
    const issues = [];
    const scriptText = scriptData.script_text || '';
    
    for (const mcq of mcqs) {
      // Check if MCQ references content that exists in script
      const questionTerms = this.extractKeyTerms(mcq.question_text);
      const foundTerms = questionTerms.filter(term => 
        scriptText.toLowerCase().includes(term.toLowerCase())
      );
      
      if (foundTerms.length / questionTerms.length < 0.5) {
        issues.push(`MCQ ${mcq.qid} may reference content not in script`);
      }
    }
    
    return issues;
  }

  /**
   * Helper: Extract key terms from question text
   */
  extractKeyTerms(questionText) {
    // Simple keyword extraction - in production, use NLP library
    return questionText
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 4)
      .slice(0, 5); // Top 5 keywords
  }
}

module.exports = new ValidationController();