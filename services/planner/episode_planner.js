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
    // Episode planning constraints per MIGRATION.md
    this.wordCountThresholds = { small: 800, large: 2000 };
    this.conceptCountThresholds = { small: 3, large: 6 };
    this.episodeCountRanges = { 
      small: [2, 3], 
      medium: [4, 6], 
      large: [7, 10] 
    };
    this.targetDurationRange = [4, 8]; // minutes
    this.maxConceptsPerEpisode = 3;
    this.minConceptsPerEpisode = 1;
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
   * Determine chapter size per MIGRATION.md rules
   */
  determineChapterSize(concepts, chapterMetadata) {
    const conceptCount = concepts.length;
    const wordCount = chapterMetadata.word_count || 0;

    // Use concept_count if available; fallback to word_count per MIGRATION.md
    if (conceptCount > 0) {
      if (conceptCount < this.conceptCountThresholds.small) return 'small';
      if (conceptCount <= this.conceptCountThresholds.large) return 'medium';
      return 'large';
    } else if (wordCount > 0) {
      if (wordCount < this.wordCountThresholds.small) return 'small';
      if (wordCount <= this.wordCountThresholds.large) return 'medium';
      return 'large';
    }

    // Default fallback
    return 'medium';
  }

  /**
   * Calculate target episode count per MIGRATION.md table
   */
  calculateEpisodeCount(chapterSize) {
    const range = this.episodeCountRanges[chapterSize];
    const randomFactor = this.nextRandom();
    
    // Deterministic selection within range
    const episodeCount = Math.floor(range[0] + randomFactor * (range[1] - range[0] + 1));
    
    logger.info({ 
      action: 'episode_count_calculated', 
      chapterSize, 
      targetCount: episodeCount,
      range 
    });

    return episodeCount;
  }

  /**
   * Build prerequisite dependency graph from concept relationships
   */
  buildDependencyGraph(concepts) {
    const graph = [];
    
    // Extract explicit relationships from concept.related arrays
    concepts.forEach(concept => {
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
   * Perform greedy clustering per MIGRATION.md requirements
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
        !this.canAddConceptToEpisode(concept, currentEpisode, dependencyGraph);

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
            blooms_mix: [concept.blooms]
          }
        };
      } else {
        // Add concept to current episode
        currentEpisode.concepts.push(concept);
        currentEpisode.metadata.difficulty_mix.push(concept.difficulty);
        currentEpisode.metadata.type_mix.push(concept.type);
        currentEpisode.metadata.blooms_mix.push(concept.blooms);
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
      action: 'greedy_clustering_complete', 
      episodeCount: episodes.length,
      targetCount: targetEpisodeCount
    });

    return episodes;
  }

  /**
   * Check if concept can be added to current episode without violating constraints
   */
  canAddConceptToEpisode(concept, episode, dependencyGraph) {
    if (!episode || episode.concepts.length >= this.maxConceptsPerEpisode) {
      return false;
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

    return true;
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
   * Merge episodes with too few concepts
   */
  mergeSmallEpisodes(episodes) {
    const merged = [];
    let i = 0;

    while (i < episodes.length) {
      const currentEpisode = episodes[i];
      
      if (currentEpisode.concepts.length < this.minConceptsPerEpisode && i < episodes.length - 1) {
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
   * Split episodes with too many concepts
   */
  splitLargeEpisodes(episodes) {
    const split = [];

    episodes.forEach(episode => {
      if (episode.concepts.length > this.maxConceptsPerEpisode) {
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
   * Calculate episode durations per MIGRATION.md requirements
   */
  calculateEpisodeDurations(episodes, chapterMetadata) {
    const totalEstimatedMinutes = this.estimateTotalDuration(episodes, chapterMetadata);
    const avgDurationPerEpisode = Math.floor(totalEstimatedMinutes / episodes.length);
    
    // Bound duration in [4,8] minutes per MIGRATION.md
    const boundedDuration = Math.max(4, Math.min(8, avgDurationPerEpisode));

    return episodes.map(episode => ({
      ...episode,
      target_minutes: this.adjustDurationForConcepts(boundedDuration, episode.concepts),
      estimated_word_count: this.estimateWordCount(episode.concepts, boundedDuration),
      metadata: {
        ...episode.metadata,
        base_duration: boundedDuration,
        concept_count: episode.concepts.length
      }
    }));
  }

  /**
   * Estimate total duration needed for all concepts
   */
  estimateTotalDuration(episodes, chapterMetadata) {
    const totalConcepts = episodes.reduce((sum, ep) => sum + ep.concepts.length, 0);
    
    // Base estimation: 2-3 minutes per concept
    const baseMinutes = totalConcepts * 2.5;
    
    // Adjust for grade level (higher grades need more time)
    const gradeMultiplier = chapterMetadata.grade_band ? 
      Math.max(1, parseInt(chapterMetadata.grade_band) / 7) : 1;
    
    return Math.ceil(baseMinutes * gradeMultiplier);
  }

  /**
   * Adjust duration based on concept complexity
   */
  adjustDurationForConcepts(baseDuration, concepts) {
    let adjustedDuration = baseDuration;
    
    // Adjust for concept types
    concepts.forEach(concept => {
      if (concept.type === 'formula' || concept.type === 'process') {
        adjustedDuration += 0.5; // More complex concepts need more time
      }
      if (concept.difficulty === 'hard') {
        adjustedDuration += 0.5;
      }
    });

    // Bound in [4,8] range
    return Math.max(4, Math.min(8, Math.round(adjustedDuration)));
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