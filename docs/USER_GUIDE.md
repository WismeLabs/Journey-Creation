# User Guide: AI Educational Content Pipeline

## Getting Started

This guide will help you set up, configure, and use the AI Educational Content Pipeline to create educational content from PDFs.

---

## Table of Contents

1. [Installation & Setup](#installation--setup)
2. [Starting the System](#starting-the-system)
3. [Using the Web Interface](#using-the-web-interface)
4. [Content Upload Workflow](#content-upload-workflow)
5. [Review & Approval](#review--approval)
6. [Monitoring & Debugging](#monitoring--debugging)
7. [Advanced Configuration](#advanced-configuration)
8. [Troubleshooting](#troubleshooting)

---

## Installation & Setup

### Prerequisites

Before you begin, ensure you have:
- **Node.js 22.x** or higher
- **Python 3.13.x** or higher
- **Tesseract OCR** installed and in PATH
- **LLM API Key** (OpenAI, Anthropic, etc.)

### Step 1: Clone Repository

```powershell
cd D:\Startups\Wisme\Dev\
git clone <repository-url> Journey-Creation
cd Journey-Creation
```

### Step 2: Install Node.js Dependencies

```powershell
npm install
```

**Key packages installed:**
- `express` - Web server framework
- `pdf-parse` - PDF text extraction
- `tesseract.js` - OCR for scanned PDFs
- `p-limit` - Parallel processing control
- `dotenv` - Environment variable management

### Step 3: Install Python Dependencies

```powershell
cd hf_backend
python -m venv venv
venv\Scripts\Activate.ps1
pip install -r requirements.txt
cd ..
```

**Key packages installed:**
- `fastapi` - Python web framework
- `uvicorn` - ASGI server
- `pydub` - Audio processing
- TTS libraries (provider-specific)

### Step 4: Install Tesseract OCR

Download and install from: https://github.com/UB-Mannheim/tesseract/wiki

Add to PATH:
```powershell
$env:PATH += ";C:\Program Files\Tesseract-OCR"
```

Place `eng.traineddata` in project root (already included).

### Step 5: Configure Environment Variables

Create `.env` file in project root:

```env
# LLM Configuration
LLM_API_KEY=your_api_key_here
LLM_MODEL=gpt-4
LLM_BASE_URL=https://api.openai.com/v1

# TTS Configuration
TTS_PROVIDER=azure
AZURE_SPEECH_KEY=your_azure_key
AZURE_SPEECH_REGION=eastus

# Server Configuration
PORT=3000
PYTHON_BACKEND_URL=http://localhost:8000

# Performance Settings
MAX_CONCURRENT_EPISODES=3
CACHE_TTL_DAYS=7
```

### Step 6: Verify Installation

```powershell
# Check Node.js version
node --version  # Should show v22.x.x

# Check Python version
python --version  # Should show 3.13.x

# Check Tesseract
tesseract --version  # Should show 4.x.x
```

---

## Starting the System

### Method 1: Separate Terminals (Recommended for Development)

**Terminal 1 - Node.js Server:**
```powershell
npm start
```
Server starts on `http://localhost:3000`

**Terminal 2 - Python Backend:**
```powershell
cd hf_backend
venv\Scripts\Activate.ps1
python main.py
```
Backend starts on `http://localhost:8000`

### Method 2: Background Processes

**Start both servers:**
```powershell
# Start Node.js in background
Start-Process powershell -ArgumentList "-Command", "npm start"

# Start Python backend
cd hf_backend
venv\Scripts\Activate.ps1
Start-Process powershell -ArgumentList "-Command", "python main.py"
```

### Verify Servers Are Running

Open browser and check:
- **Main UI**: http://localhost:3000/upload.html
- **Backend Health**: http://localhost:8000/health

You should see the upload interface and a health check response.

---

## Using the Web Interface

The system has 4 main pages:

### 1. Upload Page (`/upload.html`)
- Upload PDF files
- Configure voice settings
- Start content generation

### 2. Review Page (`/review.html`)
- View generated episodes
- Review scripts and MCQs
- Approve or regenerate content

### 3. Logs Page (`/logs.html`)
- View real-time system logs
- Filter by log level (info, error, warn)
- Debug issues

### 4. Dev Stats Page (`/dev-stats.html`)
- Monitor cache performance
- View cost savings
- Manage cache (clear, refresh)
- Track episode generation metrics

---

## Content Upload Workflow

### Step 1: Navigate to Upload Page

Open browser: `http://localhost:3000/upload.html`

### Step 2: Prepare Your PDF

Ensure your PDF:
- Contains educational content (textbook, course material)
- Has clear chapter/section structure
- Is text-based or high-quality scanned images (for OCR)
- Is in English (other languages coming soon)

### Step 3: Configure Voice Settings

**Teacher Voice:**
- **Voice Name**: Select from dropdown (e.g., "en-US-JennyNeural")
- **Pitch**: Default 0 (range: -10 to +10)
- **Rate**: Default 1.0 (range: 0.5 to 2.0)
- **Style**: conversational, friendly, professional, etc.

**Student Voice:**
- Configure similar to teacher voice
- Choose a different voice for variety
- Typically use a younger-sounding voice

**Example Configuration:**
```
Teacher: en-US-JennyNeural, Pitch: 0, Rate: 1.0, Style: friendly
Student: en-US-GuyNeural, Pitch: +2, Rate: 1.1, Style: cheerful
```

### Step 4: Upload PDF

1. Click "Choose File" button
2. Select your PDF file
3. Click "Upload & Generate"
4. Wait for processing to complete

**What happens during upload:**
```
1. PDF uploaded to server (uploads/ directory)
2. Text extraction (pdf-parse or OCR if scanned)
3. Content analysis and chapter detection
4. Concept extraction (semantic analysis)
5. Episode planning (structure creation)
6. Parallel episode generation (3 at a time):
   - Script generation (LLM)
   - MCQ generation (3 per concept)
   - Metadata creation
7. Output saved to outputs/ directory
```

### Step 5: Monitor Progress

Watch the progress indicator:
- ⏳ Uploading PDF...
- 📄 Analyzing content...
- 🧠 Extracting concepts...
- 📝 Planning episodes...
- ✨ Generating episode 1/10...
- ✨ Generating episode 2/10...
- (Parallel processing - multiple episodes at once)
- ✅ Generation complete!

**Typical Processing Time:**
- Small PDF (20-50 pages): 5-10 minutes
- Medium PDF (50-150 pages): 15-30 minutes
- Large PDF (150+ pages): 30-60 minutes

*Time varies based on cache hits and LLM response speed*

---

## Review & Approval

### Step 1: Navigate to Review Page

Click "Review" in navigation or go to: `http://localhost:3000/review.html`

### Step 2: Browse Episodes

Episodes are displayed as cards:
```
Episode 1: Introduction to Biology
Status: ✅ Complete
Concepts: 5
MCQs: 15 (3 per concept)
Duration: ~8 minutes
[View Details] [Regenerate]
```

### Step 3: Review Episode Content

Click "View Details" to see:

**Script Preview:**
```
TEACHER: "Welcome to our journey into biology..."
STUDENT: "I'm excited to learn about living organisms!"
TEACHER: "Let's start with the basic definition of life..."
```

**Concept List:**
- Cell Theory
- Homeostasis
- Evolution
- Metabolism
- Reproduction

**MCQ Samples:**
```
Q1: What is the basic unit of life?
A) Tissue
B) Cell ✓
C) Organ
D) Organism

Q2: Which process maintains stable internal conditions?
A) Metabolism
B) Homeostasis ✓
C) Reproduction
D) Evolution
```

### Step 4: Approve or Regenerate

**If content looks good:**
- Click "Approve" to proceed to TTS generation
- Content is locked and ready for audio production

**If content needs changes:**
- Click "Regenerate" to create new version
- Optionally edit prompts in `templates/prompts/` first
- System will use cache if possible (faster regeneration)

### Step 5: Generate Audio

After approval:
1. Click "Generate Audio" for selected episodes
2. System sends scripts to Python backend
3. TTS converts text to speech using configured voices
4. Audio files saved to `outputs/audio/`

**Audio Generation Progress:**
```
🎙️ Generating audio for Episode 1...
🎙️ Generating audio for Episode 2...
✅ Audio generation complete!
```

---

## Monitoring & Debugging

### Using the Logs Page

Navigate to: `http://localhost:3000/logs.html`

**Features:**
- **Real-time updates**: Logs refresh every 5 seconds
- **Dark mode interface**: Easy on the eyes during debugging
- **Log filtering**: Filter by INFO, WARN, ERROR, or ALL
- **Timestamps**: Precise timing for debugging
- **Search**: Find specific error messages quickly

**Common Log Patterns:**

✅ **Successful Generation:**
```
[2025-11-26 10:30:15] INFO: Starting episode generation for upload_abc123
[2025-11-26 10:30:20] INFO: Extracted 45 concepts from PDF
[2025-11-26 10:30:25] INFO: Planned 8 episodes
[2025-11-26 10:35:40] INFO: Episode 1 generated successfully
[2025-11-26 10:35:41] INFO: Cache HIT for episode 2 script
[2025-11-26 10:40:15] INFO: All episodes complete
```

⚠️ **Warnings (Non-Critical):**
```
[2025-11-26 10:32:10] WARN: OCR quality low, some text may be inaccurate
[2025-11-26 10:35:45] WARN: Retry attempt 1/3 for LLM call
[2025-11-26 10:38:20] WARN: Generated only 2 MCQs for concept (expected 3)
```

❌ **Errors (Require Attention):**
```
[2025-11-26 10:33:15] ERROR: LLM API rate limit exceeded
[2025-11-26 10:34:20] ERROR: Python backend not responding (port 8000)
[2025-11-26 10:36:45] ERROR: Invalid JSON response from LLM
```

### Using the Dev Stats Page

Navigate to: `http://localhost:3000/dev-stats.html`

**Metrics Displayed:**

**Cache Performance:**
- Total Requests: 142
- Cache Hits: 89 (62.7%)
- Cache Misses: 53 (37.3%)
- Estimated Savings: $12.50
- Cache Size: 3.2 MB

**Episode Generation:**
- Episodes Generated Today: 24
- Average Generation Time: 6.2 minutes
- Parallel Episodes: 3 concurrent
- Success Rate: 97.5%

**System Health:**
- Node.js Memory: 245 MB / 512 MB
- Python Backend: ✅ Connected
- LLM API: ✅ Responding
- Cache Directory: ✅ Writable

**Actions Available:**
- 🔄 Refresh Stats (auto-refreshes every 10s)
- 🗑️ Clear Cache (removes all cached responses)
- 📊 Export Metrics (download as CSV)

### When to Clear Cache

Clear cache if:
- Testing prompt changes and want fresh LLM responses
- Cache hit rate is unusually high with poor quality content
- Disk space is running low (cache can grow large)
- Switching to a different LLM model or provider

**⚠️ Warning:** Clearing cache will slow down subsequent generations until cache rebuilds.

---

## Advanced Configuration

### Customizing Prompts

Prompts are stored in `templates/prompts/`:

**1. Chapter Analysis Prompt** (`chapter_analysis_prompt.txt`)
- Controls how concepts are extracted from content
- Customize to focus on specific educational aspects
- Example: Emphasize practical applications vs theoretical concepts

**2. Episode Script Prompt** (`episode_script_prompt.txt`)
- Controls conversational style and structure
- Customize teacher/student interaction style
- Example: More Socratic dialogue vs direct instruction

**3. MCQ Generation Prompt** (`mcq_generation_prompt.txt`)
- Controls question difficulty and style
- Customize distractor quality and question types
- Example: More application-based vs recall questions

**To Customize:**
1. Open prompt file in text editor
2. Modify instructions while keeping structure
3. Save file (changes take effect immediately)
4. Clear cache if testing on existing content

### Adjusting Concurrency

Edit `.env` file:
```env
# Default: 3 concurrent episodes
MAX_CONCURRENT_EPISODES=5

# Warning: Higher values = faster but more memory/API load
# Lower values = slower but more stable
```

Recommended values:
- **Low-end machine**: 2
- **Standard machine**: 3 (default)
- **High-end machine**: 5
- **Server**: 7-10

### Cache Configuration

Edit `.env` file:
```env
# Cache TTL in days (default: 7)
CACHE_TTL_DAYS=14

# Cache directory (default: ./cache)
CACHE_DIR=D:/CustomCachePath
```

Cache files are named: `{SHA-256 hash}.json`
- Hash is based on prompt + model + temperature
- Identical requests hit cache automatically
- Expired files deleted on next cache check

### Voice Configuration Presets

Create voice presets in `config/voice-presets.json`:
```json
{
  "professional": {
    "teacher": {
      "name": "en-US-JennyNeural",
      "pitch": 0,
      "rate": 1.0,
      "style": "professional"
    },
    "student": {
      "name": "en-US-GuyNeural",
      "pitch": 2,
      "rate": 1.1,
      "style": "curious"
    }
  },
  "casual": {
    "teacher": {
      "name": "en-US-AriaNeural",
      "pitch": 1,
      "rate": 1.05,
      "style": "friendly"
    },
    "student": {
      "name": "en-US-DavisNeural",
      "pitch": 3,
      "rate": 1.15,
      "style": "cheerful"
    }
  }
}
```

---

## Troubleshooting

### Common Issues

#### Issue 1: "Python backend not responding"

**Symptoms:**
- Upload page shows "Backend connection failed"
- TTS generation fails
- Dev stats shows "Python Backend: ❌ Disconnected"

**Solutions:**
```powershell
# Check if Python backend is running
netstat -an | findstr "8000"

# If not running, start it
cd hf_backend
venv\Scripts\Activate.ps1
python main.py

# Check for port conflicts
# If port 8000 is taken, change in .env and hf_backend/main.py
```

#### Issue 2: "LLM API rate limit exceeded"

**Symptoms:**
- Episode generation stops midway
- Error in logs: "Rate limit exceeded"
- Retry attempts fail

**Solutions:**
```powershell
# Solution 1: Reduce concurrency
# Edit .env:
MAX_CONCURRENT_EPISODES=2

# Solution 2: Wait and retry
# Rate limits reset after 60 seconds typically

# Solution 3: Use cache for retries
# Cached responses don't count toward rate limits
```

#### Issue 3: "OCR quality low, inaccurate text"

**Symptoms:**
- Warning in logs about OCR quality
- Generated content has typos or missing sections
- PDF is scanned/image-based

**Solutions:**
```powershell
# Solution 1: Use higher quality PDF
# Re-scan at higher DPI (300+)

# Solution 2: Pre-process PDF
# Use Adobe Acrobat or similar to run OCR first

# Solution 3: Manual text extraction
# Copy text from PDF and provide as text file
```

#### Issue 4: "Cache not working, every request is a miss"

**Symptoms:**
- Cache hit rate is 0%
- Dev stats shows all misses
- Regeneration takes full time

**Solutions:**
```powershell
# Check cache directory exists
Test-Path cache
# If false, create it:
New-Item -ItemType Directory -Path cache

# Check write permissions
# Run PowerShell as Administrator if needed

# Verify .env configuration
# Ensure CACHE_TTL_DAYS is set and valid
```

#### Issue 5: "Generated MCQs are incomplete or incorrect"

**Symptoms:**
- Less than 3 MCQs per concept
- MCQs don't match episode content
- Answers are incorrect

**Solutions:**
```powershell
# Solution 1: Regenerate specific episode
# Use "Regenerate" button on review page

# Solution 2: Customize MCQ prompt
# Edit templates/prompts/mcq_generation_prompt.txt
# Add more specific instructions

# Solution 3: Clear cache and retry
# Cache may contain old, incorrect responses
# Clear via dev-stats.html

# Solution 4: Check concept extraction
# Review logs to verify concepts were extracted correctly
```

#### Issue 6: "Node.js out of memory"

**Symptoms:**
- Process crashes during large PDF processing
- Error: "JavaScript heap out of memory"

**Solutions:**
```powershell
# Increase Node.js memory limit
$env:NODE_OPTIONS="--max-old-space-size=4096"
npm start

# Or edit package.json:
"scripts": {
  "start": "node --max-old-space-size=4096 server.js"
}

# Reduce concurrency to lower memory usage
# Edit .env: MAX_CONCURRENT_EPISODES=2
```

### Getting Help

1. **Check Logs First**: `logs.html` shows detailed error messages
2. **Check Dev Stats**: `dev-stats.html` shows system health
3. **Review Documentation**: 
   - `README.md` - Quick reference
   - `docs/README.md` - API documentation
   - `docs/PRODUCT_OVERVIEW.md` - System architecture
4. **Common Error Messages**: See error reference in `docs/README.md`
5. **Contact Team**: Provide logs and steps to reproduce

---

## Best Practices

### For Content Quality

✅ **DO:**
- Use high-quality, text-based PDFs when possible
- Review generated content before approving
- Customize prompts for your specific educational domain
- Test voice settings with short samples first

❌ **DON'T:**
- Upload extremely large PDFs (>500 pages) without testing
- Approve content without reviewing MCQs
- Change prompts mid-generation (wait for completion)
- Use cache when testing prompt changes

### For Performance

✅ **DO:**
- Keep cache enabled for production use
- Monitor cache hit rate on dev-stats
- Use parallel processing (default 3)
- Clear cache periodically (monthly)

❌ **DON'T:**
- Set concurrency too high (>10) without testing
- Clear cache during active generation
- Disable cache in production
- Regenerate unnecessarily (cache saves costs)

### For Maintenance

✅ **DO:**
- Check logs daily for warnings/errors
- Monitor disk space (cache and uploads grow)
- Back up outputs/ directory regularly
- Keep .env file secure (API keys)

❌ **DON'T:**
- Commit .env to version control
- Delete cache directory manually (use dev-stats)
- Run multiple instances on same ports
- Ignore repeated warnings in logs

---

## Quick Reference

### Essential URLs
- Upload: `http://localhost:3000/upload.html`
- Review: `http://localhost:3000/review.html`
- Logs: `http://localhost:3000/logs.html`
- Dev Stats: `http://localhost:3000/dev-stats.html`

### Essential Commands
```powershell
# Start Node.js server
npm start

# Start Python backend
cd hf_backend; venv\Scripts\Activate.ps1; python main.py

# View running processes
netstat -an | findstr "3000 8000"

# Check logs
Get-Content logs/generation.log -Tail 50 -Wait

# Clear cache
Remove-Item cache/* -Recurse -Force
```

### Key File Locations
- PDFs: `uploads/`
- Generated content: `outputs/`
- Audio files: `outputs/audio/`
- Cache: `cache/`
- Logs: `logs/`
- Prompts: `templates/prompts/`

### Environment Variables
- `LLM_API_KEY` - Your LLM provider API key
- `LLM_MODEL` - Model name (e.g., gpt-4)
- `MAX_CONCURRENT_EPISODES` - Parallel processing limit (default: 3)
- `CACHE_TTL_DAYS` - Cache expiration (default: 7)
- `TTS_PROVIDER` - TTS provider (azure, google, etc.)

---

## Next Steps

Now that you're set up:

1. **Test with Sample PDF**: Upload a small PDF (10-20 pages) to test workflow
2. **Review Generated Content**: Check quality of scripts and MCQs
3. **Customize Voices**: Experiment with different voice settings
4. **Monitor Performance**: Watch dev-stats during generation
5. **Optimize Configuration**: Adjust concurrency and cache based on your needs

For more detailed API information, see `docs/README.md`.

For system architecture and capabilities, see `docs/PRODUCT_OVERVIEW.md`.

Happy content creation! 🚀
