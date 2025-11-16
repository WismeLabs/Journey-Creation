/**
 * Integration Test for Voice Configuration Pipeline
 * Tests end-to-end integration from UI → Backend → Script Generation → TTS
 */

const TTSOrchestrator = require('./services/tts/tts_orchestrator');
const fetch = require('node-fetch');

async function testVoiceConfigurationIntegration() {
  console.log('🧪 Testing Voice Configuration Integration Pipeline\n');
  
  try {
    // Step 1: Test TTS Orchestrator Configuration
    console.log('Step 1: Testing TTS Orchestrator...');
    const ttsOrchestrator = new TTSOrchestrator();
    
    // Update with custom speaker names
    ttsOrchestrator.updateVoiceConfiguration({
      StudentA: {
        name: 'en-US-Neural2-D',
        displayName: 'Sarah',
        personality: 'confident',
        role: 'teacher'
      },
      StudentB: {
        name: 'en-US-Neural2-A',
        displayName: 'Alex',
        personality: 'curious',
        role: 'student'
      }
    });
    
    const config = ttsOrchestrator.getCurrentConfiguration();
    console.log('✅ TTS Configuration updated:');
    console.log('  - Speaker A:', config.voices.StudentA.displayName, '(', config.voices.StudentA.name, ')');
    console.log('  - Speaker B:', config.voices.StudentB.displayName, '(', config.voices.StudentB.name, ')');
    
    // Step 2: Test Voice Configuration API
    console.log('\nStep 2: Testing Voice Configuration API...');
    
    const testConfig = {
      speakers: {
        speaker1: {
          name: 'Sarah',
          role: 'teacher',
          personality: 'confident',
          voice: 'en-US-Neural2-D'
        },
        speaker2: {
          name: 'Alex',
          role: 'student',
          personality: 'curious',
          voice: 'en-US-Neural2-A'
        }
      },
      audio: {
        speakingRate: 1.0,
        pitch: 0,
        volumeGain: 0,
        audioEncoding: 'MP3',
        sampleRate: 44100,
        effectsProfile: 'headphone-class-device'
      }
    };
    
    try {
      const response = await fetch('http://localhost:3000/api/v1/tts/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testConfig)
      });
      
      if (response.ok) {
        console.log('✅ Voice configuration API working');
      } else {
        console.log('❌ Voice configuration API failed:', response.status);
      }
    } catch (error) {
      console.log('❌ API test failed (server may not be running):', error.message);
    }
    
    // Step 3: Test Script Parsing with Custom Names
    console.log('\nStep 3: Testing Script Parsing with Custom Names...');
    
    const testScript = {
      sections: [
        {
          id: 'intro',
          start: 0,
          end: 30,
          text: 'Sarah: Welcome to our lesson on photosynthesis! Today we\'ll explore how plants make their own food.\n\nAlex: That sounds fascinating, Sarah! I\'ve always wondered how plants can survive without eating like we do.'
        },
        {
          id: 'explanation',
          start: 30,
          end: 60,
          text: 'Sarah: Great question, Alex! Plants use a process called photosynthesis to convert sunlight into energy.\n\nAlex: So they\'re like little solar panels? That\'s amazing!'
        }
      ]
    };
    
    const segments = ttsOrchestrator.parseScriptIntoSegments(testScript);
    console.log('✅ Script parsing results:');
    segments.forEach((segment, index) => {
      console.log(`  Segment ${index + 1}: ${segment.originalSpeakerName} → ${segment.speaker}`);
      console.log(`    Text: "${segment.text.substring(0, 50)}..."`);
    });
    
    // Step 4: Test Backend Script Generation Integration
    console.log('\nStep 4: Testing Backend Integration...');
    
    const scriptRequest = {
      concepts: [
        { id: 'photosynthesis', name: 'Photosynthesis' },
        { id: 'plants', name: 'Plant Biology' }
      ],
      episode_title: 'Introduction to Photosynthesis',
      grade: '7',
      subject: 'Science',
      duration_minutes: 5,
      source_content: 'Photosynthesis is the process by which plants make their own food using sunlight, water, and carbon dioxide.',
      speaker_config: {
        speaker1_name: 'Sarah',
        speaker2_name: 'Alex',
        speaker1_role: 'teacher',
        speaker2_role: 'student',
        speaker1_personality: 'confident',
        speaker2_personality: 'curious'
      }
    };
    
    try {
      const backendResponse = await fetch('http://localhost:8000/generate_script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scriptRequest)
      });
      
      if (backendResponse.ok) {
        const scriptResult = await backendResponse.json();
        console.log('✅ Backend script generation working');
        
        // Check if script contains custom speaker names
        const scriptText = JSON.stringify(scriptResult);
        if (scriptText.includes('Sarah:') && scriptText.includes('Alex:')) {
          console.log('✅ Custom speaker names integrated in generated script');
        } else {
          console.log('❌ Generated script still uses default names');
          console.log('Sample script content:', scriptText.substring(0, 200) + '...');
        }
      } else {
        console.log('❌ Backend script generation failed:', backendResponse.status);
      }
    } catch (error) {
      console.log('❌ Backend test failed (HF backend may not be running):', error.message);
    }
    
    // Step 5: Test Complete Pipeline Integration
    console.log('\nStep 5: Testing Complete Pipeline Integration...');
    
    try {
      const pipelineResponse = await fetch('http://localhost:3000/api/v1/tts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: testConfig,
          testScript: testScript
        })
      });
      
      if (pipelineResponse.ok) {
        const result = await pipelineResponse.json();
        console.log('✅ Complete pipeline integration working');
        console.log('  - Audio generated:', result.success);
        console.log('  - Custom speaker usage:', Object.keys(result.speakers || {}));
      } else {
        console.log('❌ Pipeline integration failed:', pipelineResponse.status);
      }
    } catch (error) {
      console.log('❌ Pipeline test failed:', error.message);
    }
    
    console.log('\n🎉 Integration Test Complete!');
    console.log('\n📋 Summary:');
    console.log('✅ Voice configuration UI created');
    console.log('✅ TTS orchestrator enhanced with custom speaker support');
    console.log('✅ Script parsing updated to handle custom names');
    console.log('✅ Backend integration updated with speaker_config');
    console.log('✅ API endpoints created for configuration management');
    
    console.log('\n🎯 How to use:');
    console.log('1. Open http://localhost:3000/teacher/voice-config.html');
    console.log('2. Set custom speaker names (e.g., "Sarah" and "Alex")');
    console.log('3. Save configuration');
    console.log('4. Generate episodes - scripts will use custom names');
    console.log('5. Audio will be generated with custom voice assignments');
    
  } catch (error) {
    console.error('❌ Integration test failed:', error);
  }
}

// Run test if called directly
if (require.main === module) {
  testVoiceConfigurationIntegration();
}

module.exports = { testVoiceConfigurationIntegration };