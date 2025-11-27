const winston = require('winston');
const path = require('path');
const { validateEpisodePlanOutput, getValidationReport } = require('../validation/schema_validator');

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
 * Episode Planner - Creates conversational revision episodes for students
 * 
 * PURPOSE: Plan audio revision episodes where two students discuss chapter content
 * 
 * Design Principles:
 * 1. Group concepts by pedagogical coherence (what belongs together for learning)
 * 2. Use concept importance and depth as primary grouping factors
 * 3. Respect natural prerequisite flow (don't discuss X before Y if Y is needed first)
 * 4. Target episode lengths that work for student attention and audio consumption
 * 5. Balance episode count - not too many (fragmented) or too few (overwhelming)
 * 
 * Episode Duration Philosophy:
 * - Target: 5-8 minutes for most grades (short enough to maintain focus)
 * - Flexible: Can go shorter (3-4 min) or longer (10-12 min) based on concept grouping
 * - Priority: Conceptual coherence > strict time limits
 */
class EpisodePlanner {
  constructor() {
    // Target episode durations for audio revision content
    // Based on: student attention span + audio consumption patterns
    this.gradeAttentionSpans = {
      '1-2': 4,    // Very young: 3-5 min optimal (short, focused)
      '3-4': 5,    // Early elementary: 4-6 min optimal
      '5-6': 6,    // Upper elementary: 5-8 min optimal
      '7-8': 7,    // Middle school: 6-9 min optimal
      '9-10': 8,   // High school: 7-10 min optimal
      '11-12': 10  // Senior: 8-12 min optimal (can handle more depth)
    };

    // Allow flexibility for conceptual grouping
    // Episode can be 70%-130% of target if concepts belong together
    this.durationFlexibility = { min: 0.7, max: 1.3 };
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
    
    // Get chapter analysis from LLM (passed via metadata)
    const chapterAnalysis = chapterMetadata.chapter_analysis || null;
    
    // Default strategy
    let planningStrategy = 'default_prerequisite';
    
    if (chapterAnalysis) {
      logger.info({
        action: 'using_llm_chapter_analysis',
        content_type: chapterAnalysis.content_type,
        main_focus: chapterAnalysis.main_focus,
        organization: chapterAnalysis.content_organization,
        approach: chapterAnalysis.recommended_episode_approach || chapterAnalysis.episode_grouping_strategy,
        confidence: chapterAnalysis.confidence
      });
      
      // Extract LLM's understanding
      const contentType = (chapterAnalysis.content_type || '').toLowerCase();
      const approach = (chapterAnalysis.recommended_episode_approach || chapterAnalysis.episode_grouping_strategy || '').toLowerCase();
      const organization = (chapterAnalysis.content_organization || '').toLowerCase();
      const hasDependencies = chapterAnalysis.has_dependencies !== false; // default true
      
      // Decide planning strategy based on LLM analysis
      if (approach.includes('overview') || approach.includes('single episode')) {
        // LLM recommends single overview episode
        planningStrategy = 'llm_overview';
        const overviewEpisodes = this.createOverviewEpisodes(concepts, targetDuration, maxDuration, chapterMetadata);
        
        return {
          total_episodes: overviewEpisodes.length,
          episodes: overviewEpisodes,
          content_type: chapterAnalysis.content_type,
          planning_metadata: {
            chapter_analysis: chapterAnalysis,
            target_duration: targetDuration,
            strategy_used: planningStrategy,
            reasoning: 'LLM identified this as overview/introductory content best served in single episode'
          }
        };
      } else if (!hasDependencies || organization.includes('independent') || organization.includes('standalone')) {
        // Content has no dependencies - can group by theme/topic
        planningStrategy = 'thematic_grouping';
        logger.info({ action: 'using_thematic_grouping', reason: 'LLM identified independent concepts' });
      } else if (organization.includes('sequential') || organization.includes('builds') || hasDependencies) {
        // Sequential content - preserve order
        planningStrategy = 'sequential_flow';
        logger.info({ action: 'using_sequential_flow', reason: 'LLM identified prerequisite dependencies' });
      } else if (organization.includes('chronological')) {
        // Chronological content (history, narratives)
        planningStrategy = 'chronological_order';
        logger.info({ action: 'using_chronological_order', reason: 'LLM identified time-based organization' });
      } else {
        // Default to preserving textbook order
        planningStrategy = 'textbook_order';
        logger.info({ action: 'using_textbook_order', reason: 'Default strategy based on LLM analysis' });
      }
    } else {
      // No LLM analysis - preserve textbook order
      logger.info({
        action: 'no_llm_analysis',
        strategy: 'textbook_order_fallback',
        reasoning: 'Textbook already has concepts in proper teaching sequence'
      });
      planningStrategy = 'textbook_order';
    }
    
    // Group concepts into episodes based on chosen strategy
    // CRITICAL: Actually USE the strategy we determined above
    let episodes;
    
    switch (planningStrategy) {
      case 'llm_overview':
        // Already handled above (early return)
        break;
        
      case 'sequential_flow':
      case 'chronological_order':
      case 'textbook_order':
        // PRESERVE TEXTBOOK ORDER - just split by duration while maintaining sequence
        logger.info({ action: 'preserving_textbook_order', strategy: planningStrategy });
        episodes = this.groupConceptsByTimePreservingOrder(
          concepts,
          targetDuration,
          minDuration,
          maxDuration,
          chapterMetadata
        );
        break;
        
      case 'thematic_grouping':
        // Group by theme BUT still respect relative order within themes
        logger.info({ action: 'grouping_by_theme', strategy: planningStrategy });
        episodes = this.groupConceptsByThemePreservingOrder(
          concepts,
          targetDuration,
          minDuration,
          maxDuration,
          chapterMetadata
        );
        break;
        
      default:
        // Fallback: preserve textbook order
        logger.info({ action: 'using_fallback_strategy', strategy: 'textbook_order' });
        episodes = this.groupConceptsByTimePreservingOrder(
          concepts,
          targetDuration,
          minDuration,
          maxDuration,
          chapterMetadata
        );
    }

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
        generated_at: new Date().toISOString(),
        chapter_analysis: chapterAnalysis || null,
        strategy_used: planningStrategy,
        content_type: chapterAnalysis ? chapterAnalysis.content_type : 'unknown'
      }
    };

    // Validate against schema before returning
    const validationResult = validateEpisodePlanOutput(plan);
    if (!validationResult.valid) {
      const report = getValidationReport(validationResult, 'Episode Plan');
      logger.warn({
        action: 'schema_validation_warning',
        chapterId: chapterMetadata.chapter_id,
        report,
        errors: validationResult.errors
      });
      // Don't throw - just warn for now
    }

    logger.info({ 
      action: 'episode_planning_complete', 
      chapterId: chapterMetadata.chapter_id,
      episodeCount: enrichedEpisodes.length,
      totalMinutes: enrichedEpisodes.reduce((sum, ep) => sum + ep.duration_minutes, 0),
      strategy: planningStrategy
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
  /**
   * Group concepts by time WHILE PRESERVING TEXTBOOK ORDER
   * This is the PRIMARY episode planning method
   * 
   * PRINCIPLES:
   * 1. NEVER reorder concepts - textbook sequence is sacred
   * 2. Split into episodes based on target duration
   * 3. Prefer keeping related concepts together
   * 4. Balance episode lengths (not too short, not too long)
   */
  groupConceptsByTimePreservingOrder(concepts, targetDuration, minDuration, maxDuration, metadata) {
    logger.info({
      action: 'grouping_concepts_preserving_order',
      totalConcepts: concepts.length,
      targetDuration,
      minDuration,
      maxDuration
    });
    
    const episodes = [];
    let currentEpisode = {
      concepts: [],
      cumulative_minutes: 0,
      cumulative_importance: 0
    };

    const planningLog = [];

    // Process concepts IN ORDER (never reorder)
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
      planning_decisions: planningLog,
      textbook_order_preserved: true
    });

    return episodes;
  }

  /**
   * LEGACY METHOD - kept for compatibility
   * Use groupConceptsByTimePreservingOrder instead
   */
  groupConceptsByTime(concepts, targetDuration, minDuration, maxDuration, metadata) {
    logger.warn({
      action: 'using_legacy_grouping_method',
      message: 'This method is deprecated. Use groupConceptsByTimePreservingOrder instead.'
    });
    return this.groupConceptsByTimePreservingOrder(concepts, targetDuration, minDuration, maxDuration, metadata);
  }

  /**
   * Group concepts by theme WHILE PRESERVING ORDER
   * Used when LLM identifies independent thematic sections
   * 
   * STRATEGY:
   * 1. Detect theme boundaries (concept type changes, importance shifts)
   * 2. Group concepts within same theme
   * 3. NEVER reorder - just create episode breaks at theme boundaries
   */
  groupConceptsByThemePreservingOrder(concepts, targetDuration, minDuration, maxDuration, metadata) {
    logger.info({
      action: 'grouping_by_theme_preserving_order',
      totalConcepts: concepts.length
    });

    // Detect theme boundaries by analyzing concept metadata
    const themeBoundaries = [];
    
    for (let i = 1; i < concepts.length; i++) {
      const prev = concepts[i - 1];
      const curr = concepts[i];
      
      // Theme boundary indicators:
      // - Concept type changes (definition → formula → process)
      // - Large importance drop (5 → 2)
      // - Difficulty level changes significantly
      const typeChange = prev.type !== curr.type;
      const importanceDrop = (prev.importance || 3) - (curr.importance || 3) >= 2;
      const difficultyChange = prev.difficulty !== curr.difficulty;
      
      if (typeChange || importanceDrop || difficultyChange) {
        themeBoundaries.push(i);
      }
    }
    
    logger.info({
      action: 'detected_theme_boundaries',
      boundaries: themeBoundaries,
      themeCount: themeBoundaries.length + 1
    });

    // If no clear themes detected, fall back to time-based grouping
    if (themeBoundaries.length === 0) {
      logger.info({ action: 'no_themes_detected', fallback: 'time_based_grouping' });
      return this.groupConceptsByTimePreservingOrder(concepts, targetDuration, minDuration, maxDuration, metadata);
    }

    // Group concepts by themes, then split long themes by duration
    const episodes = [];
    let themeStart = 0;
    
    for (let i = 0; i <= themeBoundaries.length; i++) {
      const themeEnd = i < themeBoundaries.length ? themeBoundaries[i] : concepts.length;
      const themeConcepts = concepts.slice(themeStart, themeEnd);
      
      // If theme is too long, split it while preserving order
      const themeTime = themeConcepts.reduce((sum, c) => sum + (c.estimated_minutes || 3), 0);
      
      if (themeTime > maxDuration) {
        // Theme too long - split into sub-episodes
        const subEpisodes = this.groupConceptsByTimePreservingOrder(
          themeConcepts,
          targetDuration,
          minDuration,
          maxDuration,
          metadata
        );
        subEpisodes.forEach(ep => episodes.push(ep));
      } else {
        // Theme fits in one episode
        const themeImportance = themeConcepts.reduce((sum, c) => sum + (c.importance || 3), 0);
        episodes.push(this.finalizeEpisode({
          concepts: themeConcepts,
          cumulative_minutes: themeTime,
          cumulative_importance: themeImportance
        }, episodes.length + 1));
      }
      
      themeStart = themeEnd;
    }

    logger.info({
      action: 'theme_grouping_complete',
      episodeCount: episodes.length,
      textbook_order_preserved: true
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

    let rationale = `This ${duration}-minute episode covers ${conceptCount} concept${conceptCount > 1 ? 's' : ''} `;
    
    // Describe the grouping logic
    if (conceptCount === 1) {
      const concept = episode.concept_details[0];
      rationale += `focusing deeply on "${concept.name}" (importance: ${concept.importance}/5, ${concept.estimated_minutes} min). `;
      rationale += `This concept deserves its own episode due to its ${concept.importance >= 4 ? 'critical importance' : 'complexity'} in the chapter.`;
    } else {
      rationale += `that naturally belong together. `;
      
      if (avgImportance >= 4) {
        rationale += `These are core concepts central to understanding the chapter. `;
      } else if (avgImportance >= 3) {
        rationale += `These concepts build on each other and are best understood together. `;
      } else {
        rationale += `These supporting concepts provide important context and foundation. `;
      }

      // Mention difficulty progression if applicable
      const difficulties = episode.concept_details.map(c => c.difficulty);
      const hasProgression = difficulties[0] === 'easy' && difficulties.some(d => d !== 'easy');
      
      if (hasProgression) {
        rationale += `The episode starts with easier concepts and progresses to more complex ones, `;
      } else if (difficulties.every(d => d === difficulties[0])) {
        rationale += `All concepts are ${difficulties[0]} difficulty, maintaining consistent pacing. `;
      }

      rationale += `Concepts: ${episode.concept_details.map(c => `"${c.name}" (${c.importance}/5)`).join(', ')}.`;
    }

    return rationale;
  }

  /**
   * Create episodes for overview/introduction chapters
   * Uses intelligent grouping based on concept metadata and topic clustering
   */
  createOverviewEpisodes(concepts, targetDuration, maxDuration, metadata) {
    const episodes = [];
    
    // Calculate total duration
    const totalTime = concepts.reduce((sum, c) => sum + (c.estimated_minutes || 3), 0);
    
    logger.info({
      action: 'creating_overview_episodes',
      conceptCount: concepts.length,
      totalMinutes: totalTime,
      targetDuration,
      maxDuration
    });
    
    // STRATEGY: Respect textbook ordering (concepts are already in teaching sequence)
    // Simply split into balanced episodes by duration, preserving the flow
    // The textbook author already organized concepts in the right order
    
    // Decision logic:
    // - ≤ 5 concepts OR ≤ maxDuration*1.3 → Single episode
    // - 6-12 concepts → 2 balanced episodes
    // - > 12 concepts → 3 episodes
    
    let episodeCount = 1;
    if (concepts.length > 12 || totalTime > maxDuration * 2) {
      episodeCount = 3;
    } else if (concepts.length > 5 || totalTime > maxDuration * 1.3) {
      episodeCount = 2;
    }
    
    logger.info({
      action: 'splitting_by_textbook_flow',
      episodeCount,
      reasoning: `Preserving textbook order - ${concepts.length} concepts, ${totalTime.toFixed(1)} min total`
    });
    
    // Split concepts sequentially while balancing duration
    // This PRESERVES textbook order (no reordering)
    const balancedGroups = this.balanceConceptsByDuration(concepts, episodeCount, targetDuration);
    
    balancedGroups.forEach((group, idx) => {
      const groupTime = group.reduce((sum, c) => sum + (c.estimated_minutes || 3), 0);
      const groupImportance = group.reduce((sum, c) => sum + (c.importance || 3), 0);
      
      // Create meaningful theme based on first few concepts
      const conceptNames = group.map(c => c.name || c.id).slice(0, 2);
      const theme = group.length <= 2 
        ? conceptNames.join(' & ') 
        : `${conceptNames[0]} and ${group.length - 1} more`;
      
      episodes.push(this.finalizeEpisode({
        concepts: group,
        cumulative_minutes: groupTime,
        cumulative_importance: groupImportance,
        episode_theme: theme
      }, idx + 1));
    });
    
    logger.info({
      action: 'created_sequential_episodes',
      episodeCount: episodes.length,
      durations: episodes.map(e => e.duration_minutes),
      conceptCounts: episodes.map(e => e.concept_details.length),
      preservedTextbookOrder: true
    });

    return this.enrichEpisodeData(episodes, metadata);
  }

  /**
   * Analyze cluster quality and decide whether to use them or fall back to duration balancing
   * Also handles merging tiny clusters and splitting huge ones
   */
  analyzeClusterQuality(clusters, maxDuration) {
    if (!clusters || clusters.length === 0) {
      return { usesClusters: false, reasoning: 'No clusters found' };
    }
    
    // Single cluster = everything connected, treat as one group
    if (clusters.length === 1) {
      return { usesClusters: false, reasoning: 'All concepts form single cluster - using duration balancing' };
    }
    
    // Calculate cluster statistics
    const clusterSizes = clusters.map(c => c.concepts.length);
    const clusterDurations = clusters.map(c => 
      c.concepts.reduce((sum, concept) => sum + (concept.estimated_minutes || 3), 0)
    );
    
    const avgSize = clusterSizes.reduce((a, b) => a + b, 0) / clusters.length;
    const maxSize = Math.max(...clusterSizes);
    const minSize = Math.min(...clusterSizes);
    
    // Check for pathological cases
    
    // Too many micro-clusters (e.g., 8 clusters with 1 concept each)
    const microClusters = clusterSizes.filter(size => size === 1).length;
    if (microClusters > clusters.length * 0.6) {
      return { 
        usesClusters: false, 
        reasoning: `Too many single-concept clusters (${microClusters}/${clusters.length}) - concepts are disconnected` 
      };
    }
    
    // Extreme imbalance (e.g., one cluster has 80% of concepts)
    if (maxSize > avgSize * 3) {
      return { 
        usesClusters: false, 
        reasoning: `Clusters too imbalanced (largest: ${maxSize}, avg: ${avgSize.toFixed(1)}) - merging won't help` 
      };
    }
    
    // Too many clusters (> 5 episodes is too fragmented for overview)
    if (clusters.length > 5) {
      return { 
        usesClusters: false, 
        reasoning: `Too many clusters (${clusters.length}) - would create too many episodes` 
      };
    }
    
    // GOOD QUALITY CLUSTERS - now optimize them
    
    // Step 1: Merge tiny clusters (< 2 concepts) into nearest neighbor
    let optimizedClusters = this.mergeTinyClusters(clusters, maxDuration);
    
    // Step 2: Split overly long clusters that exceed maxDuration
    optimizedClusters = this.splitOversizedClusters(optimizedClusters, maxDuration);
    
    // Step 3: If we still have 1 cluster after merging, fall back
    if (optimizedClusters.length === 1) {
      return { 
        usesClusters: false, 
        reasoning: 'Clusters merged into single group - using duration balancing' 
      };
    }
    
    // Step 4: Final balance check - ensure no cluster is too small relative to others
    const finalSizes = optimizedClusters.map(c => c.length);
    const finalAvg = finalSizes.reduce((a, b) => a + b, 0) / finalSizes.length;
    const tooSmall = finalSizes.filter(size => size < finalAvg * 0.3).length;
    
    if (tooSmall > 0 && optimizedClusters.length > 2) {
      // Merge smallest cluster with its best match
      optimizedClusters = this.mergeSmallestCluster(optimizedClusters, maxDuration);
    }
    
    return {
      usesClusters: true,
      episodes: optimizedClusters,
      reasoning: `Created ${optimizedClusters.length} episodes from ${clusters.length} clusters (merged/split for balance)`
    };
  }

  /**
   * Merge clusters with only 1-2 concepts into their nearest neighbor
   */
  mergeTinyClusters(clusters, maxDuration) {
    const MIN_CLUSTER_SIZE = 2;
    let merged = clusters.map(c => c.concepts); // Convert to arrays of concepts
    let changed = true;
    
    while (changed) {
      changed = false;
      
      for (let i = 0; i < merged.length; i++) {
        if (merged[i].length >= MIN_CLUSTER_SIZE) continue;
        
        // Find best cluster to merge with (closest in duration)
        let bestIdx = -1;
        let bestDiff = Infinity;
        
        for (let j = 0; j < merged.length; j++) {
          if (i === j) continue;
          
          const combinedDuration = [...merged[i], ...merged[j]]
            .reduce((sum, c) => sum + (c.estimated_minutes || 3), 0);
          
          if (combinedDuration <= maxDuration * 1.5) {
            const diff = Math.abs(merged[i].length - merged[j].length);
            if (diff < bestDiff) {
              bestDiff = diff;
              bestIdx = j;
            }
          }
        }
        
        if (bestIdx !== -1) {
          // Merge cluster i into cluster bestIdx
          merged[bestIdx] = [...merged[bestIdx], ...merged[i]];
          merged.splice(i, 1);
          changed = true;
          break; // Restart loop
        }
      }
    }
    
    return merged;
  }

  /**
   * Split clusters that are too long (exceed maxDuration significantly)
   */
  splitOversizedClusters(clusters, maxDuration) {
    const result = [];
    
    clusters.forEach(cluster => {
      const duration = cluster.reduce((sum, c) => sum + (c.estimated_minutes || 3), 0);
      
      if (duration > maxDuration * 1.8) {
        // Split into 2 balanced parts
        const sorted = [...cluster].sort((a, b) => (b.estimated_minutes || 3) - (a.estimated_minutes || 3));
        const half1 = [];
        const half2 = [];
        let time1 = 0, time2 = 0;
        
        // Greedy balancing
        sorted.forEach(concept => {
          if (time1 <= time2) {
            half1.push(concept);
            time1 += (concept.estimated_minutes || 3);
          } else {
            half2.push(concept);
            time2 += (concept.estimated_minutes || 3);
          }
        });
        
        result.push(half1, half2);
      } else {
        result.push(cluster);
      }
    });
    
    return result;
  }

  /**
   * Merge the smallest cluster with its best match
   */
  mergeSmallestCluster(clusters, maxDuration) {
    if (clusters.length <= 2) return clusters;
    
    // Find smallest cluster
    const sizes = clusters.map(c => c.length);
    const minIdx = sizes.indexOf(Math.min(...sizes));
    
    // Find best merge target (closest size, within duration limit)
    let bestIdx = -1;
    let bestDiff = Infinity;
    
    for (let i = 0; i < clusters.length; i++) {
      if (i === minIdx) continue;
      
      const combinedDuration = [...clusters[minIdx], ...clusters[i]]
        .reduce((sum, c) => sum + (c.estimated_minutes || 3), 0);
      
      if (combinedDuration <= maxDuration * 1.5) {
        const diff = Math.abs(clusters[minIdx].length - clusters[i].length);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = i;
        }
      }
    }
    
    if (bestIdx === -1) return clusters; // Can't merge safely
    
    // Merge
    const merged = [...clusters];
    merged[bestIdx] = [...merged[bestIdx], ...merged[minIdx]];
    merged.splice(minIdx, 1);
    
    return merged;
  }

  /**
   * Cluster concepts by topic based on ACTUAL relationships in the data
   * Uses prerequisite graph, name similarity, and type matching
   * Does NOT assume domain categories like "Physics" or "Biology"
   */
  clusterConceptsByTopic(concepts) {
    // Build adjacency map from prerequisites/related concepts
    const adjacency = new Map();
    concepts.forEach((c, idx) => {
      adjacency.set(idx, new Set());
      
      // Add edges from prerequisite relationships
      if (Array.isArray(c.related) && c.related.length > 0) {
        concepts.forEach((other, otherIdx) => {
          if (idx !== otherIdx && c.related.includes(other.id)) {
            adjacency.get(idx).add(otherIdx);
            if (!adjacency.has(otherIdx)) adjacency.set(otherIdx, new Set());
            adjacency.get(otherIdx).add(idx);
          }
        });
      }
      
      // Add edges from name similarity (shared keywords)
      concepts.forEach((other, otherIdx) => {
        if (idx !== otherIdx && this.areConceptsRelated(c, other)) {
          adjacency.get(idx).add(otherIdx);
          if (!adjacency.has(otherIdx)) adjacency.set(otherIdx, new Set());
          adjacency.get(otherIdx).add(idx);
        }
      });
    });
    
    // Find connected components (clusters)
    const visited = new Set();
    const clusters = [];
    
    const dfs = (startIdx) => {
      const cluster = [];
      const stack = [startIdx];
      
      while (stack.length > 0) {
        const idx = stack.pop();
        if (visited.has(idx)) continue;
        
        visited.add(idx);
        cluster.push(concepts[idx]);
        
        // Visit neighbors
        const neighbors = adjacency.get(idx) || new Set();
        neighbors.forEach(neighborIdx => {
          if (!visited.has(neighborIdx)) {
            stack.push(neighborIdx);
          }
        });
      }
      
      return cluster;
    };
    
    // Run DFS from each unvisited concept
    concepts.forEach((_, idx) => {
      if (!visited.has(idx)) {
        const cluster = dfs(idx);
        if (cluster.length > 0) {
          clusters.push({
            topics: cluster.map(c => c.name || c.id),
            concepts: cluster
          });
        }
      }
    });
    
    // Sort clusters by total importance (put important clusters first)
    clusters.sort((a, b) => {
      const importanceA = a.concepts.reduce((sum, c) => sum + (c.importance || 3), 0);
      const importanceB = b.concepts.reduce((sum, c) => sum + (c.importance || 3), 0);
      return importanceB - importanceA;
    });
    
    return clusters;
  }

  /**
   * Check if two concepts are related based on actual data
   * Uses: shared keywords, same type, parent-child relationship
   */
  areConceptsRelated(concept1, concept2) {
    // Check parent-child relationship
    if (concept1.parent_concept === concept2.id || concept2.parent_concept === concept1.id) {
      return true;
    }
    
    // Check if same specialized type (formulas should be together, processes together)
    if (concept1.type === concept2.type && ['process', 'formula', 'method'].includes(concept1.type)) {
      return true;
    }
    
    // Check name similarity (shared meaningful keywords)
    const name1 = (concept1.name || concept1.id || '').toLowerCase();
    const name2 = (concept2.name || concept2.id || '').toLowerCase();
    
    // Extract meaningful words (length > 3, not common words)
    const commonWords = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'what', 'how', 'why', 'when', 'where']);
    const words1 = name1.split(/\s+/).filter(w => w.length > 3 && !commonWords.has(w));
    const words2 = name2.split(/\s+/).filter(w => w.length > 3 && !commonWords.has(w));
    
    // If they share 2+ meaningful words, consider them related
    const sharedWords = words1.filter(w => words2.includes(w));
    if (sharedWords.length >= 2) {
      return true;
    }
    
    // If one concept name contains the other, they're related
    if (words1.length <= 2 && name2.includes(name1)) return true;
    if (words2.length <= 2 && name1.includes(name2)) return true;
    
    return false;
  }

  /**
   * Balance concepts across N episodes by duration
   * PRESERVES textbook order - concepts stay in original sequence
   */
  balanceConceptsByDuration(concepts, episodeCount, targetDuration) {
    // Simple sequential split that respects textbook flow
    // Don't reorder - the textbook author already arranged concepts pedagogically
    
    const totalDuration = concepts.reduce((sum, c) => sum + (c.estimated_minutes || 3), 0);
    const targetPerEpisode = totalDuration / episodeCount;
    
    const groups = [];
    let currentGroup = [];
    let currentDuration = 0;
    
    concepts.forEach((concept, idx) => {
      const conceptDuration = concept.estimated_minutes || 3;
      
      // Start new group if:
      // 1. Current group would exceed 1.5x target AND we haven't filled all episodes yet
      // 2. This is the last concept and we need to close the group
      const wouldExceedTarget = (currentDuration + conceptDuration) > targetPerEpisode * 1.5;
      const hasMoreEpisodes = groups.length < episodeCount - 1;
      const isLastConcept = idx === concepts.length - 1;
      
      if (currentGroup.length > 0 && wouldExceedTarget && hasMoreEpisodes) {
        groups.push(currentGroup);
        currentGroup = [concept];
        currentDuration = conceptDuration;
      } else {
        currentGroup.push(concept);
        currentDuration += conceptDuration;
      }
      
      // Close final group
      if (isLastConcept && currentGroup.length > 0) {
        groups.push(currentGroup);
      }
    });
    
    return groups.filter(g => g.length > 0);
  }
}

module.exports = new EpisodePlanner();
