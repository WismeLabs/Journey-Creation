const winston = require('winston');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const fetch = require('node-fetch');

// Configure logger per MIGRATION.md requirements
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/concept_extractor.log'),
      maxsize: 50000000,
      maxFiles: 5
    })
  ]
});

/**
 * Complete Semantic Engine per MIGRATION.md requirements
 * Handles: concept detection, prerequisite graph building, 
 * difficulty assessment, and Bloom's taxonomy classification
 */
class ConceptExtractor {
  constructor() {
    this.llmServiceUrl = process.env.HF_BACKEND_URL || 'http://localhost:8000';
    logger.info({ action: 'concept_extractor_initialized', url: this.llmServiceUrl });
    this.conceptTypes = ['definition', 'process', 'formula', 'example', 'application'];
    this.difficultyLevels = ['easy', 'medium', 'hard'];
    this.bloomsLevels = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
    
    // Load canonical concept reference table (optional seed per MIGRATION.md)
    this.canonicalConcepts = this.loadCanonicalConcepts();
    
    // Cache directory for LLM responses (developer time/cost savings)
    this.cacheDir = path.join(__dirname, '../../cache');
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      logger.info({ action: 'cache_directory_created', path: this.cacheDir });
    }
    this.cacheEnabled = process.env.LLM_CACHE_ENABLED !== 'false'; // Default enabled
    this.cacheTTL = parseInt(process.env.LLM_CACHE_TTL) || 7 * 24 * 3600 * 1000; // 7 days default
  }

  /**
   * Main concept extraction function per MIGRATION.md
   */
  async extractConcepts(markdownContent, metadata = {}) {
    const startTime = Date.now();
    
    try {
      logger.info({ 
        action: 'concept_extraction_start', 
        chapterId: metadata.chapter_id,
        contentLength: markdownContent.length,
        subject: metadata.subject,
        grade: metadata.grade_band
      });

      // Step 1: AI-powered concept extraction
      const aiConcepts = await this.extractConceptsWithAI(markdownContent, metadata);
      
      // Step 2: Heuristic fallback and validation
      const heuristicConcepts = await this.extractConceptsHeuristic(markdownContent, metadata);
      
      // Step 3: Merge and validate concepts
      const mergedConcepts = await this.mergeAndValidateConcepts(aiConcepts, heuristicConcepts, metadata);
      
      // Step 4: Build prerequisite graph
      const conceptGraph = await this.buildPrerequisiteGraph(mergedConcepts, markdownContent);
      
      // Step 5: Validate and enhance with fallbacks
      const validatedConcepts = await this.validateAndEnhanceConcepts(mergedConcepts, conceptGraph, metadata);

      const processingTime = Date.now() - startTime;
      
      const result = {
        concepts: validatedConcepts,
        graph: conceptGraph,
        metadata: {
          extraction_method: aiConcepts.length > 0 ? 'ai_primary' : 'heuristic_only',
          total_concepts: validatedConcepts.length,
          processing_time_ms: processingTime,
          content_length: markdownContent.length,
          subject: metadata.subject,
          grade_band: metadata.grade_band,
          generated_at: new Date().toISOString(),
          generation_version: 'content_pipeline_v1'
        }
      };

      logger.info({ 
        action: 'concept_extraction_complete', 
        chapterId: metadata.chapter_id,
        conceptCount: validatedConcepts.length,
        processingTime 
      });

      return result;

    } catch (error) {
      logger.error({ 
        action: 'concept_extraction_failed', 
        chapterId: metadata.chapter_id,
        error: error.message 
      });
      
      // Fallback to heuristic-only extraction
      return await this.fallbackConceptExtraction(markdownContent, metadata);
    }
  }

  /**
   * AI-powered concept extraction using enhanced LLM service
   * WITH CACHING for developer time/cost savings on re-runs
   */
  async extractConceptsWithAI(markdownContent, metadata) {
    try {
      // Generate cache key from content + metadata
      const cacheKey = this.generateCacheKey(markdownContent, metadata);
      
      // Check cache first (skip expensive LLM call if cached)
      if (this.cacheEnabled) {
        const cached = await this.getCachedResponse(cacheKey, 'concepts');
        if (cached) {
          logger.info({ 
            action: 'cache_hit', 
            type: 'concepts',
            cacheKey: cacheKey.substring(0, 12),
            savedCost: '$0.02-0.05' 
          });
          return cached.data;
        }
      }
      
      const response = await fetch(`${this.llmServiceUrl}/extract_concepts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown_content: markdownContent,
          metadata: {
            subject: metadata.subject || 'general',
            grade_band: metadata.grade_band || '7',
            llm_provider: metadata.llm_provider || 'auto',
            language: metadata.language || 'en-IN',
            curriculum: 'CBSE'
          }
        })
      });

      if (!response.ok) {
        throw new Error(`AI extraction failed: ${response.status}`);
      }

      const result = await response.json();
      
      // Validate AI response structure
      if (!result.concepts || !Array.isArray(result.concepts)) {
        throw new Error('Invalid AI response structure');
      }

      const concepts = result.concepts.map(concept => ({
        ...concept,
        extraction_method: 'ai',
        confidence: concept.confidence || 0.8
      }));

      // Cache the result for future re-runs
      if (this.cacheEnabled) {
        await this.setCachedResponse(cacheKey, 'concepts', concepts);
        logger.info({ 
          action: 'cache_stored', 
          type: 'concepts',
          cacheKey: cacheKey.substring(0, 12),
          conceptCount: concepts.length 
        });
      }

      logger.info({ 
        action: 'ai_extraction_success', 
        conceptCount: concepts.length,
        cached: false
      });

      return concepts;

    } catch (error) {
      logger.warn({ action: 'ai_extraction_failed', error: error.message });
      return [];
    }
  }

  /**
   * Heuristic-based concept extraction as fallback
   */
  async extractConceptsHeuristic(markdownContent, metadata) {
    const concepts = [];
    const lines = markdownContent.split('\\n');
    let conceptId = 1;

    // Definition detection patterns
    const definitionPatterns = [
      /^(.+?)\\s+is\\s+(.+?)\\./i,
      /^(.+?)\\s+are\\s+(.+?)\\./i,
      /^(.+?):\\s*(.+?)\\./i,
      /Definition\\s*:?\\s*(.+?)\\s+is\\s+(.+?)\\./i
    ];

    // Process detection patterns
    const processPatterns = [
      /steps?\\s+(?:of|for|in)\\s+(.+?):/i,
      /process\\s+(?:of|for)\\s+(.+?):/i,
      /how\\s+to\\s+(.+?):/i,
      /method\\s+(?:of|for)\\s+(.+?):/i
    ];

    // Formula detection patterns
    const formulaPatterns = [
      /([A-Z][a-z]*(?:\\s*=\\s*[^\\n]+))/,
      /equation\\s*:?\\s*(.+)/i,
      /formula\\s*:?\\s*(.+)/i
    ];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.length < 10) continue;

      // Check for definitions
      for (const pattern of definitionPatterns) {
        const match = line.match(pattern);
        if (match) {
          const conceptName = this.cleanConceptName(match[1]);
          if (conceptName && conceptName.length > 2) {
            concepts.push({
              id: this.generateConceptId(conceptName),
              name: conceptName,
              type: 'definition',
              definition: match[2] || match[0],
              difficulty: this.assessDifficulty(match[0], metadata.grade_band),
              blooms: 'understand',
              source_excerpt: `line_${i+1}`,
              extraction_method: 'heuristic',
              confidence: 0.7,
              related: []
            });
          }
          break;
        }
      }

      // Check for processes
      for (const pattern of processPatterns) {
        const match = line.match(pattern);
        if (match) {
          const processName = this.cleanConceptName(match[1]);
          if (processName && processName.length > 2) {
            concepts.push({
              id: this.generateConceptId(processName),
              name: processName,
              type: 'process',
              description: this.extractProcessSteps(lines, i),
              difficulty: this.assessDifficulty(line, metadata.grade_band),
              blooms: 'apply',
              source_excerpt: `line_${i+1}`,
              extraction_method: 'heuristic',
              confidence: 0.6,
              related: []
            });
          }
          break;
        }
      }

      // Check for formulas
      for (const pattern of formulaPatterns) {
        const match = line.match(pattern);
        if (match) {
          const formulaName = this.extractFormulaName(match[1]);
          if (formulaName) {
            concepts.push({
              id: this.generateConceptId(formulaName),
              name: formulaName,
              type: 'formula',
              formula: match[1],
              difficulty: 'medium',
              blooms: 'apply',
              source_excerpt: `line_${i+1}`,
              extraction_method: 'heuristic',
              confidence: 0.8,
              related: []
            });
          }
          break;
        }
      }

      // Extract key terms from headings
      if (line.startsWith('#')) {
        const headingText = line.replace(/^#+\\s*/, '');
        const keyTerms = this.extractKeyTermsFromHeading(headingText);
        
        keyTerms.forEach(term => {
          concepts.push({
            id: this.generateConceptId(term),
            name: term,
            type: 'definition',
            description: `Key concept from section: ${headingText}`,
            difficulty: this.assessDifficulty(headingText, metadata.grade_band),
            blooms: 'understand',
            source_excerpt: `heading_line_${i+1}`,
            extraction_method: 'heuristic',
            confidence: 0.5,
            related: []
          });
        });
      }
    }

    // Remove duplicates and low-confidence concepts
    const uniqueConcepts = this.deduplicateConcepts(concepts);
    
    logger.info({ 
      action: 'heuristic_extraction_complete', 
      conceptCount: uniqueConcepts.length 
    });

    return uniqueConcepts;
  }

  /**
   * Merge AI and heuristic concepts with validation
   */
  async mergeAndValidateConcepts(aiConcepts, heuristicConcepts, metadata) {
    const mergedConcepts = [];
    const seenConcepts = new Set();

    // Priority to AI concepts (higher confidence)
    aiConcepts.forEach(concept => {
      if (!seenConcepts.has(concept.id)) {
        mergedConcepts.push(concept);
        seenConcepts.add(concept.id);
      }
    });

    // Add unique heuristic concepts
    heuristicConcepts.forEach(concept => {
      if (!seenConcepts.has(concept.id) && concept.confidence > 0.5) {
        mergedConcepts.push(concept);
        seenConcepts.add(concept.id);
      }
    });

    // Validate concepts per MIGRATION.md requirements
    const validatedConcepts = mergedConcepts.filter(concept => 
      this.validateConcept(concept, metadata)
    );

    // Ensure minimum concepts for episode generation
    if (validatedConcepts.length < 3) {
      logger.warn({ 
        action: 'insufficient_concepts', 
        count: validatedConcepts.length,
        chapterId: metadata.chapter_id 
      });
      
      // Add fallback concepts
      const fallbackConcepts = await this.generateFallbackConcepts(metadata);
      validatedConcepts.push(...fallbackConcepts);
    }

    return validatedConcepts;
  }

  /**
   * Build prerequisite graph per MIGRATION.md requirements
   */
  async buildPrerequisiteGraph(concepts, markdownContent) {
    const graph = [];
    const conceptMap = new Map(concepts.map(c => [c.id, c]));

    // Common prerequisite patterns for educational content
    const prerequisitePatterns = [
      { prerequisite: 'number', dependent: 'algebra' },
      { prerequisite: 'addition', dependent: 'multiplication' },
      { prerequisite: 'cell', dependent: 'tissue' },
      { prerequisite: 'tissue', dependent: 'organ' },
      { prerequisite: 'definition', dependent: 'application' }
    ];

    // Build graph using concept types and content analysis
    concepts.forEach(concept => {
      concepts.forEach(otherConcept => {
        if (concept.id !== otherConcept.id) {
          const dependency = this.analyzeDependency(concept, otherConcept, markdownContent);
          
          if (dependency.isPrerequisite) {
            graph.push([concept.id, otherConcept.id]);
            
            // Update related concepts
            if (!concept.related) concept.related = [];
            if (!concept.related.includes(otherConcept.id)) {
              concept.related.push(otherConcept.id);
            }
          }
        }
      });
    });

    // Apply canonical prerequisite patterns
    prerequisitePatterns.forEach(pattern => {
      const prereqConcept = concepts.find(c => 
        c.name.toLowerCase().includes(pattern.prerequisite) ||
        c.id.includes(pattern.prerequisite)
      );
      const depConcept = concepts.find(c => 
        c.name.toLowerCase().includes(pattern.dependent) ||
        c.id.includes(pattern.dependent)
      );

      if (prereqConcept && depConcept) {
        graph.push([prereqConcept.id, depConcept.id]);
      }
    });

    logger.info({ 
      action: 'graph_built', 
      nodes: concepts.length, 
      edges: graph.length 
    });

    return graph;
  }

  /**
   * Validate and enhance concepts with additional metadata
   */
  async validateAndEnhanceConcepts(concepts, graph, metadata) {
    return concepts.map(concept => {
      // Ensure all required fields per MIGRATION.md schema
      const enhanced = {
        id: concept.id,
        name: concept.name || concept.id,
        type: concept.type || 'definition',
        difficulty: concept.difficulty || this.assessDifficulty(concept.name, metadata.grade_band),
        blooms: concept.blooms || this.assessBloomsLevel(concept.type),
        source_excerpt: concept.source_excerpt || 'auto_generated',
        related: concept.related || [],
        confidence: concept.confidence !== undefined ? concept.confidence : 0.5,
        extraction_method: concept.extraction_method || 'unknown',
        
        // Additional enhancements
        definition: concept.definition || concept.description || `${concept.name} concept`,
        grade_appropriate: this.isGradeAppropriate(concept, metadata.grade_band),
        curriculum_alignment: concept.curriculum_alignment || this.assessCurriculumAlignment(concept, metadata.subject),
        
        // CRITICAL FIELDS FOR EPISODE PLANNING - Use LLM values if present, calculate only if missing
        // Use !== undefined to preserve 0 values from LLM
        importance: concept.importance !== undefined ? concept.importance : this.calculateImportance(concept, metadata),
        estimated_minutes: concept.estimated_minutes !== undefined ? concept.estimated_minutes : this.estimateConceptMinutes(concept, metadata),
        parent_concept: concept.parent_concept !== undefined ? concept.parent_concept : this.findParentConcept(concept, concepts, graph),
        groupable: concept.groupable !== undefined ? concept.groupable : this.isGroupable(concept, concepts),
        
        // Preserve LLM-generated fields if present
        common_misconceptions: concept.common_misconceptions || [],
        confusion_points: concept.confusion_points || null,
        prerequisite_gaps: concept.prerequisite_gaps || null
      };

      // Add pronunciation hints for complex terms
      if (concept.name && concept.name.length > 8) {
        enhanced.pronunciation_hint = this.generatePronunciationHint(concept.name);
      }

      return enhanced;
    });
  }

  /**
   * Calculate concept importance (1-5 scale) based on curriculum alignment and complexity
   */
  calculateImportance(concept, metadata) {
    let importance = 3; // Default medium importance

    // Curriculum alignment boost
    if (concept.curriculum_alignment === 'high') {
      importance += 1;
    } else if (concept.curriculum_alignment === 'low') {
      importance -= 1;
    }

    // Bloom's taxonomy level boost (higher cognitive levels = more important)
    const bloomsWeight = {
      'remember': 0,
      'understand': 0,
      'apply': 1,
      'analyze': 1,
      'evaluate': 2,
      'create': 2
    };
    importance += bloomsWeight[concept.blooms] || 0;

    // Type-based importance
    const typeWeight = {
      'definition': 0,      // Foundational but basic
      'process': 1,         // Important for understanding
      'formula': 1,         // Key for application
      'example': -1,        // Supporting material
      'application': 1      // High-value learning
    };
    importance += typeWeight[concept.type] || 0;

    // Confidence penalty (low confidence concepts are less important)
    if (concept.confidence < 0.5) {
      importance -= 1;
    }

    // Clamp to 1-5 range
    return Math.max(1, Math.min(5, importance));
  }

  /**
   * Estimate time needed to teach concept (in minutes) based on complexity and content
   */
  estimateConceptMinutes(concept, metadata) {
    let minutes = 3; // Default base time

    // Difficulty multiplier
    const difficultyTime = {
      'easy': 2,
      'medium': 3,
      'hard': 5
    };
    minutes = difficultyTime[concept.difficulty] || 3;

    // Type-based time adjustment
    const typeTime = {
      'definition': 2,      // Quick to explain
      'process': 4,         // Needs step-by-step explanation
      'formula': 3,         // Needs derivation and examples
      'example': 1,         // Quick illustration
      'application': 4      // Needs context and practice
    };
    minutes = Math.max(minutes, typeTime[concept.type] || 3);

    // Content length factor (if definition exists, use it to estimate)
    if (concept.definition) {
      const wordCount = concept.definition.split(/\s+/).length;
      if (wordCount > 50) minutes += 1;
      if (wordCount > 100) minutes += 1;
    }

    // Bloom's level adjustment (higher levels need more time)
    const bloomsTime = {
      'remember': 0,
      'understand': 0,
      'apply': 1,
      'analyze': 2,
      'evaluate': 2,
      'create': 3
    };
    minutes += bloomsTime[concept.blooms] || 0;

    // Related concepts complexity (more relationships = more context needed)
    if (concept.related && concept.related.length > 2) {
      minutes += 1;
    }

    return Math.max(2, Math.min(8, minutes)); // Clamp to 2-8 minutes per concept
  }

  /**
   * Find parent concept in prerequisite hierarchy
   */
  findParentConcept(concept, allConcepts, graph) {
    // Look for prerequisites in graph
    const prerequisites = graph
      .filter(([prereq, dependent]) => dependent === concept.id)
      .map(([prereq, _]) => prereq);

    if (prerequisites.length === 0) return null;

    // Return the most important prerequisite
    const parentCandidates = allConcepts.filter(c => prerequisites.includes(c.id));
    if (parentCandidates.length === 0) return null;

    // Sort by importance if available, otherwise return first
    parentCandidates.sort((a, b) => {
      const aImportance = this.calculateImportance(a, {});
      const bImportance = this.calculateImportance(b, {});
      return bImportance - aImportance;
    });

    return parentCandidates[0].id;
  }

  /**
   * Determine if concept can be grouped with others
   */
  isGroupable(concept, allConcepts) {
    // Concepts with same type and difficulty are groupable
    const similarConcepts = allConcepts.filter(c => 
      c.id !== concept.id &&
      c.type === concept.type &&
      c.difficulty === concept.difficulty
    );

    return similarConcepts.length > 0;
  }

  /**
   * Generate concept ID using deterministic hash
   */
  generateConceptId(conceptName) {
    const cleanName = conceptName.toLowerCase()
      .replace(/[^a-z0-9\\s]/g, '')
      .replace(/\\s+/g, '_')
      .substring(0, 30);
    
    return cleanName || crypto.createHash('md5').update(conceptName).digest('hex').substring(0, 8);
  }

  /**
   * Clean and normalize concept names
   */
  cleanConceptName(name) {
    return name.trim()
      .replace(/^(a|an|the)\\s+/i, '')
      .replace(/[.,!?;:]$/, '')
      .trim();
  }

  /**
   * Assess concept difficulty based on grade level
   */
  assessDifficulty(conceptText, gradeBand) {
    const grade = parseInt(gradeBand) || 7;
    
    // Simple heuristics for difficulty
    if (grade <= 5) {
      return conceptText.length > 50 ? 'medium' : 'easy';
    } else if (grade <= 8) {
      return conceptText.length > 100 ? 'hard' : 'medium';
    } else {
      return conceptText.includes('equation') || conceptText.includes('formula') ? 'hard' : 'medium';
    }
  }

  /**
   * Assess Bloom's taxonomy level based on concept type
   */
  assessBloomsLevel(conceptType) {
    const bloomsMap = {
      'definition': 'understand',
      'process': 'apply',
      'formula': 'apply',
      'example': 'remember',
      'application': 'analyze'
    };
    
    return bloomsMap[conceptType] || 'understand';
  }

  /**
   * Analyze dependency between two concepts
   */
  analyzeDependency(concept1, concept2, markdownContent) {
    // Simple dependency analysis based on:
    // 1. Type hierarchy (definition -> application)
    // 2. Content order (earlier concepts are prerequisites)
    // 3. Complexity (simpler concepts are prerequisites)
    
    let isPrerequisite = false;
    let confidence = 0;

    // Type-based dependency
    const typeHierarchy = ['definition', 'example', 'process', 'formula', 'application'];
    const type1Index = typeHierarchy.indexOf(concept1.type);
    const type2Index = typeHierarchy.indexOf(concept2.type);
    
    if (type1Index >= 0 && type2Index >= 0 && type1Index < type2Index) {
      isPrerequisite = true;
      confidence += 0.3;
    }

    // Content order analysis
    const content1Pos = markdownContent.indexOf(concept1.name);
    const content2Pos = markdownContent.indexOf(concept2.name);
    
    if (content1Pos >= 0 && content2Pos >= 0 && content1Pos < content2Pos) {
      isPrerequisite = true;
      confidence += 0.2;
    }

    // Complexity analysis
    if (concept1.difficulty === 'easy' && concept2.difficulty === 'medium') {
      isPrerequisite = true;
      confidence += 0.2;
    }

    return { isPrerequisite: isPrerequisite && confidence > 0.3, confidence };
  }

  /**
   * Validate concept per MIGRATION.md requirements
   */
  validateConcept(concept, metadata) {
    // Required fields check
    if (!concept.id || !concept.type) return false;
    
    // Length constraints
    if (concept.name && concept.name.length > 100) return false;
    
    // Type validation
    if (!this.conceptTypes.includes(concept.type)) return false;
    
    // Grade appropriateness
    if (!this.isGradeAppropriate(concept, metadata.grade_band)) return false;
    
    return true;
  }

  /**
   * Check if concept is appropriate for grade level
   */
  isGradeAppropriate(concept, gradeBand) {
    const grade = parseInt(gradeBand) || 7;
    
    // Simple grade appropriateness rules
    if (grade <= 5) {
      return !concept.name.includes('equation') && !concept.name.includes('complex');
    } else if (grade <= 8) {
      return !concept.name.includes('advanced') && !concept.name.includes('calculus');
    }
    
    return true; // High school - most concepts appropriate
  }

  /**
   * Assess curriculum alignment
   */
  assessCurriculumAlignment(concept, subject) {
    // Subject-specific concept validation
    const subjectKeywords = {
      'science': ['cell', 'atom', 'energy', 'force', 'matter', 'organism'],
      'mathematics': ['number', 'equation', 'formula', 'ratio', 'geometry'],
      'social_science': ['democracy', 'constitution', 'geography', 'history']
    };

    const keywords = subjectKeywords[subject?.toLowerCase()] || [];
    const hasAlignment = keywords.some(keyword => 
      concept.name.toLowerCase().includes(keyword) ||
      (concept.definition && concept.definition.toLowerCase().includes(keyword))
    );

    return hasAlignment ? 'high' : 'medium';
  }

  /**
   * Generate pronunciation hints for complex terms
   */
  generatePronunciationHint(term) {
    // Simple pronunciation mapping for common scientific terms
    const pronunciationMap = {
      'photosynthesis': 'FOH-toh-SIN-thuh-sis',
      'chlorophyll': 'KLAWR-uh-fil',
      'respiration': 'res-puh-RAY-shun',
      'mitochondria': 'my-tuh-KON-dree-uh'
    };

    return pronunciationMap[term.toLowerCase()] || null;
  }

  /**
   * Remove duplicate concepts
   */
  deduplicateConcepts(concepts) {
    const uniqueConcepts = [];
    const seenIds = new Set();

    concepts.forEach(concept => {
      if (!seenIds.has(concept.id)) {
        seenIds.add(concept.id);
        uniqueConcepts.push(concept);
      }
    });

    return uniqueConcepts;
  }

  /**
   * Extract key terms from headings
   */
  extractKeyTermsFromHeading(headingText) {
    // Extract meaningful terms (nouns primarily)
    const words = headingText.split(/\\s+/);
    const keyTerms = words.filter(word => 
      word.length > 3 && 
      /^[A-Z]/.test(word) && // Capitalized
      !/^(The|And|Or|But|With|For|Of|In|On|At|To|From)$/i.test(word) // Not common words
    );

    return keyTerms.slice(0, 3); // Max 3 terms per heading
  }

  /**
   * Extract process steps from surrounding lines
   */
  extractProcessSteps(lines, startIndex) {
    const steps = [];
    let i = startIndex + 1;
    
    while (i < lines.length && i < startIndex + 10) {
      const line = lines[i].trim();
      if (line.match(/^\\d+\\.\\s+/) || line.match(/^Step\\s+\\d+/i)) {
        steps.push(line);
      } else if (line.length === 0 || line.startsWith('#')) {
        break;
      }
      i++;
    }
    
    return steps.join(' ');
  }

  /**
   * Extract formula name from formula text
   */
  extractFormulaName(formulaText) {
    const match = formulaText.match(/^([A-Z][a-z]*)/);
    return match ? match[1] : null;
  }

  /**
   * Fallback concept extraction when all methods fail
   */
  async fallbackConceptExtraction(markdownContent, metadata) {
    logger.warn({ action: 'using_fallback_extraction', chapterId: metadata.chapter_id });
    
    const fallbackConcepts = await this.generateFallbackConcepts(metadata);
    
    return {
      concepts: fallbackConcepts,
      graph: [],
      metadata: {
        extraction_method: 'fallback_only',
        total_concepts: fallbackConcepts.length,
        processing_time_ms: 0,
        content_length: markdownContent.length,
        subject: metadata.subject,
        grade_band: metadata.grade_band,
        generated_at: new Date().toISOString(),
        generation_version: 'content_pipeline_v1'
      }
    };
  }

  /**
   * Generate basic fallback concepts
   */
  async generateFallbackConcepts(metadata) {
    const subjectConcepts = {
      'science': ['Matter', 'Energy', 'Force', 'Cell', 'Organism'],
      'mathematics': ['Number', 'Equation', 'Formula', 'Geometry', 'Algebra'],
      'social_science': ['Society', 'Government', 'Democracy', 'Geography', 'History']
    };

    const baseConcepts = subjectConcepts[metadata.subject?.toLowerCase()] || ['Concept1', 'Concept2', 'Concept3'];
    
    return baseConcepts.map((name, index) => ({
      id: this.generateConceptId(name),
      name: name,
      type: 'definition',
      difficulty: 'medium',
      blooms: 'understand',
      source_excerpt: 'fallback_generated',
      related: [],
      confidence: 0.3,
      extraction_method: 'fallback',
      definition: `${name} is a key concept in ${metadata.subject}`,
      grade_appropriate: true,
      curriculum_alignment: 'medium'
    }));
  }

  /**
   * Load canonical concept reference table (optional)
   */
  loadCanonicalConcepts() {
    try {
      const conceptsPath = path.join(__dirname, '../../config/canonical_concepts.json');
      if (fs.existsSync(conceptsPath)) {
        return JSON.parse(fs.readFileSync(conceptsPath, 'utf8'));
      }
    } catch (error) {
      logger.warn({ action: 'canonical_concepts_load_failed', error: error.message });
    }
    
    return {};
  }

  /**
   * Generate cache key from content and metadata
   * Uses SHA-256 hash for deterministic caching
   */
  generateCacheKey(content, metadata) {
    const cacheInput = JSON.stringify({
      content: content.substring(0, 5000), // First 5k chars (chapters rarely change structure)
      subject: metadata.subject,
      grade: metadata.grade_band,
      llm_provider: metadata.llm_provider || 'auto'
    });
    
    return crypto.createHash('sha256').update(cacheInput).digest('hex');
  }

  /**
   * Get cached LLM response if available and not expired
   */
  async getCachedResponse(cacheKey, type) {
    try {
      const cacheFile = path.join(this.cacheDir, `${type}_${cacheKey}.json`);
      
      if (!fs.existsSync(cacheFile)) {
        return null;
      }
      
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      
      // Check if cache is expired
      const age = Date.now() - cached.timestamp;
      if (age > this.cacheTTL) {
        logger.info({ 
          action: 'cache_expired', 
          type, 
          age_days: Math.round(age / (24 * 3600 * 1000)) 
        });
        fs.unlinkSync(cacheFile); // Clean up expired cache
        return null;
      }
      
      return cached;
      
    } catch (error) {
      logger.warn({ action: 'cache_read_failed', error: error.message });
      return null;
    }
  }

  /**
   * Store LLM response in cache
   */
  async setCachedResponse(cacheKey, type, data) {
    try {
      const cacheFile = path.join(this.cacheDir, `${type}_${cacheKey}.json`);
      
      const cacheData = {
        timestamp: Date.now(),
        type,
        cacheKey,
        data
      };
      
      fs.writeFileSync(cacheFile, JSON.stringify(cacheData, null, 2), 'utf8');
      
    } catch (error) {
      logger.warn({ action: 'cache_write_failed', error: error.message });
      // Don't fail on cache write errors - just continue without caching
    }
  }
}

module.exports = new ConceptExtractor();