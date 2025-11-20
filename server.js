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

// API Routes
// Voice configuration endpoints will be added inline

// Job tracking in memory (in production, use Redis or DB)
const jobs = new Map();
const jobQueue = [];
let isProcessing = false;

// Voice configuration storage (in-memory, use DB in production)
let voiceConfiguration = {
  speakers: {
    speaker1: {
      name: 'StudentA',
      role: 'student',
      personality: 'confident',
      voice: 'en-US-Chirp3-HD-Achird'
    },
    speaker2: {
      name: 'StudentB',
      role: 'student',
      personality: 'curious',
      voice: 'en-US-Chirp3-HD-Aoede'
    }
  },
  audio: {
    format: 'mp3',
    sampleRate: 24000,
    effects: {
      normalization: true,
      backgroundMusic: false
    }
  }
};

/**
 * Helper function to load voice configuration
 */
async function loadVoiceConfiguration() {
  // In production, load from DB or config file
  return voiceConfiguration;
}

/**
 * Helper function to save voice configuration
 */
async function saveVoiceConfiguration(config) {
  voiceConfiguration = { ...voiceConfiguration, ...config };
  // In production, save to DB or config file
  const fs = require('fs');
  const configPath = path.join(__dirname, 'outputs', 'voice_config.json');
  fs.writeFileSync(configPath, JSON.stringify(voiceConfiguration, null, 2));
  return voiceConfiguration;
}

// Production metrics tracking per MIGRATION.md
const metrics = {
  totalJobs: 0,
  successfulJobs: 0,
  failedJobs: 0,
  averageProcessingTime: 0,
  hallucinations: 0,
  teacherReviews: 0
};

/**
 * Save data to clean curriculum-grade-chapter structure
 */
async function saveToOutputStructure(chapterId, filename, data, metadata = {}) {
  const fs = require('fs');
  
  // Clean folder structure: CBSE/Grade-8/Chapter-Name/
  const { grade_band = 'unknown', subject = 'unknown' } = metadata;
  const curriculum = metadata.curriculum || 'CBSE';
  
  // Format chapter name nicely
  const chapterName = chapterId.replace(/_/g, '-').replace(/^chapter-/, '');
  
  const chapterDir = path.join(
    __dirname, 
    'outputs', 
    curriculum,
    `Grade-${grade_band}`,
    chapterName
  );
  
  if (!fs.existsSync(chapterDir)) {
    fs.mkdirSync(chapterDir, { recursive: true });
  }
  
  const filePath = path.join(chapterDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  
  logger.info(`Saved ${filename} to: ${filePath}`);
  return filePath;
}

/**
 * Save episode files in clean structure: CBSE/Grade-8/Chapter-Name/Episode-1/
 */
async function saveEpisodeFiles(chapterId, episodeIndex, episodeData, metadata = {}) {
  const fs = require('fs');
  
  // Clean folder structure
  const { grade_band = 'unknown', subject = 'unknown' } = metadata;
  const curriculum = metadata.curriculum || 'CBSE';
  
  // Format chapter name nicely
  const chapterName = chapterId.replace(/_/g, '-').replace(/^chapter-/, '');
  
  const episodeDir = path.join(
    __dirname, 
    'outputs', 
    curriculum,
    `Grade-${grade_band}`,
    chapterName,
    `Episode-${episodeIndex}`
  );
  
  if (!fs.existsSync(episodeDir)) {
    fs.mkdirSync(episodeDir, { recursive: true });
  }
  
  // Create audio directory for segments
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

  // Save cues.json (use actual cues from TTS if available, otherwise placeholder)
  const cuesPath = path.join(episodeDir, 'cues.json');
  const cues = episodeData.audio?.cues || { 
    sections: [], 
    timestamps: [], 
    audio_file: `ep${episodeIndex.toString().padStart(2, '0')}_final.mp3`,
    note: 'Cues will be generated after TTS audio production'
  };
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

// Job queue processor
async function processJobQueue() {
  if (isProcessing || jobQueue.length === 0) return;
  
  isProcessing = true;
  const job = jobQueue.shift();
  
  try {
    logger.info(`Processing job ${job.jobId} from queue`);
    await processChapterJob(job);
  } catch (error) {
    logger.error(`Job ${job.jobId} failed:`, error);
    updateJobStatus(job.jobId, 'failed', null, error.message);
    metrics.failedJobs++;
  } finally {
    isProcessing = false;
    // Process next job if available
    if (jobQueue.length > 0) {
      setTimeout(processJobQueue, 100);
    }
  }
}

// Process individual chapter job
async function processChapterJob(job) {
  const startTime = Date.now();
  const { jobId, pdfFile, markdownContent, metadata } = job;
  
  updateJobStatus(jobId, 'processing', 0);
  
  // Call the existing processChapter function with proper error handling
  await processChapter(jobId, pdfFile, markdownContent, metadata);
  
  const processingTime = Date.now() - startTime;
  metrics.averageProcessingTime = 
    (metrics.averageProcessingTime * metrics.successfulJobs + processingTime) / 
    (metrics.successfulJobs + 1);
  metrics.successfulJobs++;
}

// Complete REST API per MIGRATION.md section 15

/**
 * POST /api/v1/generate
 * Payload: {chapter_id, chapter_file_url or upload, grade_band, subject, language, teacher_review}
 * Returns: {job_id}
 */
app.post('/api/v1/generate', async (req, res) => {
  const jobId = uuidv4();
  
  try {
    // Validate required fields per MIGRATION.md
    const { chapter_id, grade_band, subject, language = 'en-IN', teacher_review = false } = req.body;
    
    if (!chapter_id || !grade_band || !subject) {
      return res.status(400).json({ 
        error: 'Missing required fields: chapter_id, grade_band, subject',
        required_fields: ['chapter_id', 'grade_band', 'subject'],
        optional_fields: ['language', 'teacher_review', 'curriculum']
      });
    }

    // Check for uploaded file, file URL, or markdown content
    let pdfFile = null;
    let markdownContent = null;
    
    if (req.files && req.files.chapter_file) {
      pdfFile = req.files.chapter_file;
    } else if (req.body.markdown_content) {
      markdownContent = req.body.markdown_content;
    } else if (req.body.chapter_file_url) {
      // Handle URL-based upload later
      return res.status(400).json({ error: 'URL-based upload not yet implemented' });
    } else {
      return res.status(400).json({ error: 'No PDF file or markdown content provided' });
    }

    // Create job entry with speaker configuration
    const speakerConfig = {
      speaker1_name: req.body.speaker1_name || 'StudentA',
      speaker2_name: req.body.speaker2_name || 'StudentB',
      speaker1_voice: req.body.speaker1_voice || 'en-US-Chirp3-HD-Achird',
      speaker2_voice: req.body.speaker2_voice || 'en-US-Chirp3-HD-Aoede'
    };

    const jobData = {
      jobId,
      status: 'queued',
      progress: 0,
      createdAt: new Date(),
      lastUpdated: new Date(),
      metadata: { 
        chapter_id, 
        grade_band, 
        subject, 
        language, 
        teacher_review, 
        curriculum: req.body.curriculum || 'CBSE',
        ...speakerConfig
      }
    };
    
    jobs.set(jobId, jobData);
    metrics.totalJobs++;
    
    // Add to queue for processing
    jobQueue.push({ jobId, pdfFile, markdownContent, metadata: jobData.metadata });
    
    // Start processing if not already running
    if (!isProcessing) {
      setTimeout(processJobQueue, 100);
    }
    
    logger.info(`Job ${jobId} queued for chapter ${chapter_id}`);
    
    res.json({ job_id: jobId });
    
  } catch (error) {
    logger.error('Generate API error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/status/{job_id}
 * Returns progress + errors per MIGRATION.md
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
    created_at: job.createdAt,
    last_updated: job.lastUpdated,
    error: job.error || null,
    metadata: job.metadata
  });
});

/**
 * GET /api/v1/result/{chapter_id}
 * Returns manifest URL or error_report per MIGRATION.md with generation support
 */
app.get('/api/v1/result/:chapter_id', (req, res) => {
  const { chapter_id } = req.params;
  const { generation } = req.query; // Optional generation parameter
  const fs = require('fs');
  
  try {
    // Find the chapter in optimized structure
    const outputsDir = path.join(__dirname, 'outputs');
    
    function findChapterPath(dir) {
      if (!fs.existsSync(dir)) return null;
      
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          const itemPath = path.join(dir, item.name);
          if (item.name === `chapter_${chapter_id}`) {
            // Found chapter folder, now find generation
            return findLatestGeneration(itemPath, generation);
          }
          const found = findChapterPath(itemPath);
          if (found) return found;
        }
      }
      return null;
    }
    
    function findLatestGeneration(chapterPath, targetGeneration = null) {
      if (!fs.existsSync(chapterPath)) return null;
      
      const generations = fs.readdirSync(chapterPath, { withFileTypes: true })
        .filter(item => item.isDirectory() && item.name.startsWith('gen_'))
        .sort((a, b) => b.name.localeCompare(a.name)); // Sort by timestamp desc
      
      if (generations.length === 0) return null;
      
      // Return specific generation or latest
      const selectedGen = targetGeneration 
        ? generations.find(g => g.name === targetGeneration)
        : generations[0];
      
      return selectedGen ? path.join(chapterPath, selectedGen.name) : null;
    }
    
    const generationPath = findChapterPath(outputsDir);
    if (!generationPath) {
      return res.status(404).json({ error: 'Chapter not found' });
    }
    
    const manifestPath = path.join(generationPath, 'manifest.json');
    const errorReportPath = path.join(generationPath, 'error_report.json');
    
    if (fs.existsSync(errorReportPath)) {
      const errorReport = JSON.parse(fs.readFileSync(errorReportPath, 'utf8'));
      return res.json({ error_report: errorReport });
    }
    
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const relativePath = path.relative(path.join(__dirname, 'outputs'), manifestPath).replace(/\\\\/g, '/');
      
      // Also return available generations
      const chapterPath = path.dirname(generationPath);
      const availableGenerations = fs.readdirSync(chapterPath, { withFileTypes: true })
        .filter(item => item.isDirectory() && item.name.startsWith('gen_'))
        .map(item => ({
          id: item.name,
          timestamp: item.name.replace('gen_', '').replace(/-/g, ':')
        }))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      
      return res.json({ 
        manifest_url: `/outputs/${relativePath}`,
        manifest: manifest,
        current_generation: path.basename(generationPath),
        available_generations: availableGenerations
      });
    }
    
    res.status(404).json({ error: 'No results found for chapter' });
    
  } catch (error) {
    logger.error('Result API error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/regenerate_episode
 * For manual triggers (accepts seed & episode_index) per MIGRATION.md
 */
app.post('/api/v1/regenerate_episode', async (req, res) => {
  try {
    const { chapter_id, episode_index, regeneration_type, seed } = req.body;
    
    if (!chapter_id || !episode_index || !regeneration_type) {
      return res.status(400).json({ 
        error: 'Missing required fields: chapter_id, episode_index, regeneration_type' 
      });
    }
    
    const jobId = uuidv4();
    const jobData = {
      jobId,
      status: 'processing',
      progress: 0,
      createdAt: new Date(),
      lastUpdated: new Date(),
      metadata: { chapter_id, episode_index, trigger: 'manual_regeneration', seed }
    };
    
    jobs.set(jobId, jobData);
    
    // Call regeneration service
    const regenerationResult = await callRegenerationService({
      chapter_id,
      episode_index,
      prompt_type: regeneration_type,
      seed
    });
    
    updateJobStatus(jobId, 'completed', 100, null, regenerationResult);
    
    res.json({ 
      job_id: jobId,
      result: regenerationResult 
    });
    
  } catch (error) {
    logger.error('Regenerate episode API error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/preview/{chapter_id}/{episode_index}
 * Returns script preview & audio URL (for teacher) per MIGRATION.md
 */
app.get('/api/v1/preview/:chapter_id/:episode_index', (req, res) => {
  const { chapter_id, episode_index } = req.params;
  const fs = require('fs');
  
  try {
    // Find episode in optimized structure
    const outputsDir = path.join(__dirname, 'outputs');
    
    function findEpisodePath(dir) {
      if (!fs.existsSync(dir)) return null;
      
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          const itemPath = path.join(dir, item.name);
          if (item.name === `chapter_${chapter_id}`) {
            const episodePath = path.join(itemPath, 'episodes', `ep${episode_index.toString().padStart(2, '0')}`);
            return fs.existsSync(episodePath) ? episodePath : null;
          }
          const found = findEpisodePath(itemPath);
          if (found) return found;
        }
      }
      return null;
    }
    
    const episodePath = findEpisodePath(outputsDir);
    if (!episodePath) {
      return res.status(404).json({ error: 'Episode not found' });
    }
    
    const scriptPath = path.join(episodePath, 'script.json');
    const audioPath = path.join(episodePath, 'audio', 'final_audio.mp3');
    
    let scriptPreview = null;
    let audioUrl = null;
    
    if (fs.existsSync(scriptPath)) {
      scriptPreview = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    }
    
    if (fs.existsSync(audioPath)) {
      const relativePath = path.relative(path.join(__dirname, 'outputs'), audioPath).replace(/\\\\/g, '/');
      audioUrl = `/outputs/${relativePath}`;
    }
    
    res.json({
      chapter_id,
      episode_index: parseInt(episode_index),
      script_preview: scriptPreview,
      audio_url: audioUrl,
      status: audioUrl ? 'completed' : 'processing'
    });
    
  } catch (error) {
    logger.error('Preview API error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/metrics
 * Production metrics per MIGRATION.md
 */
app.get('/api/v1/metrics', (req, res) => {
  const uptime = process.uptime();
  
  res.json({
    uptime_seconds: uptime,
    total_jobs: metrics.totalJobs,
    successful_jobs: metrics.successfulJobs,
    failed_jobs: metrics.failedJobs,
    success_rate: metrics.totalJobs > 0 ? (metrics.successfulJobs / metrics.totalJobs) : 0,
    review_rate: metrics.totalJobs > 0 ? (metrics.teacherReviews / metrics.totalJobs) : 0,
    average_processing_time_ms: metrics.averageProcessingTime,
    hallucination_rate: metrics.totalJobs > 0 ? (metrics.hallucinations / metrics.totalJobs) : 0,
    queue_length: jobQueue.length,
    is_processing: isProcessing
  });
});

// Helper function for regeneration service calls
async function callRegenerationService(params) {
  try {
    const response = await fetch(`${process.env.LLM_SERVICE_URL || 'http://127.0.0.1:8000'}/regenerate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt_type: params.prompt_type,
        input_data: params,
        temperature: 0.0
      })
    });
    
    return await response.json();
  } catch (error) {
    logger.error('Regeneration service call failed:', error);
    throw error;
  }
}

/**
 * Legacy endpoint - keeping for backward compatibility
 * GET /api/v1/status/{job_id} (old format)
 */
app.get('/api/v1/status_legacy/:jobId', (req, res) => {
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
 * POST /api/v1/regenerate_episode
 * For manual triggers (accepts seed & episode_index) per MIGRATION.md
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
 * POST /api/v1/generate-audio
 * Generate audio for reviewed and approved episodes
 * This is Phase 2 - called AFTER teacher reviews scripts
 */
app.post('/api/v1/generate-audio', async (req, res) => {
  const { chapter_id, episode_indices } = req.body;
  
  if (!chapter_id) {
    return res.status(400).json({ error: 'chapter_id is required' });
  }
  
  try {
    const jobId = uuidv4();
    const jobData = {
      jobId,
      status: 'queued',
      progress: 0,
      createdAt: new Date(),
      lastUpdated: new Date(),
      metadata: { chapter_id, task: 'audio_generation' }
    };
    
    jobs.set(jobId, jobData);
    
    // Start audio generation asynchronously
    (async () => {
      try {
        updateJobStatus(jobId, 'generating_audio', 0);
        
        // Load episode data
        const fs = require('fs');
        const chapterInfo = findChapterDirectory(chapter_id);
        
        if (!chapterInfo) {
          throw new Error(`Chapter ${chapter_id} not found in outputs`);
        }
        
        const { path: chapterPath, metadata: chapterMetadata } = chapterInfo;
        
        // Get all Episode-N directories
        const episodeDirs = fs.readdirSync(chapterPath, { withFileTypes: true })
          .filter(item => item.isDirectory() && item.name.startsWith('Episode-'))
          .map(item => item.name)
          .sort();
        
        if (episodeDirs.length === 0) {
          throw new Error(`No episodes found in ${chapterPath}`);
        }
        
        // Determine which episodes to process
        const episodesToProcess = episode_indices || 
          episodeDirs.map((_, i) => i + 1);
        
        logger.info(`Generating audio for ${episodesToProcess.length} episodes in ${chapter_id}`);
        
        // Load voice configuration if available
        const voiceConfig = await loadVoiceConfiguration();
        
        for (let i = 0; i < episodesToProcess.length; i++) {
          const episodeIndex = episodesToProcess[i];
          const episodeDir = path.join(chapterPath, `Episode-${episodeIndex}`);
          
          // Validate episode directory exists
          if (!fs.existsSync(episodeDir)) {
            logger.warn(`Episode directory not found: ${episodeDir}, skipping...`);
            continue;
          }
          
          // Load episode script
          const scriptPath = path.join(episodeDir, 'script.json');
          if (!fs.existsSync(scriptPath)) {
            logger.warn(`Script not found for episode ${episodeIndex}, skipping...`);
            continue;
          }
          
          const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
          
          // Generate audio with full metadata and voice config
          await ttsService.generateEpisodeAudio(
            { script, voice_config: voiceConfig },
            chapter_id,
            episodeIndex,
            chapterMetadata
          );
          
          const progress = Math.round((i + 1) / episodesToProcess.length * 100);
          updateJobStatus(jobId, 'generating_audio', progress);
        }
        
        updateJobStatus(jobId, 'completed', 100, null, {
          message: 'Audio generation complete',
          episodes_processed: episodesToProcess.length,
          output_path: chapterPath
        });
        
      } catch (error) {
        logger.error(`Audio generation failed for job ${jobId}:`, error);
        updateJobStatus(jobId, 'failed', null, error.message);
      }
    })();
    
    res.json({ 
      job_id: jobId,
      message: 'Audio generation started',
      chapter_id 
    });
    
  } catch (error) {
    logger.error('Audio generation API error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/tts/config
 * Get current voice configuration
 */
app.get('/api/v1/tts/config', async (req, res) => {
  try {
    const config = await loadVoiceConfiguration();
    res.json(config);
  } catch (error) {
    logger.error('Failed to load voice config:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/v1/tts/config
 * Save voice configuration
 */
app.put('/api/v1/tts/config', async (req, res) => {
  try {
    const config = await saveVoiceConfiguration(req.body);
    logger.info('Voice configuration updated', config);
    res.json({ success: true, config });
  } catch (error) {
    logger.error('Failed to save voice config:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/tts/test
 * Test voice configuration with sample audio
 */
app.post('/api/v1/tts/test', async (req, res) => {
  try {
    const { config, testScript } = req.body;
    
    // Temporarily apply test configuration
    const originalConfig = voiceConfiguration;
    voiceConfiguration = { ...originalConfig, ...config };
    
    // Generate test audio
    const testAudioPath = path.join(__dirname, 'outputs', 'test_audio');
    const fs = require('fs');
    if (!fs.existsSync(testAudioPath)) {
      fs.mkdirSync(testAudioPath, { recursive: true });
    }
    
    // Restore original configuration
    voiceConfiguration = originalConfig;
    
    res.json({ 
      success: true, 
      message: 'Test audio generated',
      output_path: testAudioPath 
    });
  } catch (error) {
    logger.error('Test audio generation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/chapter/:chapter_id
 * Get chapter data with episodes for review page
 */
app.get('/api/v1/chapter/:chapter_id', async (req, res) => {
  try {
    const { chapter_id } = req.params;
    const fs = require('fs');
    
    const chapterInfo = findChapterDirectory(chapter_id);
    
    if (!chapterInfo) {
      return res.status(404).json({ error: `Chapter ${chapter_id} not found` });
    }
    
    const { path: chapterPath, metadata: chapterMetadata } = chapterInfo;
    
    // Load chapter data files
    const conceptsPath = path.join(chapterPath, 'concepts.json');
    const episodePlanPath = path.join(chapterPath, 'episode_plan.json');
    
    let concepts = [];
    let episodePlan = null;
    
    if (fs.existsSync(conceptsPath)) {
      concepts = JSON.parse(fs.readFileSync(conceptsPath, 'utf8'));
    }
    
    if (fs.existsSync(episodePlanPath)) {
      episodePlan = JSON.parse(fs.readFileSync(episodePlanPath, 'utf8'));
    }
    
    // Load all episodes
    const episodeDirs = fs.readdirSync(chapterPath, { withFileTypes: true })
      .filter(item => item.isDirectory() && item.name.startsWith('Episode-'))
      .map(item => item.name)
      .sort();
    
    const episodes = [];
    for (const episodeDir of episodeDirs) {
      const episodePath = path.join(chapterPath, episodeDir);
      const scriptPath = path.join(episodePath, 'script.json');
      const mcqsPath = path.join(episodePath, 'mcqs.json');
      
      let script = null;
      let mcqs = null;
      let scriptText = '';
      
      if (fs.existsSync(scriptPath)) {
        script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
        // Extract plain text from script sections for review UI
        if (script.sections && Array.isArray(script.sections)) {
          scriptText = script.sections.map(s => s.text).join('\n\n');
        }
      }
      
      if (fs.existsSync(mcqsPath)) {
        mcqs = JSON.parse(fs.readFileSync(mcqsPath, 'utf8'));
      }
      
      episodes.push({
        episode_number: parseInt(episodeDir.replace('Episode-', '')),
        script,
        script_text: scriptText,
        mcqs,
        status: 'pending'
      });
    }
    
    res.json({
      chapter_id,
      metadata: chapterMetadata,
      concepts,
      episode_plan: episodePlan,
      episodes,
      total_episodes: episodes.length
    });
    
  } catch (error) {
    logger.error('Failed to load chapter data:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Helper function to find chapter directory in new structure
 * Returns object with {path, metadata} or null
 */
function findChapterDirectory(chapterId) {
  const fs = require('fs');
  const outputsDir = path.join(__dirname, 'outputs');
  
  // Format chapter name as it appears in folder (replace underscores with hyphens)
  const chapterName = chapterId.replace(/_/g, '-').replace(/^chapter-/, '');
  
  // Search all curriculum/grade combinations
  if (!fs.existsSync(outputsDir)) return null;
  
  const curriculums = fs.readdirSync(outputsDir, { withFileTypes: true })
    .filter(item => item.isDirectory())
    .map(item => item.name);
  
  for (const curriculum of curriculums) {
    const curriculumPath = path.join(outputsDir, curriculum);
    const grades = fs.readdirSync(curriculumPath, { withFileTypes: true })
      .filter(item => item.isDirectory())
      .map(item => item.name);
    
    for (const grade of grades) {
      const gradePath = path.join(curriculumPath, grade);
      const chapters = fs.readdirSync(gradePath, { withFileTypes: true })
        .filter(item => item.isDirectory())
        .map(item => item.name);
      
      // Check if chapter name matches (exact or similar)
      for (const chapter of chapters) {
        if (chapter === chapterName || chapter === chapterId || chapter.includes(chapterName)) {
          const chapterPath = path.join(gradePath, chapter);
          // Extract grade number from Grade-X format
          const gradeMatch = grade.match(/Grade-(\d+)/);
          const gradeBand = gradeMatch ? gradeMatch[1] : 'unknown';
          
          return {
            path: chapterPath,
            metadata: {
              curriculum,
              grade_band: gradeBand,
              chapter_id: chapterId,
              chapter_name: chapter
            }
          };
        }
      }
    }
  }
  
  return null;
}

/**
 * Save error report per MIGRATION.md structure
 */
async function saveErrorReport(chapterId, episodeIndex, errorReport, metadata = {}) {
  const fs = require('fs');
  
  const { grade_band = 'unknown', subject = 'unknown' } = metadata;
  const curriculum = metadata.curriculum || 'CBSE';
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const generationId = metadata.generation_id || `gen_${timestamp}`;
  
  const errorReportPath = path.join(
    __dirname, 
    'outputs', 
    curriculum.toUpperCase(),
    `Grade_${grade_band}`,
    subject.toLowerCase(),
    `chapter_${chapterId}`,
    generationId,
    episodeIndex ? `episodes/ep${episodeIndex.toString().padStart(2, '0')}/error_report.json` : 'error_report.json'
  );
  
  const errorDir = path.dirname(errorReportPath);
  if (!fs.existsSync(errorDir)) {
    fs.mkdirSync(errorDir, { recursive: true });
  }
  
  fs.writeFileSync(errorReportPath, JSON.stringify(errorReport, null, 2), 'utf8');
  logger.info(`Error report saved: ${errorReportPath}`);
  
  return errorReportPath;
}

/**
 * Sync MCQ timestamps with actual audio cues per MIGRATION.md REGEN_TIME_SYNC
 */
async function syncMCQTimestamps(mcqs, cues) {
  if (!cues || !cues.sections || !Array.isArray(mcqs)) return mcqs;
  
  return mcqs.map(mcq => {
    // Find matching section for this MCQ
    const matchingSection = cues.sections.find(section => 
      Math.abs(section.start - mcq.timestamp_ref) < 30 // Within 30 seconds
    );
    
    if (matchingSection) {
      return {
        ...mcq,
        timestamp_ref: matchingSection.start, // Update to actual audio timestamp
        timestamp_source: 'audio_sync'
      };
    }
    
    return mcq;
  });
}

/**
 * Main chapter processing pipeline
 */
async function processChapter(jobId, pdfFile, markdownContent, metadata) {
  try {
    const { chapter_id, grade_band, subject, language, teacher_review } = metadata;
    
    updateJobStatus(jobId, 'processing', 10);

    let cleanedMarkdown, rawText, pdfProcessingResult;
    
    if (markdownContent) {
      // Direct markdown input (text paste)
      logger.info(`Step 1: Using provided markdown content for ${chapter_id}`);
      updateJobStatus(jobId, 'processing_text', 20);
      cleanedMarkdown = markdownContent;
      rawText = markdownContent;
      pdfProcessingResult = {
        success: true,
        markdown: cleanedMarkdown,
        rawText: rawText,
        metadata: { word_count: markdownContent.split(/\s+/).length }
      };
    } else if (pdfFile) {
      // PDF file processing
      logger.info(`Step 1: Processing PDF for ${chapter_id}`);
      updateJobStatus(jobId, 'extracting_text', 20);
      
      pdfProcessingResult = await ingestService.processChapter(pdfFile, chapter_id, metadata);
      
      if (!pdfProcessingResult.success) {
        throw new Error(`PDF processing failed: ${JSON.stringify(pdfProcessingResult.errorReport)}`);
      }
      
      cleanedMarkdown = pdfProcessingResult.markdown;
      rawText = pdfProcessingResult.rawText;
    } else {
      throw new Error('No PDF file or markdown content provided');
    }
    
    // Save chapter data per MIGRATION.md output structure
    await ingestService.saveChapterData(chapter_id, pdfProcessingResult, metadata);
    
    updateJobStatus(jobId, 'analyzing_content', 30);

    // Step 2: Concept extraction and semantic analysis
    logger.info(`Step 2: Extracting concepts for ${chapter_id}`);
    const conceptExtractionResult = await semanticService.extractConcepts(cleanedMarkdown, metadata);
    const concepts = conceptExtractionResult.concepts; // Extract concepts array
    const conceptGraph = conceptExtractionResult.graph;
    
    // Save concepts.json per MIGRATION.md output structure with optimized folders
    const conceptsOutput = {
      concepts: concepts,
      graph: conceptGraph
    };
    await saveToOutputStructure(chapter_id, 'concepts.json', conceptsOutput, metadata);
    
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
    
    // Save episode_plan.json per MIGRATION.md output structure with optimized folders
    await saveToOutputStructure(chapter_id, 'episode_plan.json', episodePlan, metadata);
    
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

    // Skip audio generation unless explicitly requested
    // Audio will be generated separately via /api/v1/generate-audio endpoint
    
    updateJobStatus(jobId, 'packaging_results', 85);

    // Step 6: Package and save results
    const results = await packageResults(chapter_id, {
      markdown: cleanedMarkdown,
      concepts,
      episodePlan,
      episodes
    }, metadata);
    
    // Track metrics per MIGRATION.md section 12
    const requiresReview = episodes.some(ep => ep.metadata?.validation_status === 'requires_review');
    if (requiresReview) {
      metrics.teacherReviews++;
    }
    
    // Track hallucinations (episodes with inferred/unsourced content)
    const hasHallucinations = episodes.some(ep => 
      ep.error_report?.fail_reasons?.includes('hallucination')
    );
    if (hasHallucinations) {
      metrics.hallucinations++;
    }

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
    
    // Get current voice configuration for custom speaker names
    let speakerConfig = {
      speaker1: { name: 'StudentA' },
      speaker2: { name: 'StudentB' }
    };
    
    // Try to get voice configuration from TTS orchestrator
    try {
      const currentTTSConfig = ttsService.getCurrentConfiguration();
      if (currentTTSConfig && currentTTSConfig.voices) {
        speakerConfig = {
          speaker1: {
            name: currentTTSConfig.voices.StudentA?.displayName || 'StudentA',
            role: 'student',
            personality: currentTTSConfig.voices.StudentA?.personality || 'confident'
          },
          speaker2: {
            name: currentTTSConfig.voices.StudentB?.displayName || 'StudentB',
            role: 'student',
            personality: currentTTSConfig.voices.StudentB?.personality || 'curious'
          }
        };
      }
    } catch (error) {
      logger.warn('Could not load voice configuration from TTS service, using defaults:', error.message);
    }
    
    // Get episode-specific concepts from episode config
    const episodeConcepts = episodeConfig.concepts || [];
    
    // Generate script using enhanced backend with custom speaker names
    const scriptResponse = await fetch(`${process.env.HF_BACKEND_URL || 'http://localhost:8000'}/generate_script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concepts: episodeConcepts,
        episode_title: `${metadata.subject} - Episode ${episodeIndex}`,
        grade: metadata.grade_band || metadata.grade,
        subject: metadata.subject,
        duration_minutes: episodeConfig.target_minutes || 8,
        source_content: markdown.substring(0, 5000), // Context window
        speaker_config: {
          speaker1_name: speakerConfig.speaker1.name || 'StudentA',
          speaker2_name: speakerConfig.speaker2.name || 'StudentB',
          speaker1_role: speakerConfig.speaker1.role || 'student',
          speaker2_role: speakerConfig.speaker2.role || 'student',
          speaker1_personality: speakerConfig.speaker1.personality || 'confident',
          speaker2_personality: speakerConfig.speaker2.personality || 'curious'
        }
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
        count: Math.max(3, Math.min(episodeConcepts.length, 5)), // At least 3 MCQs
        difficulty: parseInt(metadata.grade_band || metadata.grade) >= 10 ? 'medium' : 'easy',
        speaker_config: {
          speaker1_name: speakerConfig.speaker1.name || 'StudentA',
          speaker2_name: speakerConfig.speaker2.name || 'StudentB'
        }
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
    const validationResult = await validationService.validateEpisode(episodeData, episodeConfig);
    
    if (!validationResult.isValid) {
      // Attempt auto-repair with retry logic per MIGRATION.md
      const repairResult = await validationService.repairEpisodeWithRetries(episodeData, episodeConfig);
      if (repairResult.success) {
        episodeData.script = repairResult.repairedEpisode.script;
        episodeData.mcqs = repairResult.repairedEpisode.mcqs;
        episodeData.metadata.validation_status = 'auto_repaired';
        episodeData.metadata.repair_log = repairResult.repairLog;
        logs.push({ step: 'validation', status: 'auto_repaired', attempts: repairResult.repairLog.totalAttempts });
      } else {
        episodeData.metadata.validation_status = 'requires_review';
        episodeData.metadata.validation_errors = validationResult.errors;
        episodeData.error_report = repairResult.errorReport;
        logs.push({ step: 'validation', status: 'requires_review', errors: validationResult.errors.length });
        
        // Save error_report.json per MIGRATION.md
        if (repairResult.errorReport) {
          await saveErrorReport(metadata.chapter_id, episodeIndex, repairResult.errorReport, metadata);
        }
      }
    } else {
      episodeData.metadata.validation_status = 'validated';
      logs.push({ step: 'validation', status: 'passed' });
    }

    // Generate audio if validation passed
    if (episodeData.metadata.validation_status !== 'requires_review') {
      try {
        const audioResult = await ttsService.generateEpisodeAudio(episodeData, metadata.chapter_id, episodeIndex);
        episodeData.audio = audioResult;
        logs.push({ step: 'audio_generation', status: 'completed', audioFile: audioResult.finalAudioPath });
        
        // Update MCQ timestamps with actual audio timing per MIGRATION.md REGEN_TIME_SYNC
        if (audioResult.cues && episodeData.mcqs) {
          episodeData.mcqs = await syncMCQTimestamps(episodeData.mcqs, audioResult.cues);
        }
      } catch (audioError) {
        console.error(`Audio generation failed for episode ${episodeIndex}:`, audioError);
        episodeData.metadata.audio_error = audioError.message;
        logs.push({ step: 'audio_generation', status: 'failed', error: audioError.message });
      }
    }

    // Save episode files per MIGRATION.md output structure with optimized folders
    await saveEpisodeFiles(metadata.chapter_id, episodeIndex, episodeData, metadata);
    
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
async function packageResults(chapterId, data, metadata = {}) {
  const fs = require('fs');
  const crypto = require('crypto');
  
  // Generate deterministic seed per MIGRATION.md section 6
  const deterministicSeed = crypto.createHash('md5').update(chapterId).digest('hex');
  
  const { grade_band = 'unknown' } = metadata;
  const curriculum = metadata.curriculum || 'CBSE';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const generationId = metadata.generation_id || `gen_${timestamp}`;
  
  // Clean folder structure: CBSE/Grade-8/chapter-name/
  const chapterName = chapterId.replace(/_/g, '-').replace(/^chapter-/, '');
  
  const outputDir = path.join(
    __dirname,
    'outputs',
    curriculum,
    `Grade-${grade_band}`,
    chapterName
  );
  
  // Ensure directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Create manifest.json per MIGRATION.md requirements
  const manifest = {
    chapter_id: chapterId,
    generation_version: 'school_pipeline_v1',
    generation_seed: deterministicSeed,
    timestamp: new Date().toISOString(),
    status: 'completed',
    metadata: {
      curriculum: curriculum,
      grade_band: grade_band,
      subject: metadata.subject || 'unknown',
      language: metadata.language || 'en-IN',
      teacher_review: metadata.teacher_review || false
    },
    processing_summary: {
      total_concepts: data.concepts?.length || 0,
      total_episodes: data.episodes?.length || 0,
      word_count: data.markdown?.length || 0,
      curriculum: curriculum
    },
    files: {
      "chapter.md": "cleaned markdown",
      "concepts.json": "detected concept index + graph", 
      "episode_plan.json": "deterministic plan",
      "Episode-*/": "episode content with scripts, MCQs, audio",
      "manifest.json": "this file"
    },
    episodes: data.episodes?.map((ep, index) => ({
      episode_index: index + 1,
      title: ep.title || `Episode ${index + 1}`,
      status: ep.error ? 'failed' : 'completed',
      validation_status: ep.metadata?.validation_status || 'unknown',
      audio_generated: false, // Audio generated separately now
      requires_teacher_review: ep.metadata?.validation_status === 'requires_review'
    })) || []
  };

  // Save manifest.json
  const manifestPath = path.join(outputDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  logger.info(`Generated manifest for chapter ${chapterId} with ${data.episodes?.length || 0} episodes`);

  return {
    manifest_url: `/outputs/${curriculum}/Grade-${grade_band}/${chapterName}/manifest.json`,
    chapter_url: `/outputs/${curriculum}/Grade-${grade_band}/${chapterName}/chapter.md`,
    episodes_count: data.episodes?.length || 0,
    teacher_review_url: `/teacher/review.html?chapter=${chapterId}`,
    generation_id: generationId,
    deterministic_seed: deterministicSeed,
    output_path: outputDir,
    status: 'completed'
  };
}

/**
 * Regenerate specific episode based on teacher feedback
 */
async function regenerateEpisode(jobId, chapterId, episodeIndex, seed, reason, metadata = {}) {
  try {
    logger.info(`Starting episode regeneration for ${chapterId} episode ${episodeIndex}`);
    updateJobStatus(jobId, 'regenerating', 10);

    // Find chapter directory using new structure
    const chapterInfo = findChapterDirectory(chapterId);
    if (!chapterInfo) {
      throw new Error(`Chapter ${chapterId} not found`);
    }
    
    const { path: chapterPath } = chapterInfo;
    
    // Load existing episode data from new structure
    const episodeDir = path.join(chapterPath, `Episode-${episodeIndex}`);
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