require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Load API key and voice ID from .env or arguments

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// Allow user to specify 'host' or 'speaker' as first argument, or fallback to VOICE_ID
let VOICE_ID = process.env.VOICE_ID;
const which = process.argv[2];
if (!VOICE_ID) {
  if (which === 'host') VOICE_ID = process.env.HOST_VOICE_ID;
  else if (which === 'speaker') VOICE_ID = process.env.SPEAKER_VOICE_ID;
  else VOICE_ID = process.env.HOST_VOICE_ID || process.env.SPEAKER_VOICE_ID;
}
const OUTPUT_FILE = 'output.mp3';
const TEXT = 'Hello! This is ElevenLabs speaking.';

if (!ELEVENLABS_API_KEY || !VOICE_ID) {
  console.error('❌ Missing ELEVENLABS_API_KEY or VOICE_ID.');
  process.exit(1);
}

async function generateTTS(text, voiceId, outputPath) {
  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        text,
        model_id: 'eleven_multilingual_v2', // Or 'eleven_monolingual_v1' for English-only
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
        },
      },
      {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        responseType: 'arraybuffer', // So we can save binary audio
      }
    );

    fs.writeFileSync(outputPath, response.data);
    console.log(`✅ Audio saved to: ${outputPath}`);
  } catch (err) {
    console.error('❌ Error generating TTS:', err.response?.data || err.message);
  }
}

generateTTS(TEXT, VOICE_ID, path.join(__dirname, OUTPUT_FILE));
