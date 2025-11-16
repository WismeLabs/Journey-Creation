/**
 * TTS Configuration Test Script
 * Demonstrates the comprehensive Google TTS integration
 */

const TTSOrchestrator = require('./services/tts/tts_orchestrator');

async function testTTSConfiguration() {
  console.log('🎵 Testing Journey Creation TTS Configuration\n');
  
  try {
    // Initialize TTS orchestrator
    const ttsOrchestrator = new TTSOrchestrator();
    
    // Display configuration status
    console.log('📊 Current TTS Configuration:');
    const status = ttsOrchestrator.getConfigurationStatus();
    console.log(JSON.stringify(status, null, 2));
    console.log();
    
    // Display available voices
    console.log('🎤 Available Voice Types:');
    const voices = ttsOrchestrator.getAvailableVoices();
    Object.keys(voices).forEach(lang => {
      console.log(`\n${lang.toUpperCase()}:`);
      Object.keys(voices[lang]).forEach(type => {
        console.log(`  ${type}: ${voices[lang][type].join(', ')}`);
      });
    });
    console.log();
    
    // Display audio configuration options
    console.log('🔊 Audio Configuration Options:');
    const audioConfig = ttsOrchestrator.getAudioConfiguration();
    console.log('Encoding:', audioConfig.audioEncoding);
    console.log('Sample Rate:', audioConfig.sampleRateHertz + 'Hz');
    console.log('Speaking Rate:', audioConfig.speakingRate + 'x');
    console.log('Effects Profile:', audioConfig.effectsProfileId || 'None');
    console.log();
    
    // Test educational SSML generation
    console.log('📚 Educational SSML Generation:');
    const sampleText = 'Today we will learn about photosynthesis, the process by which plants convert sunlight into energy.';
    const ssml = ttsOrchestrator.generateEducationalSSML(sampleText, {
      keyTerms: ['photosynthesis'],
      subject: 'science',
      grade: 7,
      emphasizeDefinitions: true,
      pauseAfterConcepts: true
    });
    console.log('Generated SSML:');
    console.log(ssml);
    console.log();
    
    // Display optimal voice configuration for different content types
    console.log('🎯 Optimal Voice Configurations:');
    const contentTypes = ['mathematics', 'science', 'social-studies', 'english', 'hindi'];
    contentTypes.forEach(subject => {
      const config = ttsOrchestrator.getOptimalVoiceConfig(subject, 7, 'en-US');
      console.log(`${subject}: ${config.name} (${config.type})`);
    });
    console.log();
    
    // Test voice validation
    console.log('✅ Voice Validation:');
    const validation = await ttsOrchestrator.validateVoiceConfiguration();
    console.log('Configuration Valid:', validation.isValid);
    if (validation.issues.length > 0) {
      console.log('Issues Found:');
      validation.issues.forEach(issue => console.log(`  - ${issue}`));
    }
    if (validation.recommendations.length > 0) {
      console.log('Recommendations:');
      validation.recommendations.forEach(rec => console.log(`  - ${rec}`));
    }
    
    console.log('\n🎉 TTS Configuration Test Complete!');
    console.log('\nThe system now includes:');
    console.log('✅ Comprehensive Google TTS voice integration');
    console.log('✅ All voice types (Chirp3 HD, Neural2, WaveNet, Standard)');
    console.log('✅ Full audio configuration options');
    console.log('✅ Educational content optimization');
    console.log('✅ SSML generation with educational enhancements');
    console.log('✅ Multi-language support');
    console.log('✅ Voice validation and recommendations');
    console.log('✅ Complete environment configuration template');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.log('\nNote: This test requires Google Cloud credentials to be configured.');
    console.log('Please set up your .env file with proper TTS configuration.');
  }
}

// Run the test
if (require.main === module) {
  testTTSConfiguration();
}

module.exports = { testTTSConfiguration };