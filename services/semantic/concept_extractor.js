const winston = require('winston');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

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
   */
  async extractConceptsWithAI(markdownContent, metadata) {
    try {
      const response = await fetch(`${this.llmServiceUrl}/extract_concepts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown_content: markdownContent,
          metadata: {
            subject: metadata.subject || 'general',
            grade_band: metadata.grade_band || '7',
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

      logger.info({ 
        action: 'ai_extraction_success', 
        conceptCount: result.concepts.length 
      });

      return result.concepts.map(concept => ({
        ...concept,
        extraction_method: 'ai',
        confidence: concept.confidence || 0.8
      }));

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
        confidence: concept.confidence || 0.5,
        extraction_method: concept.extraction_method || 'unknown',
        
        // Additional enhancements
        definition: concept.definition || concept.description || `${concept.name} concept`,
        grade_appropriate: this.isGradeAppropriate(concept, metadata.grade_band),
        curriculum_alignment: this.assessCurriculumAlignment(concept, metadata.subject)
      };

      // Add pronunciation hints for complex terms
      if (concept.name && concept.name.length > 8) {
        enhanced.pronunciation_hint = this.generatePronunciationHint(concept.name);
      }

      return enhanced;
    });
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
}

module.exports = new ConceptExtractor();