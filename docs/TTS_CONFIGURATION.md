# Text-to-Speech (TTS) Configuration Guide

## Overview
The Journey Creation Platform now includes comprehensive Google Cloud Text-to-Speech integration with full support for all voice types, audio configurations, and educational optimizations.

## Voice Types Available

### 1. Chirp3 HD Voices (Premium) ⭐ RECOMMENDED
- **Best Quality**: Latest generation voices with superior naturalness
- **Educational Focus**: Optimized for learning content
- **Available Voices**:
  - `en-US-Journey-O` - Premium educational voice (neutral)
  - `en-US-Journey-D` - Premium educational voice (alternative)
- **Use Case**: Primary recommendation for all educational content
- **Pricing**: Higher cost but significantly better quality

### 2. Neural2 Voices (High Quality)
- **Excellent Quality**: Neural network-based synthesis
- **Wide Selection**: Multiple voice personalities
- **Available Voices**:
  - `en-US-Neural2-A` - Female, warm tone
  - `en-US-Neural2-C` - Female, clear diction
  - `en-US-Neural2-D` - Male, authoritative
  - `en-US-Neural2-E` - Female, friendly
  - `en-US-Neural2-F` - Female, professional
  - `en-US-Neural2-G` - Female, energetic
  - `en-US-Neural2-H` - Female, calm
  - `en-US-Neural2-I` - Male, conversational
  - `en-US-Neural2-J` - Male, clear
- **Use Case**: Good balance of quality and cost

### 3. WaveNet Voices (Standard Premium)
- **Good Quality**: Google's original premium voices
- **Regional Variants**: Including Indian English
- **Available Voices**:
  - `en-US-Wavenet-A` through `en-US-Wavenet-J`
  - `en-IN-Wavenet-A` through `en-IN-Wavenet-D`
- **Use Case**: Budget-conscious premium option

### 4. Standard Voices (Basic)
- **Basic Quality**: Traditional concatenative synthesis
- **Cost Effective**: Lowest pricing tier
- **Use Case**: Testing and development only

## Audio Configuration Options

### Audio Encoding Formats
- **MP3**: Recommended for web delivery (smaller files)
- **LINEAR16**: Uncompressed PCM (highest quality)
- **OGG_OPUS**: Efficient compression, good quality
- **FLAC**: Lossless compression
- **WEBM_OPUS**: Web-optimized format

### Sample Rates
- **8000 Hz**: Phone quality
- **16000 Hz**: Basic digital quality
- **22050 Hz**: Standard music quality
- **24000 Hz**: High-quality speech
- **44100 Hz**: CD quality (recommended)
- **48000 Hz**: Professional audio

### Speaking Rate
- **0.25 - 4.0**: Speed multiplier (1.0 = normal)
- **Educational Recommendation**: 0.9-1.1 for clarity
- **Slow Explanation**: 0.7-0.8 for complex concepts
- **Quick Review**: 1.2-1.3 for familiar material

### Pitch Adjustment
- **-20.0 to +20.0 semitones**: Pitch modification
- **Educational Use**: Usually keep at 0.0 (natural)
- **Character Voices**: ±2-5 semitones for variety

### Volume Gain
- **-96.0 to +16.0 dB**: Volume adjustment
- **Recommendation**: 0.0 dB (natural level)
- **Quiet Content**: +3 to +6 dB
- **Loud Content**: -3 to -6 dB

## Audio Effects Profiles

Choose based on target playback device:

- **headphone-class-device**: Recommended for students
- **small-bluetooth-speaker-class-device**: Classroom speakers
- **large-home-entertainment-class-device**: Home systems
- **handset-class-device**: Phone speakers
- **telephony-class-application**: Phone calls
- **wearable-class-device**: Smartwatches, earbuds

## SSML Enhancement Features

### Basic SSML Tags
```xml
<speak>
  <emphasis level="strong">Important concept</emphasis>
  <break time="1s"/>
  <prosody rate="slow" pitch="-2st">Careful explanation</prosody>
</speak>
```

### Educational SSML Templates
The system automatically generates SSML with:
- **Emphasis**: Key terms and concepts
- **Breaks**: Natural pauses for comprehension
- **Prosody**: Speed and pitch variation
- **Pronunciation**: Phonetic guides for difficult words

## Configuration Examples

### Basic Setup (Development)
```env
TTS_VOICE_TYPE=neural2
TTS_LANGUAGE=en-US
TTS_VOICE_NAME=auto
TTS_AUDIO_ENCODING=MP3
TTS_SAMPLE_RATE=24000
TTS_SPEAKING_RATE=1.0
```

### Premium Setup (Production)
```env
TTS_VOICE_TYPE=chirp3-hd
TTS_LANGUAGE=en-US
TTS_VOICE_NAME=en-US-Journey-O
TTS_AUDIO_ENCODING=MP3
TTS_SAMPLE_RATE=44100
TTS_SPEAKING_RATE=0.95
TTS_EFFECTS_PROFILE=headphone-class-device
TTS_EDUCATIONAL_MODE=true
```

### Multi-Language Setup (Indian Context)
```env
TTS_LANGUAGE=en-IN
TTS_VOICE_TYPE=neural2
TTS_VOICE_NAME=en-IN-Neural2-A
TTS_SPEAKING_RATE=0.9
TTS_PRONUNCIATION_GUIDE=true
```

## Educational Optimizations

### Automatic Features When `TTS_EDUCATIONAL_MODE=true`:
1. **Slower Speaking Rate**: Defaults to 0.95x for better comprehension
2. **Enhanced Emphasis**: Key educational terms highlighted
3. **Strategic Pauses**: Added after important concepts
4. **Pronunciation Guides**: Difficult terms spelled out phonetically
5. **Concept Repetition**: Important points repeated with variation

### Content-Specific Adjustments:
- **Mathematics**: Numbers and formulas spoken clearly
- **Science**: Technical terms with proper pronunciation
- **Social Studies**: Names and places with regional accuracy
- **Languages**: Native pronunciation when possible

## Cost Optimization

### Voice Type Costs (Approximate):
1. **Chirp3 HD**: $16/1M characters (premium)
2. **Neural2**: $16/1M characters (high quality)
3. **WaveNet**: $16/1M characters (standard premium)
4. **Standard**: $4/1M characters (basic)

### Optimization Strategies:
- Use **caching** for repeated content
- Choose **MP3 encoding** for smaller files
- Use **batch processing** for multiple requests
- Implement **content chunking** for long texts

## Troubleshooting

### Common Issues:
1. **Voice Not Available**: Check region and quotas
2. **Audio Quality Poor**: Increase sample rate
3. **Speech Too Fast**: Adjust speaking rate
4. **Robotic Sound**: Upgrade to Neural2 or Chirp3
5. **Volume Issues**: Adjust effects profile for device

### Validation Commands:
The system includes built-in validation:
```javascript
// Check available voices
await ttsOrchestrator.validateAndListVoices('en-US');

// Get configuration status
const status = ttsOrchestrator.getConfigurationStatus();
```

## API Quotas and Limits

### Google Cloud TTS Limits:
- **Requests per minute**: 1,000 (adjustable)
- **Characters per request**: 5,000
- **Concurrent requests**: 100
- **Audio length**: 10 minutes per request

### Best Practices:
- Implement **exponential backoff** for retries
- Use **request batching** for efficiency
- Monitor **quota usage** regularly
- Set up **fallback voices** for reliability

## Integration Examples

### Basic TTS Request:
```javascript
const audioBuffer = await ttsOrchestrator.synthesizeText(
  'Welcome to our mathematics lesson on fractions.',
  {
    contentType: 'educational',
    subject: 'mathematics',
    emphasis: ['fractions']
  }
);
```

### Advanced SSML Request:
```javascript
const ssmlText = ttsOrchestrator.generateEducationalSSML(
  'Today we will learn about photosynthesis.',
  {
    keyTerms: ['photosynthesis'],
    pauseAfterConcepts: true,
    emphasizeDefinitions: true
  }
);
```

This comprehensive TTS integration ensures the Journey Creation Platform can generate high-quality, educationally-optimized audio content for all supported subjects and grade levels.