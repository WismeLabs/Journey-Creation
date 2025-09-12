# Journey-Creation

Automate conversational journeys with AI and TTS, generating audio episodes using Gemini and ElevenLabs, with a web frontend for prompt management.

## Features

- **Frontend**: Web UI (`public/index.html`) for entering prompts, context, and voice settings.
- **Backend**: 
  - Node.js server (`server.js`) for automation, TTS, and audio merging.
  - Python FastAPI backend (`hf_backend/main.py`) for Gemini text generation.

## Prerequisites

- **Node.js** (v18+ recommended)
- **Python** (3.8+)
- **ffmpeg** (Windows: update `merge_audio.js` with your ffmpeg path)
- **Supabase account** (for audio uploads, optional)

## Environment Variables

Create a `.env` file in the root and in `hf_backend/` with the following keys:

```
GEMINI_API_KEY=your_gemini_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
HOST_VOICE_ID=your_elevenlabs_host_voice_id
SPEAKER_VOICE_ID=your_elevenlabs_speaker_voice_id
HOST_NAME=your_host_name
SPEAKER_NAME=your_speaker_name
SUPABASE_KEY=your_supabase_key
SUPABASE_BASE_URL=your_supabase_url
```

## Backend Setup

1. **Install Python dependencies**:
   ```sh
   cd hf_backend
   python -m venv venv
   venv\Scripts\activate  # Windows
   pip install -r requirements.txt
   ```

2. **Start FastAPI server**:
   ```sh
   uvicorn main:app --host 127.0.0.1 --port 8000
   ```
   - API available at `http://127.0.0.1:8000/generate`

## Frontend & Node.js Automation

1. **Install Node.js dependencies**:
   ```sh
   npm install
   ```

2. **Start Node.js server**:
   ```sh
   npm start
   ```
   - Web UI at `http://localhost:3000`

3. **Open `public/index.html`** in your browser, fill in prompts, context, and voice settings, then start automation.

## Audio Merging

- Ensure `ffmpeg` is installed and the path in `merge_audio.js` is correct.
- Merged audio files are saved in the `outputs/` directory.

## Troubleshooting

- Missing API keys or voice IDs will cause errors.
- Check `.env` files in both root and `hf_backend/`.
- For Supabase uploads, ensure keys and bucket exist.

## Folder Structure

- `public/` – Frontend HTML
- `server.js`, `playwright-automation.js`, `merge_audio.js`, `tts.js` – Node.js backend
- `hf_backend/` – Python FastAPI backend
- `outputs/` – Generated audio files

---
NOTE - Only do one episode per time as multithreading is unstable and don't want to lose tokens for now
