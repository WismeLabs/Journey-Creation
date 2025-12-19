# 🎓 Educational Audio Revision System - Setup Guide

Transform your PDF chapters into engaging audio revision sessions with AI-generated scripts and Indian TTS voices!

## 🚀 Quick Start (2 Terminals)

### Terminal 1: Backend (Python FastAPI + Gemini AI)
```bash
./start-backend.sh
```

### Terminal 2: Frontend (Node.js Express + Educational UI)
```bash
./start-frontend.sh
```

## 📋 Prerequisites

### 1. Node.js 18+
```bash
# Using nvm (recommended)
nvm install 18
nvm use 18
```

### 2. Python 3.8+
```bash
python3 --version  # Should be 3.8+
```

### 3. API Keys (Required)
Create `hf_backend/.env`:
```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 4. Optional: Google TTS & Supabase
Create `.env` in root directory:
```env
GOOGLE_TTS_API_KEY=your_google_tts_key
SUPABASE_BASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

## 🎯 How to Use

### Step 1: Start Both Services
1. **Terminal 1**: `./start-backend.sh` (Python backend on port 8000)
2. **Terminal 2**: `./start-frontend.sh` (Node.js frontend on port 3000)

### Step 2: Access Educational Interface
Open: **http://localhost:3000/educational.html**

### Step 3: Create Educational Audio
1. **Upload PDF**: Drag & drop your chapter PDF
2. **Configure**: Set grade band, duration, speaker names & Indian voices
3. **Generate Script**: AI creates educational dialogue using your PDF content
4. **Generate Audio**: Convert script to audio with Indian TTS voices

## 🎵 Indian TTS Voices Available

- **en-IN-PrabhatNeural**: Male English with Indian accent
- **en-IN-NeerjaNeural**: Female English with Indian accent  
- **hi-IN-MadhurNeural**: Male Hindi voice
- **hi-IN-SwaraNeural**: Female Hindi voice

## 🔧 Manual Setup (Alternative)

### Backend Setup
```bash
cd hf_backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```

### Frontend Setup
```bash
source ~/.nvm/nvm.sh && nvm use 18
npm install
npm start
```

## 📁 Project Structure

```
Journey-Creation/
├── hf_backend/                 # Python FastAPI backend
│   ├── main.py                # Gemini AI service
│   ├── requirements.txt       # Python dependencies
│   └── .env                   # API keys (create this)
├── src/
│   ├── utils/
│   │   ├── pdfProcessor.js    # PDF text extraction
│   │   ├── educationalPrompt.js # Educational script templates
│   │   └── indianTTSConfig.js # Indian voice configuration
│   └── routes/
│       └── educationalRoutes.js # PDF upload & script generation APIs
├── public/
│   └── educational.html       # Educational workflow interface
├── server.js                  # Node.js Express server
├── playwright-automation.js   # Audio generation pipeline
└── package.json              # Node.js dependencies
```

## 🌐 Endpoints

### Educational APIs
- `POST /api/upload-pdf` - Upload and process PDF
- `POST /api/generate-script` - Generate educational script with AI
- `POST /api/regenerate-script` - Regenerate script with modifications

### Audio Generation
- `POST /api/start` - Start audio generation pipeline

### Python Backend
- `POST http://localhost:8000/generate` - Gemini AI text generation

## 🐛 Troubleshooting

### Backend Issues
- **Port 8000 in use**: Change port in `hf_backend/main.py`
- **Gemini API errors**: Check your API key in `hf_backend/.env`
- **Python dependencies**: Run `pip install -r requirements.txt`

### Frontend Issues
- **Port 3000 in use**: Change port in `server.js`
- **Node.js version**: Use `nvm use 18`
- **Dependencies**: Run `npm install`

### Audio Generation Issues
- **Google TTS errors**: Add `GOOGLE_TTS_API_KEY` to `.env`
- **ffmpeg not found**: Install ffmpeg for audio merging
- **Voice not supported**: Use Indian voices from the dropdown

## 🎯 Features

✅ **PDF Processing**: Automatic text extraction and validation  
✅ **AI Script Generation**: Educational dialogue with Gemini 2.5-pro  
✅ **Indian TTS Voices**: 4 high-quality Indian voices  
✅ **Educational Optimization**: Slower speech, clear pronunciation  
✅ **Script Preview**: Review and edit before audio generation  
✅ **Complete Pipeline**: PDF → Script → Audio workflow  

## 🚀 Ready to Create Educational Audio!

Your system is now ready to transform PDF chapters into engaging audio revision sessions! 🎓🎵