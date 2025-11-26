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
    
    // Initialize voice configurations BEFORE TTS client
    this.availableVoices = this.getAvailableVoices();
    
    // Language-specific voice mappings for K-12 education
    this.educationalVoices = {
      'en-US': {
        StudentA: { name: 'en-US-Neural2-D', gender: 'MALE', personality: 'confident' },
        StudentB: { name: 'en-US-Neural2-F', gender: 'FEMALE', personality: 'curious' }
      },
      'en-IN': {
        StudentA: { name: 'en-IN-Neural2-B', gender: 'MALE', personality: 'confident' },
        StudentB: { name: 'en-IN-Neural2-A', gender: 'FEMALE', personality: 'curious' }
      },
      'en-GB': {
        StudentA: { name: 'en-GB-Neural2-B', gender: 'MALE', personality: 'confident' },
        StudentB: { name: 'en-GB-Neural2-A', gender: 'FEMALE', personality: 'curious' }
      },
      'hi-IN': {
        StudentA: { name: 'hi-IN-Neural2-B', gender: 'MALE', personality: 'confident' },
        StudentB: { name: 'hi-IN-Neural2-A', gender: 'FEMALE', personality: 'curious' }
      }
    };

    // FFmpeg and FFprobe paths - update for your system
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
    this.ffprobePath = process.env.FFPROBE_PATH || (this.ffmpegPath.includes('ffmpeg.exe') ? this.ffmpegPath.replace('ffmpeg.exe', 'ffprobe.exe') : 'ffprobe');
    
    // Initialize voice and audio configurations
    this.voiceConfig = this.getOptimalVoiceConfig();
    this.audioConfig = this.getAudioConfiguration();
    
    // Initialize TTS client AFTER configurations are set
    this.initializeGoogleTTS();
  }

  /**
   * Get comprehensive available voices from Google TTS
   * Updated list - only verified working voices
   */
  getAvailableVoices() {
    return {
      // Journey Voices (Latest Generation - Best for Education)
      journey: {
        'en-US': [
          'en-US-Journey-D', 'en-US-Journey-F', 'en-US-Journey-O'
        ]
      },
      // Studio Voices (High Quality Natural)
      studio: {
        'en-US': [
          'en-US-Studio-O', 'en-US-Studio-Q'
        ]
      },
      // Neural2 Voices (High Quality - Expressive)
      neural2: {
        'en-US': [
          'en-US-Neural2-A', 'en-US-Neural2-C', 'en-US-Neural2-D', 'en-US-Neural2-E',
          'en-US-Neural2-F', 'en-US-Neural2-G', 'en-US-Neural2-H', 'en-US-Neural2-I', 'en-US-Neural2-J'
        ],
        'en-IN': ['en-IN-Neural2-A', 'en-IN-Neural2-B', 'en-IN-Neural2-C', 'en-IN-Neural2-D'],
        'en-GB': ['en-GB-Neural2-A', 'en-GB-Neural2-B', 'en-GB-Neural2-C', 'en-GB-Neural2-D', 'en-GB-Neural2-F'],
        'hi-IN': ['hi-IN-Neural2-A', 'hi-IN-Neural2-B', 'hi-IN-Neural2-C', 'hi-IN-Neural2-D']
      },
      // WaveNet Voices (Good Quality - Natural Sounding)
      wavenet: {
        'en-US': [
          'en-US-Wavenet-A', 'en-US-Wavenet-B', 'en-US-Wavenet-C', 'en-US-Wavenet-D',
          'en-US-Wavenet-E', 'en-US-Wavenet-F', 'en-US-Wavenet-G', 'en-US-Wavenet-H',
          'en-US-Wavenet-I', 'en-US-Wavenet-J'
        ],
        'en-IN': ['en-IN-Wavenet-A', 'en-IN-Wavenet-B', 'en-IN-Wavenet-C', 'en-IN-Wavenet-D'],
        'en-GB': ['en-GB-Wavenet-A', 'en-GB-Wavenet-B', 'en-GB-Wavenet-C', 'en-GB-Wavenet-D', 'en-GB-Wavenet-F'],
        'hi-IN': ['hi-IN-Wavenet-A', 'hi-IN-Wavenet-B', 'hi-IN-Wavenet-C', 'hi-IN-Wavenet-D']
      },
      // Standard Voices (Cost Effective - Basic Quality)
      standard: {
        'en-US': [
          'en-US-Standard-A', 'en-US-Standard-B', 'en-US-Standard-C', 'en-US-Standard-D',
          'en-US-Standard-E', 'en-US-Standard-F', 'en-US-Standard-G', 'en-US-Standard-H',
          'en-US-Standard-I', 'en-US-Standard-J'
        ],
        'en-IN': ['en-IN-Standard-A', 'en-IN-Standard-B', 'en-IN-Standard-C', 'en-IN-Standard-D'],
        'en-GB': ['en-GB-Standard-A', 'en-GB-Standard-B', 'en-GB-Standard-C', 'en-GB-Standard-D', 'en-GB-Standard-F'],
        'hi-IN': ['hi-IN-Standard-A', 'hi-IN-Standard-B', 'hi-IN-Standard-C', 'hi-IN-Standard-D']
      }
    };
  }

  /**
   * Get optimal voice configuration for K-12 education
   */
  getOptimalVoiceConfig() {
    const language = process.env.TTS_LANGUAGE || 'en-IN';
    const voiceType = process.env.TTS_VOICE_TYPE || 'neural2'; // neural2, wavenet, journey, studio, standard
    
    // Ensure educationalVoices is initialized before accessing
    const eduVoices = this.educationalVoices || {};
    const langVoices = eduVoices[language] || eduVoices['en-IN'] || {};
    
    return {
      language: language,
      voiceType: voiceType,
      StudentA: {
        name: langVoices.StudentA?.name || 'en-IN-Neural2-B',
        displayName: 'StudentA', // Default display name, can be customized
        languageCode: language,
        ssmlGender: langVoices.StudentA?.gender || 'MALE',
        personality: 'confident',
        role: 'student',
        ssmlPrefix: '<prosody rate="medium" pitch="+0.5st" volume="+2dB">',
        ssmlSuffix: '</prosody>'
      },
      StudentB: {
        name: langVoices.StudentB?.name || 'en-IN-Neural2-A',
        displayName: 'StudentB', // Default display name, can be customized
        languageCode: language,
        ssmlGender: langVoices.StudentB?.gender || 'FEMALE',
        personality: 'curious',
        role: 'student',
        ssmlPrefix: '<prosody rate="medium" pitch="-0.5st" volume="+1dB">',
        ssmlSuffix: '</prosody>'
      }
    };
  }

  /**
   * Get comprehensive audio configuration with all Google TTS options
   */
  getAudioConfiguration() {
    return {
      // Audio Encoding Options: LINEAR16, MP3, OGG_OPUS, MULAW, ALAW
      audioEncoding: process.env.TTS_AUDIO_ENCODING || 'MP3',
      
      // Sample Rate (Hz) - must match encoding
      sampleRateHertz: parseInt(process.env.TTS_SAMPLE_RATE) || 44100, // 8000, 16000, 22050, 24000, 44100, 48000
      
      // Speaking Rate: 0.25 to 4.0 (1.0 = normal)
      speakingRate: parseFloat(process.env.TTS_SPEAKING_RATE) || 1.0,
      
      // Pitch: -20.0 to 20.0 semitones (0 = no change)
      pitch: parseFloat(process.env.TTS_PITCH) || 0,
      
      // Volume Gain: -96.0 to 16.0 dB
      volumeGainDb: parseFloat(process.env.TTS_VOLUME_GAIN) || 0,
      
      // Effects Profile for device optimization
      effectsProfileId: process.env.TTS_EFFECTS_PROFILE || 'handset-class-device', // telephony-class-application, wearable-class-device, headphone-class-device, small-bluetooth-speaker-class-device, medium-bluetooth-speaker-class-device, large-home-entertainment-class-device, large-automotive-class-device
      
      // Advanced Chirp3 HD options
      advancedVoiceOptions: {
        lowLatencyJourneySynthesis: process.env.TTS_LOW_LATENCY === 'true' || false
      }
    };
  }

  /**
   * Select best voice for language and personality
   */
  selectVoice(language, personality, preferredGender = null) {
    const voiceType = this.voiceConfig.voiceType;
    const availableVoices = this.availableVoices[voiceType][language];
    
    if (!availableVoices) {
      logger.warn(`No ${voiceType} voices available for ${language}, falling back to en-US`);
      return this.selectVoice('en-US', personality, preferredGender);
    }
    
    // For educational content, use predefined optimal voices
    if (this.educationalVoices[language]) {
      return personality === 'confident' 
        ? this.educationalVoices[language].StudentA
        : this.educationalVoices[language].StudentB;
    }
    
    // Fallback to first available voice
    return {
      name: availableVoices[0],
      languageCode: language,
      ssmlGender: preferredGender || 'NEUTRAL'
    };
  }

  /**
   * Customize voice parameters for specific content
   */
  customizeVoiceForContent(baseVoice, contentType, ageGroup) {
    const customizations = {
      hook: { pitch: '+1st', rate: '1.1', volume: '+3dB' },
      explanation: { pitch: '0st', rate: '1.0', volume: '+1dB' },
      example: { pitch: '-0.5st', rate: '0.95', volume: '+2dB' },
      summary: { pitch: '+0.5st', rate: '0.9', volume: '+2dB' }
    };
    
    const ageAdjustments = {
      elementary: { rate: '0.9', pitch: '+0.5st' },
      middle: { rate: '1.0', pitch: '0st' },
      high: { rate: '1.1', pitch: '-0.5st' }
    };
    
    const contentCustom = customizations[contentType] || {};
    const ageCustom = ageAdjustments[ageGroup] || {};
    
    return {
      ...baseVoice,
      ssmlPrefix: `<prosody rate="${ageCustom.rate || contentCustom.rate || 'medium'}" pitch="${ageCustom.pitch || contentCustom.pitch || '0st'}" volume="${contentCustom.volume || '+1dB'}">`,
      ssmlSuffix: '</prosody>'
    };
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

      // Test the TTS connection asynchronously (don't await in constructor)
      this.testTTSConnection().catch(err => {
        logger.error(`❌ TTS connection test failed: ${err.message}`);
      });
      
    } catch (error) {
      logger.error(`❌ Google TTS initialization failed: ${error.message}`);
      throw error;
    }
  }

  async testTTSConnection() {
    try {
      // Test with comprehensive configuration
      const testConfig = this.voiceConfig.StudentA;
      
      // Ensure languageCode is set with fallback
      const languageCode = testConfig.languageCode || this.voiceConfig.language || 'en-IN';
      const voiceName = testConfig.name || 'en-IN-Chirp3-HD-Achird';
      const ssmlGender = testConfig.ssmlGender || 'MALE';
      
      const [response] = await this.googleTTSClient.synthesizeSpeech({
        input: { text: 'Test synthesis for K-12 educational content pipeline.' },
        voice: {
          languageCode: languageCode,
          name: voiceName,
          ssmlGender: ssmlGender
        },
        audioConfig: {
          audioEncoding: this.audioConfig.audioEncoding,
          sampleRateHertz: this.audioConfig.sampleRateHertz,
          speakingRate: this.audioConfig.speakingRate,
          pitch: this.audioConfig.pitch
        }
      });
      
      logger.info('✅ Google TTS connection test successful');
      logger.info(`✅ Voice: ${voiceName} (${languageCode})`);
      logger.info(`✅ Audio: ${this.audioConfig.audioEncoding} @ ${this.audioConfig.sampleRateHertz}Hz`);
      
      return {
        success: true,
        voiceConfig: testConfig,
        audioConfig: this.audioConfig,
        responseSize: response.audioContent.length
      };
      
    } catch (error) {
      logger.error(`❌ Google TTS connection test failed: ${error.message}`);
      
      // Provide specific error guidance
      if (error.message.includes('API key')) {
        throw new Error('Invalid Google TTS API key. Please check GOOGLE_TTS_API_KEY in .env file.');
      } else if (error.message.includes('quota')) {
        throw new Error('Google TTS quota exceeded. Please check your billing and usage limits.');
      } else if (error.message.includes('voice') || error.message.includes('language')) {
        throw new Error(`Voice not available: ${this.voiceConfig.StudentA.name}. Please check voice availability and language code in your region.`);
      } else {
        throw new Error(`TTS configuration error: ${error.message}`);
      }
    }
  }

  /**
   * Generate simple test audio (not a full episode)
   */
  async generateTestAudio(testScript, outputDir = null, customVoiceConfig = null) {
    try {
      if (!this.googleTTSClient) {
        throw new Error('Google TTS not initialized');
      }

      // Create output directory for test audio
      const testDir = outputDir || path.join(__dirname, '../../outputs/test_audio');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }

      const timestamp = Date.now();
      const segments = [];

      // Generate audio for each segment
      for (let i = 0; i < testScript.length; i++) {
        const segment = testScript[i];
        
        // Map speaker1/speaker2 to StudentA/StudentB or use custom config
        let voiceConfig;
        if (customVoiceConfig && customVoiceConfig.speakers) {
          const speakerKey = segment.speaker === 'speaker1' ? 'speaker1' : 
                           segment.speaker === 'speaker2' ? 'speaker2' : segment.speaker;
          const customSpeaker = customVoiceConfig.speakers[speakerKey] || 
                               customVoiceConfig.speakers.StudentA || 
                               this.voiceConfig.StudentA;
          
          // Extract languageCode and voice name from voice/voiceId field
          const voiceName = customSpeaker.voice || customSpeaker.voiceId || customSpeaker.name || 'en-IN-Neural2-A';
          const languageCode = voiceName.split('-').slice(0, 2).join('-'); // Extract 'en-IN' from 'en-IN-Neural2-A'
          
          voiceConfig = {
            name: voiceName,
            languageCode: languageCode,
            ssmlGender: customSpeaker.ssmlGender || 'NEUTRAL'
          };
        } else {
          const mappedSpeaker = segment.speaker === 'speaker1' ? 'StudentA' : 
                               segment.speaker === 'speaker2' ? 'StudentB' : segment.speaker;
          voiceConfig = this.voiceConfig[mappedSpeaker] || this.voiceConfig.StudentA;
        }
        
        const filename = `test_${timestamp}_${i}.mp3`;
        const outputPath = path.join(testDir, filename);

        const request = {
          input: { text: segment.text },
          voice: {
            languageCode: voiceConfig.languageCode || 'en-IN',
            name: voiceConfig.name || 'en-IN-Neural2-A',
            ssmlGender: voiceConfig.ssmlGender || 'NEUTRAL'
          },
          audioConfig: {
            audioEncoding: this.audioConfig.audioEncoding,
            sampleRateHertz: this.audioConfig.sampleRateHertz,
            speakingRate: this.audioConfig.speakingRate,
            pitch: this.audioConfig.pitch,
            volumeGainDb: this.audioConfig.volumeGainDb,
            effectsProfileId: this.audioConfig.effectsProfileId ? [this.audioConfig.effectsProfileId] : []
          }
        };

        const [response] = await this.googleTTSClient.synthesizeSpeech(request);
        fs.writeFileSync(outputPath, response.audioContent, 'binary');
        logger.info(`✅ Test audio segment saved: ${filename}`);
        
        segments.push(outputPath);
      }

      // Merge segments if multiple
      if (segments.length > 1) {
        const finalPath = path.join(testDir, `test_${timestamp}_final.mp3`);
        const mergeListPath = path.join(testDir, `merge_list_${timestamp}.txt`);
        const mergeList = segments.map(s => `file '${s}'`).join('\n');
        fs.writeFileSync(mergeListPath, mergeList);

        execSync(`"${this.ffmpegPath}" -f concat -safe 0 -i "${mergeListPath}" -c copy -y "${finalPath}"`);
        
        // Clean up individual segments and merge list
        segments.forEach(s => fs.unlinkSync(s));
        fs.unlinkSync(mergeListPath);
        
        logger.info(`✅ Test audio merged: ${finalPath}`);
        return {
          success: true,
          audioPath: finalPath,
          voiceConfig: this.voiceConfig,
          audioConfig: this.audioConfig
        };
      } else {
        return {
          success: true,
          audioPath: segments[0],
          voiceConfig: this.voiceConfig,
          audioConfig: this.audioConfig
        };
      }

    } catch (error) {
      logger.error(`Test audio generation failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate audio for complete episode
   */
  async generateEpisodeAudio(episodeData, chapterId, episodeIndex, metadata = {}) {
    try {
      logger.info(`Generating audio for chapter ${chapterId}, episode ${episodeIndex}`);

      if (!this.googleTTSClient) {
        throw new Error(
          'Google TTS not initialized. Please set GOOGLE_TTS_API_KEY in .env file. ' +
          'Get your API key from: https://console.cloud.google.com/apis/credentials'
        );
      }

      // Clean output structure: CBSE/Grade-8/Chapter-Name/Episode-1/
      const { grade_band = 'unknown' } = metadata;
      const curriculum = metadata.curriculum || 'CBSE';
      
      // Format chapter name nicely
      const chapterName = chapterId.replace(/_/g, '-').replace(/^chapter-/, '');
      
      const episodeDir = path.join(
        __dirname, 
        '../../outputs', 
        curriculum,
        `Grade-${grade_band}`,
        chapterName,
        `Episode-${episodeIndex}`
      );
      
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
   * Get current TTS configuration for UI display
   */
  getCurrentConfiguration() {
    return {
      voices: {
        StudentA: {
          name: this.voiceConfig.StudentA.name,
          displayName: this.voiceConfig.StudentA.displayName || 'StudentA',
          language: this.voiceConfig.StudentA.languageCode,
          gender: this.voiceConfig.StudentA.ssmlGender,
          personality: this.voiceConfig.StudentA.personality,
          role: this.voiceConfig.StudentA.role || 'student'
        },
        StudentB: {
          name: this.voiceConfig.StudentB.name,
          displayName: this.voiceConfig.StudentB.displayName || 'StudentB',
          language: this.voiceConfig.StudentB.languageCode,
          gender: this.voiceConfig.StudentB.ssmlGender,
          personality: this.voiceConfig.StudentB.personality,
          role: this.voiceConfig.StudentB.role || 'student'
        }
      },
      audio: {
        encoding: this.audioConfig.audioEncoding,
        sampleRate: this.audioConfig.sampleRateHertz,
        speakingRate: this.audioConfig.speakingRate,
        pitch: this.audioConfig.pitch,
        volumeGain: this.audioConfig.volumeGainDb,
        effectsProfile: this.audioConfig.effectsProfileId
      },
      availableLanguages: Object.keys(this.educationalVoices),
      availableVoiceTypes: Object.keys(this.availableVoices)
    };
  }

  /**
   * Update voice configuration dynamically
   */
  updateVoiceConfiguration(newConfig) {
    try {
      // Update speaker-specific configurations
      if (newConfig.StudentA) {
        this.voiceConfig.StudentA = {
          ...this.voiceConfig.StudentA,
          name: newConfig.StudentA.name || this.voiceConfig.StudentA.name,
          displayName: newConfig.StudentA.displayName || this.voiceConfig.StudentA.displayName,
          personality: newConfig.StudentA.personality || this.voiceConfig.StudentA.personality,
          role: newConfig.StudentA.role || this.voiceConfig.StudentA.role
        };
        logger.info(`Updated StudentA configuration: ${this.voiceConfig.StudentA.displayName} (${this.voiceConfig.StudentA.name})`);
      }
      
      if (newConfig.StudentB) {
        this.voiceConfig.StudentB = {
          ...this.voiceConfig.StudentB,
          name: newConfig.StudentB.name || this.voiceConfig.StudentB.name,
          displayName: newConfig.StudentB.displayName || this.voiceConfig.StudentB.displayName,
          personality: newConfig.StudentB.personality || this.voiceConfig.StudentB.personality,
          role: newConfig.StudentB.role || this.voiceConfig.StudentB.role
        };
        logger.info(`Updated StudentB configuration: ${this.voiceConfig.StudentB.displayName} (${this.voiceConfig.StudentB.name})`);
      }
      
      // Update language settings
      if (newConfig.language && this.educationalVoices[newConfig.language]) {
        this.voiceConfig.language = newConfig.language;
        logger.info(`Updated voice configuration for language: ${newConfig.language}`);
      }
      
      // Update audio configuration
      if (newConfig.audio) {
        this.audioConfig = { ...this.audioConfig, ...newConfig.audio };
        logger.info('Updated audio configuration:', newConfig.audio);
      }
      
      return this.getCurrentConfiguration();
    } catch (error) {
      logger.error('Failed to update voice configuration:', error);
      throw new Error(`Voice configuration update failed: ${error.message}`);
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
        // Match both hardcoded format (StudentA/StudentB) and custom speaker names
        const speakerMatch = line.match(/^([^:]+):\s*(.+)$/);
        if (speakerMatch) {
          const speakerName = speakerMatch[1].trim();
          let text = speakerMatch[2].trim();
          
          // Map custom speaker names to internal IDs
          let internalSpeaker = 'StudentA'; // default
          if (this.voiceConfig.StudentA && (
            speakerName === this.voiceConfig.StudentA.displayName || 
            speakerName === this.voiceConfig.StudentA.name ||
            speakerName === 'StudentA'
          )) {
            internalSpeaker = 'StudentA';
          } else if (this.voiceConfig.StudentB && (
            speakerName === this.voiceConfig.StudentB.displayName || 
            speakerName === this.voiceConfig.StudentB.name ||
            speakerName === 'StudentB'
          )) {
            internalSpeaker = 'StudentB';
          } else {
            // If no match, assign based on order (first speaker = A, second = B)
            internalSpeaker = segments.filter(s => s.speaker === 'StudentA').length <= 
                             segments.filter(s => s.speaker === 'StudentB').length ? 'StudentA' : 'StudentB';
          }
          
          // Apply pronunciation hints
          text = this.applyPronunciationHints(text, pronunciationHints);
          
          // Add SSML formatting
          const ssmlText = this.generateSSML(text, internalSpeaker, section);
          
          segments.push({
            segmentIndex: segmentIndex++,
            speaker: internalSpeaker,
            originalSpeakerName: speakerName,
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
   * Generate comprehensive SSML markup with all available features
   */
  generateSSML(text, speaker, section, metadata = {}) {
    const voiceConfig = this.voiceConfig[speaker];
    const ageGroup = metadata.age_group || 'middle';
    const contentType = section.id;
    
    // Customize voice for specific content and age
    const customVoice = this.customizeVoiceForContent(voiceConfig, contentType, ageGroup);
    
    let ssml = '<speak>';
    
    // Add comprehensive prosody with all options
    ssml += customVoice.ssmlPrefix;
    
    // Add section-specific emphasis and breaks
    switch (section.id) {
      case 'hook':
        ssml += '<emphasis level="strong">';
        break;
      case 'core1':
      case 'core2':
        ssml += '<emphasis level="moderate">';
        break;
      case 'mini-summary':
        ssml += '<emphasis level="reduced"><prosody rate="0.9">';
        break;
    }
    
    // Add natural pauses for readability
    const processedText = this.addNaturalPauses(text);
    ssml += processedText;
    
    // Close section-specific tags
    switch (section.id) {
      case 'hook':
      case 'core1':
      case 'core2':
        ssml += '</emphasis>';
        break;
      case 'mini-summary':
        ssml += '</prosody></emphasis>';
        break;
    }
    
    // Add section transition breaks
    const sectionBreaks = {
      hook: '<break time="500ms"/>',
      core1: '<break time="300ms"/>',
      core2: '<break time="300ms"/>',
      'mini-summary': '<break time="200ms"/>'
    };
    
    if (sectionBreaks[section.id]) {
      ssml += sectionBreaks[section.id];
    }
    
    // Close main prosody and speak tags
    ssml += customVoice.ssmlSuffix + '</speak>';
    
    return ssml;
  }

  /**
   * Add natural pauses for better speech flow
   */
  addNaturalPauses(text) {
    return text
      .replace(/([.!?])\s+/g, '$1<break time="400ms"/> ') // Long pause after sentences
      .replace(/([,;])\s+/g, '$1<break time="200ms"/> ') // Short pause after commas
      .replace(/([:-])\s+/g, '$1<break time="300ms"/> ') // Medium pause after colons
      .replace(/\b(however|therefore|moreover|furthermore|additionally)\b/gi, '<break time="250ms"/>$1') // Pause before transition words
      .replace(/\b(for example|such as|in other words)\b/gi, '<break time="300ms"/>$1<break time="200ms"/>');
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

      // Prepare comprehensive TTS request with all Google TTS options
      const request = {
        input: { ssml: segment.ssmlText },
        voice: {
          languageCode: voiceConfig.languageCode,
          name: voiceConfig.name,
          ssmlGender: voiceConfig.ssmlGender
        },
        audioConfig: {
          audioEncoding: this.audioConfig.audioEncoding,
          sampleRateHertz: this.audioConfig.sampleRateHertz,
          speakingRate: this.audioConfig.speakingRate,
          pitch: this.audioConfig.pitch,
          volumeGainDb: this.audioConfig.volumeGainDb,
          effectsProfileId: [this.audioConfig.effectsProfileId]
        },
        ...(this.audioConfig.advancedVoiceOptions && {
          advancedVoiceOptions: this.audioConfig.advancedVoiceOptions
        })
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
   * Synthesize text with custom configuration (for previews and testing)
   */
  async synthesizeText(text, customConfig = {}) {
    try {
      if (!this.googleTTSClient) {
        throw new Error('Google TTS client not initialized. Please check your credentials.');
      }

      // Use custom config or fall back to default
      const voiceConfig = customConfig.voice || {
        name: this.voiceConfig.StudentA.name,
        languageCode: this.voiceConfig.StudentA.languageCode,
        ssmlGender: this.voiceConfig.StudentA.ssmlGender
      };

      const audioConfig = customConfig.audioConfig || this.audioConfig;

      // Prepare TTS request
      const request = {
        input: { text: text },
        voice: voiceConfig,
        audioConfig: {
          audioEncoding: audioConfig.audioEncoding || 'MP3',
          sampleRateHertz: audioConfig.sampleRateHertz || 22050,
          speakingRate: audioConfig.speakingRate || 1.0,
          pitch: audioConfig.pitch || 0.0,
          volumeGainDb: audioConfig.volumeGainDb || 0.0,
          ...(audioConfig.effectsProfileId && {
            effectsProfileId: [audioConfig.effectsProfileId]
          })
        }
      };

      logger.info(`Synthesizing text with voice: ${voiceConfig.name}`);

      // Call Google TTS
      const [response] = await this.googleTTSClient.synthesizeSpeech(request);
      
      return response.audioContent;

    } catch (error) {
      logger.error(`Text synthesis failed: ${error.message}`);
      throw new Error(`Failed to synthesize text: ${error.message}`);
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
      const cmd = `"${this.ffprobePath}" -v quiet -show_entries format=duration -of csv=p=0 "${audioPath}"`;
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

  /**
   * Validate voice availability and list alternatives
   */
  async validateAndListVoices(language = null) {
    try {
      const [result] = await this.googleTTSClient.listVoices({
        languageCode: language
      });
      
      const availableVoices = result.voices.map(voice => ({
        name: voice.name,
        languages: voice.languageCodes,
        gender: voice.ssmlGender,
        sampleRate: voice.naturalSampleRateHertz
      }));
      
      logger.info(`Found ${availableVoices.length} available voices${language ? ` for ${language}` : ''}`);
      
      return availableVoices;
      
    } catch (error) {
      logger.error(`Failed to list voices: ${error.message}`);
      return [];
    }
  }

  /**
   * Get TTS configuration status and recommendations
   */
  getConfigurationStatus() {
    const status = {
      configured: !!this.googleTTSClient,
      voiceLanguage: this.voiceConfig.language,
      voiceType: this.voiceConfig.voiceType,
      audioEncoding: this.audioConfig.audioEncoding,
      sampleRate: this.audioConfig.sampleRateHertz,
      recommendations: []
    };
    
    // Add configuration recommendations
    if (this.voiceConfig.voiceType === 'standard') {
      status.recommendations.push('Consider upgrading to Chirp3 HD voices for better educational content quality');
    }
    
    if (this.audioConfig.sampleRateHertz < 22050) {
      status.recommendations.push('Consider using higher sample rate (44100Hz) for better audio quality');
    }
    
    if (!this.audioConfig.effectsProfileId) {
      status.recommendations.push('Set audio effects profile for device-optimized playback');
    }
    
    return status;
  }
}

module.exports = new TTSOrchestrator();