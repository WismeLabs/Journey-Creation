const winston = require('winston');
const path = require('path');
const crypto = require('crypto');

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/episode_planner.log'),
      maxsize: 50000000,
      maxFiles: 5
    })
  ]
});

/**
 * Complete Episode Planner per MIGRATION.md requirements
 * Implements: deterministic clustering, prerequisite topological sorting,
 * greedy episode filling, and stable pseudo-random seeding
 */
class EpisodePlanner {
  constructor() {
    // Dynamic episode planning - no static limits
    // All constraints calculated based on actual concept complexity and metadata
  }

  /**
   * Main episode planning function per MIGRATION.md
   * Implements deterministic clustering with stable pseudo-random seeding
   */
  async planEpisodes(concepts, chapterMetadata = {}) {
    const startTime = Date.now();
    
    try {
      logger.info({ 
        action: 'episode_planning_start', 
        chapterId: chapterMetadata.chapter_id,
        conceptCount: concepts.length,
        metadata: chapterMetadata
      });

      // Step 1: Generate deterministic seed per MIGRATION.md
      const seed = this.generateDeterministicSeed(chapterMetadata.chapter_id);
      this.initializePseudoRandom(seed);

      // Step 2: Determine chapter size and episode count
      const chapterSize = this.determineChapterSize(concepts, chapterMetadata);
      const targetEpisodeCount = this.calculateEpisodeCount(chapterSize);

      // Step 3: Build prerequisite dependency graph
      const dependencyGraph = this.buildDependencyGraph(concepts);
      
      // Step 4: Topological sort to respect prerequisites
      const sortedConcepts = this.topologicalSort(concepts, dependencyGraph);
      
      // Step 5: Greedy clustering with constraint satisfaction
      const episodes = this.performGreedyClustering(
        sortedConcepts, 
        targetEpisodeCount, 
        dependencyGraph,
        chapterMetadata
      );

      // Step 6: Validate and optimize episode plan
      const optimizedEpisodes = this.optimizeEpisodePlan(episodes, chapterMetadata);

      // Step 7: Calculate episode durations
      const finalEpisodes = this.calculateEpisodeDurations(optimizedEpisodes, chapterMetadata);

      const processingTime = Date.now() - startTime;

      const episodePlan = {
        chapter_id: chapterMetadata.chapter_id || 'unknown',
        size_category: chapterSize,
        total_concepts: concepts.length,
        total_episodes: finalEpisodes.length,
        episodes: finalEpisodes,
        metadata: {
          planning_seed: seed,
          processing_time_ms: processingTime,
          algorithm_version: 'deterministic_greedy_v1',
          dependency_edges: dependencyGraph.length,
          generated_at: new Date().toISOString(),
          generation_version: 'content_pipeline_v1'
        }
      };

      logger.info({ 
        action: 'episode_planning_complete', 
        chapterId: chapterMetadata.chapter_id,
        episodeCount: finalEpisodes.length,
        processingTime 
      });

      return episodePlan;

    } catch (error) {
      logger.error({ 
        action: 'episode_planning_failed', 
        chapterId: chapterMetadata.chapter_id,
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Generate stable pseudo-random seed per chapter_id (MIGRATION.md requirement)
   */
  generateDeterministicSeed(chapterId) {
    return crypto.createHash('md5').update(chapterId || 'default').digest('hex');
  }

  /**
   * Initialize pseudo-random number generator with seed
   */
  initializePseudoRandom(seed) {
    // Simple Linear Congruential Generator for deterministic randomness
    const seedNum = parseInt(seed.substring(0, 8), 16);
    this.rngState = seedNum % 2147483647;
    if (this.rngState <= 0) this.rngState += 2147483646;
  }

  /**
   * Get next pseudo-random number [0, 1)
   */
  nextRandom() {
    this.rngState = (this.rngState * 16807) % 2147483647;
    return (this.rngState - 1) / 2147483646;
  }

  /**
   * Analyze concept complexity and calculate planning metrics
   */
  analyzeConceptComplexity(concepts) {
    const analysis = {
      totalConcepts: concepts.length,
      coreConcepts: 0,
      supportingConcepts: 0,
      vocabularyConcepts: 0,
      totalComplexityScore: 0,
      avgComplexityPerConcept: 0,
      hasHardConcepts: false,
      hasFormulas: false,
      hasProcesses: false,
      estimatedTotalMinutes: 0,
      conceptTypes: {},
      difficultyDistribution: { easy: 0, medium: 0, hard: 0 }
    };

    concepts.forEach(concept => {
      const importance = concept.importance || 3;
      const difficulty = concept.difficulty || 'medium';
      const type = concept.type || 'definition';
      const estimatedMinutes = concept.estimated_minutes || 0;

      // Categorize by importance
      if (importance >= 4) analysis.coreConcepts++;
      else if (importance === 3) analysis.supportingConcepts++;
      else analysis.vocabularyConcepts++;

      // Track difficulty
      analysis.difficultyDistribution[difficulty] = (analysis.difficultyDistribution[difficulty] || 0) + 1;
      if (difficulty === 'hard') analysis.hasHardConcepts = true;

      // Track types
      analysis.conceptTypes[type] = (analysis.conceptTypes[type] || 0) + 1;
      if (type === 'formula') analysis.hasFormulas = true;
      if (type === 'process') analysis.hasProcesses = true;

      // Calculate complexity score for this concept
      let conceptComplexity = importance; // Base: 1-5
      
      // Difficulty multiplier
      if (difficulty === 'easy') conceptComplexity *= 0.8;
      else if (difficulty === 'hard') conceptComplexity *= 1.4;
      
      // Type multiplier
      if (type === 'formula' || type === 'process') conceptComplexity *= 1.3;
      else if (type === 'application') conceptComplexity *= 1.2;
      else if (type === 'definition') conceptComplexity *= 0.9;
      
      analysis.totalComplexityScore += conceptComplexity;
      
      // Estimate time needed
      if (estimatedMinutes > 0) {
        analysis.estimatedTotalMinutes += estimatedMinutes;
      } else {
        // Fallback estimation based on complexity
        analysis.estimatedTotalMinutes += conceptComplexity * 1.5;
      }
    });

    analysis.avgComplexityPerConcept = analysis.totalComplexityScore / concepts.length;
    analysis.significantConceptCount = analysis.coreConcepts + analysis.supportingConcepts;

    return analysis;
  }
  /**
   * Determine chapter size using weighted concept importance (smart sizing)
   */
  determineChapterSize(concepts, chapterMetadata) {
    const analysis = this.analyzeConceptComplexity(concepts);

    logger.info({
      action: 'chapter_complexity_analysis',
      totalConcepts: analysis.totalConcepts,
      significantConcepts: analysis.significantConceptCount,
      avgComplexity: analysis.avgComplexityPerConcept.toFixed(2),
      totalComplexityScore: analysis.totalComplexityScore.toFixed(2),
      estimatedMinutes: Math.round(analysis.estimatedTotalMinutes),
      coreConcepts: analysis.coreConcepts,
      supportingConcepts: analysis.supportingConcepts
    });

    // Store analysis for later use
    this.currentAnalysis = analysis;

    // Determine size based on complexity, not just count
    const complexityScore = analysis.totalComplexityScore;
    const significantCount = analysis.significantConceptCount;

    // Small: Low complexity OR few significant concepts
    if (complexityScore < 12 || significantCount <= 3) return 'small';
    
    // Large: High complexity OR many significant concepts
    if (complexityScore > 30 || significantCount > 7) return 'large';
    
    // Medium: Everything else
    return 'medium';
  }

  /**
   * Calculate optimal episode count based on complexity analysis
   */
  calculateEpisodeCount(chapterSize) {
    const analysis = this.currentAnalysis;
    
    if (!analysis) {
      logger.warn('No complexity analysis found, using fallback');
      return chapterSize === 'small' ? 1 : chapterSize === 'large' ? 5 : 3;
    }

    // Dynamic calculation based on complexity and estimated time
    const targetMinutesPerEpisode = 8; // Sweet spot for engagement
    const estimatedEpisodes = Math.ceil(analysis.estimatedTotalMinutes / targetMinutesPerEpisode);
    
    // Also consider concept count and coherence
    const avgConceptsPerEpisode = 2.5; // Ideal for deep coverage
    const episodesByConceptCount = Math.ceil(analysis.significantConceptCount / avgConceptsPerEpisode);
    
    // Take the average, but weight towards complexity-based estimate
    let targetCount = Math.round((estimatedEpisodes * 0.6) + (episodesByConceptCount * 0.4));
    
    // Enforce minimums and maximums
    if (analysis.significantConceptCount <= 2) targetCount = 1; // Very simple chapters
    if (targetCount < 1) targetCount = 1;
    if (targetCount > 10) targetCount = 10; // Cap at 10 episodes
    
    // Add slight variation using deterministic random
    const randomFactor = this.nextRandom();
    if (randomFactor > 0.7 && targetCount < 10) targetCount += 1;
    if (randomFactor < 0.3 && targetCount > 1) targetCount -= 1;

    logger.info({
      action: 'episode_count_calculated',
      chapterSize,
      targetCount,
      estimatedByTime: estimatedEpisodes,
      estimatedByConceptCount: episodesByConceptCount,
      totalMinutes: Math.round(analysis.estimatedTotalMinutes),
      significantConcepts: analysis.significantConceptCount
    });

    return targetCount;
  }

  /**
   * Build prerequisite dependency graph from concept relationships
   */
  buildDependencyGraph(concepts) {
    const graph = [];
    
    // Extract explicit relationships from concept.related arrays
    concepts.forEach(concept => {
      // Auto-group low-importance concepts with their parent
      if (concept.parent_concept) {
        graph.push([concept.parent_concept, concept.id]);
      }
      
      if (concept.related && Array.isArray(concept.related)) {
        concept.related.forEach(relatedId => {
          const relatedConcept = concepts.find(c => c.id === relatedId);
          if (relatedConcept) {
            // Add edge: prerequisite -> dependent
            graph.push({ from: concept.id, to: relatedId });
          }
        });
      }
    });

    // Add implicit dependencies based on concept types and difficulty
    concepts.forEach(concept => {
      concepts.forEach(otherConcept => {
        if (concept.id !== otherConcept.id) {
          const isImplicitDependency = this.detectImplicitDependency(concept, otherConcept);
          if (isImplicitDependency) {
            // Avoid duplicates
            const existingEdge = graph.find(edge => 
              edge.from === concept.id && edge.to === otherConcept.id
            );
            if (!existingEdge) {
              graph.push({ from: concept.id, to: otherConcept.id });
            }
          }
        }
      });
    });

    logger.info({ 
      action: 'dependency_graph_built', 
      nodes: concepts.length, 
      edges: graph.length 
    });

    return graph;
  }

  /**
   * Detect implicit dependencies between concepts
   */
  detectImplicitDependency(concept1, concept2) {
    // Type-based dependencies
    const typeHierarchy = ['definition', 'example', 'process', 'formula', 'application'];
    const type1Index = typeHierarchy.indexOf(concept1.type);
    const type2Index = typeHierarchy.indexOf(concept2.type);
    
    if (type1Index >= 0 && type2Index >= 0 && type1Index < type2Index) {
      return true;
    }

    // Difficulty-based dependencies
    const difficultyOrder = ['easy', 'medium', 'hard'];
    const diff1Index = difficultyOrder.indexOf(concept1.difficulty);
    const diff2Index = difficultyOrder.indexOf(concept2.difficulty);
    
    if (diff1Index >= 0 && diff2Index >= 0 && diff1Index < diff2Index) {
      return true;
    }

    // Bloom's taxonomy dependencies
    const bloomsOrder = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
    const blooms1Index = bloomsOrder.indexOf(concept1.blooms);
    const blooms2Index = bloomsOrder.indexOf(concept2.blooms);
    
    if (blooms1Index >= 0 && blooms2Index >= 0 && blooms1Index < blooms2Index) {
      return true;
    }

    return false;
  }

  /**
   * Topological sort to respect prerequisite constraints
   */
  topologicalSort(concepts, dependencyGraph) {
    const conceptMap = new Map(concepts.map(c => [c.id, c]));
    const inDegree = new Map();
    const adjacencyList = new Map();
    
    // Initialize structures
    concepts.forEach(concept => {
      inDegree.set(concept.id, 0);
      adjacencyList.set(concept.id, []);
    });

    // Build adjacency list and calculate in-degrees
    dependencyGraph.forEach(edge => {
      if (conceptMap.has(edge.from) && conceptMap.has(edge.to)) {
        adjacencyList.get(edge.from).push(edge.to);
        inDegree.set(edge.to, inDegree.get(edge.to) + 1);
      }
    });

    // Kahn's algorithm for topological sorting
    const queue = [];
    const sorted = [];

    // Add concepts with no prerequisites
    inDegree.forEach((degree, conceptId) => {
      if (degree === 0) {
        queue.push(conceptId);
      }
    });

    while (queue.length > 0) {
      // Sort queue deterministically using concept names
      queue.sort((a, b) => {
        const conceptA = conceptMap.get(a);
        const conceptB = conceptMap.get(b);
        return conceptA.name.localeCompare(conceptB.name);
      });

      const conceptId = queue.shift();
      const concept = conceptMap.get(conceptId);
      sorted.push(concept);

      // Process adjacent concepts
      adjacencyList.get(conceptId).forEach(neighborId => {
        inDegree.set(neighborId, inDegree.get(neighborId) - 1);
        if (inDegree.get(neighborId) === 0) {
          queue.push(neighborId);
        }
      });
    }

    // Handle cycles by adding remaining concepts
    if (sorted.length < concepts.length) {
      logger.warn({ 
        action: 'cycle_detected_in_dependency_graph', 
        sortedCount: sorted.length, 
        totalCount: concepts.length 
      });
      
      concepts.forEach(concept => {
        if (!sorted.find(c => c.id === concept.id)) {
          sorted.push(concept);
        }
      });
    }

    logger.info({ 
      action: 'topological_sort_complete', 
      conceptCount: sorted.length 
    });

    return sorted;
  }

  /**
   * Perform semantic clustering with prerequisite awareness
   */
  performGreedyClustering(sortedConcepts, targetEpisodeCount, dependencyGraph, chapterMetadata) {
    const episodes = [];
    let currentEpisode = null;
    let episodeIndex = 1;

    for (const concept of sortedConcepts) {
      // Check if we need to start a new episode
      const needNewEpisode = 
        !currentEpisode || 
        currentEpisode.concepts.length >= this.maxConceptsPerEpisode ||
        !this.canAddConceptToEpisode(concept, currentEpisode, dependencyGraph, sortedConcepts);

      if (needNewEpisode) {
        // Finalize current episode if it exists
        if (currentEpisode && currentEpisode.concepts.length > 0) {
          episodes.push(currentEpisode);
        }

        // Start new episode
        currentEpisode = {
          ep: episodeIndex++,
          concepts: [concept],
          target_minutes: 0, // Will be calculated later
          metadata: {
            difficulty_mix: [concept.difficulty],
            type_mix: [concept.type],
            blooms_mix: [concept.blooms],
            semantic_coherence: 1.0 // Will be updated as concepts are added
          }
        };
      } else {
        // Calculate semantic similarity before adding
        const similarity = this.calculateSemanticSimilarity(concept, currentEpisode.concepts);
        
        // Add concept to current episode
        currentEpisode.concepts.push(concept);
        currentEpisode.metadata.difficulty_mix.push(concept.difficulty);
        currentEpisode.metadata.type_mix.push(concept.type);
        currentEpisode.metadata.blooms_mix.push(concept.blooms);
        
        // Update semantic coherence score
        currentEpisode.metadata.semantic_coherence = 
          (currentEpisode.metadata.semantic_coherence * (currentEpisode.concepts.length - 1) + similarity) / 
          currentEpisode.concepts.length;
      }

      // Stop if we've reached target episode count and remaining concepts are few
      if (episodes.length >= targetEpisodeCount && 
          sortedConcepts.length - sortedConcepts.indexOf(concept) <= 2) {
        // Add remaining concepts to current episode
        const remainingConcepts = sortedConcepts.slice(sortedConcepts.indexOf(concept) + 1);
        currentEpisode.concepts.push(...remainingConcepts);
        break;
      }
    }

    // Add final episode
    if (currentEpisode && currentEpisode.concepts.length > 0) {
      episodes.push(currentEpisode);
    }

    logger.info({ 
      action: 'semantic_clustering_complete', 
      episodeCount: episodes.length,
      targetCount: targetEpisodeCount,
      avgCoherence: (episodes.reduce((sum, ep) => sum + (ep.metadata.semantic_coherence || 0), 0) / episodes.length).toFixed(2)
    });

    return episodes;
  }
  
  /**
   * Calculate semantic similarity between a concept and existing episode concepts
   */
  calculateSemanticSimilarity(newConcept, episodeConcepts) {
    if (episodeConcepts.length === 0) return 1.0;
    
    let totalSimilarity = 0;
    
    for (const existingConcept of episodeConcepts) {
      let similarity = 0;
      
      // Same parent concept = very high similarity
      if (newConcept.parent_concept && newConcept.parent_concept === existingConcept.id) {
        similarity += 0.5;
      }
      if (existingConcept.parent_concept && existingConcept.parent_concept === newConcept.id) {
        similarity += 0.5;
      }
      
      // Related concepts = high similarity
      if (newConcept.related && newConcept.related.includes(existingConcept.id)) {
        similarity += 0.4;
      }
      if (existingConcept.related && existingConcept.related.includes(newConcept.id)) {
        similarity += 0.4;
      }
      
      // Same type = moderate similarity
      if (newConcept.type === existingConcept.type) {
        similarity += 0.2;
      }
      
      // Similar difficulty = moderate similarity
      if (newConcept.difficulty === existingConcept.difficulty) {
        similarity += 0.15;
      }
      
      // Same Bloom's level = moderate similarity
      if (newConcept.blooms === existingConcept.blooms) {
        similarity += 0.15;
      }
      
      // Text similarity in definitions
      const textSimilarity = this.calculateTextSimilarity(
        newConcept.definition || '', 
        existingConcept.definition || ''
      );
      similarity += textSimilarity * 0.3;
      
      // Common misconceptions = should be together
      if (this.hasCommonMisconceptions(newConcept, existingConcept)) {
        similarity += 0.3;
      }
      
      totalSimilarity += Math.min(1.0, similarity);
    }
    
    return totalSimilarity / episodeConcepts.length;
  }
  
  /**
   * Calculate text similarity using simple word overlap
   */
  calculateTextSimilarity(text1, text2) {
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
    
    if (words1.size === 0 || words2.size === 0) return 0;
    
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }
  
  /**
   * Check if concepts have common misconceptions (should be clarified together)
   */
  hasCommonMisconceptions(concept1, concept2) {
    if (!concept1.common_misconceptions || !concept2.common_misconceptions) {
      return false;
    }
    
    const misc1 = concept1.common_misconceptions.map(m => m.toLowerCase());
    const misc2 = concept2.common_misconceptions.map(m => m.toLowerCase());
    
    // Check for any overlapping words in misconceptions
    for (const m1 of misc1) {
      for (const m2 of misc2) {
        const words1 = new Set(m1.split(/\s+/).filter(w => w.length > 3));
        const words2 = new Set(m2.split(/\s+/).filter(w => w.length > 3));
        const overlap = [...words1].filter(w => words2.has(w));
        
        if (overlap.length > 0) return true;
      }
    }
    
    return false;
  }

  /**
   * Check if concept can be added to current episode without violating constraints
   */
  canAddConceptToEpisode(concept, episode, dependencyGraph, allConcepts) {
    if (!episode) return false;

    // Dynamic max based on current episode complexity
    const currentComplexity = episode.concepts.reduce((sum, c) => {
      let complexity = (c.importance || 3);
      if (c.difficulty === 'hard') complexity *= 1.4;
      if (c.type === 'formula' || c.type === 'process') complexity *= 1.3;
      return sum + complexity;
    }, 0);
    
    const newConceptComplexity = (concept.importance || 3) * 
      (concept.difficulty === 'hard' ? 1.4 : 1) *
      (concept.type === 'formula' || concept.type === 'process' ? 1.3 : 1);
    
    // Don't exceed complexity threshold for one episode (roughly 3 medium-complexity core concepts)
    const maxEpisodeComplexity = 15;
    if (currentComplexity + newConceptComplexity > maxEpisodeComplexity && episode.concepts.length >= 2) {
      logger.info({
        action: 'complexity_limit_reached',
        currentComplexity: currentComplexity.toFixed(2),
        newConceptComplexity: newConceptComplexity.toFixed(2),
        concept: concept.name
      });
      return false;
    }

    // SMART GROUPING: Auto-group low-importance concepts with core concepts
    const importance = concept.importance || 3;
    const isGroupable = concept.groupable !== false; // default true
    
    // If it's a vocabulary/fact (importance 1-2) and groupable, always add to current episode
    if (importance <= 2 && isGroupable && episode.concepts.length > 0) {
      logger.info({
        action: 'auto_grouping_vocabulary',
        concept: concept.name,
        importance,
        episode: episode.ep
      });
      return true;
    }

    // Check prerequisite constraints
    const conceptPrerequisites = dependencyGraph
      .filter(edge => edge.to === concept.id)
      .map(edge => edge.from);

    const episodeConceptIds = episode.concepts.map(c => c.id);
    
    // All prerequisites must be in earlier episodes or current episode
    for (const prerequisiteId of conceptPrerequisites) {
      if (!episodeConceptIds.includes(prerequisiteId)) {
        // Prerequisite not satisfied in current episode
        return false;
      }
    }
    
    // Check semantic similarity - avoid mixing unrelated concepts
    const similarity = this.calculateSemanticSimilarity(concept, episode.concepts);
    if (similarity < 0.2 && episode.concepts.length >= 2) {
      // Concept is too dissimilar, start new episode
      logger.info({
        action: 'semantic_split',
        concept: concept.name,
        similarity: similarity.toFixed(2),
        episode: episode.ep
      });
      return false;
    }
    
    // Separate commonly confused concepts into different episodes
    if (this.hasConfusionConflict(concept, episode.concepts)) {
      logger.info({
        action: 'confusion_separation',
        concept: concept.name,
        episode: episode.ep
      });
      return false;
    }

    return true;
  }
  
  /**
   * Check if concept would cause confusion with existing episode concepts
   */
  hasConfusionConflict(newConcept, episodeConcepts) {
    if (!newConcept.confusion_points) return false;
    
    const newConfusionLower = newConcept.confusion_points.toLowerCase();
    
    for (const existingConcept of episodeConcepts) {
      // If confusion point mentions another concept by name, they should be separate
      if (newConfusionLower.includes(existingConcept.name.toLowerCase()) ||
          (existingConcept.confusion_points && 
           existingConcept.confusion_points.toLowerCase().includes(newConcept.name.toLowerCase()))) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Optimize episode plan by balancing concepts and difficulty
   */
  optimizeEpisodePlan(episodes, chapterMetadata) {
    let optimizedEpisodes = [...episodes];

    // Merge episodes that are too small
    optimizedEpisodes = this.mergeSmallEpisodes(optimizedEpisodes);
    
    // Split episodes that are too large
    optimizedEpisodes = this.splitLargeEpisodes(optimizedEpisodes);
    
    // Balance difficulty across episodes
    optimizedEpisodes = this.balanceDifficulty(optimizedEpisodes);

    // Renumber episodes
    optimizedEpisodes.forEach((episode, index) => {
      episode.ep = index + 1;
    });

    logger.info({ 
      action: 'episode_plan_optimized', 
      originalCount: episodes.length,
      optimizedCount: optimizedEpisodes.length
    });

    return optimizedEpisodes;
  }

  /**
   * Merge episodes with too few concepts or too low complexity
   */
  mergeSmallEpisodes(episodes) {
    const merged = [];
    let i = 0;

    while (i < episodes.length) {
      const currentEpisode = episodes[i];
      
      // Calculate episode complexity
      const episodeComplexity = currentEpisode.concepts.reduce((sum, c) => {
        let complexity = (c.importance || 3);
        if (c.difficulty === 'hard') complexity *= 1.4;
        if (c.type === 'formula' || c.type === 'process') complexity *= 1.3;
        return sum + complexity;
      }, 0);
      
      // Merge if: only 1 concept AND (it's low importance OR next episode also small)
      const shouldMerge = 
        currentEpisode.concepts.length === 1 && 
        episodeComplexity < 4 && // Low complexity
        i < episodes.length - 1;
      
      if (shouldMerge) {
        // Merge with next episode
        const nextEpisode = episodes[i + 1];
        const mergedEpisode = {
          ep: currentEpisode.ep,
          concepts: [...currentEpisode.concepts, ...nextEpisode.concepts],
          target_minutes: 0,
          metadata: {
            difficulty_mix: [...currentEpisode.metadata.difficulty_mix, ...nextEpisode.metadata.difficulty_mix],
            type_mix: [...currentEpisode.metadata.type_mix, ...nextEpisode.metadata.type_mix],
            blooms_mix: [...currentEpisode.metadata.blooms_mix, ...nextEpisode.metadata.blooms_mix],
            merged: true
          }
        };
        
        merged.push(mergedEpisode);
        i += 2; // Skip next episode as it's been merged
      } else {
        merged.push(currentEpisode);
        i += 1;
      }
    }

    return merged;
  }

  /**
   * Split episodes that exceed complexity threshold
   */
  splitLargeEpisodes(episodes) {
    const split = [];

    episodes.forEach(episode => {
      const episodeComplexity = episode.concepts.reduce((sum, c) => {
        let complexity = (c.importance || 3);
        if (c.difficulty === 'hard') complexity *= 1.4;
        if (c.type === 'formula' || c.type === 'process') complexity *= 1.3;
        return sum + complexity;
      }, 0);
      
      // Split if complexity too high (more than ~4 medium core concepts worth)
      if (episodeComplexity > 18 && episode.concepts.length > 2) {
        // Split into multiple episodes
        const conceptsPerEpisode = Math.ceil(episode.concepts.length / 2);
        
        for (let i = 0; i < episode.concepts.length; i += conceptsPerEpisode) {
          const episodeConcepts = episode.concepts.slice(i, i + conceptsPerEpisode);
          
          split.push({
            ep: episode.ep,
            concepts: episodeConcepts,
            target_minutes: 0,
            metadata: {
              difficulty_mix: episodeConcepts.map(c => c.difficulty),
              type_mix: episodeConcepts.map(c => c.type),
              blooms_mix: episodeConcepts.map(c => c.blooms),
              split_from: episode.ep
            }
          });
        }
      } else {
        split.push(episode);
      }
    });

    return split;
  }

  /**
   * Balance difficulty across episodes
   */
  balanceDifficulty(episodes) {
    // Calculate difficulty distribution
    episodes.forEach(episode => {
      const difficulties = episode.metadata.difficulty_mix;
      const difficultyScore = difficulties.reduce((score, diff) => {
        return score + (diff === 'easy' ? 1 : diff === 'medium' ? 2 : 3);
      }, 0) / difficulties.length;
      
      episode.metadata.difficulty_score = difficultyScore;
    });

    return episodes;
  }

  /**
   * Calculate episode durations dynamically based on complexity
   */
  calculateEpisodeDurations(episodes, chapterMetadata) {
    return episodes.map(episode => {
      // Calculate complexity for this specific episode
      const episodeComplexity = episode.concepts.reduce((sum, c) => {
        let complexity = (c.importance || 3);
        if (c.difficulty === 'hard') complexity *= 1.4;
        else if (c.difficulty === 'easy') complexity *= 0.8;
        if (c.type === 'formula' || c.type === 'process') complexity *= 1.3;
        if (c.type === 'application') complexity *= 1.2;
        return sum + complexity;
      }, 0);
      
      // Base time calculation: complexity score * 1.5 minutes
      let targetMinutes = episodeComplexity * 1.5;
      
      // Adjust for grade level (higher grades need slightly more time)
      const gradeMultiplier = chapterMetadata.grade_band ? 
        (1 + (parseInt(chapterMetadata.grade_band) - 5) * 0.05) : 1;
      targetMinutes *= gradeMultiplier;
      
      // Enforce reasonable bounds (5-12 minutes)
      targetMinutes = Math.max(5, Math.min(12, Math.round(targetMinutes)));
      
      // Calculate word count based on actual target duration
      const estimatedWordCount = this.estimateWordCount(episode.concepts, targetMinutes);
      
      return {
        ...episode,
        target_minutes: targetMinutes,
        estimated_word_count: estimatedWordCount,
        metadata: {
          ...episode.metadata,
          complexity_score: episodeComplexity.toFixed(2),
          concept_count: episode.concepts.length
        }
      };
    });
  }

  /**
   * Estimate word count for episode based on duration and concepts
   */
  estimateWordCount(concepts, durationMinutes) {
    // Base estimation: ~150 words per minute for educational content
    const baseWordCount = durationMinutes * 150;
    
    // Adjust for concept complexity
    let complexityFactor = 1;
    concepts.forEach(concept => {
      if (concept.type === 'definition') complexityFactor += 0.1;
      if (concept.type === 'formula') complexityFactor += 0.2;
      if (concept.difficulty === 'hard') complexityFactor += 0.15;
    });

    return Math.round(baseWordCount * complexityFactor);
  }
}

module.exports = new EpisodePlanner();