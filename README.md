# Journey Creation - K-12 Educational Content Generation Pipeline

Production-ready AI-powered content pipeline for generating engaging educational learning journeys with conversational dialogue scripts and text-to-speech audio.

## Features

- **Real LLM Integration**: Gemini 2.0 Flash API for concept extraction, script generation, and MCQ creation
- **Google Cloud TTS**: Premium Chirp3-HD voices for natural student dialogue
- **Complete Pipeline**: PDF/Markdown → Concepts → Episodes → Scripts → MCQs → Audio
- **Teacher Interface**: Upload and configure content via web UI
- **Production Ready**: No mocks, real API calls, comprehensive error handling

## Prerequisites

- Node.js 22+ 
- Python 3.13+
- Gemini API Key ([Get one here](https://makersuite.google.com/app/apikey))
- Google Cloud TTS API Key
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
GEMINI_API_KEY=your-gemini-api-key-here
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

- [Complete Generation Guide](docs/COMPLETE_GENERATION_GUIDE.md)
- [TTS Configuration](docs/TTS_CONFIGURATION.md)
- [Migration Guide](docs/MIGRATION.md)

## Tech Stack

- **Backend**: Node.js (Express), Python (FastAPI)
- **LLM**: Google Gemini 2.0 Flash
- **TTS**: Google Cloud Text-to-Speech (Chirp3-HD)
- **OCR**: Tesseract.js
- **Audio**: FFmpeg

## Environment Variables

Key configuration in `.env`:

```env
# Required
GEMINI_API_KEY=           # From Google AI Studio
GOOGLE_TTS_API_KEY=       # From Google Cloud Console

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

Generated content organized by curriculum:

```
outputs/
└── CBSE/
    └── Grade_6/
        └── science/
            └── chapter_photosynthesis/
                └── gen_2025-11-17T12-30-45/
                    ├── concepts.json
                    ├── episode_plan.json
                    └── episodes/
                        ├── ep01/
                        │   ├── script.json
                        │   ├── mcqs.json
                        │   └── audio/
                        │       ├── audio.mp3
                        │       └── segments/
                        ├── ep02/
                        └── ...
```

## License

Proprietary - WismeLabs

## Support

For issues or questions, contact the development team.
