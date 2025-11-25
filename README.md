# Journey Creation

AI-powered educational content pipeline that generates podcast-style learning episodes from curriculum materials.

## Features

- **Multi-LLM Support**: GPT-5, GPT-4o, Gemini 2.0 Flash with auto-fallback
- **Parallel Processing**: 3 episodes generated concurrently
- **LLM Response Caching**: Saves costs on repeated content
- **Voice Synthesis**: Google Cloud TTS with 21 HD voices
- **Modern UI**: Clean web interface for developers

---

## 🚀 Setup & Installation

### Prerequisites

Install these first:
- **Node.js 22+** → [Download here](https://nodejs.org/)
- **Python 3.13+** → [Download here](https://www.python.org/)
- **API Keys**: OpenAI and/or Gemini, Google Cloud TTS

### Step 1: Install Dependencies

```powershell
# Install Node.js packages
npm install

# Install Python packages
cd hf_backend
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

### Step 2: Configure Environment

Create `.env` file in project root:

```env
# LLM Provider (auto switches between available APIs)
LLM_PROVIDER=auto
OPENAI_API_KEY=your_openai_key_here
GEMINI_API_KEY=your_gemini_key_here

# Text-to-Speech
GOOGLE_TTS_API_KEY=your_google_tts_key_here

# Performance Settings (optional)
LLM_CACHE_ENABLED=true
LLM_CACHE_TTL=604800000
MAX_CONCURRENT_EPISODES=3
```

---

## ▶️ Start the System

Run these in **TWO separate terminals**:

### Terminal 1: Python Backend

```powershell
cd hf_backend
venv\Scripts\Activate.ps1
python main.py
```

✅ **Backend running at:** http://localhost:8000

### Terminal 2: Node.js Server

```powershell
npm start
```

✅ **Web interface at:** http://localhost:3000

### Verify Everything Works

Open these URLs in your browser:
- **Upload Page**: http://localhost:3000/teacher/upload.html
- **Backend Health**: http://localhost:8000/health

If both load, you're ready to go! 🎉

---

## 🎯 How to Use

### 1. Upload Content

**Go to:** http://localhost:3000/teacher/upload.html

1. Upload a PDF or paste text
2. Select grade, subject, curriculum
3. Choose AI model (auto/OpenAI/Gemini)
4. Configure student voice settings
5. Click "Generate Episodes"

**Processing time:** 5-30 minutes depending on content size

### 2. Review Generated Content

**Go to:** http://localhost:3000/teacher/review.html

- View all generated episodes
- Read scripts and MCQ questions
- Approve or regenerate episodes
- Generate final audio files

### 3. Monitor System Performance

**Logs:** http://localhost:3000/teacher/logs.html
- Real-time system logs
- Filter by level (INFO/ERROR/WARN)
- Dark mode developer interface

**Stats:** http://localhost:3000/teacher/dev-stats.html
- Cache performance metrics
- Cost savings tracking
- System health monitoring

---

## 📂 Web Interface Pages

| Page | URL | Purpose |
|------|-----|---------|
| Upload | `/teacher/upload.html` | Upload PDFs & configure generation |
| Review | `/teacher/review.html` | Review and approve episodes |
| Logs | `/teacher/logs.html` | System logs and debugging |
| Stats | `/teacher/dev-stats.html` | Performance metrics and cache |

---

## 📂 Project Structure

```
Journey-Creation/
├── server.js                 # Main Node.js server
├── hf_backend/
│   ├── main.py              # Python FastAPI backend
│   └── requirements.txt     # Python dependencies
├── services/
│   ├── ingest/              # PDF processing & OCR
│   ├── semantic/            # Concept extraction (cached)
│   ├── planner/             # Episode planning
│   ├── tts/                 # Voice synthesis
│   └── validation/          # Quality validation
├── teacher_ui/              # Web interface (4 pages)
├── templates/prompts/       # LLM prompt templates
├── schemas/                 # JSON validation schemas
├── cache/                   # LLM response cache
└── outputs/                 # Generated episodes
```

---

## 🔧 API Reference

### Content Generation
```http
POST /api/v1/generate          # Submit PDF/text for processing
GET  /api/v1/status/:jobId     # Check generation progress
GET  /api/v1/chapters/:id      # Get generated content
```

### Performance & Monitoring
```http
GET    /api/v1/metrics         # System performance metrics
GET    /api/v1/cache/stats     # Cache hit rate & savings
DELETE /api/v1/cache/clear     # Clear LLM response cache
```

### Voice Configuration
```http
GET  /api/v1/tts/voices        # Available TTS voices
GET  /api/v1/tts/config        # Current voice settings
PUT  /api/v1/tts/config        # Update voice config
POST /api/v1/tts/test          # Test voice synthesis
```

---

## 📁 Output Structure

```
outputs/CBSE/Grade-8/math_grade8_abc123/
├── concepts.json              # Extracted learning concepts
├── episode_plan.json          # Episode structure & outline
├── Episode-1/
│   ├── script.json           # Dialogue script (teacher + student)
│   ├── mcqs.json             # Quiz questions (3 per concept)
│   └── audio/
│       └── audio.mp3         # Generated episode audio
├── Episode-2/
└── Episode-N/
```

---

## ⚡ Performance Features

### Parallel Processing
- **3 episodes generated simultaneously** using p-limit
- Reduces total generation time by ~60%
- Configurable via `MAX_CONCURRENT_EPISODES` in `.env`

### LLM Response Caching
- File-based cache with SHA-256 hashing
- 7-day TTL (configurable via `LLM_CACHE_TTL`)
- Saves $0.02-0.05 per cached concept extraction
- Monitor cache performance in dev-stats page

### Cost Optimization
- Auto LLM fallback (GPT-5 → GPT-4o → Gemini)
- Cached responses eliminate redundant API calls
- **Estimated cost:** $0.64-2.50 per 100 chapters

---

## 🛠️ Troubleshooting

### ❌ Server won't start

**Problem:** Node.js or Python server fails to start

**Solutions:**
```powershell
# Check versions
node --version    # Need 22+
python --version  # Need 3.13+

# Verify dependencies installed
npm install
cd hf_backend; pip install -r requirements.txt

# Check .env file exists with API keys
Get-Content .env
```

### ❌ Generation fails

**Problem:** Episode generation stops or errors out

**Solutions:**
1. **Check logs:** http://localhost:3000/teacher/logs.html
2. **Verify API keys** in `.env` are valid and active
3. **Check LLM provider status** (OpenAI/Gemini dashboards)
4. **Clear cache** if seeing stale/incorrect responses
5. **Reduce concurrency** in `.env`: `MAX_CONCURRENT_EPISODES=2`

### ❌ No audio generated

**Problem:** TTS fails to create audio files

**Solutions:**
```powershell
# Verify Google TTS key is set
echo $env:GOOGLE_TTS_API_KEY

# Check Python backend is running
curl http://localhost:8000/health

# Verify TTS quota in Google Cloud Console
```

### ❌ Cache not working

**Problem:** Cache hit rate is 0%, every request is a miss

**Solutions:**
```powershell
# Check cache directory exists
Test-Path cache

# Create if missing
New-Item -ItemType Directory -Path cache

# Verify cache is enabled in .env
# LLM_CACHE_ENABLED=true
```

---

## 📚 Documentation

- **[Product Overview](docs/PRODUCT_OVERVIEW.md)** - Comprehensive product documentation
- **[User Guide](docs/USER_GUIDE.md)** - Complete setup and usage guide for team members
- **API Docs**: http://localhost:8000/docs (when Python backend running)

---

## 🔑 Environment Variables Reference

```env
# LLM Provider Settings
LLM_PROVIDER=auto               # Options: auto, openai, gemini
OPENAI_API_KEY=sk-...           # Your OpenAI API key
OPENAI_MODEL=gpt-5.1,gpt-4o     # Models to try (fallback order)
GEMINI_API_KEY=...              # Your Gemini API key

# Text-to-Speech
GOOGLE_TTS_API_KEY=...          # Google Cloud TTS API key

# Performance & Caching
LLM_CACHE_ENABLED=true          # Enable/disable caching
LLM_CACHE_TTL=604800000         # Cache TTL in milliseconds (7 days)
MAX_CONCURRENT_EPISODES=3       # Parallel episode generation limit

# Server Configuration
PORT=3000                       # Node.js server port
HF_BACKEND_URL=http://127.0.0.1:8000  # Python backend URL
```

---

## 📊 Cache Management

### View Cache Stats
```powershell
curl http://localhost:3000/api/v1/cache/stats
```

**Response:**
```json
{
  "totalRequests": 142,
  "cacheHits": 89,
  "cacheMisses": 53,
  "hitRate": "62.7%",
  "estimatedSavings": "$12.50",
  "cacheSize": "3.2 MB"
}
```

### Clear Cache
```powershell
curl -X DELETE http://localhost:3000/api/v1/cache/clear
```

**When to clear cache:**
- Testing new prompt templates
- Switching LLM models
- Getting stale/incorrect responses
- Running low on disk space

---

**Version:** 3.0.0  
**Status:** Production Ready  
**Last Updated:** November 2025
- Review logs for TTS errors

### Cache not working
- Check `cache/` directory exists
- Verify `LLM_CACHE_ENABLED=true` in `.env`
- View cache stats at http://localhost:3000/teacher/dev-stats.html

## Documentation

See [docs/README.md](docs/README.md) for complete API reference and advanced configuration.

## License

Proprietary - WismeLabs
