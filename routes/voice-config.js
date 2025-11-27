/**
 * Voice Configuration API Routes
 * Handles speaker name customization, voice selection, and TTS settings
 */

const express = require('express');
const router = express.Router();
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// Initialize TTS orchestrator (now exported as an instance)
const ttsOrchestrator = require('../services/tts/tts_orchestrator');

// In-memory storage for user configurations (use database in production)
const userConfigurations = new Map();

/**
 * GET /api/v1/tts/config
 * Get current TTS configuration
 */
router.get('/config', async (req, res) => {
  try {
    const userId = req.headers['user-id'] || 'default';
    
    // Get saved configuration or default
    let config = userConfigurations.get(userId);
    
    if (!config && ttsOrchestrator) {
      // Generate default configuration
      config = {
        speakers: {
          speaker1: {
            name: 'StudentA',
            role: 'student',
            personality: 'confident',
            voice: 'en-US-Neural2-D'
          },
          speaker2: {
            name: 'StudentB',
            role: 'student',
            personality: 'curious',
            voice: 'en-US-Neural2-A'
          }
        },
        audio: ttsOrchestrator.getAudioConfiguration(),
        metadata: {
          lastUpdated: new Date(),
          version: '1.0'
        }
      };
    }
    
    res.json(config || { error: 'TTS not configured' });
    
  } catch (error) {
    logger.error('Error getting TTS config:', error);
    res.status(500).json({ error: 'Failed to get configuration' });
  }
});

/**
 * PUT /api/v1/tts/config
 * Save TTS configuration with speaker names and voice selections
 */
router.put('/config', async (req, res) => {
  try {
    const userId = req.headers['user-id'] || 'default';
    const config = req.body;
    
    // Validate configuration
    const validation = validateConfiguration(config);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Invalid configuration',
        issues: validation.issues
      });
    }
    
    // Save configuration
    config.metadata = {
      lastUpdated: new Date(),
      version: '1.0',
      userId: userId
    };
    
    userConfigurations.set(userId, config);
    
    logger.info(`Configuration saved for user ${userId}`, {
      speakers: Object.keys(config.speakers).map(key => ({
        id: key,
        name: config.speakers[key].name,
        voice: config.speakers[key].voice
      }))
    });
    
    res.json({
      success: true,
      message: 'Configuration saved successfully',
      config: config
    });
    
  } catch (error) {
    logger.error('Error saving TTS config:', error);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

/**
 * GET /api/v1/tts/voices
 * Get available Google TTS voices
 */
router.get('/voices', async (req, res) => {
  try {
    const language = req.query.language || 'en-US';
    
    if (!ttsOrchestrator) {
      return res.status(503).json({ error: 'TTS service not available' });
    }
    
    // Get available voices from TTS orchestrator
    const availableVoices = ttsOrchestrator.getAvailableVoices();
    
    // Also get real-time voice list from Google (if credentials configured)
    let liveVoices = [];
    try {
      liveVoices = await ttsOrchestrator.validateAndListVoices(language);
    } catch (error) {
      logger.warn('Could not fetch live voice list:', error.message);
    }
    
    res.json({
      available: availableVoices,
      live: liveVoices,
      language: language,
      recommendations: getVoiceRecommendations(language)
    });
    
  } catch (error) {
    logger.error('Error getting available voices:', error);
    res.status(500).json({ error: 'Failed to get voice list' });
  }
});

/**
 * POST /api/v1/tts/preview
 * Generate voice preview audio
 */
router.post('/preview', async (req, res) => {
  try {
    const { voice, text, speakingRate, pitch, volumeGain } = req.body;
    
    if (!voice || !text) {
      return res.status(400).json({ error: 'Voice and text are required' });
    }
    
    if (!ttsOrchestrator) {
      return res.status(503).json({ error: 'TTS service not available' });
    }
    
    // Generate preview with custom settings
    const previewConfig = {
      voice: {
        name: voice,
        languageCode: voice.startsWith('en-US') ? 'en-US' : 'en-IN'
        // ssmlGender is inferred by Google from the voice name
      },
      audioConfig: {
        audioEncoding: 'MP3',
        sampleRateHertz: 22050,
        speakingRate: parseFloat(speakingRate) || 1.0,
        pitch: parseFloat(pitch) || 0.0,
        volumeGainDb: parseFloat(volumeGain) || 0.0
      }
    };
    
    const audioBuffer = await ttsOrchestrator.synthesizeText(text, previewConfig);
    
    // Return audio as base64 or binary
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'no-cache'
    });
    
    res.send(audioBuffer);
    
  } catch (error) {
    logger.error('Error generating voice preview:', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
});

/**
 * POST /api/v1/tts/test
 * Test full configuration with sample episode generation
 */
router.post('/test', async (req, res) => {
  try {
    const { config, testScript } = req.body;
    const userId = req.headers['user-id'] || 'default';
    
    if (!config || !testScript) {
      return res.status(400).json({ error: 'Configuration and test script are required' });
    }
    
    if (!ttsOrchestrator) {
      return res.status(503).json({ error: 'TTS service not available' });
    }
    
    // Update TTS orchestrator with new configuration
    ttsOrchestrator.updateVoiceConfiguration({
      StudentA: {
        name: config.speakers.speaker1.voice,
        displayName: config.speakers.speaker1.name,
        personality: config.speakers.speaker1.personality,
        role: config.speakers.speaker1.role
      },
      StudentB: {
        name: config.speakers.speaker2.voice,
        displayName: config.speakers.speaker2.name,
        personality: config.speakers.speaker2.personality,
        role: config.speakers.speaker2.role
      }
    });
    
    // Generate test audio
    const testData = {
      script: testScript,
      metadata: {
        title: 'Voice Configuration Test',
        duration: 30,
        speakers: config.speakers
      }
    };
    
    const audioResult = await ttsOrchestrator.generateEpisodeAudio(
      testData,
      'test-config',
      1
    );
    
    res.json({
      success: true,
      message: 'Test audio generated successfully',
      audioPath: audioResult.finalAudioPath,
      speakers: {
        [config.speakers.speaker1.name]: audioResult.segments.filter(s => s.speaker === 'StudentA').length,
        [config.speakers.speaker2.name]: audioResult.segments.filter(s => s.speaker === 'StudentB').length
      },
      duration: audioResult.totalDuration
    });
    
  } catch (error) {
    logger.error('Error generating test audio:', error);
    res.status(500).json({ error: 'Failed to generate test audio' });
  }
});

/**
 * GET /api/v1/tts/speakers
 * Get current speaker configurations
 */
router.get('/speakers', async (req, res) => {
  try {
    const userId = req.headers['user-id'] || 'default';
    const config = userConfigurations.get(userId);
    
    if (!config) {
      return res.json({
        speakers: {
          speaker1: { name: 'StudentA', role: 'student', personality: 'confident' },
          speaker2: { name: 'StudentB', role: 'student', personality: 'curious' }
        }
      });
    }
    
    res.json({
      speakers: config.speakers,
      lastUpdated: config.metadata?.lastUpdated
    });
    
  } catch (error) {
    logger.error('Error getting speakers:', error);
    res.status(500).json({ error: 'Failed to get speaker configuration' });
  }
});

/**
 * PUT /api/v1/tts/speakers/:speakerId
 * Update individual speaker configuration
 */
router.put('/speakers/:speakerId', async (req, res) => {
  try {
    const { speakerId } = req.params;
    const { name, role, personality, voice } = req.body;
    const userId = req.headers['user-id'] || 'default';
    
    if (!['speaker1', 'speaker2'].includes(speakerId)) {
      return res.status(400).json({ error: 'Invalid speaker ID' });
    }
    
    let config = userConfigurations.get(userId) || { speakers: {} };
    
    config.speakers[speakerId] = {
      name: name || config.speakers[speakerId]?.name || `Student${speakerId.slice(-1)}`,
      role: role || 'student',
      personality: personality || 'friendly',
      voice: voice || 'en-US-Neural2-A'
    };
    
    config.metadata = {
      lastUpdated: new Date(),
      version: '1.0'
    };
    
    userConfigurations.set(userId, config);
    
    res.json({
      success: true,
      speaker: config.speakers[speakerId]
    });
    
  } catch (error) {
    logger.error('Error updating speaker:', error);
    res.status(500).json({ error: 'Failed to update speaker' });
  }
});

// Helper functions

/**
 * Validate TTS configuration
 */
function validateConfiguration(config) {
  const issues = [];
  
  if (!config.speakers) {
    issues.push('Speakers configuration is required');
  } else {
    // Validate speaker names
    Object.keys(config.speakers).forEach(speakerId => {
      const speaker = config.speakers[speakerId];
      if (!speaker.name || speaker.name.trim().length === 0) {
        issues.push(`Speaker ${speakerId} must have a name`);
      }
      if (!speaker.voice) {
        issues.push(`Speaker ${speakerId} must have a voice selected`);
      }
    });
  }
  
  if (config.audio) {
    if (config.audio.speakingRate && (config.audio.speakingRate < 0.25 || config.audio.speakingRate > 4.0)) {
      issues.push('Speaking rate must be between 0.25 and 4.0');
    }
    if (config.audio.pitch && (config.audio.pitch < -20 || config.audio.pitch > 20)) {
      issues.push('Pitch must be between -20 and 20 semitones');
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues: issues
  };
}

/**
 * Get voice recommendations based on language and use case
 */
function getVoiceRecommendations(language) {
  const recommendations = {
    'en-US': {
      education: ['en-US-Neural2-A', 'en-US-Neural2-D', 'en-US-Journey-O'],
      professional: ['en-US-Neural2-F', 'en-US-Neural2-I'],
      friendly: ['en-US-Neural2-C', 'en-US-Neural2-J']
    },
    'en-IN': {
      education: ['en-IN-Neural2-A', 'en-IN-Neural2-B'],
      professional: ['en-IN-Neural2-C', 'en-IN-Neural2-D']
    }
  };
  
  return recommendations[language] || recommendations['en-US'];
}

module.exports = router;