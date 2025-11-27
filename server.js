require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fileUpload = require('express-fileupload');
const path = require('path');
const os = require('os');
const winston = require('winston');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch'); // For LLM service calls
const axios = require('axios'); // For HTTP requests
const pLimit = require('p-limit'); // For controlled parallel processing
const crypto = require('crypto'); // For content hashing

// Import services
const ingestService = require('./services/ingest/pdf_processor');
const semanticService = require('./services/semantic/concept_extractor');
const plannerService = require('./services/planner/episode_planner');
const validationService = require('./services/validation/validator');
const ttsService = require('./services/tts/tts_orchestrator');

// In-memory log storage for web UI (last 500 logs)
const frontendLogs = [];
const MAX_FRONTEND_LOGS = 500;

// Custom format to capture logs in memory
const memoryFormat = winston.format((info) => {
  // Store log entry for web UI
  frontendLogs.push({
    timestamp: info.timestamp || new Date().toISOString(),
    level: info.level ? info.level.toUpperCase() : 'INFO',
    source: 'frontend',
    message: info.message || JSON.stringify(info),
    module: 'server.js',
    funcName: 'unknown'
  });

  // Keep only last 500 logs
  if (frontendLogs.length > MAX_FRONTEND_LOGS) {
    frontendLogs.shift();
  }

  return info;
});

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    memoryFormat(),
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
  tempFileDir: os.tmpdir() // Cross-platform temp directory
}));

// Serve static files for outputs and teacher UI
app.use('/outputs', express.static(path.join(__dirname, 'outputs')));
app.use('/teacher', express.static(path.join(__dirname, 'teacher_ui')));

// API Routes
// Voice configuration endpoints will be added inline

// Job tracking - persistent storage
const JOBS_FILE = path.join(__dirname, 'outputs', 'jobs.json');
let jobs = new Map();

// Load jobs from disk on startup
async function loadJobs() {
  const fs = require('fs').promises;
  try {
    const data = await fs.readFile(JOBS_FILE, 'utf8');
    const jobsArray = JSON.parse(data);
    jobs = new Map(jobsArray.map(j => [j.jobId, j]));
    logger.info(`Loaded ${jobs.size} jobs from disk`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      logger.warn('Failed to load jobs:', error.message);
    }
    // File doesn't exist yet - start fresh
    jobs = new Map();
  }
}

// Save jobs to disk
async function saveJobs() {
  const fs = require('fs').promises;
  try {
    const jobsArray = Array.from(jobs.values());
    await fs.writeFile(JOBS_FILE, JSON.stringify(jobsArray, null, 2));
  } catch (error) {
    logger.error('Failed to save jobs:', error);
  }
}

// Initialize jobs on startup
loadJobs().catch(err => logger.error('Failed to initialize jobs:', err));

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
  const fs = require('fs');
  const configPath = path.join(__dirname, 'outputs', 'voice_config.json');
  
  // Try to load from file first
  if (fs.existsSync(configPath)) {
    try {
      const fileData = fs.readFileSync(configPath, 'utf8');
      const loadedConfig = JSON.parse(fileData);
      voiceConfiguration = { ...voiceConfiguration, ...loadedConfig };
      return voiceConfiguration;
    } catch (error) {
      logger.warn('Failed to load voice config from file, using defaults:', error.message);
    }
  }
  
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

// Utility function to update job status WITH cost tracking
function updateJobStatus(jobId, status, progress = null, error = null, result = null) {
  const job = jobs.get(jobId);
  if (job) {
    job.status = status;
    job.progress = progress;
    job.lastUpdated = new Date();
    if (error) job.error = error;
    if (result) job.result = result;
    
    // Persist to disk
    saveJobs().catch(err => logger.error('Failed to persist job update:', err));
    
    // Developer-friendly logging with cost estimates
    const logData = { 
      jobId, 
      status, 
      progress, 
      error,
      cost_estimate: job.cost_tracking || null
    };
    
    logger.info(`Job ${jobId} status updated to ${status}`, logData);
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
        llm_provider: req.body.llm_provider || 'auto',  // Support provider selection
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
 * Returns progress + errors + performance metrics
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
    metadata: job.metadata,
    // Developer info
    performance: {
      parallel_processing: 'enabled (3 concurrent episodes)',
      cache_enabled: process.env.LLM_CACHE_ENABLED !== 'false',
      estimated_cost: job.cost_tracking || 'calculating...'
    }
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
  const fs = require('fs');
  const cacheDir = path.join(__dirname, 'cache');
  
  // Count cache files
  let cacheStats = { files: 0, total_size_mb: 0 };
  try {
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json'));
      const totalSize = files.reduce((sum, file) => {
        const stat = fs.statSync(path.join(cacheDir, file));
        return sum + stat.size;
      }, 0);
      cacheStats = {
        files: files.length,
        total_size_mb: (totalSize / 1024 / 1024).toFixed(2)
      };
    }
  } catch (err) {
    logger.warn('Failed to read cache stats:', err.message);
  }
  
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
    is_processing: isProcessing,
    // Developer performance metrics
    performance: {
      parallel_episodes: true,
      concurrency_limit: 3,
      cache_enabled: process.env.LLM_CACHE_ENABLED !== 'false',
      cache_stats: cacheStats
    }
  });
});

/**
 * GET /api/v1/cache/stats
 * Developer endpoint for cache statistics and management
 */
app.get('/api/v1/cache/stats', (req, res) => {
  const fs = require('fs');
  const cacheDir = path.join(__dirname, 'cache');
  
  try {
    if (!fs.existsSync(cacheDir)) {
      return res.json({
        enabled: process.env.LLM_CACHE_ENABLED !== 'false',
        files: 0,
        total_size_mb: 0,
        oldest_cache: null,
        newest_cache: null,
        ttl_days: 7
      });
    }
    
    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json') && !f.startsWith('test_'));
    const fileStats = files.map(file => {
      const filePath = path.join(cacheDir, file);
      const stat = fs.statSync(filePath);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        file,
        type: data.type,
        size_kb: (stat.size / 1024).toFixed(2),
        age_hours: ((Date.now() - data.timestamp) / 3600000).toFixed(1),
        timestamp: data.timestamp
      };
    });
    
    const totalSize = fileStats.reduce((sum, f) => sum + parseFloat(f.size_kb), 0);
    const sortedByAge = [...fileStats].sort((a, b) => a.timestamp - b.timestamp);
    
    res.json({
      enabled: process.env.LLM_CACHE_ENABLED !== 'false',
      files: files.length,
      total_size_mb: (totalSize / 1024).toFixed(2),
      oldest_cache: sortedByAge[0] || null,
      newest_cache: sortedByAge[sortedByAge.length - 1] || null,
      ttl_days: 7,
      cache_hits_saved_cost: `$${(files.length * 0.03).toFixed(2)}` // Rough estimate
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/cache/clear
 * Clear LLM response cache (developer tool)
 */
app.delete('/api/v1/cache/clear', (req, res) => {
  const fs = require('fs');
  const cacheDir = path.join(__dirname, 'cache');
  
  try {
    if (!fs.existsSync(cacheDir)) {
      return res.json({ message: 'Cache directory does not exist' });
    }
    
    const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json') && !f.startsWith('test_'));
    let deletedCount = 0;
    
    files.forEach(file => {
      fs.unlinkSync(path.join(cacheDir, file));
      deletedCount++;
    });
    
    logger.info({ action: 'cache_cleared', files: deletedCount });
    
    res.json({ 
      message: 'Cache cleared successfully',
      deleted_files: deletedCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
          
          // Update status before starting this episode
          updateJobStatus(jobId, 'generating_audio', Math.round((i / episodesToProcess.length) * 100), null, {
            currentEpisode: i + 1,
            totalEpisodes: episodesToProcess.length,
            episodeIndex: episodeIndex,
            stage: 'starting'
          });
          
          // Generate audio with progress callback
          await ttsService.generateEpisodeAudio(
            { script, voice_config: voiceConfig },
            chapter_id,
            episodeIndex,
            chapterMetadata,
            (progressData) => {
              // Update job status with TTS progress
              updateJobStatus(jobId, 'generating_audio', 
                Math.round(((i + progressData.progress / 100) / episodesToProcess.length) * 100), 
                null, {
                  currentEpisode: i + 1,
                  totalEpisodes: episodesToProcess.length,
                  episodeIndex: episodeIndex,
                  ttsProgress: progressData.progress,
                  ttsStage: progressData.stage,
                  currentSegment: progressData.currentSegment,
                  totalSegments: progressData.totalSegments
                });
            }
          );
          
          const progress = Math.round((i + 1) / episodesToProcess.length * 100);
          updateJobStatus(jobId, 'generating_audio', progress, null, {
            currentEpisode: i + 1,
            totalEpisodes: episodesToProcess.length,
            episodeIndex: episodeIndex,
            stage: 'completed'
          });
        }
        
        updateJobStatus(jobId, 'completed', 100, null, {
          stage: 'audio_generation_complete',
          episodesProcessed: episodesToProcess.length,
          outputPath: chapterPath,
          successCount: audioResults.filter(r => r.success).length,
          failedCount: audioResults.filter(r => !r.success).length
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
 * GET /api/v1/tts/voices
 * Get available voices from TTS service
 */
app.get('/api/v1/tts/voices', async (req, res) => {
  try {
    const voices = ttsService.getAvailableVoices();
    const currentConfig = ttsService.voiceConfig;
    
    res.json({
      available: voices,
      current: {
        language: currentConfig.language || 'en-US',
        voiceType: currentConfig.voiceType || 'chirp3_hd',
        speakers: {
          StudentA: currentConfig.StudentA,
          StudentB: currentConfig.StudentB
        }
      },
      languages: ['en-US', 'en-IN', 'en-GB', 'hi-IN'],
      voiceTypes: ['chirp3_hd', 'neural2', 'wavenet', 'standard']
    });
  } catch (error) {
    logger.error('Failed to load voices:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/logs
 * Merge frontend and backend logs for unified view
 */
app.get('/api/v1/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 500;
    
    // Fetch backend logs (optional)
    let backendLogs = [];
    let backendAvailable = false;
    try {
      const response = await fetch(`http://localhost:8000/api/v1/logs?limit=${limit}`, {
        signal: AbortSignal.timeout(1000) // 1 second timeout
      });
      if (response.ok) {
        const data = await response.json();
        backendLogs = data.logs || [];
        backendAvailable = true;
      }
    } catch (backendError) {
      // Backend not available, continue with frontend logs only
    }
    
    // Merge frontend and backend logs, sort by timestamp desc
    const allLogs = [...frontendLogs, ...backendLogs]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
    
    res.json({ 
      logs: allLogs,
      total: allLogs.length,
      sources: {
        frontend: frontendLogs.length,
        backend: backendLogs.length
      },
      backendAvailable
    });
  } catch (error) {
    logger.error('Failed to fetch logs:', error);
    res.status(500).json({ logs: frontendLogs.slice(-100), total: frontendLogs.length, error: error.message });
  }
});

/**
 * GET /api/v1/jobs
 * Proxy to backend for active jobs status
 */
app.get('/api/v1/jobs', async (req, res) => {
  try {
    const response = await fetch('http://localhost:8000/api/v1/jobs', {
      signal: AbortSignal.timeout(1000) // 1 second timeout
    });
    if (!response.ok) {
      throw new Error('Backend not available');
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    // Backend not available, return empty jobs list
    res.json({ 
      jobs: [], 
      active_count: 0,
      history: [],
      backendAvailable: false,
      message: 'Backend service not running. Start with: cd hf_backend && python main.py'
    });
  }
});

/**
 * POST /api/v1/tts/test
 * Test voice configuration with sample audio
 */
app.post('/api/v1/tts/test', async (req, res) => {
  try {
    const { config, testScript } = req.body;
    
    logger.info('Generating test audio with voice configuration');
    logger.info(`Received testScript type: ${typeof testScript}, isArray: ${Array.isArray(testScript)}`);
    logger.info(`Test script content: ${JSON.stringify(testScript)}`);
    
    // Validate testScript - wrap single object in array if needed
    let scriptArray = testScript;
    if (!Array.isArray(testScript)) {
      if (testScript && typeof testScript === 'object' && testScript.speaker && testScript.text) {
        scriptArray = [testScript];
        logger.info('Wrapped single object in array');
      } else {
        throw new Error('Invalid testScript: must be an array of {speaker, text} objects or a single {speaker, text} object');
      }
    }
    
    if (scriptArray.length === 0) {
      throw new Error('Invalid testScript: array is empty');
    }
    
    // Use the dedicated test audio generation method with custom voice config
    const result = await ttsService.generateTestAudio(scriptArray, null, config);
    
    logger.info(`Test audio result: ${JSON.stringify({ success: result.success, hasPath: !!result.audioPath })}`);
    
    if (result.success && result.audioPath) {
      // Get relative URL for the audio file
      const relativePath = path.relative(__dirname, result.audioPath);
      const audioUrl = '/' + relativePath.replace(/\\/g, '/');
      
      logger.info(`✅ Test audio generated: ${audioUrl}`);
      
      res.json({ 
        success: true, 
        message: 'Test audio generated successfully',
        audio_url: audioUrl,
        file_path: result.audioPath,
        voice_config: result.voiceConfig,
        audio_config: result.audioConfig
      });
    } else {
      throw new Error('Audio generation returned no file');
    }
    
  } catch (error) {
    logger.error('Test audio generation failed:', error);
    res.status(500).json({ 
      error: error.message,
      success: false 
    });
  }
});

/**
 * POST /api/v1/tts/preview
 * Generate a simple voice preview (returns audio blob)
 */
app.post('/api/v1/tts/preview', async (req, res) => {
  try {
    const { voice, text, speakingRate, pitch, volumeGain } = req.body;
    
    if (!voice || !text) {
      return res.status(400).json({ error: 'Voice and text are required' });
    }
    
    logger.info(`Generating voice preview for: ${voice}`);
    
    // Parse voice name to get language code (e.g., "en-US-Neural2-D" -> "en-US")
    const languageCode = voice.split('-').slice(0, 2).join('-');
    
    // Determine SSML gender from voice name patterns
    let ssmlGender = 'NEUTRAL';
    if (voice.includes('-A') || voice.includes('-C') || voice.includes('Aoede') || voice.includes('Autonoe')) {
      ssmlGender = 'FEMALE';
    } else if (voice.includes('-B') || voice.includes('-D') || voice.includes('Achird') || voice.includes('Achernar')) {
      ssmlGender = 'MALE';
    }
    
    const request = {
      input: { text: text },
      voice: {
        languageCode: languageCode,
        name: voice,
        ssmlGender: ssmlGender
      },
      audioConfig: {
        audioEncoding: 'MP3',
        sampleRateHertz: 44100,
        speakingRate: speakingRate || 1.0,
        pitch: pitch || 0,
        volumeGainDb: volumeGain || 0
      }
    };
    
    // Get the TTS client directly
    const TextToSpeechClient = require('@google-cloud/text-to-speech').TextToSpeechClient;
    const ttsClient = new TextToSpeechClient({
      apiKey: process.env.GOOGLE_TTS_API_KEY
    });
    
    const [response] = await ttsClient.synthesizeSpeech(request);
    
    logger.info(`✅ Voice preview generated: ${voice}`);
    
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': response.audioContent.length
    });
    
    res.send(response.audioContent);
    
  } catch (error) {
    logger.error('Preview generation failed:', error);
    res.status(500).json({ 
      error: error.message
    });
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
      const conceptsData = JSON.parse(fs.readFileSync(conceptsPath, 'utf8'));
      // Handle both formats: {concepts: [...], graph: [...]} or just [...]
      concepts = conceptsData.concepts || conceptsData;
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
      const metadataPath = path.join(episodePath, 'metadata.json');
      
      let script_data = null;
      let mcqs = null;
      let scriptText = '';
      let metadata = null;
      
      if (fs.existsSync(scriptPath)) {
        script_data = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
        // Extract plain text from script sections for review UI
        if (script_data.sections && Array.isArray(script_data.sections)) {
          scriptText = script_data.sections.map(s => s.text).join('\n\n');
        }
      }
      
      if (fs.existsSync(mcqsPath)) {
        mcqs = JSON.parse(fs.readFileSync(mcqsPath, 'utf8'));
      }
      
      if (fs.existsSync(metadataPath)) {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      }
      
      episodes.push({
        episode_number: parseInt(episodeDir.replace('Episode-', '')),
        script_data,
        script_text: scriptText,
        mcqs,
        status: metadata?.validation_status || 'pending',
        validation: {
          passed: metadata?.validation_status === 'validated' || metadata?.validation_status === 'completed_with_warnings',
          errors: metadata?.validation_errors || [],
          attempts: metadata?.validation_attempts || 1
        },
        metadata
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
 * GET /api/v1/chapter/:chapter_id/failed-episodes
 * Get failed episodes for a chapter
 */
app.get('/api/v1/chapter/:chapter_id/failed-episodes', async (req, res) => {
  try {
    const { chapter_id } = req.params;
    const fs = require('fs');
    
    const chapterInfo = findChapterDirectory(chapter_id);
    
    if (!chapterInfo) {
      return res.status(404).json({ error: `Chapter ${chapter_id} not found` });
    }
    
    const failedEpisodesPath = path.join(chapterInfo.path, 'failed_episodes.json');
    
    if (!fs.existsSync(failedEpisodesPath)) {
      return res.json({ failures: [] }); // No failures
    }
    
    const failedData = JSON.parse(fs.readFileSync(failedEpisodesPath, 'utf8'));
    res.json(failedData);
    
  } catch (error) {
    logger.error('Failed to load failed episodes:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/retry-episode
 * Retry generating a specific failed episode
 */
app.post('/api/v1/retry-episode', async (req, res) => {
  try {
    const { chapter_id, episode_number } = req.body;
    
    if (!chapter_id || !episode_number) {
      return res.status(400).json({ error: 'chapter_id and episode_number required' });
    }
    
    const chapterInfo = findChapterDirectory(chapter_id);
    
    if (!chapterInfo) {
      return res.status(404).json({ error: `Chapter ${chapter_id} not found` });
    }
    
    const fs = require('fs');
    
    // Load chapter data
    const conceptsPath = path.join(chapterInfo.path, 'concepts.json');
    const episodePlanPath = path.join(chapterInfo.path, 'episode_plan.json');
    
    if (!fs.existsSync(conceptsPath) || !fs.existsSync(episodePlanPath)) {
      return res.status(404).json({ error: 'Chapter data not found' });
    }
    
    const concepts = JSON.parse(fs.readFileSync(conceptsPath, 'utf8'));
    const episodePlan = JSON.parse(fs.readFileSync(episodePlanPath, 'utf8'));
    
    // Find the specific episode config
    const episodeConfig = episodePlan.episodes.find(ep => ep.ep === episode_number);
    
    if (!episodeConfig) {
      return res.status(404).json({ error: `Episode ${episode_number} not found in plan` });
    }
    
    // Generate job ID
    const jobId = `retry_${chapter_id}_ep${episode_number}_${Date.now()}`;
    
    // Start regeneration in background
    regenerateSingleEpisode(jobId, chapter_id, episodeConfig, concepts.concepts || [], chapterInfo.metadata);
    
    res.json({ 
      success: true, 
      message: `Episode ${episode_number} regeneration started`,
      job_id: jobId
    });
    
  } catch (error) {
    logger.error('Failed to retry episode:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/retry-failed-episodes
 * Retry all failed episodes for a chapter
 */
app.post('/api/v1/retry-failed-episodes', async (req, res) => {
  try {
    const { chapter_id } = req.body;
    
    if (!chapter_id) {
      return res.status(400).json({ error: 'chapter_id required' });
    }
    
    const chapterInfo = findChapterDirectory(chapter_id);
    
    if (!chapterInfo) {
      return res.status(404).json({ error: `Chapter ${chapter_id} not found` });
    }
    
    const fs = require('fs');
    
    // Load failed episodes
    const failedEpisodesPath = path.join(chapterInfo.path, 'failed_episodes.json');
    
    if (!fs.existsSync(failedEpisodesPath)) {
      return res.json({ message: 'No failed episodes to retry' });
    }
    
    const failedData = JSON.parse(fs.readFileSync(failedEpisodesPath, 'utf8'));
    const failedEpisodes = failedData.failures || [];
    
    if (failedEpisodes.length === 0) {
      return res.json({ message: 'No failed episodes to retry' });
    }
    
    // Load chapter data
    const conceptsPath = path.join(chapterInfo.path, 'concepts.json');
    const episodePlanPath = path.join(chapterInfo.path, 'episode_plan.json');
    
    const concepts = JSON.parse(fs.readFileSync(conceptsPath, 'utf8'));
    const episodePlan = JSON.parse(fs.readFileSync(episodePlanPath, 'utf8'));
    
    // Generate job ID
    const jobId = `retry_all_${chapter_id}_${Date.now()}`;
    
    // Start regeneration for all failed episodes
    retryAllFailedEpisodes(jobId, chapter_id, failedEpisodes, episodePlan, concepts.concepts || [], chapterInfo.metadata);
    
    res.json({ 
      success: true, 
      message: `Retrying ${failedEpisodes.length} failed episodes`,
      job_id: jobId,
      episodes: failedEpisodes.map(f => f.episode)
    });
    
  } catch (error) {
    logger.error('Failed to retry all episodes:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/chapter/:chapter_id/approve-plan
 * Approve episode plan and trigger script generation
 */
app.post('/api/v1/chapter/:chapter_id/approve-plan', async (req, res) => {
  try {
    const { chapter_id } = req.params;
    const { approved_by } = req.body;
    
    const chapterInfo = findChapterDirectory(chapter_id);
    
    if (!chapterInfo) {
      return res.status(404).json({ error: `Chapter ${chapter_id} not found` });
    }
    
    // Update workflow status to approved
    await updateWorkflowStatus(chapter_id, {
      current_stage: 'plan_approved',
      'stages.planning.status': 'approved',
      'stages.planning.approved_at': new Date().toISOString(),
      'stages.planning.approved_by': approved_by || 'teacher',
      'metrics.teacherReviews': { $inc: 1 }  // Increment review counter
    }, chapterInfo.metadata);
    
    // Create job for script generation
    const jobId = `scripts_${chapter_id}_${Date.now()}`;
    updateJobStatus(jobId, 'starting_script_generation', 0);
    
    // Trigger script generation in background
    generateScriptsAfterApproval(jobId, chapter_id, chapterInfo.metadata).catch(err => {
      logger.error('Script generation failed after plan approval:', err);
      updateJobStatus(jobId, 'failed', null, err.message);
    });
    
    res.json({ 
      success: true, 
      message: 'Plan approved. Script generation started.',
      job_id: jobId
    });
    
  } catch (error) {
    logger.error('Failed to approve plan:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/chapter/:chapter_id/approve-scripts
 * Approve all scripts and prepare for audio generation
 */
app.post('/api/v1/chapter/:chapter_id/approve-scripts', async (req, res) => {
  try {
    const { chapter_id } = req.params;
    const { approved_by } = req.body;
    
    const chapterInfo = findChapterDirectory(chapter_id);
    
    if (!chapterInfo) {
      return res.status(404).json({ error: `Chapter ${chapter_id} not found` });
    }
    
    // Update workflow status
    await updateWorkflowStatus(chapter_id, {
      current_stage: 'content_approved',
      'stages.content_review.status': 'approved',
      'stages.content_review.approved_at': new Date().toISOString(),
      'stages.content_review.approved_by': approved_by || 'teacher',
      'metrics.teacherReviews': { $inc: 1 }  // Increment review counter
    }, chapterInfo.metadata);
    
    res.json({ 
      success: true,
      message: 'All scripts approved. Ready for voice configuration and audio generation.',
      next_stage: 'voice_configuration'
    });
    
  } catch (error) {
    logger.error('Failed to approve scripts:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/chapter/:chapter_id/approve-episode/:episode_number
 * Approve a single episode
 */
app.post('/api/v1/chapter/:chapter_id/approve-episode/:episode_number', async (req, res) => {
  try {
    const { chapter_id, episode_number } = req.params;
    const { approved_by } = req.body;
    
    const chapterInfo = findChapterDirectory(chapter_id);
    
    if (!chapterInfo) {
      return res.status(404).json({ error: `Chapter ${chapter_id} not found` });
    }
    
    const fs = require('fs');
    const statusPath = path.join(chapterInfo.path, 'workflow_status.json');
    
    if (!fs.existsSync(statusPath)) {
      return res.status(404).json({ error: 'Workflow status not found' });
    }
    
    const workflowStatus = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    
    // Update episode status
    if (workflowStatus.episodes && workflowStatus.episodes[episode_number - 1]) {
      workflowStatus.episodes[episode_number - 1].validation_status = 'approved';
      workflowStatus.episodes[episode_number - 1].approved_by = approved_by || 'teacher';
      workflowStatus.episodes[episode_number - 1].approved_at = new Date().toISOString();
      
      fs.writeFileSync(statusPath, JSON.stringify(workflowStatus, null, 2), 'utf8');
    }
    
    res.json({ 
      success: true,
      message: `Episode ${episode_number} approved`
    });
    
  } catch (error) {
    logger.error('Failed to approve episode:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/chapter/:chapter_id/request-revision
 * Request revision for plan or specific episode
 */
app.post('/api/v1/chapter/:chapter_id/request-revision', async (req, res) => {
  try {
    const { chapter_id } = req.params;
    const { episode_number, regeneration_type, feedback, revision_type, revision_notes } = req.body;
    
    const chapterInfo = findChapterDirectory(chapter_id);
    
    if (!chapterInfo) {
      return res.status(404).json({ error: `Chapter ${chapter_id} not found` });
    }
    
    // Create job for regeneration
    const jobId = `regen_${chapter_id}_ep${episode_number || 'plan'}_${Date.now()}`;
    
    // Increment regeneration counter in metadata
    await updateWorkflowStatus(chapter_id, {
      'metrics.regenerationCount': { $inc: 1 },
      'metrics.lastRegenerationAt': new Date().toISOString()
    }, chapterInfo.metadata);
    
    if (episode_number) {
      // Episode-level regeneration
      logger.info(`Regeneration requested for chapter ${chapter_id}, episode ${episode_number}, type: ${regeneration_type}`);
      
      jobs.set(jobId, {
        jobId,
        chapter_id,
        episode_number,
        type: 'regeneration',
        regeneration_type: regeneration_type || 'general',
        feedback,
        status: 'queued',
        created_at: new Date(),
        progress: 0
      });
      
      // Trigger regeneration (using existing regeneration functions)
      regenerateSingleEpisode(jobId, chapter_id, episode_number, regeneration_type, feedback, chapterInfo.metadata).catch(err => {
        logger.error('Regeneration failed:', err);
        updateJobStatus(jobId, 'failed', null, err.message);
      });
      
    } else {
      // Plan-level revision
      logger.info(`Plan revision requested for chapter ${chapter_id}: ${revision_notes}`);
      
      jobs.set(jobId, {
        jobId,
        chapter_id,
        type: 'plan_revision',
        revision_notes,
        status: 'queued',
        created_at: new Date(),
        progress: 0
      });
      
      // TODO: Implement plan revision logic
      updateJobStatus(jobId, 'pending', 0);
    }
    
    res.json({ 
      success: true,
      job_id: jobId,
      message: episode_number 
        ? `Episode ${episode_number} regeneration started`
        : 'Plan revision request recorded'
    });
    
  } catch (error) {
    logger.error('Failed to request revision:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate scripts after plan approval
 */
async function generateScriptsAfterApproval(jobId, chapterId, metadata) {
  try {
    const chapterInfo = findChapterDirectory(chapterId);
    if (!chapterInfo) throw new Error('Chapter not found');
    
    const fs = require('fs');
    
    // Load necessary data
    const episodePlanPath = path.join(chapterInfo.path, 'episode_plan.json');
    const conceptsPath = path.join(chapterInfo.path, 'concepts.json');
    const markdownPath = path.join(chapterInfo.path, 'chapter.md');
    
    if (!fs.existsSync(episodePlanPath) || !fs.existsSync(conceptsPath) || !fs.existsSync(markdownPath)) {
      throw new Error('Required chapter data files not found');
    }
    
    const episodePlan = JSON.parse(fs.readFileSync(episodePlanPath, 'utf8'));
    const conceptsData = JSON.parse(fs.readFileSync(conceptsPath, 'utf8'));
    const concepts = conceptsData.concepts || [];
    const cleanedMarkdown = fs.readFileSync(markdownPath, 'utf8');
    
    // Update workflow to content_generating
    await updateWorkflowStatus(chapterId, {
      current_stage: 'content_generating',
      'stages.content_generation.status': 'processing',
      'stages.content_generation.started_at': new Date().toISOString()
    }, metadata);
    
    updateJobStatus(jobId, 'generating_scripts', 50, null, {
      stage: 'script_generation',
      totalEpisodes: episodePlan.episodes.length,
      parallelLimit: 3
    });
    logger.info(`Generating scripts for ${episodePlan.episodes.length} episodes in parallel`);
    
    const episodes = [];
    const failedEpisodes = [];
    
    // Limit to 3 concurrent LLM calls
    const limit = pLimit(3);
    
    const episodeGenerationPromises = episodePlan.episodes.map((episodeConfig, i) => 
      limit(async () => {
        const episodeNumber = i + 1;
        const progress = 50 + (i / episodePlan.episodes.length) * 30;
        
        // Update with parallel progress info
        updateJobStatus(jobId, 'generating_scripts', Math.round(progress), null, {
          stage: 'script_generation',
          currentEpisode: episodeNumber,
          totalEpisodes: episodePlan.episodes.length,
          episodeTitle: episodeConfig.title,
          parallelProgress: {
            inProgress: episodeNumber,
            completed: i,
            total: episodePlan.episodes.length
          }
        });
        
        try {
          const episodeContent = await generateEpisodeContent(episodeConfig, concepts, cleanedMarkdown, metadata);
          const validationResult = await validationService.validateEpisode(episodeContent, episodeConfig);
          let finalContent = episodeContent;
          
          if (!validationResult.isValid) {
            finalContent = await validationService.repairEpisode(episodeContent, validationResult.errors);
          }
          
          return { success: true, episode: episodeConfig.ep, content: finalContent };
          
        } catch (episodeError) {
          logger.error({
            message: `Episode ${episodeConfig.ep} generation failed`,
            error: episodeError.message,
            episode: episodeConfig.ep,
            concepts: episodeConfig.concepts.map(c => c.name)
          });
          
          return {
            success: false,
            episode: episodeConfig.ep,
            error: episodeError.message,
            timestamp: new Date().toISOString(),
            concepts: episodeConfig.concepts.map(c => c.name)
          };
        }
      })
    );
    
    const episodeResults = await Promise.allSettled(episodeGenerationPromises);
    
    episodeResults.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value.success) {
        episodes.push(result.value.content);
      } else if (result.status === 'fulfilled' && !result.value.success) {
        failedEpisodes.push(result.value);
      } else if (result.status === 'rejected') {
        failedEpisodes.push({
          episode: episodePlan.episodes[i].ep,
          error: result.reason.message,
          timestamp: new Date().toISOString(),
          concepts: episodePlan.episodes[i].concepts.map(c => c.name)
        });
      }
    });
    
    logger.info(`Generated ${episodes.length}/${episodePlan.episodes.length} episodes successfully`);
    
    // Check if critical episodes failed
    if (failedEpisodes.length > 0) {
      logger.warn(`⚠️ ${failedEpisodes.length} episodes failed generation:`, 
        failedEpisodes.map(f => `Episode ${f.episode}: ${f.error}`));
    }
    
    // Update episode statuses in workflow
    const episodeStatusesUpdated = episodePlan.episodes.map((ep, i) => {
      const generated = episodes.find(e => e.episode_index === (i + 1));
      const failed = failedEpisodes.find(f => f.episode === (i + 1));
      
      return {
        episode_number: i + 1,
        title: ep.title,
        status: failed ? 'failed' : (generated ? 'generated' : 'planned'),
        generated_at: generated ? new Date().toISOString() : null,
        validation_status: generated?.metadata?.validation_status || 'pending',
        has_audio: false,
        error: failed?.error || null
      };
    });
    
    // Determine overall status
    const overallStatus = failedEpisodes.length === 0 ? 'completed' : 
                         episodes.length === 0 ? 'failed' : 
                         'partial_success';
    
    await updateWorkflowStatus(chapterId, {
      current_stage: failedEpisodes.length === 0 ? 'content_generated' : 'content_generated_partial',
      'stages.content_generation.status': overallStatus,
      'stages.content_generation.completed_at': new Date().toISOString(),
      'stages.content_generation.success_count': episodes.length,
      'stages.content_generation.failed_count': failedEpisodes.length,
      episodes: episodeStatusesUpdated
    }, metadata);
    
    // Package results
    await packageResults(chapterId, {
      markdown: cleanedMarkdown,
      concepts,
      episodePlan,
      episodes,
      failedEpisodes: failedEpisodes.length > 0 ? failedEpisodes : undefined
    }, metadata);
    
    // Update job status with warning if episodes failed
    if (failedEpisodes.length > 0 && episodes.length > 0) {
      updateJobStatus(jobId, 'partial_success', 100, 
        `${failedEpisodes.length} episodes failed. ${episodes.length} succeeded.`,
        { 
          stage: 'script_generation_partial',
          success_count: episodes.length, 
          failed_count: failedEpisodes.length,
          failed_episodes: failedEpisodes.map(f => f.episode),
          requiresAction: true,
          actionType: 'script_approval'
        });
    } else if (failedEpisodes.length > 0) {
      updateJobStatus(jobId, 'failed', 100, 'All episodes failed generation', {
        stage: 'script_generation_failed',
        failed_count: failedEpisodes.length
      });
    } else {
      updateJobStatus(jobId, 'completed', 100, null, {
        stage: 'script_generation_complete',
        scriptCount: episodes.length,
        requiresAction: true,
        actionType: 'script_approval'
      });
    }
    
    logger.info(`Script generation completed for ${chapterId}. Success: ${episodes.length}, Failed: ${failedEpisodes.length}`);
    
  } catch (error) {
    logger.error(`Script generation failed for ${chapterId}:`, error);
    updateJobStatus(jobId, 'failed', null, error.message);
    
    await updateWorkflowStatus(chapterId, {
      current_stage: 'plan_approved',
      'stages.content_generation.status': 'failed',
      'stages.content_generation.error': error.message
    }, metadata);
    
    throw error;
  }
}

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
 * Update workflow status for a chapter
 */
async function updateWorkflowStatus(chapterId, updates, metadata = {}) {
  const fs = require('fs').promises;
  const chapterInfo = findChapterDirectory(chapterId);
  
  if (!chapterInfo) {
    logger.warn(`Cannot update workflow status - chapter ${chapterId} not found`);
    return;
  }
  
  const statusPath = path.join(chapterInfo.path, 'workflow_status.json');
  
  let workflowStatus = {
    chapter_id: chapterId,
    current_stage: 'created',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    stages: {
      extraction: { status: 'pending' },
      planning: { status: 'pending' },
      content_generation: { status: 'pending' },
      content_review: { status: 'pending' },
      audio_generation: { status: 'pending' }
    },
    episodes: [],
    metrics: {
      teacherReviews: 0,
      regenerationCount: 0,
      hallucinations: 0
    },
    metadata: metadata
  };
  
  // Load existing if present
  try {
    const existing = await fs.readFile(statusPath, 'utf8');
    workflowStatus = JSON.parse(existing);
    // Ensure metrics object exists in legacy workflows
    if (!workflowStatus.metrics) {
      workflowStatus.metrics = {
        teacherReviews: 0,
        regenerationCount: 0,
        hallucinations: 0
      };
    }
  } catch (err) {
    // File doesn't exist yet, use defaults
  }
  
  // Apply updates (support nested paths like 'stages.planning.status')
  for (const [key, value] of Object.entries(updates)) {
    if (key.includes('.')) {
      const parts = key.split('.');
      let target = workflowStatus;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]]) target[parts[i]] = {};
        target = target[parts[i]];
      }
      
      // Handle $inc operator for counters
      if (typeof value === 'object' && value.$inc) {
        const currentValue = target[parts[parts.length - 1]] || 0;
        target[parts[parts.length - 1]] = currentValue + value.$inc;
      } else {
        target[parts[parts.length - 1]] = value;
      }
    } else {
      // Handle $inc operator for top-level keys
      if (typeof value === 'object' && value.$inc) {
        const currentValue = workflowStatus[key] || 0;
        workflowStatus[key] = currentValue + value.$inc;
      } else {
        workflowStatus[key] = value;
      }
    }
  }
  
  workflowStatus.updated_at = new Date().toISOString();
  
  await fs.writeFile(statusPath, JSON.stringify(workflowStatus, null, 2), 'utf8');
  logger.info(`Updated workflow status for ${chapterId}: stage=${workflowStatus.current_stage}`);
  
  return workflowStatus;
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
      updateJobStatus(jobId, 'processing_text', 20, null, {
        stage: 'text_extraction',
        method: 'markdown_input',
        wordCount: markdownContent.split(/\s+/).length
      });
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
      updateJobStatus(jobId, 'extracting_text', 20, null, {
        stage: 'pdf_extraction',
        fileName: pdfFile.name,
        fileSize: pdfFile.size
      });
      
      pdfProcessingResult = await ingestService.processChapter(pdfFile, chapter_id, metadata);
      
      if (!pdfProcessingResult.success) {
        throw new Error(`PDF processing failed: ${JSON.stringify(pdfProcessingResult.errorReport)}`);
      }
      
      cleanedMarkdown = pdfProcessingResult.markdown;
      rawText = pdfProcessingResult.rawText;
    } else {
      throw new Error('No PDF file or markdown content provided');
    }
    
    // Save chapter data per MIGRATION.MD output structure
    await ingestService.saveChapterData(chapter_id, pdfProcessingResult, metadata);
    
    // Update workflow status: extraction complete
    await updateWorkflowStatus(chapter_id, {
      current_stage: 'extracted',
      'stages.extraction.status': 'completed',
      'stages.extraction.completed_at': new Date().toISOString()
    }, metadata);
    
    updateJobStatus(jobId, 'analyzing_content', 30, null, {
      stage: 'concept_extraction',
      chapterId: chapter_id,
      wordCount: pdfProcessingResult.metadata.word_count
    });

    // Step 2: Concept extraction and semantic analysis
    logger.info(`Step 2: Extracting concepts for ${chapter_id}`);
    const conceptExtractionResult = await semanticService.extractConcepts(cleanedMarkdown, metadata);
    const concepts = conceptExtractionResult.concepts; // Extract concepts array
    const conceptGraph = conceptExtractionResult.graph;
    const chapterAnalysis = conceptExtractionResult.chapter_analysis; // NEW: Get chapter understanding
    
    logger.info(`✅ Extracted ${concepts.length} concepts`);
    
    updateJobStatus(jobId, 'analyzing_content', 35, null, {
      stage: 'concept_extraction_complete',
      conceptCount: concepts.length,
      graphNodeCount: conceptGraph?.nodes?.length || 0,
      contentType: chapterAnalysis?.content_type || 'unknown'
    });
    
    // Save concepts.json per MIGRATION.md output structure with optimized folders
    const conceptsOutput = {
      concepts: concepts,
      graph: conceptGraph,
      chapter_analysis: chapterAnalysis  // Store analysis for reference
    };
    await saveToOutputStructure(chapter_id, 'concepts.json', conceptsOutput, metadata);
    
    // Update workflow status: concepts extracted
    await updateWorkflowStatus(chapter_id, {
      current_stage: 'extracting',
      'stages.extraction.status': 'completed',
      'stages.extraction.concept_count': concepts.length
    }, metadata);
    
    updateJobStatus(jobId, 'planning_episodes', 40, null, {
      stage: 'episode_planning',
      conceptCount: concepts.length,
      chapterAnalysis: chapterAnalysis ? chapterAnalysis.content_type : 'none'
    });

    // Step 3: Episode planning
    logger.info(`Step 3: Planning episodes for ${chapter_id}`);
    
    // Prepare chapter metadata for planner (including LLM's chapter analysis)
    const chapterMetadata = {
      ...metadata,
      chapter_analysis: chapterAnalysis,  // Pass LLM's understanding to planner
      word_count: pdfProcessingResult.metadata.word_count,
      concept_count: concepts.length
    };
    
    const episodePlan = await plannerService.planEpisodes(concepts, chapterMetadata);
    
    // Save episode_plan.json per MIGRATION.md output structure with optimized folders
    await saveToOutputStructure(chapter_id, 'episode_plan.json', episodePlan, metadata);
    
    // Update workflow status: plan generated, awaiting approval
    const episodeStatuses = episodePlan.episodes.map((ep, i) => ({
      episode_number: i + 1,
      title: ep.title,
      status: 'planned',
      validation_status: 'pending',
      has_audio: false
    }));
    
    await updateWorkflowStatus(chapter_id, {
      current_stage: 'plan_generated',
      'stages.planning.status': 'completed',
      'stages.planning.completed_at': new Date().toISOString(),
      'stages.planning.episode_count': episodePlan.episodes.length,
      'stages.planning.total_duration_minutes': episodePlan.episodes.reduce((sum, ep) => sum + (ep.duration_minutes || 0), 0),
      episodes: episodeStatuses
    }, metadata);
    
    // STOP HERE - Wait for teacher approval
    updateJobStatus(jobId, 'plan_ready', 50, null, {
      stage: 'waiting_plan_approval',
      episodeCount: episodePlan.episodes.length,
      totalDuration: episodePlan.episodes.reduce((sum, ep) => sum + (ep.duration_minutes || 0), 0),
      requiresAction: true,
      actionType: 'plan_approval'
    });
    logger.info(`✅ Episode plan generated. Awaiting teacher approval. Plan: ${episodePlan.episodes.length} episodes`);
    return; // Exit processChapter - script generation triggered by /approve-plan endpoint

    // NOTE: Code below this point moved to generateScriptsAfterApproval()
    // Step 4: Generate scripts and MCQs for each episode (PARALLEL with concurrency limit)
    logger.info(`Step 4: Generating content for ${episodePlan.episodes.length} episodes in parallel`);
    const episodes = [];
    const failedEpisodes = [];
    
    // Limit to 3 concurrent LLM calls to avoid rate limits while improving speed
    const limit = pLimit(3);
    
    const episodeGenerationPromises = episodePlan.episodes.map((episodeConfig, i) => 
      limit(async () => {
        const episodeNumber = i + 1;
        const progress = 50 + (i / episodePlan.episodes.length) * 30;
        updateJobStatus(jobId, `generating_episode_${episodeNumber}`, Math.round(progress));
        
        try {
          // Generate script and MCQs via LLM service
          const episodeContent = await generateEpisodeContent(episodeConfig, concepts, cleanedMarkdown, metadata);
          
          // Validate content (quality checks still apply)
          const validationResult = await validationService.validateEpisode(episodeContent, episodeConfig);
          let finalContent = episodeContent;
          
          if (!validationResult.isValid) {
            // Auto-repair if needed
            finalContent = await validationService.repairEpisode(episodeContent, validationResult.errors);
          }
          
          return { success: true, episode: episodeConfig.ep, content: finalContent };
          
        } catch (episodeError) {
          // Enhanced error logging for developers
          logger.error({
            message: `Episode ${episodeConfig.ep} generation failed`,
            error: episodeError.message,
            stack: episodeError.stack,
            episode: episodeConfig.ep,
            concepts: episodeConfig.concepts.map(c => c.name),
            llm_provider: metadata.llm_provider || 'auto',
            grade: metadata.grade_band
          });
          
          return {
            success: false,
            episode: episodeConfig.ep,
            error: episodeError.message,
            stack: episodeError.stack,
            timestamp: new Date().toISOString(),
            concepts: episodeConfig.concepts.map(c => c.name)
          };
        }
      })
    );
    
    // Wait for all episodes to complete (parallel execution)
    const episodeResults = await Promise.allSettled(episodeGenerationPromises);
    
    // Process results maintaining episode order
    episodeResults.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value.success) {
        episodes.push(result.value.content);
      } else if (result.status === 'fulfilled' && !result.value.success) {
        failedEpisodes.push(result.value);
      } else if (result.status === 'rejected') {
        // Shouldn't happen due to try-catch, but handle anyway
        failedEpisodes.push({
          episode: episodePlan.episodes[i].ep,
          error: result.reason.message,
          timestamp: new Date().toISOString(),
          concepts: episodePlan.episodes[i].concepts.map(c => c.name)
        });
      }
    });

    // Skip audio generation unless explicitly requested
    // Audio will be generated separately via /api/v1/generate-audio endpoint
    
    // Log failed episodes summary
    if (failedEpisodes.length > 0) {
      logger.warn(`${failedEpisodes.length} episodes failed to generate:`, failedEpisodes);
    }
    
    logger.info(`Successfully generated ${episodes.length}/${episodePlan.episodes.length} episodes`);
    
    updateJobStatus(jobId, 'packaging_results', 85);

    // Step 6: Package and save results
    const packagedResults = await packageResults(chapter_id, {
      markdown: cleanedMarkdown,
      concepts,
      episodePlan,
      episodes,
      failedEpisodes: failedEpisodes.length > 0 ? failedEpisodes : undefined
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

    updateJobStatus(jobId, 'completed', 100, null, packagedResults);
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
    // New planner returns concepts as ID array and concept_details as full objects
    const episodeConcepts = episodeConfig.concepts || []; // Array of IDs
    const conceptDetails = episodeConfig.concept_details || []; // Array of full objects from planner
    
    // Map episode concept IDs to full concept objects from original concepts array
    const fullConcepts = concepts.filter(c => 
      episodeConcepts.includes(c.id)
    );
    
    // Merge with concept_details from planner (has importance, estimated_minutes, etc)
    fullConcepts.forEach(concept => {
      const plannerDetail = conceptDetails.find(cd => cd.id === concept.id);
      if (plannerDetail) {
        concept.importance = plannerDetail.importance;
        concept.estimated_minutes = plannerDetail.estimated_minutes;
      }
    });
    
    logger.info(`Episode ${episodeIndex}: Using ${fullConcepts.length} concepts with misconceptions for generation`);
    
    // Generate script using enhanced backend with custom speaker names
    const scriptResponse = await fetch(`${process.env.HF_BACKEND_URL || 'http://localhost:8000'}/generate_script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concepts: fullConcepts,  // Pass full concept objects with importance/estimated_minutes
        episode_title: episodeConfig.title || `${metadata.subject} - Episode ${episodeIndex}`,
        grade: metadata.grade_band || metadata.grade,
        subject: metadata.subject,
        duration_minutes: episodeConfig.duration_minutes || 8,  // Use new planner field
        target_words: episodeConfig.target_words,  // Pass planner's calculated target
        word_count_range: episodeConfig.word_count_range,  // Pass min/max from planner
        episode_rationale: episodeConfig.rationale,  // Pass planning rationale
        source_content: markdown.substring(0, 5000), // Context window
        llm_provider: metadata.llm_provider || 'auto',
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
    
    // Store validation results from Python backend
    const scriptValidation = scriptData.validation || { passed: true };
    
    // Generate MCQs with FULL concept objects including misconceptions
    const mcqResponse = await fetch(`${process.env.HF_BACKEND_URL || 'http://localhost:8000'}/generate_mcqs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concepts: fullConcepts,  // Pass full concept objects with misconceptions
        script: scriptData.script,
        count: fullConcepts.length * 3, // 3 MCQs per concept for comprehensive question bank
        grade_band: metadata.grade_band || metadata.grade,  // Add grade_band for age-appropriate questions
        difficulty: parseInt(metadata.grade_band || metadata.grade) >= 10 ? 'medium' : 'easy',
        llm_provider: metadata.llm_provider || 'auto',
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
      title: episodeConfig.title || `${metadata.subject} - Episode ${episodeIndex}`,
      concepts: concepts,
      script_data: scriptData.script,  // Store as script_data for review UI
      script: scriptData.script,  // Keep for backward compatibility
      mcqs: mcqData.mcqs,
      duration: episodeConfig.duration_minutes || 12,
      validation: scriptValidation,  // Use Python validation results
      metadata: {
        generated_at: new Date().toISOString(),
        source_concepts: concepts.map(c => c.id || c.name),
        validation_status: scriptValidation.passed ? 'validated' : 'has_warnings',
        validation_attempts: scriptValidation.attempts || 1,
        validation_errors: scriptValidation.errors || []
      },
      logs: logs
    };

    // Check Python validation results instead of re-validating
    if (!scriptValidation.passed && scriptValidation.errors && scriptValidation.errors.length > 0) {
      // Log validation warnings but don't fail - Python already tried retry
      logger.warn({
        message: `Episode ${episodeIndex} has validation warnings from Python backend`,
        errors: scriptValidation.errors,
        attempts: scriptValidation.attempts,
        warning: 'Python backend already attempted retry - accepting with warnings'
      });
      
      episodeData.metadata.validation_status = 'completed_with_warnings';
      logs.push({ 
        step: 'validation', 
        status: 'has_warnings', 
        errors: scriptValidation.errors,
        attempts: scriptValidation.attempts,
        note: 'Python validation already attempted fixes'
      });
    } else if (scriptValidation.passed) {
      logger.info({
        message: `Episode ${episodeIndex} passed Python validation`,
        attempts: scriptValidation.attempts || 1
      });
      
      episodeData.metadata.validation_status = 'validated';
      logs.push({ 
        step: 'validation', 
        status: 'passed', 
        attempts: scriptValidation.attempts || 1
      });
    }

    // Generate audio if validation passed or has warnings (don't skip if only warnings)
    if (episodeData.metadata.validation_status !== 'failed') {
      try {
        const audioResult = await ttsService.generateEpisodeAudio(
          episodeData, 
          metadata.chapter_id, 
          episodeIndex,
          metadata,
          (progressData) => {
            // TTS progress callback - could be wired to job status if needed
            logger.info(`Episode ${episodeIndex} TTS progress: ${progressData.stage} ${progressData.progress}%`);
          }
        );
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

  // Save failed episodes report if any failures occurred
  if (data.failedEpisodes && data.failedEpisodes.length > 0) {
    const failedReportPath = path.join(outputDir, 'failed_episodes.json');
    fs.writeFileSync(failedReportPath, JSON.stringify({
      chapter_id: chapterId,
      timestamp: new Date().toISOString(),
      failed_count: data.failedEpisodes.length,
      total_episodes: data.episodePlan?.total_episodes || 0,
      failures: data.failedEpisodes,
      suggested_action: 'Retry failed episodes individually or enable billing to increase rate limits'
    }, null, 2), 'utf8');
    
    logger.warn(`Saved failed episodes report: ${data.failedEpisodes.length} episodes failed`);
  }

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

/**
 * Regenerate a single episode
 */
async function regenerateSingleEpisode(jobId, chapterId, episodeConfig, concepts, metadata) {
  try {
    updateJobStatus(jobId, 'generating_episode', 0);
    logger.info(`Regenerating episode ${episodeConfig.ep} for chapter ${chapterId}`);
    
    // Load chapter markdown
    const chapterInfo = findChapterDirectory(chapterId);
    const fs = require('fs');
    const chapterMdPath = path.join(chapterInfo.path, 'chapter.md');
    const cleanedMarkdown = fs.existsSync(chapterMdPath) 
      ? fs.readFileSync(chapterMdPath, 'utf8') 
      : '';
    
    // Generate episode content
    const episodeContent = await generateEpisodeContent(episodeConfig, concepts, cleanedMarkdown, metadata);
    
    // Validate
    const validationResult = await validationService.validateEpisode(episodeContent, episodeConfig);
    
    let finalContent = episodeContent;
    if (!validationResult.isValid) {
      const repairedContent = await validationService.repairEpisode(episodeContent, validationResult.errors);
      finalContent = repairedContent;
    }
    
    // Save episode files
    await saveEpisodeFiles(chapterId, episodeConfig.ep, finalContent, metadata);
    
    // Remove from failed episodes list
    await removeFromFailedEpisodes(chapterId, episodeConfig.ep);
    
    updateJobStatus(jobId, 'completed', 100);
    logger.info(`Successfully regenerated episode ${episodeConfig.ep}`);
    
  } catch (error) {
    logger.error(`Failed to regenerate episode:`, error);
    updateJobStatus(jobId, 'failed', null, error.message);
  }
}

/**
 * Retry all failed episodes
 */
async function retryAllFailedEpisodes(jobId, chapterId, failedEpisodes, episodePlan, concepts, metadata) {
  try {
    updateJobStatus(jobId, 'retrying_episodes', 0);
    logger.info(`Retrying ${failedEpisodes.length} failed episodes for ${chapterId}`);
    
    const chapterInfo = findChapterDirectory(chapterId);
    const fs = require('fs');
    const chapterMdPath = path.join(chapterInfo.path, 'chapter.md');
    const cleanedMarkdown = fs.existsSync(chapterMdPath) 
      ? fs.readFileSync(chapterMdPath, 'utf8') 
      : '';
    
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < failedEpisodes.length; i++) {
      const failed = failedEpisodes[i];
      const episodeConfig = episodePlan.episodes.find(ep => ep.ep === failed.episode);
      
      if (!episodeConfig) {
        logger.warn(`Episode ${failed.episode} not found in plan, skipping`);
        continue;
      }
      
      const progress = Math.round((i / failedEpisodes.length) * 100);
      updateJobStatus(jobId, `retrying_episode_${failed.episode}`, progress);
      
      try {
        // Add delay to avoid rate limits
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
        }
        
        const episodeContent = await generateEpisodeContent(episodeConfig, concepts, cleanedMarkdown, metadata);
        
        const validationResult = await validationService.validateEpisode(episodeContent, episodeConfig);
        
        let finalContent = episodeContent;
        if (!validationResult.isValid) {
          const repairedContent = await validationService.repairEpisode(episodeContent, validationResult.errors);
          finalContent = repairedContent;
        }
        
        await saveEpisodeFiles(chapterId, episodeConfig.ep, finalContent, metadata);
        
        successCount++;
        logger.info(`Successfully regenerated episode ${failed.episode}`);
        
      } catch (error) {
        logger.error(`Failed to regenerate episode ${failed.episode}:`, error);
        failCount++;
      }
    }
    
    // Update failed episodes file
    if (successCount > 0) {
      const remainingFailed = failedEpisodes.filter((_, i) => i >= successCount);
      await updateFailedEpisodesFile(chapterId, remainingFailed);
    }
    
    updateJobStatus(jobId, 'completed', 100, null, {
      success_count: successCount,
      fail_count: failCount,
      total: failedEpisodes.length
    });
    
    logger.info(`Retry completed: ${successCount} succeeded, ${failCount} failed`);
    
  } catch (error) {
    logger.error(`Failed to retry episodes:`, error);
    updateJobStatus(jobId, 'failed', null, error.message);
  }
}

/**
 * Remove episode from failed episodes list
 */
async function removeFromFailedEpisodes(chapterId, episodeNumber) {
  const fs = require('fs');
  const chapterInfo = findChapterDirectory(chapterId);
  
  if (!chapterInfo) return;
  
  const failedPath = path.join(chapterInfo.path, 'failed_episodes.json');
  
  if (fs.existsSync(failedPath)) {
    const failedData = JSON.parse(fs.readFileSync(failedPath, 'utf8'));
    failedData.failures = failedData.failures.filter(f => f.episode !== episodeNumber);
    failedData.failed_count = failedData.failures.length;
    
    if (failedData.failures.length === 0) {
      // Remove file if no more failures
      fs.unlinkSync(failedPath);
    } else {
      fs.writeFileSync(failedPath, JSON.stringify(failedData, null, 2), 'utf8');
    }
  }
}

/**
 * Update failed episodes file
 */
async function updateFailedEpisodesFile(chapterId, remainingFailed) {
  const fs = require('fs');
  const chapterInfo = findChapterDirectory(chapterId);
  
  if (!chapterInfo) return;
  
  const failedPath = path.join(chapterInfo.path, 'failed_episodes.json');
  
  if (remainingFailed.length === 0) {
    // Remove file if no failures
    if (fs.existsSync(failedPath)) {
      fs.unlinkSync(failedPath);
    }
  } else {
    const failedData = {
      chapter_id: chapterId,
      timestamp: new Date().toISOString(),
      failed_count: remainingFailed.length,
      failures: remainingFailed
    };
    
    fs.writeFileSync(failedPath, JSON.stringify(failedData, null, 2), 'utf8');
  }
}

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'healthy',
    service: 'journey-creation-school-pipeline',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    checks: {}
  };

  let allHealthy = true;

  // Check 1: LLM Backend connectivity
  try {
    const llmUrl = process.env.HF_BACKEND_URL || 'http://localhost:8000';
    const llmResponse = await fetch(`${llmUrl}/health`, { 
      method: 'GET',
      timeout: 5000 
    });
    
    if (llmResponse.ok) {
      health.checks.llm_backend = { status: 'healthy', url: llmUrl };
    } else {
      health.checks.llm_backend = { status: 'unhealthy', url: llmUrl, error: `HTTP ${llmResponse.status}` };
      allHealthy = false;
    }
  } catch (error) {
    health.checks.llm_backend = { status: 'unreachable', error: error.message };
    allHealthy = false;
  }

  // Check 2: Google TTS availability (check credentials)
  try {
    const ttsCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (ttsCredentials && fs.existsSync(ttsCredentials)) {
      health.checks.google_tts = { status: 'healthy', credentials: 'configured' };
    } else {
      health.checks.google_tts = { status: 'warning', credentials: 'not_configured' };
      // Don't mark as unhealthy - TTS is optional
    }
  } catch (error) {
    health.checks.google_tts = { status: 'error', error: error.message };
  }

  // Check 3: Disk space (outputs directory)
  try {
    const { execSync } = require('child_process');
    const outputsDir = path.join(__dirname, 'outputs');
    
    // Ensure outputs directory exists
    if (!fs.existsSync(outputsDir)) {
      fs.mkdirSync(outputsDir, { recursive: true });
    }
    
    // Get disk space (Windows compatible)
    const drive = outputsDir.substring(0, 2); // e.g., "D:"
    const diskInfo = execSync(`wmic logicaldisk where "DeviceID='${drive}' get FreeSpace,Size /format:csv`, { encoding: 'utf8' });
    const lines = diskInfo.trim().split('\n').filter(l => l.includes(','));
    
    if (lines.length > 0) {
      const parts = lines[0].split(',');
      const freeSpace = parseInt(parts[1]) || 0;
      const totalSpace = parseInt(parts[2]) || 0;
      const freeGB = (freeSpace / (1024 * 1024 * 1024)).toFixed(2);
      const totalGB = (totalSpace / (1024 * 1024 * 1024)).toFixed(2);
      const usedPercent = totalSpace > 0 ? ((1 - freeSpace / totalSpace) * 100).toFixed(1) : 0;
      
      health.checks.disk_space = {
        status: freeSpace > 5 * 1024 * 1024 * 1024 ? 'healthy' : 'warning', // 5GB threshold
        free_gb: freeGB,
        total_gb: totalGB,
        used_percent: `${usedPercent}%`
      };
      
      if (freeSpace < 1 * 1024 * 1024 * 1024) { // Less than 1GB
        health.checks.disk_space.status = 'critical';
        allHealthy = false;
      }
    }
  } catch (error) {
    health.checks.disk_space = { status: 'unknown', error: 'Unable to check disk space' };
  }

  // Check 4: Job queue health
  health.checks.job_queue = {
    status: 'healthy',
    active_jobs: jobs.size,
    jobs_list: Array.from(jobs.values()).map(j => ({
      id: j.jobId,
      chapter: j.chapter_id,
      status: j.status,
      progress: j.progress
    }))
  };

  // Overall status
  health.status = allHealthy ? 'healthy' : 'degraded';

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
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
  console.log('\n' + '='.repeat(70));
  console.log('🚀 Journey Creation - Audio Revision Pipeline');
  console.log('='.repeat(70));
  console.log(`📡 Server Running:    http://localhost:${PORT}`);
  console.log('');
  console.log('📚 PIPELINE STAGES:');
  console.log('   1️⃣  PDF Upload → Markdown Extraction');
  console.log('   2️⃣  Concept Extraction + Chapter Analysis (LLM)');
  console.log('   3️⃣  Episode Planning (Sequential, Textbook Order Preserved)');
  console.log('   4️⃣  Script Generation (Conversational Audio)');
  console.log('   5️⃣  Text-to-Speech (Google Cloud TTS)');
  console.log('');
  console.log('🎓 TEACHER INTERFACE:');
  console.log(`   📤 Upload Chapter:    http://localhost:${PORT}/teacher/upload.html`);
  console.log(`   📝 Review & Approve:  http://localhost:${PORT}/teacher/review.html`);
  console.log(`   🎤 Voice Settings:    http://localhost:${PORT}/teacher/voice-config.html`);
  console.log(`   📊 System Logs:       http://localhost:${PORT}/teacher/logs.html`);
  console.log('');
  console.log('🔧 BACKEND SERVICES:');
  console.log(`   🤖 LLM Service:       http://127.0.0.1:8000`);
  console.log('      Start: cd hf_backend && python main.py');
  console.log('');
  console.log('✨ RECENT UPDATES:');
  console.log('   ✅ Enhanced chapter analysis prompt (210+ lines)');
  console.log('   ✅ Sequential episode planning (preserves textbook order)');
  console.log('   ✅ No concept reordering - respects pedagogical flow');
  console.log('   ✅ Improved error handling and validation');
  console.log('='.repeat(70) + '\n');
  
  logger.info(`Journey Creation server running on port ${PORT} - Pipeline ready`);
});

module.exports = app;