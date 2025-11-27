# Journey Creation

AI-powered audio revision content generator for K-12 students.

**Input**: Textbook chapter PDF  
**Output**: 5-8 minute audio episodes where two students revise the chapter together

Students listen at home - after school, before tests, or anytime.

---

## Quick Start

### 1. Install
```powershell
npm install
cd hf_backend
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Configure
Create `.env` file:
```env
OPENAI_API_KEY=your_key_here
GOOGLE_TTS_API_KEY=your_key_here
```

### 3. Run
**Terminal 1**:
```powershell
cd hf_backend
venv\Scripts\Activate.ps1
python main.py
```

**Terminal 2**:
```powershell
npm start
```

### 4. Open
http://localhost:3000/teacher/dashboard.html

---

## Documentation

📖 **Read these in order**:

1. **[System Overview](docs/01_SYSTEM_OVERVIEW.md)** - What this does
2. **[Setup Guide](docs/02_SETUP_GUIDE.md)** - Detailed installation
3. **[Pipeline Flow](docs/03_PIPELINE_FLOW.md)** - How content is generated
4. **[Workflow & Approvals](docs/WORKFLOW.md)** - Pause points, approval gates, continuation triggers
5. **[Prompting Philosophy](docs/04_PROMPTING_PHILOSOPHY.md)** - Revision approach & tone
6. **[Prompt Quality Audit](docs/PROMPT_QUALITY_AUDIT.md)** - All prompts reviewed for quality
7. **[Prompt Migration Guide](docs/PROMPT_MIGRATION.md)** - How prompts are organized (txt files)
8. **[API Endpoints](docs/05_API_ENDPOINTS.md)** - API reference
9. **[File Structure](docs/06_FILE_STRUCTURE.md)** - Code organization

---

## Key Features

✅ **Revision-Focused**: Not teaching - helps students refresh what they learned  
✅ **Engaging Content**: Humor, relatable examples, memory tricks  
✅ **Smart Planning**: AI analyzes chapter structure, preserves textbook order  
✅ **Textbook Order Preservation**: Concepts NEVER reordered - teaching sequence maintained  
✅ **Strategy-Based Episodes**: Sequential flow, thematic grouping, or time-balanced per chapter nature  
✅ **Parallel Processing**: Generates 3 episodes simultaneously  
✅ **Quality Control**: Review & approve plan → scripts → audio generation  
✅ **Multi-LLM**: OpenAI (GPT-4o) / Gemini 2.0 Flash with auto-fallback  
✅ **Progress Tracking**: Real-time status during LLM calls (calling_llm, parsing_response)

---

## Tech Stack

- **Node.js 22+** - Backend server
- **Python 3.13+** - LLM & TTS orchestration
- **OpenAI / Gemini** - Content generation
- **Google Cloud TTS** - Voice synthesis
- **Tesseract OCR** - PDF text extraction

---

## Output Structure

```
outputs/chapter_{id}/
├── workflow_status.json    # Current pipeline stage & approval status
├── concepts.json           # Extracted concepts IN TEXTBOOK ORDER with metadata
├── episode_plan.json       # Episode grouping with planning_metadata (strategy, analysis)
└── Episode-{N}/
    ├── script.json        # Dialogue between two students
    ├── mcqs.json         # Quiz questions (2-3 per concept)
    └── audio.mp3         # TTS generated audio
```

See `docs/WORKFLOW.md` for complete pipeline flow with approval gates.

---

## Episode Durations

- Grade 1-2: **4 min**
- Grade 3-4: **5 min**
- Grade 5-6: **6 min**
- Grade 7-8: **7 min**
- Grade 9-10: **8 min**
- Grade 11-12: **10 min**

Flexible: 70%-130% for pedagogical coherence

---

## Core Philosophy

### NOT Teaching - It's Revision
Students already studied in class. They need to:
- **REFRESH** memory
- **CLARIFY** doubts
- **SOLIDIFY** understanding

### Engaging & Memorable
- Uses humor when it helps
- Relatable examples (phones, gaming, social situations)
- Addresses common confusions
- Memory tricks where useful
- Natural conversation (not robotic)

### Anytime Learning
Not just exam prep:
- After school (daily review)
- Weekend revision
- Before tests (exam prep)
- Casual learning

See `docs/04_PROMPTING_PHILOSOPHY.md` for details.

---

## For Your Teammate

Start here:
1. Read `docs/01_SYSTEM_OVERVIEW.md` - Understand what this does
2. Follow `docs/02_SETUP_GUIDE.md` - Get it running
3. Read `docs/04_PROMPTING_PHILOSOPHY.md` - Understand the revision approach
4. Explore the code - inline comments explain everything

**All prompts centralized in**: `templates/prompts/` (txt files for easy editing)
- Concept extraction: `concept_extraction_{Subject}.txt`
- Script generation: `script_generation_{Subject}.txt`
- MCQ generation: `mcq_generation_{Subject}.txt`
- Regeneration: `regeneration_prompts.txt` (13 types)
- Chapter analysis: `chapter_structure_analysis_prompt.txt`

**✅ Supported Subjects** (audio revision format):
- **Science** (CBSE 6-10, ICSE 6-8) - theory + problem-solving strategies
- **Physics, Chemistry, Biology** (ICSE 9-10) - concepts + numerical approaches
- **Social Studies** (CBSE), **History, Geography, Civics** (ICSE) - perfect for audio
- **Computer Science** - algorithms, logic, debugging (students code separately)
- **Economics** - principles, policies, verbal graph descriptions
- **EVS** (grades 1-5) - simple, descriptive

**❌ Not Supported** (require seeing worked examples):
- **Mathematics** - step-by-step problem solving must be seen
- **English** - literature needs text, grammar needs written practice

Prompts are loaded via `hf_backend/prompt_loader.py` → imported by `main.py`

---

## Common Issues

**"Module not found"**: `npm install` or `pip install -r requirements.txt`  
**"Tesseract not found"**: Add to PATH: `C:\Program Files\Tesseract-OCR`  
**"API key invalid"**: Check `.env` file has valid keys  
**Port in use**: Change `PORT=3001` in `.env`

See `docs/02_SETUP_GUIDE.md` for detailed troubleshooting.

---

## Project Status

✅ Core pipeline working  
✅ Parallel episode generation  
✅ Dashboard & review UI  
✅ Voice configuration  
✅ TTS audio generation  
✅ Complete documentation

**Last Updated**: November 26, 2025  
**Version**: 4.0.0 (Revision-focused rewrite)
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
