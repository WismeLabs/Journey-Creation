const winston = require('winston');
const path = require('path');

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
 * CLEAN Episode Planner - Data-Driven, No Magic Numbers
 * 
 * Design Principles:
 * 1. Use ACTUAL concept.importance and concept.estimated_minutes
 * 2. Respect grade-level attention spans (research-based)
 * 3. Group by prerequisite order and natural topic breaks
 * 4. Validate everything - log all decisions
 */
class EpisodePlanner {
  constructor() {
    // Grade-level attention span research (in minutes)
    // Source: National Center for Biotechnology Information (NCBI) studies
    this.gradeAttentionSpans = {
      '1-2': 8,    // Grades 1-2: 5-10 min optimal
      '3-4': 10,   // Grades 3-4: 8-12 min optimal
      '5-6': 12,   // Grades 5-6: 10-15 min optimal
      '7-8': 15,   // Grades 7-8: 12-18 min optimal
      '9-10': 18,  // Grades 9-10: 15-20 min optimal
      '11-12': 20  // Grades 11-12: 18-25 min optimal
    };

    // Episode duration constraints (80% to 120% of attention span)
    this.durationFlexibility = { min: 0.8, max: 1.2 };
  }

  /**
   * Main planning entry point
   */
  async planEpisodes(concepts, chapterMetadata = {}) {
    const startTime = Date.now();
    
    logger.info({ 
      action: 'episode_planning_start', 
      chapterId: chapterMetadata.chapter_id,
      conceptCount: concepts.length,
      grade: chapterMetadata.grade_band
    });

    // Validate inputs
    if (!concepts || concepts.length === 0) {
      throw new Error('No concepts provided for episode planning');
    }

    // Verify concepts have required fields
    this.validateConceptData(concepts);

    // Get target episode duration for grade level
    const targetDuration = this.getTargetDuration(chapterMetadata.grade_band);
    const minDuration = targetDuration * this.durationFlexibility.min;
    const maxDuration = targetDuration * this.durationFlexibility.max;

    logger.info({
      action: 'duration_targets_calculated',
      grade: chapterMetadata.grade_band,
      targetDuration,
      minDuration,
      maxDuration,
      source: 'NCBI_attention_span_research'
    });

    // Build prerequisite graph
    const graph = this.buildDependencyGraph(concepts);
    
    // Sort concepts by prerequisites (topological sort)
    const sortedConcepts = this.topologicalSort(concepts, graph);
    
    logger.info({
      action: 'concepts_sorted',
      originalOrder: concepts.map(c => c.id),
      sortedOrder: sortedConcepts.map(c => c.id),
      dependencies: graph.length
    });

    // Group concepts into episodes based on cumulative time
    const episodes = this.groupConceptsByTime(
      sortedConcepts,
      targetDuration,
      minDuration,
      maxDuration,
      chapterMetadata
    );

    // Add detailed metadata for review UI
    const enrichedEpisodes = this.enrichEpisodeData(episodes, chapterMetadata);

    const processingTime = Date.now() - startTime;

    const plan = {
      chapter_id: chapterMetadata.chapter_id,
      grade_band: chapterMetadata.grade_band,
      total_concepts: concepts.length,
      total_episodes: enrichedEpisodes.length,
      episodes: enrichedEpisodes,
      planning_metadata: {
        target_duration_minutes: targetDuration,
        duration_range: [minDuration, maxDuration],
        attention_span_source: 'NCBI_research',
        processing_time_ms: processingTime,
        generated_at: new Date().toISOString()
      }
    };

    logger.info({ 
      action: 'episode_planning_complete', 
      chapterId: chapterMetadata.chapter_id,
      episodeCount: enrichedEpisodes.length,
      totalMinutes: enrichedEpisodes.reduce((sum, ep) => sum + ep.duration_minutes, 0)
    });

    return plan;
  }

  /**
   * Validate that concepts have required fields
   */
  validateConceptData(concepts) {
    const missingFields = [];

    concepts.forEach((concept, index) => {
      const errors = [];
      
      if (concept.importance === undefined) {
        errors.push('importance');
      }
      if (concept.estimated_minutes === undefined) {
        errors.push('estimated_minutes');
      }
      if (!concept.id) {
        errors.push('id');
      }
      if (!concept.name) {
        errors.push('name');
      }

      if (errors.length > 0) {
        missingFields.push({
          index,
          id: concept.id || 'unknown',
          missing: errors
        });
      }
    });

    if (missingFields.length > 0) {
      logger.error({
        action: 'concept_validation_failed',
        missingFields
      });
      throw new Error(
        `Concepts missing required fields: ${JSON.stringify(missingFields, null, 2)}\n` +
        `Required fields: id, name, importance (1-5), estimated_minutes (2-8)`
      );
    }

    logger.info({
      action: 'concept_validation_passed',
      conceptCount: concepts.length
    });
  }

  /**
   * Get target episode duration based on grade level
   */
  getTargetDuration(gradeBand) {
    const grade = parseInt(gradeBand) || 7;

    // Map grade to attention span bracket
    if (grade <= 2) return this.gradeAttentionSpans['1-2'];
    if (grade <= 4) return this.gradeAttentionSpans['3-4'];
    if (grade <= 6) return this.gradeAttentionSpans['5-6'];
    if (grade <= 8) return this.gradeAttentionSpans['7-8'];
    if (grade <= 10) return this.gradeAttentionSpans['9-10'];
    return this.gradeAttentionSpans['11-12'];
  }

  /**
   * Build prerequisite dependency graph from concept relationships
   */
  buildDependencyGraph(concepts) {
    const graph = [];
    
    concepts.forEach(concept => {
      if (concept.parent_concept) {
        // Edge from parent to child (parent must come first)
        graph.push([concept.parent_concept, concept.id]);
      }

      // Also check related concepts for implicit dependencies
      if (concept.related && concept.related.length > 0) {
        concept.related.forEach(relatedId => {
          const relatedConcept = concepts.find(c => c.id === relatedId);
          if (relatedConcept) {
            // If related concept is easier, it's likely a prerequisite
            if (relatedConcept.difficulty === 'easy' && concept.difficulty !== 'easy') {
              graph.push([relatedId, concept.id]);
            }
          }
        });
      }
    });

    return graph;
  }

  /**
   * Topological sort to respect prerequisite order
   */
  topologicalSort(concepts, graph) {
    const conceptMap = new Map(concepts.map(c => [c.id, c]));
    const inDegree = new Map(concepts.map(c => [c.id, 0]));
    const adjList = new Map(concepts.map(c => [c.id, []]));

    // Build adjacency list and in-degree count
    graph.forEach(([from, to]) => {
      if (adjList.has(from) && inDegree.has(to)) {
        adjList.get(from).push(to);
        inDegree.set(to, inDegree.get(to) + 1);
      }
    });

    // Find all concepts with no prerequisites
    const queue = concepts
      .filter(c => inDegree.get(c.id) === 0)
      .sort((a, b) => {
        // Within same level, sort by importance (high to low)
        if (b.importance !== a.importance) {
          return b.importance - a.importance;
        }
        // Then by difficulty (easy to hard)
        const diffOrder = { 'easy': 0, 'medium': 1, 'hard': 2 };
        return diffOrder[a.difficulty] - diffOrder[b.difficulty];
      });

    const sorted = [];

    while (queue.length > 0) {
      const current = queue.shift();
      sorted.push(current);

      // Process all dependent concepts
      const dependents = adjList.get(current.id) || [];
      dependents.forEach(depId => {
        inDegree.set(depId, inDegree.get(depId) - 1);
        
        if (inDegree.get(depId) === 0) {
          const depConcept = conceptMap.get(depId);
          if (depConcept) {
            // Insert in sorted position by importance and difficulty
            let insertIndex = queue.findIndex(c => 
              c.importance < depConcept.importance ||
              (c.importance === depConcept.importance && 
               this.getDifficultyOrder(c.difficulty) > this.getDifficultyOrder(depConcept.difficulty))
            );
            
            if (insertIndex === -1) {
              queue.push(depConcept);
            } else {
              queue.splice(insertIndex, 0, depConcept);
            }
          }
        }
      });
    }

    // If we didn't sort all concepts, there's a cycle or missing concepts
    if (sorted.length < concepts.length) {
      logger.warn({
        action: 'topological_sort_incomplete',
        sorted: sorted.length,
        total: concepts.length,
        message: 'Some concepts have circular dependencies or are unreachable'
      });
      
      // Add remaining concepts at the end
      concepts.forEach(c => {
        if (!sorted.find(s => s.id === c.id)) {
          sorted.push(c);
        }
      });
    }

    return sorted;
  }

  /**
   * Helper to get numeric difficulty order
   */
  getDifficultyOrder(difficulty) {
    const order = { 'easy': 0, 'medium': 1, 'hard': 2 };
    return order[difficulty] || 1;
  }

  /**
   * Group concepts into episodes based on cumulative estimated time
   */
  groupConceptsByTime(concepts, targetDuration, minDuration, maxDuration, metadata) {
    const episodes = [];
    let currentEpisode = {
      concepts: [],
      cumulative_minutes: 0,
      cumulative_importance: 0
    };

    const planningLog = [];

    for (let i = 0; i < concepts.length; i++) {
      const concept = concepts[i];
      const newTotal = currentEpisode.cumulative_minutes + concept.estimated_minutes;

      // Decision logic
      const isLastConcept = i === concepts.length - 1;
      const wouldExceedMax = newTotal > maxDuration;
      const isAboveMin = currentEpisode.cumulative_minutes >= minDuration;
      const wouldBeBelowMin = newTotal < minDuration;

      planningLog.push({
        concept: concept.name,
        estimated_minutes: concept.estimated_minutes,
        current_episode_time: currentEpisode.cumulative_minutes,
        new_total_if_added: newTotal,
        decision: null
      });

      // Decision tree
      if (currentEpisode.concepts.length === 0) {
        // First concept always goes in
        currentEpisode.concepts.push(concept);
        currentEpisode.cumulative_minutes = concept.estimated_minutes;
        currentEpisode.cumulative_importance += concept.importance;
        planningLog[planningLog.length - 1].decision = 'first_concept_in_episode';
        
      } else if (isLastConcept) {
        // Last concept - add to current or make new episode
        if (wouldExceedMax && isAboveMin) {
          // Current episode is complete, make new episode for last concept
          episodes.push(this.finalizeEpisode(currentEpisode, episodes.length + 1));
          currentEpisode = {
            concepts: [concept],
            cumulative_minutes: concept.estimated_minutes,
            cumulative_importance: concept.importance
          };
          planningLog[planningLog.length - 1].decision = 'last_concept_new_episode';
        } else {
          // Add to current episode even if exceeds max (better than single-concept episode)
          currentEpisode.concepts.push(concept);
          currentEpisode.cumulative_minutes = newTotal;
          currentEpisode.cumulative_importance += concept.importance;
          planningLog[planningLog.length - 1].decision = 'last_concept_added_to_current';
        }
        episodes.push(this.finalizeEpisode(currentEpisode, episodes.length + 1));
        
      } else if (wouldExceedMax && isAboveMin) {
        // Would exceed max and we already have enough content - start new episode
        episodes.push(this.finalizeEpisode(currentEpisode, episodes.length + 1));
        currentEpisode = {
          concepts: [concept],
          cumulative_minutes: concept.estimated_minutes,
          cumulative_importance: concept.importance
        };
        planningLog[planningLog.length - 1].decision = 'start_new_episode_max_exceeded';
        
      } else {
        // Add to current episode
        currentEpisode.concepts.push(concept);
        currentEpisode.cumulative_minutes = newTotal;
        currentEpisode.cumulative_importance += concept.importance;
        planningLog[planningLog.length - 1].decision = 'added_to_current_episode';
      }
    }

    logger.info({
      action: 'episode_grouping_complete',
      episodeCount: episodes.length,
      planning_decisions: planningLog
    });

    return episodes;
  }

  /**
   * Finalize episode data structure
   */
  finalizeEpisode(episodeData, episodeNumber) {
    return {
      episode_number: episodeNumber,
      concepts: episodeData.concepts.map(c => c.id),
      concept_details: episodeData.concepts.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        difficulty: c.difficulty,
        importance: c.importance,
        estimated_minutes: c.estimated_minutes
      })),
      duration_minutes: Math.round(episodeData.cumulative_minutes),
      total_importance: episodeData.cumulative_importance,
      average_importance: Math.round(episodeData.cumulative_importance / episodeData.concepts.length * 10) / 10
    };
  }

  /**
   * Enrich episodes with metadata for review UI
   */
  enrichEpisodeData(episodes, metadata) {
    return episodes.map(episode => {
      // Calculate target word count (150 words per minute speaking rate)
      const targetWords = episode.duration_minutes * 150;
      const minWords = Math.floor(targetWords * 0.9); // 90% minimum
      const maxWords = Math.ceil(targetWords * 1.1);  // 110% maximum

      return {
        ...episode,
        target_words: targetWords,
        word_count_range: [minWords, maxWords],
        title: `Episode ${episode.episode_number}: ${episode.concept_details[0].name}${episode.concept_details.length > 1 ? ' and more' : ''}`,
        description: `Covers ${episode.concept_details.length} concept${episode.concept_details.length > 1 ? 's' : ''}: ${episode.concept_details.map(c => c.name).join(', ')}`,
        rationale: this.generateEpisodeRationale(episode)
      };
    });
  }

  /**
   * Generate human-readable rationale for episode grouping
   */
  generateEpisodeRationale(episode) {
    const conceptCount = episode.concept_details.length;
    const avgImportance = episode.average_importance;
    const duration = episode.duration_minutes;

    let rationale = `This episode covers ${conceptCount} concept${conceptCount > 1 ? 's' : ''} `;
    
    if (avgImportance >= 4) {
      rationale += 'of high importance ';
    } else if (avgImportance >= 3) {
      rationale += 'of medium importance ';
    } else {
      rationale += 'of foundational importance ';
    }

    rationale += `with a total estimated teaching time of ${duration} minutes. `;

    const difficulties = episode.concept_details.map(c => c.difficulty);
    const allSame = difficulties.every(d => d === difficulties[0]);
    
    if (allSame) {
      rationale += `All concepts are ${difficulties[0]} difficulty, `;
    } else {
      rationale += `Concepts range from ${difficulties[0]} to ${difficulties[difficulties.length - 1]} difficulty, `;
    }

    rationale += 'grouped together based on prerequisite relationships and optimal learning pacing.';

    return rationale;
  }
}

module.exports = new EpisodePlanner();
