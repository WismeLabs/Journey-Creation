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
      // This would integrate with audio analysis tools
      // For now, basic file existence check
      const fs = require('fs');
      if (!fs.existsSync(audioPath)) {
        validation.errors.push('Audio file does not exist');
        validation.isValid = false;
        return validation;
      }

      // Duration validation would go here
      // Silence detection would go here  
      // RMS level validation would go here

      validation.warnings.push('Audio validation not fully implemented');

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
   * Helper: Check source alignment (hallucination guard)
   */
  async checkSourceAlignment(scriptText, episodeConfig) {
    // Placeholder for hallucination detection
    // In production, this would check factual claims against source material
    return { issues: [] };
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