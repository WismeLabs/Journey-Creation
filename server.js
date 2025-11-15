require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch'); // For LLM service calls

// Import services
const ingestService = require('./services/ingest/pdf_processor');
const semanticService = require('./services/semantic/concept_extractor');
const plannerService = require('./services/planner/episode_planner');
const validationService = require('./services/validation/validator');
const ttsService = require('./services/tts/tts_orchestrator');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  useTempFiles: true,
  tempFileDir: '/tmp/'
}));

// Serve static files for outputs and teacher UI
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));
app.use('/teacher', express.static(path.join(__dirname, 'teacher_ui')));

// Job tracking in memory (in production, use Redis or DB)
const jobs = new Map();

/**
 * Save data to MIGRATION.md compliant output structure
 */
async function saveToOutputStructure(chapterId, filename, data) {
  const fs = require('fs');
  const chapterDir = path.join(__dirname, 'outputs', `chapter_${chapterId}`);
  
  if (!fs.existsSync(chapterDir)) {
    fs.mkdirSync(chapterDir, { recursive: true });
  }
  
  const filePath = path.join(chapterDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  
  logger.info(`Saved ${filename} to ${filePath}`);
}

/**
 * Save episode files per MIGRATION.md output contract
 */
async function saveEpisodeFiles(chapterId, episodeIndex, episodeData) {
  const fs = require('fs');
  const episodeDir = path.join(__dirname, 'outputs', `chapter_${chapterId}`, 'episodes', `ep${episodeIndex.toString().padStart(2, '0')}`);
  
  if (!fs.existsSync(episodeDir)) {
    fs.mkdirSync(episodeDir, { recursive: true });
  }
  
  // Create audio directory
  const audioDir = path.join(episodeDir, 'audio');
  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }

  // Save script.json (structured format per MIGRATION.md)
  const scriptJsonPath = path.join(episodeDir, 'script.json');
  fs.writeFileSync(scriptJsonPath, JSON.stringify(episodeData.script, null, 2), 'utf8');

  // Save script.txt (raw StudentA/StudentB format per MIGRATION.md)
  const scriptTxtPath = path.join(episodeDir, 'script.txt');
  const rawScript = convertScriptToRawText(episodeData.script);
  fs.writeFileSync(scriptTxtPath, rawScript, 'utf8');

  // Save mcqs.json
  const mcqsPath = path.join(episodeDir, 'mcqs.json');
  fs.writeFileSync(mcqsPath, JSON.stringify(episodeData.mcqs, null, 2), 'utf8');

  // Save metadata.json
  const metadataPath = path.join(episodeDir, 'metadata.json');
  fs.writeFileSync(metadataPath, JSON.stringify(episodeData.metadata, null, 2), 'utf8');

  // Save cues.json (placeholder for now, will be generated after TTS)
  const cuesPath = path.join(episodeDir, 'cues.json');
  const cues = { sections: [], timestamps: [], audio_file: `ep${episodeIndex.toString().padStart(2, '0')}_final.mp3` };
  fs.writeFileSync(cuesPath, JSON.stringify(cues, null, 2), 'utf8');

  logger.info(`Saved episode ${episodeIndex} files to ${episodeDir}`);
}

/**
 * Convert structured script to raw StudentA/StudentB text format
 */
function convertScriptToRawText(script) {
  if (!script.sections) return '';
  
  return script.sections.map(section => section.text || '').join('\n\n');
}

// Utility function to update job status
function updateJobStatus(jobId, status, progress = null, error = null, result = null) {
  const job = jobs.get(jobId);
  if (job) {
    job.status = status;
    job.progress = progress;
    job.lastUpdated = new Date();
    if (error) job.error = error;
    if (result) job.result = result;
    logger.info(`Job ${jobId} status updated to ${status}`, { progress, error });
  }
}

// API Routes

/**
 * POST /api/v1/generate
 * Starts chapter processing pipeline
 */
app.post('/api/v1/generate', async (req, res) => {
  const jobId = uuidv4();
  
  try {
    // Validate required fields
    const { chapter_id, grade_band, subject, language = 'en-IN', teacher_review = false } = req.body;
    
    if (!chapter_id || !grade_band || !subject) {
      return res.status(400).json({ 
        error: 'Missing required fields: chapter_id, grade_band, subject' 
      });
    }

    // Check for uploaded file or file URL
    let pdfFile = null;
    if (req.files && req.files.chapter_file) {
      pdfFile = req.files.chapter_file;
    } else if (req.body.chapter_file_url) {
      // Handle URL-based upload later
      return res.status(400).json({ error: 'URL-based upload not yet implemented' });
    } else {
      return res.status(400).json({ error: 'No PDF file provided' });
    }

    // Initialize job tracking
    jobs.set(jobId, {
      jobId,
      chapterId: chapter_id,
      status: 'started',
      progress: 0,
      startTime: new Date(),
      lastUpdated: new Date(),
      metadata: { chapter_id, grade_band, subject, language, teacher_review }
    });

    logger.info(`Starting chapter processing for ${chapter_id}`, { jobId, metadata: jobs.get(jobId).metadata });

    // Start async processing
    processChapter(jobId, pdfFile, { chapter_id, grade_band, subject, language, teacher_review });

    res.json({ 
      job_id: jobId,
      status: 'started',
      message: 'Chapter processing initiated'
    });

  } catch (error) {
    logger.error('Error starting chapter processing', { error: error.message, jobId });
    res.status(500).json({ error: 'Failed to start processing: ' + error.message });
  }
});

/**
 * GET /api/v1/status/{job_id}
 * Returns job progress and status
 */
app.get('/api/v1/status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    job_id: jobId,
    status: job.status,
    progress: job.progress,
    start_time: job.startTime,
    last_updated: job.lastUpdated,
    error: job.error || null
  });
});

/**
 * GET /api/v1/result/{chapter_id}
 * Returns processing results
 */
app.get('/api/v1/result/:chapterId', (req, res) => {
  const { chapterId } = req.params;
  
  // Find job by chapter ID
  let targetJob = null;
  for (const [jobId, job] of jobs.entries()) {
    if (job.chapterId === chapterId && job.status === 'completed') {
      targetJob = job;
      break;
    }
  }

  if (!targetJob) {
    return res.status(404).json({ error: 'No completed job found for chapter' });
  }

  if (targetJob.result) {
    res.json(targetJob.result);
  } else {
    res.status(500).json({ error: 'Job completed but no result available' });
  }
});

/**
 * GET /api/v1/preview/{chapter_id}/{episode_index}
 * Returns script preview & audio URL for teacher review
 */
app.get('/api/v1/preview/:chapterId/:episodeIndex', (req, res) => {
  const { chapterId, episodeIndex } = req.params;
  
  try {
    const outputDir = path.join(__dirname, 'outputs', `chapter_${chapterId}`);
    const episodeDir = path.join(outputDir, 'episodes', `ep${episodeIndex.padStart(2, '0')}`);
    
    // Check if episode exists
    if (!fs.existsSync(episodeDir)) {
      return res.status(404).json({ error: 'Episode not found' });
    }

    // Load episode data
    const scriptPath = path.join(episodeDir, 'script.json');
    const mcqsPath = path.join(episodeDir, 'mcqs.json');
    const audioPath = path.join(episodeDir, 'audio', 'final_audio.mp3');

    const preview = {
      chapter_id: chapterId,
      episode_index: parseInt(episodeIndex),
      script: null,
      mcqs: null,
      audio_url: null,
      metadata: null
    };

    // Load script if exists
    if (fs.existsSync(scriptPath)) {
      preview.script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    }

    // Load MCQs if exists
    if (fs.existsSync(mcqsPath)) {
      preview.mcqs = JSON.parse(fs.readFileSync(mcqsPath, 'utf8'));
    }

    // Check for audio
    if (fs.existsSync(audioPath)) {
      preview.audio_url = `/outputs/chapter_${chapterId}/episodes/ep${episodeIndex.padStart(2, '0')}/audio/final_audio.mp3`;
    }

    res.json(preview);

  } catch (error) {
    logger.error(`Preview generation failed: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

/**
 * POST /api/v1/regenerate_episode
 * Manually trigger episode regeneration
 */
app.post('/api/v1/regenerate_episode', async (req, res) => {
  const { chapter_id, episode_index, seed, reason } = req.body;
  
  if (!chapter_id || !episode_index) {
    return res.status(400).json({ error: 'chapter_id and episode_index required' });
  }

  try {
    const jobId = uuidv4();
    
    // Initialize regeneration job
    jobs.set(jobId, {
      jobId,
      chapterId: chapter_id,
      status: 'regenerating',
      progress: 0,
      startTime: new Date(),
      lastUpdated: new Date(),
      metadata: { episode_index, seed, reason, type: 'regeneration' }
    });

    // Start async regeneration
    regenerateEpisode(jobId, chapter_id, episode_index, seed, reason);

    res.json({ 
      job_id: jobId,
      status: 'regenerating',
      message: `Episode ${episode_index} regeneration started`
    });

  } catch (error) {
    logger.error(`Regeneration request failed: ${error.message}`);
    res.status(500).json({ error: 'Failed to start regeneration' });
  }
});

/**
 * Teacher Review UI Routes
 */

// Serve teacher review UI
app.get('/teacher/review', (req, res) => {
  res.sendFile(path.join(__dirname, 'teacher_ui', 'review.html'));
});

// Serve teacher review for specific chapter
app.get('/teacher/review/:chapterId', (req, res) => {
  res.sendFile(path.join(__dirname, 'teacher_ui', 'review.html'));
});

// Submit teacher review
app.post('/api/v1/teacher/review', async (req, res) => {
  const { chapter_id, episode_reviews, overall_decision, notes } = req.body;

  try {
    // Save teacher review data
    const reviewData = {
      chapter_id,
      episode_reviews,
      overall_decision, // 'approved' | 'revision_requested' | 'rejected'
      notes,
      reviewer_timestamp: new Date().toISOString(),
      review_id: uuidv4()
    };

    // Create review directory if it doesn't exist
    const reviewDir = path.join(__dirname, 'outputs', `chapter_${chapter_id}`, 'reviews');
    if (!fs.existsSync(reviewDir)) {
      fs.mkdirSync(reviewDir, { recursive: true });
    }

    // Save review
    const reviewPath = path.join(reviewDir, `teacher_review_${Date.now()}.json`);
    fs.writeFileSync(reviewPath, JSON.stringify(reviewData, null, 2));

    // Handle review decision
    if (overall_decision === 'revision_requested') {
      // Trigger regeneration for flagged episodes
      const episodesToRegenerate = episode_reviews
        .filter(review => review.status === 'revision_requested')
        .map(review => review.episode_index);

      for (const episodeIndex of episodesToRegenerate) {
        const jobId = uuidv4();
        jobs.set(jobId, {
          jobId,
          chapterId: chapter_id,
          status: 'regenerating',
          progress: 0,
          startTime: new Date(),
          metadata: { episode_index: episodeIndex, trigger: 'teacher_review' }
        });

        // Start regeneration
        regenerateEpisode(jobId, chapter_id, episodeIndex, null, notes);
      }
    }

    logger.info(`Teacher review submitted for ${chapter_id}: ${overall_decision}`);
    res.json({ 
      success: true, 
      review_id: reviewData.review_id,
      message: 'Review submitted successfully'
    });

  } catch (error) {
    logger.error(`Teacher review submission failed: ${error.message}`);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

/**
 * Main chapter processing pipeline
 */
async function processChapter(jobId, pdfFile, metadata) {
  try {
    const { chapter_id, grade_band, subject, language, teacher_review } = metadata;
    
    updateJobStatus(jobId, 'processing', 10);

    // Step 1: PDF Ingestion and text extraction
    logger.info(`Step 1: Processing PDF for ${chapter_id}`);
    updateJobStatus(jobId, 'extracting_text', 20);
    
    const pdfProcessingResult = await ingestService.processChapter(pdfFile, chapter_id, metadata);
    
    if (!pdfProcessingResult.success) {
      throw new Error(`PDF processing failed: ${JSON.stringify(pdfProcessingResult.errorReport)}`);
    }
    
    const cleanedMarkdown = pdfProcessingResult.markdown;
    const rawText = pdfProcessingResult.rawText;
    
    // Save chapter data per MIGRATION.md output structure
    await ingestService.saveChapterData(chapter_id, pdfProcessingResult);
    
    updateJobStatus(jobId, 'analyzing_content', 30);

    // Step 2: Concept extraction and semantic analysis
    logger.info(`Step 2: Extracting concepts for ${chapter_id}`);
    const conceptExtractionResult = await semanticService.extractConcepts(cleanedMarkdown, metadata);
    const concepts = conceptExtractionResult.concepts; // Extract concepts array
    const conceptGraph = conceptExtractionResult.graph;
    
    // Save concepts.json per MIGRATION.md output structure
    const conceptsOutput = {
      concepts: concepts,
      graph: conceptGraph
    };
    await saveToOutputStructure(chapter_id, 'concepts.json', conceptsOutput);
    
    updateJobStatus(jobId, 'planning_episodes', 40);

    // Step 3: Episode planning
    logger.info(`Step 3: Planning episodes for ${chapter_id}`);
    
    // Prepare chapter metadata for planner
    const chapterMetadata = {
      ...metadata,
      word_count: pdfProcessingResult.metadata.word_count,
      concept_count: concepts.length
    };
    
    const episodePlan = await plannerService.planEpisodes(concepts, chapterMetadata);
    
    // Save episode_plan.json per MIGRATION.md output structure
    await saveToOutputStructure(chapter_id, 'episode_plan.json', episodePlan);
    
    updateJobStatus(jobId, 'generating_scripts', 50);

    // Step 4: Generate scripts and MCQs for each episode
    logger.info(`Step 4: Generating content for ${episodePlan.episodes.length} episodes`);
    const episodes = [];
    
    for (let i = 0; i < episodePlan.episodes.length; i++) {
      const episodeConfig = episodePlan.episodes[i];
      const progress = 50 + (i / episodePlan.episodes.length) * 30;
      updateJobStatus(jobId, `generating_episode_${i + 1}`, Math.round(progress));

      // Generate script and MCQs via LLM service
      const episodeContent = await generateEpisodeContent(episodeConfig, concepts, cleanedMarkdown, metadata);
      
      // Validate content
      const validationResult = await validationService.validateEpisode(episodeContent, episodeConfig);
      if (!validationResult.isValid) {
        // Auto-repair if needed
        const repairedContent = await validationService.repairEpisode(episodeContent, validationResult.errors);
        episodes.push(repairedContent);
      } else {
        episodes.push(episodeContent);
      }
    }

    updateJobStatus(jobId, 'generating_audio', 80);

    // Step 5: TTS generation
    logger.info(`Step 5: Generating audio for all episodes`);
    for (let i = 0; i < episodes.length; i++) {
      await ttsService.generateEpisodeAudio(episodes[i], chapter_id, i + 1);
      const audioProgress = 80 + (i / episodes.length) * 15;
      updateJobStatus(jobId, 'generating_audio', Math.round(audioProgress));
    }

    updateJobStatus(jobId, 'packaging_results', 95);

    // Step 6: Package and save results
    const results = await packageResults(chapter_id, {
      markdown: cleanedMarkdown,
      concepts,
      episodePlan,
      episodes
    });

    updateJobStatus(jobId, 'completed', 100, null, results);
    logger.info(`Chapter processing completed for ${chapter_id}`, { jobId });

  } catch (error) {
    logger.error(`Chapter processing failed for job ${jobId}`, { error: error.message, stack: error.stack });
    updateJobStatus(jobId, 'failed', null, error.message);
  }
}

/**
 * Generate episode content using LLM service
 */
async function generateEpisodeContent(episodeConfig, concepts, markdown, metadata) {
  const episodeIndex = episodeConfig.ep;
  const logs = [];
  
  try {
    logs.push({ step: `episode_${episodeIndex}_generation`, status: 'started', timestamp: new Date().toISOString() });
    
    // Get episode-specific concepts from episode config
    const episodeConcepts = episodeConfig.concepts || [];
    
    // Generate script using enhanced backend
    const scriptResponse = await fetch(`${process.env.HF_BACKEND_URL || 'http://localhost:8000'}/generate_script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concepts: episodeConcepts,
        episode_title: `${metadata.subject} - Episode ${episodeIndex}`,
        grade: metadata.grade_band || metadata.grade,
        subject: metadata.subject,
        duration_minutes: episodeConfig.target_minutes || 8,
        source_content: markdown.substring(0, 5000) // Context window
      })
    });

    if (!scriptResponse.ok) {
      throw new Error(`Script generation failed: ${scriptResponse.status}`);
    }

    const scriptData = await scriptResponse.json();
    
    console.log('Script data structure:', JSON.stringify(scriptData, null, 2));
    
    // Generate MCQs
    const mcqResponse = await fetch(`${process.env.HF_BACKEND_URL || 'http://localhost:8000'}/generate_mcqs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concepts: episodeConcepts,
        script: scriptData.script,
        count: Math.min(episodeConcepts.length, 5),
        difficulty: parseInt(metadata.grade_band || metadata.grade) >= 10 ? 'medium' : 'easy'
      })
    });

    if (!mcqResponse.ok) {
      throw new Error(`MCQ generation failed: ${mcqResponse.status}`);
    }

    const mcqData = await mcqResponse.json();

    const episodeData = {
      episode_index: episodeIndex,
      title: `${metadata.subject} - Episode ${episodeIndex}`,
      concepts: concepts,
      script: scriptData.script,
      mcqs: mcqData.mcqs,
      duration: 12,
      metadata: {
        generated_at: new Date().toISOString(),
        source_concepts: concepts.map(c => c.id || c.name),
        validation_status: 'pending'
      },
      logs: logs
    };

    // Validate episode
    const validationResult = await validator.validateEpisode(episodeData);
    
    if (!validationResult.isValid) {
      // Attempt auto-repair
      const repairResult = await validator.repairEpisode(episodeData, validationResult.errors);
      if (repairResult.success) {
        episodeData.script = repairResult.repairedEpisode.script;
        episodeData.mcqs = repairResult.repairedEpisode.mcqs;
        episodeData.metadata.validation_status = 'auto_repaired';
        logs.push({ step: 'validation', status: 'auto_repaired', errors_fixed: validationResult.errors.length });
      } else {
        episodeData.metadata.validation_status = 'requires_review';
        episodeData.metadata.validation_errors = validationResult.errors;
        logs.push({ step: 'validation', status: 'requires_review', errors: validationResult.errors.length });
      }
    } else {
      episodeData.metadata.validation_status = 'validated';
      logs.push({ step: 'validation', status: 'passed' });
    }

    // Generate audio if validation passed
    if (episodeData.metadata.validation_status !== 'requires_review') {
      try {
        const audioResult = await ttsOrchestrator.generateEpisodeAudio(episodeData);
        episodeData.audio = audioResult;
        logs.push({ step: 'audio_generation', status: 'completed', audioFile: audioResult.finalAudioPath });
      } catch (audioError) {
        console.error(`Audio generation failed for episode ${episodeIndex}:`, audioError);
        episodeData.metadata.audio_error = audioError.message;
        logs.push({ step: 'audio_generation', status: 'failed', error: audioError.message });
      }
    }

    // Save episode files per MIGRATION.md output structure
    await saveEpisodeFiles(metadata.chapter_id, episodeIndex, episodeData);
    
    logs.push({ step: `episode_${episodeIndex}_generation`, status: 'completed', timestamp: new Date().toISOString() });
    episodeData.logs = logs;
    
    return episodeData;

  } catch (error) {
    console.error(`Episode ${episodeIndex} generation failed:`, error);
    logs.push({ step: `episode_${episodeIndex}_generation`, status: 'failed', error: error.message });
    
    return {
      episode_index: episodeIndex,
      title: `${metadata.subject} - Episode ${episodeIndex}`,
      error: error.message,
      metadata: {
        generated_at: new Date().toISOString(),
        validation_status: 'failed',
        processing_error: error.message
      },
      logs: logs
    };
  }
}

/**
 * Package final results per MIGRATION.md manifest requirements
 */
async function packageResults(chapterId, data) {
  const fs = require('fs');
  const outputDir = path.join(__dirname, 'outputs', `chapter_${chapterId}`);
  
  // Create manifest.json per MIGRATION.md requirements
  const manifest = {
    chapter_id: chapterId,
    generation_version: 'content_pipeline_v1',
    timestamp: new Date().toISOString(),
    status: 'completed',
    processing_summary: {
      total_concepts: data.concepts?.length || 0,
      total_episodes: data.episodes?.length || 0,
      word_count: data.markdown?.length || 0,
      curriculum: 'CBSE'
    },
    files: {
      "chapter.md": "cleaned markdown",
      "concepts.json": "detected concept index + graph", 
      "episode_plan.json": "deterministic plan",
      "episodes/": "episode content with scripts, MCQs, audio",
      "manifest.json": "this file"
    },
    episodes: data.episodes?.map((ep, index) => ({
      episode_index: index + 1,
      title: ep.title || `Episode ${index + 1}`,
      status: ep.error ? 'failed' : 'completed',
      validation_status: ep.metadata?.validation_status || 'unknown',
      audio_generated: !ep.error && !ep.metadata?.audio_error
    })) || []
  };

  // Save manifest.json
  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  logger.info(`Generated manifest for chapter ${chapterId} with ${data.episodes?.length || 0} episodes`);

  return {
    manifest_url: `/outputs/chapter_${chapterId}/manifest.json`,
    chapter_url: `/outputs/chapter_${chapterId}/chapter.md`,
    episodes_count: data.episodes?.length || 0,
    teacher_review_url: `/teacher/review.html?chapter=${chapterId}`,
    status: 'completed'
  };
}

/**
 * Regenerate specific episode based on teacher feedback
 */
async function regenerateEpisode(jobId, chapterId, episodeIndex, seed, reason) {
  try {
    logger.info(`Starting episode regeneration for ${chapterId} episode ${episodeIndex}`);
    updateJobStatus(jobId, 'regenerating', 10);

    // Load existing episode data
    const episodeDir = path.join(__dirname, 'outputs', `chapter_${chapterId}`, 'episodes', `ep${episodeIndex.toString().padStart(2, '0')}`);
    const scriptPath = path.join(episodeDir, 'script.json');
    const mcqsPath = path.join(episodeDir, 'mcqs.json');

    let existingScript = null;
    let existingMCQs = null;

    if (fs.existsSync(scriptPath)) {
      existingScript = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    }
    if (fs.existsSync(mcqsPath)) {
      existingMCQs = JSON.parse(fs.readFileSync(mcqsPath, 'utf8'));
    }

    updateJobStatus(jobId, 'analyzing_feedback', 30);

    // Determine regeneration type based on reason
    let regenerationType = 'regen_tone_fix'; // default
    if (reason && reason.toLowerCase().includes('short')) {
      regenerationType = 'regen_short_script';
    } else if (reason && reason.toLowerCase().includes('long')) {
      regenerationType = 'regen_long_script';
    } else if (reason && reason.toLowerCase().includes('mcq')) {
      regenerationType = 'regen_mcq_sync';
    }

    updateJobStatus(jobId, 'regenerating_content', 50);

    // Call regeneration service
    const regenerationData = {
      prompt_type: regenerationType,
      input_data: {
        current_script: existingScript,
        current_mcqs: existingMCQs,
        feedback: reason,
        seed: seed || generateSeed(chapterId)
      },
      temperature: 0.0
    };

    // Regenerate via LLM service
    const response = await axios.post(`${process.env.LLM_SERVICE_URL || 'http://127.0.0.1:8000'}/regenerate`, regenerationData);

    if (response.data.error) {
      throw new Error(`Regeneration failed: ${response.data.error}`);
    }

    updateJobStatus(jobId, 'saving_results', 80);

    // Save regenerated content
    if (response.data.script_text) {
      fs.writeFileSync(scriptPath, JSON.stringify(response.data, null, 2));
    }
    if (response.data.mcqs) {
      fs.writeFileSync(mcqsPath, JSON.stringify({ mcqs: response.data.mcqs }, null, 2));
    }

    // Regenerate audio if script changed
    if (response.data.script_text) {
      updateJobStatus(jobId, 'regenerating_audio', 90);
      await ttsService.generateEpisodeAudio(response.data, chapterId, episodeIndex);
    }

    updateJobStatus(jobId, 'completed', 100, null, {
      episode_regenerated: episodeIndex,
      changes: response.data.change_log || 'Content regenerated based on feedback'
    });

    logger.info(`Episode regeneration completed for ${chapterId} episode ${episodeIndex}`);

  } catch (error) {
    logger.error(`Episode regeneration failed: ${error.message}`);
    updateJobStatus(jobId, 'failed', null, error.message);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'journey-creation-school-pipeline',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  logger.error('Unhandled error', { error: error.message, stack: error.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// Create logs directory
const fs = require('fs');
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
}

app.listen(PORT, () => {
  logger.info(`Journey Creation School Pipeline server running on port ${PORT}`);
});

module.exports = app;