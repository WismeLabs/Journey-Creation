require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { mergeAllOutputs, getMergedAudioFiles } = require('./merge_audio');
const { createClient } = require('@supabase/supabase-js');

// Google TTS imports
const { TextToSpeechClient } = require('@google-cloud/text-to-speech');

// TTS config: set these in your environment or replace here

const HOST_NAME = process.env.HOST_NAME || 'Harry';
const HOST_VOICE_ID = process.env.HOST_VOICE_ID || '<host_voice_id>';
const SPEAKER_NAME = process.env.SPEAKER_NAME || 'Maya';
const SPEAKER_VOICE_ID = process.env.SPEAKER_VOICE_ID || '<speaker_voice_id>';
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const AUTOMATION_ENABLED = (process.env.AUTOMATION_ENABLED || 'true').toLowerCase() === 'true';

// TTS Provider Configuration
const TTS_PROVIDER = process.env.TTS_PROVIDER || 'elevenlabs'; // 'elevenlabs' or 'google'
const GOOGLE_TTS_KEY = process.env.GOOGLE_TTS_API_KEY;
const GOOGLE_HOST_VOICE = process.env.GOOGLE_HOST_VOICE || 'en-US-Journey-D';
const GOOGLE_SPEAKER_VOICE = process.env.GOOGLE_SPEAKER_VOICE || 'en-US-Journey-F';

// Initialize Google TTS client
let googleTTSClient = null;
if (GOOGLE_TTS_KEY && TTS_PROVIDER === 'google') {
  googleTTSClient = new TextToSpeechClient({
    apiKey: GOOGLE_TTS_KEY
  });
}
// Optional: Manually trigger TTS for a user-supplied journeyN.txt
async function ttsForUserJourney(journeyPath, hostName, hostVoiceId, speakerName, speakerVoiceId) {
  if (!fs.existsSync(journeyPath)) {
    console.error(`[TTS] Provided journey file does not exist: ${journeyPath}`);
    return;
  }
  if (!AUTOMATION_ENABLED) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => {
      rl.question('Automation is disabled. Type "yes" to start audio generation: ', (answer) => {
        rl.close();
        if (answer.trim().toLowerCase() !== 'yes') {
          console.log('Aborted by user.');
          process.exit(0);
        }
        resolve();
      });
    });
  }
  await ttsForScript(journeyPath, hostName, hostVoiceId, speakerName, speakerVoiceId);
  console.log(`[TTS] Audio generation complete for ${journeyPath}`);
}

const SUPABASE_URL = process.env.SUPABASE_BASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Initialize Supabase only if credentials are provided
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('[Supabase] Client initialized');
} else {
  console.log('[Supabase] Skipping initialization - credentials not provided');
}

// Enhanced TTS function with provider selection
async function ttsLine(text, voiceId, outPath, isHost = true) {
  if (!text || text.trim() === '') {
    console.log('[TTS] Skipping empty text');
    return;
  }

  console.log(`[TTS] Using ${TTS_PROVIDER.toUpperCase()} - Generating audio for ${isHost ? 'host' : 'speaker'}: "${text.substring(0, 50)}..."`);

  try {
    if (TTS_PROVIDER === 'google') {
      await generateGoogleTTS(text, voiceId, outPath);
    } else {
      await generateElevenLabsTTS(text, voiceId, outPath);
    }
    console.log(`✅ Audio saved to ${outPath}`);
  } catch (error) {
    console.error(`[TTS] Error generating audio: ${error.message}`);
  }
}

// ElevenLabs TTS function (existing logic)
async function generateElevenLabsTTS(text, voiceId, outPath) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error('ElevenLabs API key not set');
  }
  if (!voiceId || voiceId === '<host_voice_id>' || voiceId === '<speaker_voice_id>') {
    throw new Error(`Voice ID missing or placeholder for output: ${outPath}`);
  }

  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      text,
      model_id: 'eleven_multilingual_v2',
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
      responseType: 'arraybuffer',
      validateStatus: () => true
    }
  );
  
  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}: ${response.data?.toString?.() || response.data}`);
  }
  
  fs.writeFileSync(outPath, response.data);
}

// New Google TTS function with Chirp3-HD voices
async function generateGoogleTTS(text, voiceName, outPath) {
  if (!googleTTSClient) {
    throw new Error('Google TTS client not initialized');
  }

  const request = {
    input: { text: text },
    voice: { 
      languageCode: 'en-US',
      name: voiceName
    },
    audioConfig: { 
      audioEncoding: 'LINEAR16',
      pitch: 0,
      speakingRate: 1
    }
  };

  const [response] = await googleTTSClient.synthesizeSpeech(request);
  
  // Convert LINEAR16 to MP3 and save
  // For now, we'll save as WAV and you can convert to MP3 later if needed
  const wavPath = outPath.replace('.mp3', '.wav');
  fs.writeFileSync(wavPath, response.audioContent, 'binary');
  
  // If you have ffmpeg available, convert to MP3
  try {
    const { execSync } = require('child_process');
    execSync(`ffmpeg -y -i "${wavPath}" -codec:a mp3 "${outPath}"`, { stdio: 'ignore' });
    fs.unlinkSync(wavPath); // Remove temporary WAV file
    console.log(`[Google TTS] Converted to MP3: ${outPath}`);
  } catch (error) {
    // If ffmpeg is not available, rename WAV to MP3 (audio players can usually handle it)
    fs.renameSync(wavPath, outPath);
    console.log(`[Google TTS] Saved as WAV (renamed to .mp3): ${outPath}`);
  }
}

async function ttsForScript(filePath, hostName, hostVoiceId, speakerName, speakerVoiceId) {
  console.log(`[TTS] Processing script with ${TTS_PROVIDER.toUpperCase()} TTS`);
  
  // Check TTS provider configuration
  if (TTS_PROVIDER === 'elevenlabs') {
    if (!ELEVENLABS_API_KEY || !hostVoiceId || !speakerVoiceId) {
      console.log('[TTS] Skipped: ElevenLabs API key or voice IDs not set');
      return;
    }
  } else if (TTS_PROVIDER === 'google') {
    if (!GOOGLE_TTS_KEY) {
      console.log('[TTS] Skipped: Google TTS API key not set');
      return;
    }
    // Use Google voice names from env
    hostVoiceId = GOOGLE_HOST_VOICE;
    speakerVoiceId = GOOGLE_SPEAKER_VOICE;
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  let idx = 1;
  // Auto-detect all speakers by scanning for "Name:" at line start
  const speakerSet = new Set();
  const lineInfos = [];
  const speakerRegex = /^([^:]+):\s*(.*)$/;
  for (const line of lines) {
    const match = line.match(speakerRegex);
    if (match) {
      const speaker = match[1].trim();
      const text = match[2].trim();
      speakerSet.add(speaker);
      lineInfos.push({ speaker, text, idx });
      idx++;
    }
  }
  const speakers = Array.from(speakerSet);
  if (speakers.length === 0) {
    console.error('[TTS] No speakers detected in script. Aborting.');
    return;
  }
  // Assign voices: first speaker = host, second = speaker, rest = fallback to host voice
  const speakerVoiceMap = {};
  speakers.forEach((spk, i) => {
    if (i === 0) speakerVoiceMap[spk] = hostVoiceId;
    else if (i === 1) speakerVoiceMap[spk] = speakerVoiceId;
    else speakerVoiceMap[spk] = hostVoiceId; // fallback
  });
  // Generate audio for each line
  for (const { speaker, text, idx } of lineInfos) {
    const voiceId = speakerVoiceMap[speaker];
    const safeSpeaker = speaker.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const outPath = path.join(path.dirname(filePath), `${safeSpeaker}_line${idx}.mp3`);
    const isHost = (speaker === speakers[0]);
    await ttsLine(text, voiceId, outPath, isHost);
  }
}

const OUTPUT_DIR = path.join(__dirname, 'outputs');
const GEMINI_API_URL = 'http://127.0.0.1:8000/generate';

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR);

async function extractFollowupPrompt(responseText) {
  // Use the first line as follow-up, or fallback to a generic follow-up
  const firstLine = responseText.split('\n')[0].trim();
  return firstLine.length > 0 ? firstLine : 'Can you elaborate?';
}


// Formatting prompt to clean up output
const FORMAT_PROMPT = "Format the following text so that it contains no asterisks (**), no markdown, and remove all expressions in parentheses like (smiling), (laughs), etc. The final output should be plain and simple dialogue only.";

async function interactWithGemini(prompt, history = []) {
  // Add formatting and length instruction to the prompt
  const LENGTH_PROMPT = "Make sure the script is at least 700 words (about 5 minutes of natural conversation).";
  const formattedPrompt = prompt + "\n" + LENGTH_PROMPT + "\n" + FORMAT_PROMPT;
  try {
    const res = await axios.post(GEMINI_API_URL, { prompt: formattedPrompt, history });
    return res.data.response;
  } catch (e) {
    console.error('Error calling Gemini backend:', e.message);
    console.error('Request details:', { url: GEMINI_API_URL, prompt: formattedPrompt.substring(0, 100) + '...' });
    return '';
  }
}

async function uploadToSupabase(journeyName, episodeNumber, filePath) {
  if (!supabase) {
    console.log(`[supabase] Skipping upload - Supabase not configured`);
    return null;
  }
  
  const fileName = `${journeyName}_ep${episodeNumber}.mp3`;
  const fileBuffer = fs.readFileSync(filePath);
  // Upload to storage
  const { data, error } = await supabase.storage
    .from('audio-files')
    .upload(`episodes/${fileName}`, fileBuffer, { upsert: true, contentType: 'audio/mpeg' });
  if (error) {
    console.error(`[supabase] Upload error for ${fileName}:`, error.message);
    return null;
  }
  // Insert metadata into DB
  const fileUrl = data.path;
  const { error: dbError } = await supabase
    .from('episodes')
    .insert([
      {
        journey_name: journeyName,
        episode_number: episodeNumber,
        file_url: fileUrl
      }
    ]);
  if (dbError) {
    console.error(`[supabase] DB insert error for ${fileName}:`, dbError.message);
    return null;
  }
  console.log(`[supabase] Uploaded and recorded: ${fileName}`);
  return fileUrl;
}

async function runAutomation(prompts, context = "", journeyName, hostName, hostVoiceId, speakerName, speakerVoiceId) {
  // Use passed-in names/voices if provided, fallback to env/defaults
  const resolvedHostName = hostName || HOST_NAME;
  const resolvedHostVoiceId = hostVoiceId || HOST_VOICE_ID;
  const resolvedSpeakerName = speakerName || SPEAKER_NAME;
  const resolvedSpeakerVoiceId = speakerVoiceId || SPEAKER_VOICE_ID;
  
  // Check TTS provider configuration
  let ttsConfigured = false;
  if (TTS_PROVIDER === 'elevenlabs') {
    ttsConfigured = ELEVENLABS_API_KEY && resolvedHostVoiceId !== '<host_voice_id>' && resolvedSpeakerVoiceId !== '<speaker_voice_id>';
  } else if (TTS_PROVIDER === 'google') {
    ttsConfigured = GOOGLE_TTS_KEY && googleTTSClient;
  }
  // Create journey output dir
  const journeyDir = path.join(OUTPUT_DIR, journeyName);
  if (!fs.existsSync(journeyDir)) fs.mkdirSync(journeyDir, { recursive: true });
  // Run all prompts in parallel
  await Promise.all(prompts.map(async (prompt, i) => {
    const episodeNum = i + 1;
    const outputDir = path.join(journeyDir, `Output-${episodeNum}`);
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);
    console.log(`\n--- Processing ${journeyName}/Output-${episodeNum} ---`);
    // Step 1: Send prompt with context as history
    const history = context ? [context] : [];
    console.log(`[Prompt] Sending to Gemini:`, prompt);
    const response = await interactWithGemini(prompt, history);
    const journeyPath = path.join(outputDir, `journey${episodeNum}.txt`);
    fs.writeFileSync(journeyPath, response, 'utf-8');
    console.log(`[Prompt] Response written to ${journeyPath}`);
    // Step 2: (journey_followup logic removed for now)
    // Only journeyN.txt will be generated and used for TTS/merge.
    // Step 3: Wait 30 seconds before starting TTS
    console.log('[TTS] Waiting 30 seconds before starting audio generation...');
    await new Promise(res => setTimeout(res, 30000));
    // Step 4: TTS only for journeyX.txt (not followup)
    if (ttsConfigured) {
      console.log(`[TTS] Generating audio for ${journeyPath} using ${TTS_PROVIDER.toUpperCase()}`);
      await ttsForScript(journeyPath, resolvedHostName, resolvedHostVoiceId, resolvedSpeakerName, resolvedSpeakerVoiceId);
    } else {
      console.log(`[TTS] Skipped: ${TTS_PROVIDER.toUpperCase()} TTS not properly configured.`);
    }
  }));
  // Check for audio files before merging
  const episodeDirs = fs.readdirSync(journeyDir)
    .filter(f => f.startsWith('Output-'))
    .map(f => path.join(journeyDir, f));
  const allHaveAudio = episodeDirs.every(dir => {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp3'));
    return files.length > 0;
  });
  if (!allHaveAudio) {
    console.warn(`[merge] Skipping merge: Not all episodes have audio files.`);
    return;
  }
  // After all TTS is done, merge audio for all outputs in this journey
  try {
    console.log(`[merge] Starting audio merge for all outputs in journey: ${journeyName}...`);
    mergeAllOutputs(journeyDir);
    console.log('[merge] Audio merging complete.');
    // Supabase upload for each merged.mp3 in this journey
    const mergedFiles = getMergedAudioFiles(journeyDir);
    for (let i = 0; i < mergedFiles.length; i++) {
      const { dir, mergedPath } = mergedFiles[i];
      if (fs.existsSync(mergedPath)) {
        await uploadToSupabase(journeyName, i + 1, mergedPath);
      } else {
        console.warn(`[supabase] No merged.mp3 found in ${dir}`);
      }
    }
  } catch (err) {
    console.error('[merge/supabase] Error during audio merging or upload:', err.message);
  }
}

module.exports = { runAutomation, ttsForUserJourney };
