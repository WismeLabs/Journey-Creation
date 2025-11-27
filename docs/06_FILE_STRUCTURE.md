# File Structure Guide

## Root Directory

```
Journey-Creation/
├── server.js              # Node.js backend entry point
├── package.json           # Node dependencies
├── .env                   # Configuration (create this)
├── .env.example           # Example config
├── eng.traineddata        # Tesseract OCR data
└── README.md              # Quick start guide
```

---

## Services (`services/`)

### `services/ingest/pdf_processor.js`
**Purpose**: Extract text from PDFs

**Key Functions**:
- `extractTextFromPDF(filePath)` - Extract text from PDF
- `performOCR(pdfBuffer)` - OCR for scanned PDFs
- `cleanExtractedText(text)` - Clean extracted text

**Used By**: Upload endpoint

---

### `services/semantic/concept_extractor.js`
**Purpose**: Extract concepts from chapter using LLM

**Key Functions**:
- `extractConcepts(chapterText, metadata)` - Main extraction
- `validateConceptData(concepts)` - Validate concept structure

**Calls**: Python backend `/extract_concepts`

**Output**: `concepts.json` with metadata

---

### `services/planner/episode_planner.js`
**Purpose**: Group concepts into episodes

**Key Functions**:
- `planEpisodes(concepts, metadata)` - Create episode plan
- `buildDependencyGraph(concepts)` - Build prerequisite graph
- `topologicalSort(graph)` - Sort by prerequisites
- `groupConcepts(sortedConcepts, targetDuration)` - Group into episodes
- `generateEpisodeRationale(episode)` - Explain grouping

**Algorithm**:
1. Build dependency graph from concept prerequisites
2. Topological sort (prerequisites first)
3. Group by pedagogical coherence + duration
4. Allow 70%-130% flexibility for better grouping

**Output**: `episode_plan.json`

---

### `services/tts/tts_orchestrator.js`
**Purpose**: Coordinate TTS generation

**Key Functions**:
- `generateEpisodeAudio(script, voiceConfig)` - Generate audio for one episode
- `splitScriptBySpeaker(script)` - Split dialogue by speaker
- `concatenateAudio(audioSegments)` - Combine audio files

**Calls**: Python backend `/tts/generate`

**Output**: `Episode-{N}/audio.mp3`

---

### `services/validation/validator.js`
**Purpose**: Validate generated content quality

**Key Functions**:
- `validateScript(script)` - Check script quality
- `validateMCQs(mcqs)` - Check MCQ quality
- `detectRoboticPatterns(script)` - Find robotic dialogue
- `suggestRegenerationPrompt(issues)` - Recommend fixes

**Used For**: Quality assurance before approval

---

## Backend (`hf_backend/`)

### `hf_backend/main.py`
**Purpose**: Python FastAPI backend - LLM & TTS

**Key Components**:

#### Educational Prompts (lines ~460-680)
```python
EDUCATIONAL_PROMPTS = {
    "concept_extraction": "...",
    "episode_script": "...",
    "mcq_generation": "..."
}
```

#### Regeneration Prompts (lines ~760-950)
```python
REGENERATION_PROMPTS = {
    "regen_short_script": "...",
    "regen_long_script": "...",
    "regen_tone_fix": "...",
    "regen_natural_dialogue": "...",
    "regen_add_examples": "...",
    "regen_fix_misconceptions": "...",
    # ... 10 more
}
```

#### API Endpoints
- `POST /extract_concepts` - Concept extraction
- `POST /generate_script` - Script generation
- `POST /generate_mcqs` - MCQ generation
- `POST /regenerate` - Content regeneration
- `POST /tts/generate` - Audio synthesis
- `GET /health` - Health check

#### LLM Integration
- `generate_with_llm(prompt, ...)` - Call OpenAI/Gemini
- Supports: GPT-4o, GPT-4o-mini, Gemini 2.0 Flash
- Auto-fallback between providers

---

### `hf_backend/requirements.txt`
Python dependencies:
- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `openai` - OpenAI API
- `google-generativeai` - Gemini API
- `google-cloud-texttospeech` - Google TTS
- `pydub` - Audio processing

---

## UI (`teacher_ui/`)

### `teacher_ui/dashboard.html`
**Purpose**: Landing page - view all chapters

**Features**:
- Shows all chapters organized by curriculum → subject
- Filter by grade, subject, status
- Stats: total chapters, pending review, completed
- Click chapter → go to review page

**API Calls**: `GET /api/v1/chapters/all`

---

### `teacher_ui/upload.html`
**Purpose**: Upload new chapter

**Features**:
- Upload PDF or paste text
- Configure metadata (grade, subject, curriculum)
- Enter character names (default: Maya & Arjun)
- Choose LLM provider
- Start processing

**API Calls**: `POST /api/v1/generate`

---

### `teacher_ui/review.html`
**Purpose**: Review and approve content

**Features**:
- View episode plan with stats
- Read each episode script
- Review MCQs
- Approve plan/scripts
- Configure voices (after approval)
- Generate audio

**API Calls**:
- `GET /api/v1/chapter/:id`
- `POST /api/v1/chapter/:id/approve-plan`
- `POST /api/v1/chapter/:id/approve-episode/:num`
- `GET /api/v1/voices`
- `POST /api/v1/generate-audio`

---

### `teacher_ui/voice-config.html`
**Purpose**: Standalone voice testing (deprecated - now in review page)

---

### `teacher_ui/logs.html`
**Purpose**: View system logs

**Features**:
- Real-time log streaming
- Filter by level (INFO/ERROR/WARN)
- Dark mode UI
- Search logs

**API Calls**: `GET /api/v1/logs`

---

## Schemas (`schemas/`)

JSON validation schemas (not actively used, but document structure):

### `schemas/chapter_metadata.json`
Chapter metadata structure

### `schemas/concepts.json`
Concept extraction output format

### `schemas/episode_plan.json`
Episode plan structure

### `schemas/script.json`
Episode script format

### `schemas/mcqs.json`
MCQ structure

---

## Templates (`templates/`)

### `templates/prompts/` (DEPRECATED)
These `.txt` files are **NOT USED**. 

All prompts are in `hf_backend/main.py`.

**Can be deleted**:
- `chapter_analysis_prompt.txt` ❌
- `episode_script_prompt.txt` ❌
- `mcq_generation_prompt.txt` ❌

---

## Routes (`routes/`)

### `routes/voice-config.js`
**Purpose**: Voice configuration endpoints

**Endpoints**:
- `GET /api/v1/voices` - List available TTS voices
- `GET /api/v1/tts/config` - Get current config
- `PUT /api/v1/tts/config` - Update config
- `POST /api/v1/tts/test` - Test voice

---

## Output Structure (`outputs/`)

Generated content saved here:

```
outputs/
└── chapter_{id}/
    └── gen_{timestamp}/
        ├── chapter.md              # Original chapter
        ├── concepts.json           # Extracted concepts
        ├── episode_plan.json       # Episode structure
        ├── workflow_status.json    # Processing state
        └── Episode-{N}/
            ├── script.json         # Dialogue script
            ├── mcqs.json          # Quiz questions
            └── audio.mp3          # TTS audio (if generated)
```

---

## Cache (`cache/`)

LLM response cache for cost savings:

```
cache/
└── llm_responses/
    └── {hash}.json    # Cached LLM response
```

**TTL**: 7 days  
**Purpose**: Avoid re-generating same concepts/scripts

---

## Logs (`logs/`)

System logs:

```
logs/
├── combined.log       # All logs
├── error.log         # Errors only
└── app-{date}.log    # Daily rotating logs
```

---

## Documentation (`docs/`)

**New Structure** (current):
- `01_SYSTEM_OVERVIEW.md` - What this does
- `02_SETUP_GUIDE.md` - Installation & setup
- `03_PIPELINE_FLOW.md` - How content is generated
- `04_PROMPTING_PHILOSOPHY.md` - Revision approach & tone
- `05_API_ENDPOINTS.md` - API reference
- `06_FILE_STRUCTURE.md` - This file

**Old Files** (deleted):
- ❌ `PRODUCT_OVERVIEW.md`
- ❌ `USER_GUIDE.md`

---

## Key Files to Know

### For Content Generation
1. `hf_backend/main.py` - All prompts, LLM calls, TTS
2. `services/planner/episode_planner.js` - Episode planning logic
3. `services/semantic/concept_extractor.js` - Concept extraction

### For API Development
1. `server.js` - Main API routes
2. `routes/voice-config.js` - Voice endpoints
3. `hf_backend/main.py` - Python backend APIs

### For UI Development
1. `teacher_ui/dashboard.html` - Main landing page
2. `teacher_ui/upload.html` - Upload interface
3. `teacher_ui/review.html` - Review & approval

### For Understanding System
1. `docs/01_SYSTEM_OVERVIEW.md` - Start here
2. `docs/04_PROMPTING_PHILOSOPHY.md` - Understand revision approach
3. `docs/03_PIPELINE_FLOW.md` - How it all works

---

## What Can Be Deleted

### Unused Template Files
```
templates/prompts/chapter_analysis_prompt.txt
templates/prompts/episode_script_prompt.txt
templates/prompts/mcq_generation_prompt.txt
```

### Old Documentation
```
docs/PRODUCT_OVERVIEW.md
docs/USER_GUIDE.md
PROMPT_OVERHAUL.md
```

### Deprecated UI
```
teacher_ui/voice-config.html  (functionality moved to review.html)
teacher_ui/voice-test.html    (functionality moved to review.html)
```

---

## Environment Files

### `.env` (CREATE THIS)
Your actual configuration - **NEVER commit to git**

### `.env.example`
Example configuration - safe to commit

### `.env.template`
Template - can probably delete (redundant with .env.example)

---

## Git Ignored

These folders are in `.gitignore`:
- `node_modules/` - Node dependencies
- `hf_backend/venv/` - Python virtual env
- `cache/` - LLM cache
- `logs/` - System logs
- `outputs/` - Generated content
- `.env` - Your config

Don't commit these!
