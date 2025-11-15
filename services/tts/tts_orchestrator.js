const fs = require('fs');
const path = require('path');
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');
const { execSync } = require('child_process');
const crypto = require('crypto');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

class TTSOrchestrator {
  constructor() {
    this.googleTTSClient = null;
    this.initializeGoogleTTS();
    
    // Voice configurations
    this.voiceConfig = {
      StudentA: {
        name: 'en-US-Chirp3-HD-Achird', // Confident voice
        personality: 'confident',
        ssmlPrefix: '<prosody rate="medium" pitch="+0.5st">'
      },
      StudentB: {
        name: 'en-US-Chirp3-HD-Aoede', // Curious voice  
        personality: 'curious',
        ssmlPrefix: '<prosody rate="medium" pitch="-0.5st">'
      }
    };

    this.audioConfig = {
      audioEncoding: 'MP3',
      sampleRateHertz: 44100,
      speakingRate: 1.0,
      pitch: 0
    };

    // FFmpeg path - update for your system
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  }

  /**
   * Initialize Google TTS client
   */
  initializeGoogleTTS() {
    try {
      const apiKey = process.env.GOOGLE_TTS_API_KEY;
      const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      
      if (apiKey) {
        this.googleTTSClient = new TextToSpeechClient({
          apiKey: apiKey
        });
        logger.info('✅ Google TTS client initialized with API key');
      } else if (serviceAccountPath) {
        this.googleTTSClient = new TextToSpeechClient({
          keyFilename: serviceAccountPath
        });
        logger.info('✅ Google TTS client initialized with service account');
      } else {
        throw new Error(
          '❌ GOOGLE_TTS_API_KEY or GOOGLE_APPLICATION_CREDENTIALS required for K-12 content pipeline. ' +
          'Get your API key from: https://console.cloud.google.com/apis/credentials'
        );
      }

      // Test the TTS connection
      this.testTTSConnection();
      
    } catch (error) {
      logger.error(`❌ Google TTS initialization failed: ${error.message}`);
      throw error;
    }
  }

  async testTTSConnection() {
    try {
      const [response] = await this.googleTTSClient.synthesizeSpeech({
        input: { text: 'Test' },
        voice: { languageCode: 'en-US', name: 'en-US-Chirp3-HD-Achird' },
        audioConfig: { audioEncoding: 'MP3' }
      });
      logger.info('✅ Google TTS connection test successful');
    } catch (error) {
      logger.error(`❌ Google TTS connection test failed: ${error.message}`);
      throw new Error('TTS API key appears to be invalid - connection test failed');
    }
  }

  /**
   * Generate audio for complete episode
   */
  async generateEpisodeAudio(episodeData, chapterId, episodeIndex) {
    try {
      logger.info(`Generating audio for chapter ${chapterId}, episode ${episodeIndex}`);

      if (!this.googleTTSClient) {
        throw new Error(
          'Google TTS not initialized. Please set GOOGLE_TTS_API_KEY in .env file. ' +
          'Get your API key from: https://console.cloud.google.com/apis/credentials'
        );
      }

      // Create episode directory
      const episodeDir = path.join(__dirname, '../../outputs', `chapter_${chapterId}`, 'episodes', `ep${episodeIndex.toString().padStart(2, '0')}`);
      const audioDir = path.join(episodeDir, 'audio');
      
      if (!fs.existsSync(audioDir)) {
        fs.mkdirSync(audioDir, { recursive: true });
      }

      // Parse script into segments
      const segments = this.parseScriptIntoSegments(episodeData.script, episodeData.pronunciation_hints);
      
      // Create speaker directories
      const speakerDirs = {
        StudentA: path.join(audioDir, 'a_segments'),
        StudentB: path.join(audioDir, 'b_segments')
      };

      for (const dir of Object.values(speakerDirs)) {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      // Generate audio for each segment
      const audioSegments = [];
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const audioPath = await this.generateSegmentAudio(segment, speakerDirs[segment.speaker], i);
        
        audioSegments.push({
          ...segment,
          audioPath: audioPath,
          segmentIndex: i
        });
      }

      // Merge all segments into final audio
      const finalAudioPath = await this.mergeAudioSegments(audioSegments, audioDir);
      
      // Generate cues.json with timing information
      const cues = await this.generateCueFile(audioSegments, finalAudioPath);
      fs.writeFileSync(path.join(episodeDir, 'cues.json'), JSON.stringify(cues, null, 2));

      logger.info(`Episode audio generation completed: ${finalAudioPath}`);
      return {
        finalAudioPath: finalAudioPath,
        segmentCount: audioSegments.length,
        totalDuration: cues.total_duration_seconds,
        cues: cues
      };

    } catch (error) {
      logger.error(`Episode audio generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse script text into individual audio segments
   */
  parseScriptIntoSegments(scriptData, pronunciationHints = {}) {
    const segments = [];
    let segmentIndex = 0;

    // Process each section of the script
    for (const section of scriptData.sections) {
      const lines = section.text.split('\n').filter(line => line.trim().length > 0);
      
      for (const line of lines) {
        const speakerMatch = line.match(/^(Student[AB]):\s*(.+)$/);
        if (speakerMatch) {
          const speaker = speakerMatch[1];
          let text = speakerMatch[2].trim();
          
          // Apply pronunciation hints
          text = this.applyPronunciationHints(text, pronunciationHints);
          
          // Add SSML formatting
          const ssmlText = this.generateSSML(text, speaker, section);
          
          segments.push({
            segmentIndex: segmentIndex++,
            speaker: speaker,
            text: text,
            ssmlText: ssmlText,
            sectionId: section.id,
            sectionStart: section.start,
            estimatedDuration: this.estimateSegmentDuration(text)
          });
        }
      }
    }

    return segments;
  }

  /**
   * Apply pronunciation hints to text
   */
  applyPronunciationHints(text, pronunciationHints) {
    let processedText = text;
    
    for (const [term, phonetic] of Object.entries(pronunciationHints)) {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      processedText = processedText.replace(regex, `<sub alias="${phonetic}">${term}</sub>`);
    }
    
    return processedText;
  }

  /**
   * Generate SSML markup for enhanced speech
   */
  generateSSML(text, speaker, section) {
    const voiceConfig = this.voiceConfig[speaker];
    let ssml = `<speak>`;
    
    // Add speaker-specific prosody
    ssml += voiceConfig.ssmlPrefix;
    
    // Add section-specific breaks
    if (section.id === 'hook') {
      ssml += '<emphasis level="moderate">';
    }
    
    // Add the text content
    ssml += text;
    
    // Close emphasis if added
    if (section.id === 'hook') {
      ssml += '</emphasis>';
    }
    
    // Add section break
    if (section.id !== 'mini-summary') {
      ssml += '<break time="300ms"/>';
    }
    
    // Close prosody and speak tags
    ssml += '</prosody></speak>';
    
    return ssml;
  }

  /**
   * Estimate segment duration in seconds
   */
  estimateSegmentDuration(text) {
    // Average speaking rate: ~150 words per minute
    const words = text.split(/\s+/).length;
    const baseDuration = (words / 150) * 60; // Convert to seconds
    
    // Add buffer for natural pauses
    return Math.max(baseDuration * 1.2, 2); // Minimum 2 seconds
  }

  /**
   * Generate audio for individual segment
   */
  async generateSegmentAudio(segment, outputDir, index) {
    try {
      const voiceConfig = this.voiceConfig[segment.speaker];
      const filename = `segment_${index.toString().padStart(3, '0')}_${crypto.createHash('md5').update(segment.text).digest('hex').substring(0, 8)}.mp3`;
      const outputPath = path.join(outputDir, filename);

      // Skip if file already exists (for caching)
      if (fs.existsSync(outputPath)) {
        logger.info(`Using cached audio: ${filename}`);
        return outputPath;
      }

      // Prepare TTS request
      const request = {
        input: { ssml: segment.ssmlText },
        voice: {
          languageCode: 'en-US',
          name: voiceConfig.name
        },
        audioConfig: this.audioConfig
      };

      logger.info(`Generating TTS for ${segment.speaker}: "${segment.text.substring(0, 50)}..."`);

      // Call Google TTS
      const [response] = await this.googleTTSClient.synthesizeSpeech(request);
      
      // Save audio file
      fs.writeFileSync(outputPath, response.audioContent, 'binary');
      
      logger.info(`✅ Audio segment saved: ${filename}`);
      return outputPath;

    } catch (error) {
      logger.error(`Failed to generate segment audio: ${error.message}`);
      throw error;
    }
  }

  /**
   * Merge audio segments into final episode audio
   */
  async mergeAudioSegments(segments, outputDir) {
    try {
      const finalAudioPath = path.join(outputDir, 'final_audio.mp3');
      
      if (segments.length === 0) {
        throw new Error('No audio segments to merge');
      }

      // Create file list for FFmpeg
      const fileListPath = path.join(outputDir, 'merge_list.txt');
      const fileList = segments
        .sort((a, b) => a.segmentIndex - b.segmentIndex)
        .map(segment => `file '${path.relative(outputDir, segment.audioPath)}'`)
        .join('\n');
      
      fs.writeFileSync(fileListPath, fileList);

      // Use FFmpeg to concatenate audio files
      const ffmpegCmd = [
        this.ffmpegPath,
        '-f', 'concat',
        '-safe', '0',
        '-i', `"${fileListPath}"`,
        '-c', 'copy',
        '-y', // Overwrite output file
        `"${finalAudioPath}"`
      ].join(' ');

      logger.info('Merging audio segments with FFmpeg...');
      execSync(ffmpegCmd, { stdio: 'pipe' });

      // Apply audio normalization
      await this.normalizeAudio(finalAudioPath);

      // Clean up temp file
      fs.unlinkSync(fileListPath);

      logger.info(`✅ Final audio created: ${finalAudioPath}`);
      return finalAudioPath;

    } catch (error) {
      logger.error(`Audio merging failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Apply audio normalization and quality enhancements
   */
  async normalizeAudio(audioPath) {
    try {
      const tempPath = audioPath.replace('.mp3', '_temp.mp3');
      
      // FFmpeg command for normalization
      const normalizeCmd = [
        this.ffmpegPath,
        '-i', `"${audioPath}"`,
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
        '-c:a', 'mp3',
        '-b:a', '128k',
        '-y',
        `"${tempPath}"`
      ].join(' ');

      execSync(normalizeCmd, { stdio: 'pipe' });
      
      // Replace original with normalized version
      fs.renameSync(tempPath, audioPath);
      
      logger.info('Audio normalization completed');

    } catch (error) {
      logger.warn(`Audio normalization failed: ${error.message}`);
      // Continue without normalization rather than failing
    }
  }

  /**
   * Generate cue file with precise timing information
   */
  async generateCueFile(segments, finalAudioPath) {
    try {
      // Get actual audio duration using FFprobe
      const totalDuration = await this.getAudioDuration(finalAudioPath);
      
      const cues = {
        episode_audio_path: finalAudioPath,
        total_duration_seconds: totalDuration,
        segments: [],
        sections: {}
      };

      let currentTime = 0;
      let currentSection = null;
      let sectionStart = 0;

      for (const segment of segments.sort((a, b) => a.segmentIndex - b.segmentIndex)) {
        // Get actual segment duration
        const segmentDuration = await this.getAudioDuration(segment.audioPath);
        
        // Track section boundaries
        if (segment.sectionId !== currentSection) {
          if (currentSection) {
            cues.sections[currentSection].end_seconds = currentTime;
          }
          currentSection = segment.sectionId;
          sectionStart = currentTime;
          cues.sections[currentSection] = {
            start_seconds: sectionStart,
            end_seconds: null // Will be set when section ends
          };
        }

        // Add segment cue
        cues.segments.push({
          segment_index: segment.segmentIndex,
          speaker: segment.speaker,
          text: segment.text,
          start_seconds: currentTime,
          end_seconds: currentTime + segmentDuration,
          section_id: segment.sectionId
        });

        currentTime += segmentDuration;
      }

      // Close final section
      if (currentSection) {
        cues.sections[currentSection].end_seconds = currentTime;
      }

      return cues;

    } catch (error) {
      logger.error(`Cue file generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get audio file duration using FFprobe
   */
  async getAudioDuration(audioPath) {
    try {
      const cmd = `${this.ffmpegPath.replace('ffmpeg', 'ffprobe')} -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`;
      const output = execSync(cmd, { encoding: 'utf8' });
      return parseFloat(output.trim());
    } catch (error) {
      logger.warn(`Could not determine audio duration for ${audioPath}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Validate generated audio quality
   */
  async validateAudioQuality(audioPath, expectedDuration) {
    const validation = {
      isValid: true,
      issues: []
    };

    try {
      // Check file exists
      if (!fs.existsSync(audioPath)) {
        validation.isValid = false;
        validation.issues.push('Audio file does not exist');
        return validation;
      }

      // Check duration
      const actualDuration = await this.getAudioDuration(audioPath);
      const durationDiff = Math.abs(actualDuration - expectedDuration) / expectedDuration;
      
      if (durationDiff > 0.1) { // More than 10% difference
        validation.issues.push(`Duration mismatch: expected ${expectedDuration}s, got ${actualDuration}s`);
      }

      // Check file size (should be reasonable for MP3)
      const stats = fs.statSync(audioPath);
      const expectedSize = expectedDuration * 16000; // ~16KB per second for 128kbps MP3
      
      if (stats.size < expectedSize * 0.5 || stats.size > expectedSize * 3) {
        validation.issues.push(`Unusual file size: ${stats.size} bytes`);
      }

      validation.isValid = validation.issues.length === 0;

    } catch (error) {
      validation.isValid = false;
      validation.issues.push(`Validation error: ${error.message}`);
    }

    return validation;
  }
}

module.exports = new TTSOrchestrator();