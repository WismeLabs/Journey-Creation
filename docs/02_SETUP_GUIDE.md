# Setup Guide

## Prerequisites

Install these first:

1. **Node.js 22+** → https://nodejs.org/
2. **Python 3.13+** → https://python.org/
3. **Tesseract OCR** → https://github.com/UB-Mannheim/tesseract/wiki
4. **API Keys**: OpenAI and/or Gemini, Google Cloud TTS

---

## Installation

### Step 1: Clone & Navigate
```powershell
git clone <repo-url> Journey-Creation
cd Journey-Creation
```

### Step 2: Install Node Dependencies
```powershell
npm install
```

### Step 3: Install Python Dependencies
```powershell
cd hf_backend
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

### Step 4: Configure Tesseract
Add to PATH:
```powershell
$env:PATH += ";C:\Program Files\Tesseract-OCR"
```

Verify:
```powershell
tesseract --version
```

### Step 5: Create Environment File

Create `.env` in project root:

```env
# LLM APIs (at least one required)
OPENAI_API_KEY=your_openai_key_here
GEMINI_API_KEY=your_gemini_key_here

# Text-to-Speech
GOOGLE_TTS_API_KEY=your_google_tts_key_here

# System defaults (optional)
LLM_PROVIDER=auto
PORT=3000
MAX_CONCURRENT_EPISODES=3
```

---

## Starting the System

### Option 1: Two Terminals (Recommended)

**Terminal 1 - Python Backend:**
```powershell
cd hf_backend
venv\Scripts\Activate.ps1
python main.py
```
✅ Running at: http://localhost:8000

**Terminal 2 - Node Server:**
```powershell
npm start
```
✅ Running at: http://localhost:3000

### Option 2: Background Start (PowerShell)
```powershell
# Start Python backend
cd hf_backend
venv\Scripts\Activate.ps1
Start-Process powershell -ArgumentList "-Command", "python main.py"
cd ..

# Start Node server
npm start
```

---

## Verify Installation

Open these URLs:

1. **Dashboard**: http://localhost:3000/teacher/dashboard.html
2. **Backend Health**: http://localhost:8000/health

If both load ✅ you're ready!

---

## First Upload

1. Go to: http://localhost:3000/teacher/upload.html
2. Upload a chapter PDF (or paste text)
3. Fill metadata: grade, subject, curriculum
4. Enter character names (default: Maya & Arjun)
5. Choose LLM provider
6. Click "Start Processing"

Processing takes 10-30 minutes depending on chapter size.

---

## File Structure After Install

```
Journey-Creation/
├── node_modules/          # Node dependencies (ignored in git)
├── hf_backend/
│   ├── venv/             # Python virtual env (ignored)
│   └── main.py           # Python backend entry
├── outputs/              # Generated content (created on first run)
├── cache/                # LLM response cache (created on first run)
├── logs/                 # System logs (created on first run)
├── .env                  # Your config (CREATE THIS)
└── server.js             # Node backend entry
```

---

## Common Issues

### "Module not found" (Node)
```powershell
npm install
```

### "Module not found" (Python)
```powershell
cd hf_backend
venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### "Tesseract not found"
Add to PATH:
```powershell
$env:PATH += ";C:\Program Files\Tesseract-OCR"
```

### "API key invalid"
Check `.env` file has valid keys:
```env
OPENAI_API_KEY=sk-...
GOOGLE_TTS_API_KEY=...
```

### Port already in use
Change in `.env`:
```env
PORT=3001
```
Or kill existing process:
```powershell
# Find process on port 3000
netstat -ano | findstr :3000
# Kill it (replace PID)
taskkill /PID <PID> /F
```

---

## Development Mode

### Enable Debug Logs
In `.env`:
```env
LOG_LEVEL=debug
```

### Clear Cache
```powershell
Remove-Item -Recurse cache/*
```

Or use API:
```powershell
curl -X DELETE http://localhost:3000/api/v1/cache/clear
```

---

## Updating the System

```powershell
# Pull latest code
git pull

# Update Node dependencies
npm install

# Update Python dependencies
cd hf_backend
venv\Scripts\Activate.ps1
pip install -r requirements.txt --upgrade
```

---

## Next Steps

- Read `03_PIPELINE_FLOW.md` to understand how content is generated
- Read `04_PROMPTING_PHILOSOPHY.md` to understand the revision approach
- Read `05_API_ENDPOINTS.md` for API reference
