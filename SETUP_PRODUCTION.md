# K-12 Educational Content Pipeline - Production Setup

## ⚠️ CRITICAL: API Keys Required

This system has been upgraded from mock implementations to **PRODUCTION-READY** real integrations. All mocks have been removed.

## 🔑 Required API Keys

### 1. Gemini API Key (REQUIRED)
```bash
# Get from: https://makersuite.google.com/app/apikey
GEMINI_API_KEY=your_actual_gemini_api_key_here
```

### 2. Google Cloud TTS API Key (REQUIRED)
```bash
# Get from: https://console.cloud.google.com/apis/credentials
GOOGLE_TTS_API_KEY=your_actual_google_tts_api_key_here

# OR use service account (alternative):
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account-key.json
```

## 📋 Setup Steps

### 1. Configure Environment
```bash
# Copy the template and add your real API keys
cp .env.template .env

# Edit .env file with your actual API keys:
nano .env  # or use your preferred editor
```

### 2. Install Dependencies
```bash
npm install
cd hf_backend
pip install -r requirements.txt
```

### 3. Start Services
```bash
# Terminal 1: Backend LLM Service (port 8000)
cd hf_backend
python main.py

# Terminal 2: Main Server (port 3000)
npm start
```

### 4. Test Complete Pipeline
- Upload PDF via: http://localhost:3000/test_upload.html
- Monitor logs for real Gemini API calls
- Check outputs/ directory for complete episode structure

## 🚀 Production Features (No More Mocks)

### ✅ Real Gemini Integration
- **Concept Extraction**: AI-powered analysis of educational content
- **Script Generation**: 8-12 minute educational episodes with proper structure
- **MCQ Generation**: Curriculum-aligned quiz questions with explanations
- **Content Validation**: Quality checks and curriculum compliance

### ✅ Complete TTS Pipeline  
- **Google Cloud TTS**: Professional voice synthesis
- **Multi-voice Episodes**: StudentA (confident) + StudentB (curious)
- **Audio Processing**: Segment generation, mixing, final episode audio
- **Timing Synchronization**: Accurate audio-script alignment

### ✅ Advanced PDF Processing
- **Direct Parsing**: pdf-parse for clean text extraction
- **OCR Fallback**: Tesseract.js for scanned documents
- **Structure Recovery**: Headers, paragraphs, lists, equations
- **Quality Validation**: Confidence scoring and error detection

### ✅ Complete Output Structure (MIGRATION.md Compliant)
```
outputs/chapter_{id}/
├── manifest.json           # Complete metadata
├── chapter.md             # Clean markdown
├── concepts.json          # AI-extracted concepts
├── episode_plan.json      # 4-6 episode structure
├── episodes/
│   ├── ep01/
│   │   ├── script.json    # Full episode script
│   │   ├── mcqs.json      # Quiz questions
│   │   ├── audio/         # Professional audio files
│   │   └── validation.json # Quality reports
│   └── ...
└── validation_report.json  # Complete pipeline validation
```

## 🔧 System Requirements

### API Quotas Needed
- **Gemini API**: ~50-100 requests per chapter (concept extraction, scripts, MCQs)
- **Google TTS**: ~10-20 audio synthesis calls per episode
- **Total Cost**: ~$2-5 per chapter depending on complexity

### Dependencies
- **Node.js 16+**: Main server and PDF processing
- **Python 3.8+**: LLM service backend
- **FFmpeg**: Audio processing (auto-detected)
- **ImageMagick/GraphicsMagick**: Advanced OCR (optional)

## 📊 Monitoring & Debugging

### Real-time Logs
```bash
# Backend API calls
tail -f hf_backend/logs/api.log

# PDF processing
tail -f logs/pdf_processor.log

# TTS generation  
tail -f logs/tts.log
```

### Health Checks
- **Gemini API**: http://localhost:8000/health
- **TTS Status**: Check logs for "✅ Google TTS connection test successful"
- **Pipeline Status**: Monitor job status via /api/status/{jobId}

## ⚠️ Troubleshooting

### "Gemini API key required" Error
1. Verify API key is set in .env file
2. Ensure no extra spaces or quotes around key
3. Test key at: https://makersuite.google.com/

### "Google TTS not initialized" Error  
1. Check GOOGLE_TTS_API_KEY in .env
2. Verify Google Cloud project has TTS API enabled
3. Test connection with provided test script

### "No content generated" Issues
1. Check PDF quality and text extraction logs
2. Verify concept extraction succeeded with real concepts
3. Monitor episode planning for realistic episode count (4-6 per chapter)

## 🎯 Expected Behavior (Production Mode)

- **No Mock Messages**: All logs show "using Gemini API" not "using mock"
- **Real Concepts**: Extracted concepts are content-specific, not generic
- **Quality Audio**: Professional TTS voices, proper pacing
- **Complete Episodes**: 8-12 minutes each with full script structure
- **Validation Reports**: Real quality metrics and suggestions

---

**Next Steps**: Add your API keys to .env and restart services. The system will now generate real K-12 educational content using production AI services.