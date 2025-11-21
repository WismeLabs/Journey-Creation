# Journey Creation - K-12 Educational Content Generation Pipeline

Production-ready AI-powered content pipeline for generating engaging educational learning journeys with conversational dialogue scripts and text-to-speech audio.

## Features

- **Multi-LLM Support**: GPT-5.1, GPT-4o, Gemini 2.0 Flash with automatic 3-tier fallback
- **Google Cloud TTS**: Premium Chirp3-HD voices for natural student dialogue
- **Complete Pipeline**: PDF/Markdown → Concepts → Episodes → Scripts → MCQs → Audio
- **Teacher Interface**: Upload and configure content via web UI
- **Production Ready**: Real API calls, comprehensive error handling, auto-retry

## Prerequisites

- Node.js 22+ 
- Python 3.13+
- **API Keys** (at least one LLM provider required):
  - OpenAI API Key ([GPT-5.1/GPT-4o](https://platform.openai.com/api-keys)) - Recommended
  - Gemini API Key ([Fallback/Alternative](https://makersuite.google.com/app/apikey))
  - Google Cloud TTS API Key (Required for audio)
- FFmpeg (for audio merging)

## Quick Start

### 1. Clone and Install

```powershell
git clone https://github.com/WismeLabs/Journey-Creation.git
cd Journey-Creation
npm install
cd hf_backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Configure Environment

```powershell
cp .env.example .env
```

Edit `.env` and add your API keys:
```env
# LLM Provider: auto (GPT-5.1 → GPT-4o → Gemini)
LLM_PROVIDER=auto
OPENAI_API_KEY=your-openai-key-here
OPENAI_MODEL=gpt-5.1,gpt-4o
GEMINI_API_KEY=your-gemini-key-here
GOOGLE_TTS_API_KEY=your-google-tts-key-here
```

### 3. Start Services

**Terminal 1 - Python Backend:**
```powershell
cd hf_backend
.venv\Scripts\Activate.ps1
python main.py
```

**Terminal 2 - Node Server:**
```powershell
node server.js
```

### 4. Access Upload Interface

Open browser to: `http://localhost:3002/teacher/upload.html`

## Project Structure

```
Journey-Creation/
├── hf_backend/          # Python FastAPI - LLM service
│   ├── main.py          # Gemini API integration
│   └── requirements.txt
├── services/
│   ├── ingest/          # PDF processing (Tesseract OCR)
│   ├── semantic/        # Concept extraction
│   ├── planner/         # Episode planning
│   ├── tts/             # Google TTS orchestration
│   └── validation/      # Output validation
├── teacher_ui/          # Upload interface
├── templates/prompts/   # LLM prompt templates
├── schemas/             # JSON schemas
├── outputs/             # Generated content (gitignored)
└── docs/                # Complete documentation
```

## API Endpoints

- `POST /api/v1/generate` - Submit chapter for processing
- `GET /api/v1/status/:jobId` - Check job progress
- `GET /api/v1/output/:chapterId` - Retrieve generated content
- `POST /api/v1/tts/configure` - Update voice settings

## Documentation

- [Complete Generation Guide](docs/COMPLETE_GENERATION_GUIDE.md) - Full setup and usage guide
- [TTS Configuration](docs/TTS_CONFIGURATION.md) - Voice and audio settings
- [Migration Guide](docs/MIGRATION.md) - System updates and changes

## Tech Stack

- **Backend**: Node.js (Express), Python (FastAPI)
- **LLM**: OpenAI GPT-5.1/GPT-4o, Google Gemini 2.0 Flash (3-tier cascade)
- **TTS**: Google Cloud Text-to-Speech (Chirp3-HD)
- **OCR**: Tesseract.js
- **Audio**: FFmpeg

## Environment Variables

Key configuration in `.env`:

```env
# LLM Provider (Required)
LLM_PROVIDER=auto                 # auto, openai, or gemini
OPENAI_API_KEY=                   # From OpenAI Platform
OPENAI_MODEL=gpt-5.1,gpt-4o      # Model fallback list
GEMINI_API_KEY=                   # From Google AI Studio

# TTS (Required)
GOOGLE_TTS_API_KEY=               # From Google Cloud Console

# Server
PORT=3002
HF_BACKEND_URL=http://localhost:8000

# TTS
TTS_VOICE_TYPE=chirp3-hd
TTS_LANGUAGE=en-US
TTS_AUDIO_ENCODING=MP3
TTS_SAMPLE_RATE=44100
```

## Output Structure

Generated content organized cleanly by curriculum and grade:

```
outputs/
└── CBSE/
    └── Grade-8/
        └── photosynthesis/
            ├── concepts.json
            ├── episode_plan.json
            ├── Episode-1/
            │   ├── script.json
            │   ├── script.txt
            │   ├── mcqs.json
            │   ├── metadata.json
            │   ├── cues.json
            │   └── audio/
            │       ├── audio.mp3
            │       └── segments/
            ├── Episode-2/
            ├── Episode-3/
            └── ...
```

## License

Proprietary - WismeLabs

## Support

For issues or questions, contact the development team.
