# System Functionality Reference

Complete reference of all working features, endpoints, services, and data flows in the K-12 Educational Content Generation Pipeline.

---

## Table of Contents
- [Backend Services (FastAPI)](#backend-services-fastapi)
- [Frontend Services (Node.js)](#frontend-services-nodejs)
- [API Endpoints](#api-endpoints)
- [Data Flow Pipelines](#data-flow-pipelines)
- [Web UI Features](#web-ui-features)
- [Configuration & Settings](#configuration--settings)

---

## Backend Services (FastAPI)

**Location:** `hf_backend/main.py`  
**Port:** 8000 (default)  
**Base URL:** `http://localhost:8000`

### Multi-Provider LLM Support
- **Primary Provider:** GPT-5.1 (OpenAI)
- **Fallback Provider:** GPT-4o (OpenAI) → Gemini 2.0 Flash (Google)
- **Auto-Mode:** Tries OpenAI first, falls back to Gemini
- **Manual Override:** Can specify `llm_provider` in request payload

### Job Tracking System
- **Function:** `create_job_id(task_type, data)` - Generates unique job IDs
- **Function:** `track_job(job_id, status, metadata)` - Tracks job lifecycle
- **States:** `queued`, `processing`, `completed`, `failed`
- **Storage:** In-memory with last 100 jobs in history

### Logging System
- **Handler:** `LogHandler` class with 500-log circular buffer
- **Format:** Structured JSON with timestamp, level, source, message, module, function
- **Endpoints:** Exposes logs via `/api/v1/logs` for web UI consumption

### Available Endpoints

#### `/extract_concepts` (POST)
**Purpose:** Extract educational concepts from chapter content using AI  
**Request Body:**
```json
{
  "markdown_content": "string",
  "metadata": {
    "subject": "string",
    "grade_band": "string",
    "chapter_id": "string"
  }
}
```
**Response:**
```json
{
  "concepts": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "prerequisites": ["string"],
      "difficulty": "string"
    }
  ]
}
```

#### `/generate_script` (POST)
**Purpose:** Generate educational dialogue script for episode  
**Request Body:**
```json
{
  "concepts": [{"id": "string", "name": "string"}],
  "episode_title": "string",
  "grade": "string",
  "subject": "string",
  "duration_minutes": 8,
  "source_content": "string",
  "speaker_config": {
    "speaker1_name": "StudentA",
    "speaker2_name": "StudentB",
    "speaker1_personality": "confident",
    "speaker2_personality": "curious"
  }
}
```
**Response:**
```json
{
  "script": {
    "sections": [
      {
        "type": "hook|core1|mini-summary|...",
        "speaker": "StudentA|StudentB",
        "text": "string",
        "duration_seconds": 30
      }
    ]
  }
}
```

#### `/generate_mcqs` (POST)
**Purpose:** Generate multiple-choice questions from script  
**Request Body:**
```json
{
  "concepts": [{"id": "string", "name": "string"}],
  "script": {"sections": [...]},
  "count": 5,
  "difficulty": "easy|medium|hard",
  "speaker_config": {
    "speaker1_name": "StudentA",
    "speaker2_name": "StudentB"
  }
}
```
**Response:**
```json
{
  "mcqs": [
    {
      "question": "string",
      "options": ["A", "B", "C", "D"],
      "correct_answer": "string",
      "type": "recall|concept|understanding",
      "concept_id": "string"
    }
  ]
}
```

#### `/regenerate` (POST)
**Purpose:** Regenerate content with specific improvement prompts  
**Request Body:**
```json
{
  "prompt_type": "simplify_language|add_examples|improve_flow|...",
  "content": {},
  "context": {}
}
```

#### `/analyze_chapter` (POST)
**Purpose:** Analyze chapter structure and difficulty

#### `/health` (GET)
**Purpose:** Health check endpoint  
**Response:**
```json
{
  "status": "healthy",
  "provider": "openai|gemini",
  "timestamp": "ISO-8601"
}
```

#### `/api/v1/logs` (GET)
**Purpose:** Retrieve recent system logs  
**Response:**
```json
{
  "logs": [
    {
      "timestamp": "ISO-8601",
      "level": "INFO|ERROR|WARNING",
      "source": "string",
      "message": "string",
      "module": "string",
      "funcName": "string"
    }
  ]
}
```

#### `/api/v1/jobs` (GET)
**Purpose:** Retrieve active and recent jobs  
**Response:**
```json
{
  "active_jobs": {...},
  "job_history": [...]
}
```

---

## Frontend Services (Node.js)

**Location:** `services/` directory  
**Server:** `server.js` (Express)  
**Port:** 3000 (default)

### PDF Processing Service
**File:** `services/ingest/pdf_processor.js`  
**Class:** Exports singleton instance

**Main Method:** `processChapter(pdfFile, chapter_id, metadata)`
- Extracts text from PDF using `pdf-parse`
- OCR fallback with Tesseract for scanned PDFs
- Structure recovery (headings, lists, tables)
- Diagram detection and placeholder insertion
- Returns: `{markdown, metadata, diagrams, structure}`

**Features:**
- Multi-page processing with progress tracking
- Automatic encoding detection
- Mathematical notation preservation
- Image extraction and cataloging

### Concept Extraction Service
**File:** `services/semantic/concept_extractor.js`  
**Class:** Exports singleton instance

**Main Method:** `extractConceptsWithAI(markdown, metadata)`
- Calls backend `/extract_concepts` endpoint
- Heuristic fallback if AI fails
- Prerequisite relationship mapping
- Returns: `{concepts: [...], metadata}`

**Features:**
- Difficulty classification
- Dependency graph construction
- Concept clustering by topic

### Episode Planning Service
**File:** `services/planner/episode_planner.js`  
**Class:** `EpisodePlanner` singleton

**Main Method:** `planEpisodes(concepts, chapterMetadata)`
- Deterministic clustering with stable pseudo-random seeding
- Topological sort for prerequisite handling
- Greedy episode filling algorithm
- Target duration: 4-8 minutes per episode
- Max concepts per episode: 3
- Returns: Episode plan with concept assignments

**Features:**
- Chapter size classification (small/medium/large)
- Prerequisite dependency resolution
- Episode count optimization (2-10 episodes)
- Duration balancing

### Validation Service
**File:** `services/validation/validator.js`  
**Class:** `ValidationController` singleton

**Main Methods:**
- `validateEpisode(episodeContent, episodeConfig)` - Validates complete episode
- `validateScript(scriptData, episodeConfig)` - Script-specific validation
- `validateMCQs(mcqData, scriptData, episodeConfig)` - MCQ validation
- `repairEpisodeWithRetries(episodeContent, episodeConfig)` - Auto-repair with retries

**Validation Rules:**
- **Script:**
  - Min words: 450, Max words: 1100
  - Min speaker tagging: 95%
  - Forbidden words: "teacher", "instructor", "lesson"
  - Required sections: hook, core1, mini-summary
  - Max story duration: 30 seconds

- **MCQs:**
  - Min questions: 3, Max questions: 6
  - Required types: recall, concept, understanding
  - Min recall: 40%, Min concept: 30%

**Features:**
- Auto-repair with 3 retry attempts
- Error categorization and batch processing
- Idempotent repair operations
- Detailed repair logs

### TTS Orchestration Service
**File:** `services/tts/tts_orchestrator.js`  
**Class:** `TTSOrchestrator` singleton

**Main Methods:**
- `generateEpisodeAudio(episodeData, chapterId, episodeIndex, metadata)` - Generate complete episode audio
- `getCurrentConfiguration()` - Get current voice settings
- `testConnection()` - Test Google TTS connection

**Voice Configuration:**
- StudentA: Confident personality, male voice (default: en-IN-Chirp3-HD-Achird)
- StudentB: Curious personality, female voice (default: en-IN-Chirp3-HD-Aoede)
- Customizable names, voices, SSML settings

**Audio Settings:**
- Format: MP3 (configurable)
- Sample Rate: 44100 Hz (configurable)
- Speaking Rate: 1.0 (0.25-4.0)
- Pitch: 0 semitones (-20 to +20)
- Volume Gain: 0 dB (-96 to +16)

**Features:**
- Segment-based generation (separate files per speaker turn)
- SSML support for prosody control
- Audio stitching and normalization
- Metadata preservation

---

## API Endpoints

**Server:** `server.js` (Express on port 3000)

### Content Generation

#### `POST /api/v1/generate`
**Purpose:** Upload chapter and start generation process  
**Content-Type:** `multipart/form-data` or `application/json`

**Request (File Upload):**
- `chapter_file`: PDF file (max 50MB)
- `chapter_id`: String (required)
- `grade_band`: String (required, e.g., "8")
- `subject`: String (required, e.g., "Mathematics")
- `language`: String (optional, default: "en-IN")
- `curriculum`: String (optional, default: "CBSE")
- `teacher_review`: Boolean (optional)
- `speaker1_name`: String (optional)
- `speaker2_name`: String (optional)
- `speaker1_voice`: String (optional)
- `speaker2_voice`: String (optional)

**Request (Markdown Upload):**
```json
{
  "chapter_id": "string",
  "grade_band": "string",
  "subject": "string",
  "markdown_content": "string",
  "language": "en-IN",
  "curriculum": "CBSE"
}
```

**Response:**
```json
{
  "job_id": "uuid-v4"
}
```

#### `GET /api/v1/status/:jobId`
**Purpose:** Poll job status and progress  
**Response:**
```json
{
  "job_id": "string",
  "status": "queued|processing|completed|failed",
  "progress": 0-100,
  "created_at": "ISO-8601",
  "last_updated": "ISO-8601",
  "error": "string|null",
  "metadata": {
    "chapter_id": "string",
    "grade_band": "string",
    "subject": "string"
  }
}
```

#### `GET /api/v1/result/:chapter_id`
**Purpose:** Retrieve generation results  
**Query Params:** `?generation=gen_timestamp` (optional)

**Response (Success):**
```json
{
  "manifest_url": "/outputs/CBSE/Grade-8/chapter-name/manifest.json",
  "manifest": {...},
  "current_generation": "gen_2025-11-22T10-30-00",
  "available_generations": [
    {
      "id": "gen_2025-11-22T10-30-00",
      "timestamp": "2025-11-22T10:30:00"
    }
  ]
}
```

**Response (Error):**
```json
{
  "error_report": {
    "chapter_id": "string",
    "errors": [...],
    "failed_episodes": [...]
  }
}
```

#### `POST /api/v1/regenerate_episode`
**Purpose:** Manually regenerate specific episode  
**Request Body:**
```json
{
  "chapter_id": "string",
  "episode_index": 1,
  "seed": "optional-custom-seed",
  "prompt_type": "simplify_language|add_examples|..."
}
```

#### `POST /api/v1/retry-episode`
**Purpose:** Retry failed episode generation

#### `POST /api/v1/retry-failed-episodes`
**Purpose:** Batch retry all failed episodes in a chapter

### Audio Generation

#### `POST /api/v1/generate-audio`
**Purpose:** Generate TTS audio for episodes  
**Request Body:**
```json
{
  "chapter_id": "string",
  "episode_indices": [1, 2, 3]
}
```
**Response:**
```json
{
  "job_id": "uuid-v4"
}
```

### Voice Configuration

#### `GET /api/v1/tts/config`
**Purpose:** Get current voice configuration  
**Response:**
```json
{
  "speakers": {
    "speaker1": {
      "name": "StudentA",
      "role": "student",
      "personality": "confident",
      "voice": "en-US-Chirp3-HD-Achird"
    },
    "speaker2": {
      "name": "StudentB",
      "role": "student",
      "personality": "curious",
      "voice": "en-US-Chirp3-HD-Aoede"
    }
  },
  "audio": {
    "format": "mp3",
    "sampleRate": 24000,
    "effects": {
      "normalization": true,
      "backgroundMusic": false
    }
  }
}
```

#### `PUT /api/v1/tts/config`
**Purpose:** Update voice configuration  
**Request Body:** Same as GET response  
**Persistence:** Saves to `outputs/voice_config.json`

#### `POST /api/v1/tts/test`
**Purpose:** Test voice configuration with sample audio  
**Request Body:**
```json
{
  "config": {
    "speaker1_name": "Alex",
    "speaker1_voice": "en-US-Chirp3-HD-Achird",
    "speaker2_name": "Jordan",
    "speaker2_voice": "en-US-Chirp3-HD-Aoede"
  },
  "testScript": {
    "sections": [
      {
        "speaker": "StudentA",
        "text": "Hey! Want to learn about photosynthesis?"
      },
      {
        "speaker": "StudentB",
        "text": "Sure! How do plants make their own food?"
      }
    ]
  }
}
```
**Response:**
```json
{
  "success": true,
  "message": "Test audio generated successfully",
  "audio_url": "/outputs/test_audio/episode_0.mp3",
  "file_path": "absolute-path-to-audio"
}
```

### Teacher Review

#### `POST /api/v1/teacher/review`
**Purpose:** Submit teacher feedback on generated content  
**Request Body:**
```json
{
  "chapter_id": "string",
  "episode_index": 1,
  "rating": 1-5,
  "feedback": "string",
  "hallucinations": ["string"],
  "approved": boolean
}
```

### Monitoring & Logs

#### `GET /api/v1/logs` (Proxy)
**Purpose:** Forward to backend logs endpoint  
**Proxies to:** `http://localhost:8000/api/v1/logs`

#### `GET /api/v1/jobs` (Proxy)
**Purpose:** Forward to backend jobs endpoint  
**Proxies to:** `http://localhost:8000/api/v1/jobs`

---

## Data Flow Pipelines

### 1. Content Generation Pipeline

```
Upload (PDF/Markdown)
  ↓
POST /api/v1/generate
  ↓
Create Job → Queue → {job_id}
  ↓
processChapter() orchestration
  ├→ PDF Processing (ingestService)
  │   └→ Extract text, OCR, structure recovery
  ├→ Concept Extraction (semanticService)
  │   └→ Call backend /extract_concepts
  │   └→ Build dependency graph
  ├→ Episode Planning (plannerService)
  │   └→ Deterministic clustering
  │   └→ Topological sort
  │   └→ Generate episode plan
  └→ For each episode:
      ├→ generateEpisodeContent()
      │   ├→ Load voice config (ttsService)
      │   ├→ Call backend /generate_script
      │   └→ Call backend /generate_mcqs
      ├→ Validate (validationService)
      │   └→ Auto-repair if needed (3 retries)
      ├→ Save episode files
      │   ├→ script.json
      │   ├→ script.txt
      │   ├→ mcqs.json
      │   └→ metadata.json
      └→ Update job progress
  ↓
Generate manifest.json
  ↓
Job Status: completed
```

### 2. Voice Configuration Flow

```
Upload Page Load
  ↓
GET /api/v1/tts/config
  ↓
Display voice preview card
  ├→ Show speaker names
  ├→ Show voice selections
  └→ Show test buttons
  ↓
User clicks "Test Voice"
  ↓
POST /api/v1/tts/test
  ├→ Create test episode data
  ├→ Call ttsService.generateEpisodeAudio()
  ├→ Generate MP3 audio file
  └→ Return audio URL
  ↓
Play audio in browser
  ↓
User clicks "Edit Settings"
  ↓
Navigate to voice-config.html
  ↓
Load current config (GET /api/v1/tts/config)
  ↓
User modifies settings
  ↓
Save (PUT /api/v1/tts/config)
  ├→ Update in-memory config
  └→ Persist to outputs/voice_config.json
  ↓
Return to upload page
```

### 3. Job Polling Flow

```
Submit upload form
  ↓
POST /api/v1/generate → {job_id}
  ↓
Start polling every 5 seconds
  ↓
GET /api/v1/status/{job_id}
  ├→ {status: "queued", progress: 0}
  ├→ {status: "processing", progress: 25}
  ├→ {status: "processing", progress: 50}
  ├→ {status: "processing", progress: 75}
  └→ {status: "completed", progress: 100}
  ↓
Redirect to review.html?chapter={chapter_id}
  ↓
Load results from manifest.json
```

### 4. Audio Generation Flow

```
Review Page → "Generate Audio" button
  ↓
POST /api/v1/generate-audio
  ├→ chapter_id
  └→ episode_indices (optional)
  ↓
{job_id}
  ↓
For each episode:
  ├→ Load script.json
  ├→ Parse into segments (by speaker)
  ├→ Generate TTS for each segment
  │   ├→ Google Cloud TTS API call
  │   ├→ Apply SSML (prosody, pitch, rate)
  │   └→ Save to audio/a_segments/ or audio/b_segments/
  ├→ Stitch segments into complete audio
  ├→ Apply normalization
  └→ Save episode_N.mp3
  ↓
Update manifest.json with audio paths
  ↓
Job Status: completed
```

---

## Web UI Features

### Upload Page (`teacher_ui/upload.html`)

**Features:**
- Chapter file upload (PDF) or markdown paste
- Metadata input (chapter_id, grade, subject, curriculum)
- Voice configuration preview card
  - Displays current saved settings
  - "Test Voice" buttons for each speaker
  - "Edit Settings" → navigate to voice-config.html
- Real-time job progress tracking
  - Polls `/api/v1/status/{jobId}` every 5 seconds
  - Progress bar with percentage
  - Status messages
  - 10-minute timeout with auto-retry
- Auto-redirect to review page on completion

**Voice Preview Card:**
```
┌─────────────────────────────────┐
│ Current Voice Settings          │
├─────────────────────────────────┤
│ StudentA (Confident)            │
│ Voice: en-US-Chirp3-HD-Achird   │
│ [Test Voice]                    │
├─────────────────────────────────┤
│ StudentB (Curious)              │
│ Voice: en-US-Chirp3-HD-Aoede    │
│ [Test Voice]                    │
├─────────────────────────────────┤
│         [Edit Settings]         │
└─────────────────────────────────┘
```

### Voice Configuration Page (`teacher_ui/voice-config.html`)

**Features:**
- Student A configuration
  - Custom name input
  - Voice selection dropdown (Chirp3 HD voices)
  - Personality selection
  - Test audio button
- Student B configuration (same options)
- Audio settings
  - Format (MP3/WAV/OGG)
  - Sample rate
  - Effects (normalization, background music)
- Save button (persists to outputs/voice_config.json)
- Notice: "Global persistent settings"

### Review Page (`teacher_ui/review.html`)

**Features:**
- Chapter overview
  - Metadata display
  - Episode count
  - Generation timestamp
- Episode list
  - Collapsible episode cards
  - Script preview (StudentA/StudentB format)
  - MCQ display
  - Audio player (if generated)
  - Validation status badges
- Actions
  - Generate Audio (batch or individual)
  - Regenerate Episode
  - Download All
  - Export Package
- Teacher feedback form
  - Rating (1-5 stars)
  - Comment box
  - Hallucination flagging
  - Approve/Reject

### Logs Page (`teacher_ui/logs.html`)

**Features:**
- Real-time log streaming
  - Auto-refresh every 3 seconds
  - Manual refresh button
  - Pause/Resume toggle
- Log filtering
  - Level filter (ALL/INFO/WARNING/ERROR)
  - Search box (filters by message content)
  - Source filter (backend/frontend)
- Log display
  - Timestamp
  - Level badge (color-coded)
  - Source module
  - Message text
  - Expandable for full details
- Active jobs panel
  - Job ID
  - Status
  - Task description
  - Timestamp
  - Metadata
- Download logs button (saves as JSON)

**Auto-refresh Logic:**
```javascript
// Fetch logs every 3 seconds
setInterval(() => {
  if (!isPaused) {
    fetch('/api/v1/logs')
      .then(r => r.json())
      .then(data => updateLogDisplay(data.logs));
  }
}, 3000);
```

### Voice Test Page (`teacher_ui/voice-test.html`)

**Features:**
- Quick voice testing interface
- Speaker selection
- Custom text input
- Generate & play test audio
- Voice parameter adjustment sliders

---

## Configuration & Settings

### Environment Variables (.env)

**Backend (Python):**
```bash
# LLM Provider
LLM_PROVIDER=auto  # auto|openai|gemini
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...

# Google Cloud TTS
GOOGLE_TTS_API_KEY=...

# Server
HF_BACKEND_PORT=8000
```

**Frontend (Node.js):**
```bash
# Server
PORT=3000
NODE_ENV=production

# Backend URL
HF_BACKEND_URL=http://localhost:8000
LLM_SERVICE_URL=http://localhost:8000

# Google Cloud TTS
GOOGLE_TTS_API_KEY=...
GOOGLE_TTS_PROJECT_ID=...

# Audio Configuration
TTS_AUDIO_ENCODING=MP3
TTS_SAMPLE_RATE=44100
TTS_SPEAKING_RATE=1.0
TTS_PITCH=0
TTS_VOLUME_GAIN=0
TTS_EFFECTS_PROFILE=handset-class-device

# Logging
LOG_LEVEL=info
```

### File Structure (Outputs)

```
outputs/
├── voice_config.json                   # Global voice settings
├── test_audio/                         # Test audio files
│   └── episode_0.mp3
└── CBSE/                               # Per curriculum
    └── Grade-8/                        # Per grade
        └── Chapter-Electricity/        # Per chapter
            ├── manifest.json           # Chapter manifest
            ├── chapter_metadata.json   # Chapter info
            ├── concepts.json           # Extracted concepts
            ├── episode_plan.json       # Episode planning
            ├── Episode-1/              # Per episode
            │   ├── script.json         # Structured script
            │   ├── script.txt          # Raw text format
            │   ├── mcqs.json           # MCQs
            │   ├── metadata.json       # Episode metadata
            │   ├── episode_1.mp3       # Complete audio
            │   └── audio/              # Audio segments
            │       ├── a_segments/     # StudentA clips
            │       │   ├── segment_0.mp3
            │       │   └── segment_2.mp3
            │       └── b_segments/     # StudentB clips
            │           ├── segment_1.mp3
            │           └── segment_3.mp3
            ├── Episode-2/
            └── Episode-3/
```

### Schema Files

**Location:** `schemas/` directory

- `chapter_metadata.json` - Chapter metadata schema
- `concepts.json` - Concept extraction schema
- `episode_plan.json` - Episode planning schema
- `mcqs.json` - MCQ schema
- `script.json` - Script schema

### Prompt Templates

**Location:** `templates/prompts/` directory

- `chapter_analysis_prompt.txt` - Chapter analysis
- `episode_script_prompt.txt` - Script generation
- `mcq_generation_prompt.txt` - MCQ generation

---

## Production Metrics

**Tracked Metrics:**
- Total jobs processed
- Successful jobs
- Failed jobs
- Average processing time
- Hallucination count (from teacher reviews)
- Teacher review count

**Access via:** `server.js` metrics object

---

## Dependencies

### Backend (Python)
- fastapi - Web framework
- pydantic - Data validation
- google-generativeai - Gemini API
- openai - OpenAI GPT API
- python-dotenv - Environment variables
- uvicorn - ASGI server

### Frontend (Node.js)
- express - Web framework
- express-fileupload - File uploads
- cors - CORS middleware
- winston - Logging
- pdf-parse - PDF text extraction
- tesseract.js - OCR
- @google-cloud/text-to-speech - TTS
- node-fetch - HTTP client
- uuid - ID generation

---

## Testing Checklist

### Manual Testing Flow

1. **Upload Chapter**
   - [ ] PDF upload works
   - [ ] Markdown paste works
   - [ ] Form validation works
   - [ ] Job ID returned

2. **Job Polling**
   - [ ] Status updates every 5 seconds
   - [ ] Progress bar animates
   - [ ] Timeout at 10 minutes
   - [ ] Redirect on completion

3. **Voice Configuration**
   - [ ] Load saved config
   - [ ] Preview card displays correctly
   - [ ] Test voice generates audio
   - [ ] Audio plays in browser
   - [ ] Edit page loads config
   - [ ] Save persists to file
   - [ ] Config used in script generation

4. **Content Generation**
   - [ ] PDF processed correctly
   - [ ] Concepts extracted
   - [ ] Episodes planned
   - [ ] Scripts generated
   - [ ] MCQs generated
   - [ ] Validation runs
   - [ ] Auto-repair works
   - [ ] Files saved to correct structure

5. **Audio Generation**
   - [ ] Segments generated per speaker
   - [ ] Audio stitched correctly
   - [ ] Normalization applied
   - [ ] Files saved in correct locations

6. **Review Page**
   - [ ] Manifest loads
   - [ ] Episodes display
   - [ ] Scripts formatted correctly
   - [ ] MCQs display
   - [ ] Audio players work
   - [ ] Regenerate works

7. **Logs Page**
   - [ ] Logs load and display
   - [ ] Auto-refresh works
   - [ ] Filters work (level, search)
   - [ ] Active jobs display
   - [ ] Download logs works

---

## Troubleshooting

### Common Issues

**Issue:** Job stuck in "processing"  
**Solution:** Check backend logs, verify LLM provider API keys, check network connectivity

**Issue:** TTS test fails  
**Solution:** Verify GOOGLE_TTS_API_KEY, check API quota, verify voice availability in region

**Issue:** Upload timeout  
**Solution:** Check PDF size (<50MB), verify backend is running, check CORS settings

**Issue:** Voice config not persisting  
**Solution:** Check write permissions on outputs/ directory, verify voice_config.json exists

**Issue:** Audio generation fails  
**Solution:** Check Google TTS credentials, verify script.json exists, check audio directory permissions

---

**Last Updated:** November 22, 2025  
**Version:** 1.0.0  
**Pipeline:** Content Generation v1
