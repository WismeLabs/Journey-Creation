# System Overview

## What This Does

Generates engaging audio revision content from textbook PDFs for K-12 students.

**Input**: Chapter PDF  
**Output**: 5-8 min audio episodes where two students revise the chapter together

Students listen at home - after school, before tests, or anytime they want to refresh their memory.

---

## Core Philosophy

### NOT Teaching - It's REVISION
- Students already studied in class/textbook
- They need to **REFRESH** memory, **CLARIFY** doubts, **SOLIDIFY** understanding
- Quick, clear, and **MEMORABLE**
- **ENGAGING** with humor, stories, relatable examples - NOT boring repetition

### Anytime Learning
Not just exam prep:
- After school (daily review)
- Weekend revision
- Before tests (exam prep)
- Casual learning (staying sharp)

---

## System Components

### 1. Node.js Backend (Port 3000)
- PDF upload & processing
- Concept extraction (with LLM)
- Episode planning (smart grouping)
- Script generation orchestration
- MCQ generation
- File serving & API

**Main file**: `server.js`

### 2. Python Backend (Port 8000)
- LLM API calls (OpenAI/Gemini)
- Text-to-Speech (Google Cloud TTS)
- Voice synthesis orchestration

**Main file**: `hf_backend/main.py`

### 3. Web Interface (Teacher UI)
- Dashboard: View all chapters
- Upload: Submit new chapter
- Review: Approve scripts and generate audio
- Voice Config: Choose character voices

**Files**: `teacher_ui/*.html`

---

## Episode Structure

### Duration by Grade
- Grade 1-2: **4 min**
- Grade 3-4: **5 min**
- Grade 5-6: **6 min**
- Grade 7-8: **7 min**
- Grade 9-10: **8 min**
- Grade 11-12: **10 min**

Flexible: 70%-130% of target for pedagogical coherence

### Content per Episode
- **Concepts**: 3-5 related concepts
- **Script**: ~450-1100 words of natural dialogue
- **Audio**: TTS generated with two character voices
- **MCQs**: 2-3 questions per concept

---

## Data Flow

```
1. Upload PDF
   ↓
2. Extract text & structure (OCR if needed)
   ↓
3. Analyze chapter structure (LLM)
   - Determines: content_type, organization, episode strategy
   ↓
4. Extract concepts IN TEXTBOOK ORDER (LLM) 
   - With: importance, difficulty, memory_hooks, common_misconceptions, exam_relevance
   - CRITICAL: Preserves teaching sequence from textbook
   ↓
5. Plan episodes using strategy (preserve order)
   - Sequential flow / Thematic grouping / Time-balanced
   - NEVER reorders concepts
   ↓
   🛑 PAUSE #1 - Teacher approves episode plan
   ↓
6. Generate scripts (LLM) - PARALLEL for 3 episodes
   - Engaging dialogue with humor, examples, confusion handling
   - Uses chapter content (first 3000 chars) for textbook examples
   ↓
   🛑 PAUSE #2 - Teacher approves all scripts
   ↓
7. Configure character voices
   ↓
8. Generate audio (TTS) with progress tracking
   ↓
   🛑 PAUSE #3 - Teacher approves each episode audio
   ↓
9. Complete - Ready for student distribution
```

See `docs/WORKFLOW.md` for detailed approval gates and continuation triggers.
9. Output: Ready-to-listen MP3s
```

---

## Output Structure

```
outputs/chapter_{id}/gen_{timestamp}/
├── chapter.md                    # Original chapter content
├── concepts.json                 # Extracted concepts with metadata
├── episode_plan.json             # Episode grouping & rationale
├── workflow_status.json          # Current processing state
├── Episode-1/
│   ├── script.json              # Dialogue: {speaker1_name} & {speaker2_name}
│   ├── mcqs.json                # Quiz questions
│   └── audio.mp3                # TTS generated audio
├── Episode-2/
└── Episode-N/
```

---

## Key Features

### Smart Concept Extraction
Extracts from chapter with metadata:
- `importance`: 1-5 (how critical)
- `difficulty`: easy/medium/hard
- `exam_relevance`: [mcq, short_answer, long_answer, etc.]
- `common_misconceptions`: What students get wrong
- `memory_hooks`: Mnemonics, rhymes (only when useful)
- `humor_potential`: Can this be funny?
- `relatable_examples`: From student's daily life

### Engaging Scripts
- Two students ({speaker1_name} & {speaker2_name}) help YOU revise
- Uses humor when it helps memory
- Relatable examples (phones, gaming, social situations)
- Addresses common confusions directly
- Natural conversation (not robotic Q&A)
- Memory tricks shared when useful

### Intelligent Episode Planning
- Groups concepts by pedagogical coherence
- Respects prerequisite relationships
- Balances duration (not too short/long)
- Generates rationale for grouping decisions

### Parallel Processing
Generates 3 episodes simultaneously for speed.

---

## Tech Stack

- **Node.js 22+** with Express
- **Python 3.13+** with FastAPI
- **LLMs**: OpenAI (GPT-4o, GPT-4o-mini) / Gemini 2.0 Flash
- **TTS**: Google Cloud Text-to-Speech (21 voices)
- **OCR**: Tesseract (for scanned PDFs)
- **Storage**: File-based (outputs folder)

---

## Getting Started

1. **Install**: Node.js, Python, Tesseract
2. **Configure**: `.env` with API keys
3. **Start backends**: 
   - Terminal 1: `cd hf_backend && python main.py`
   - Terminal 2: `npm start`
4. **Open**: http://localhost:3000/teacher/dashboard.html
5. **Upload** chapter and let it process

See `02_SETUP_GUIDE.md` for detailed installation.

---

## For Developers

- **Prompts**: See `04_PROMPTING_PHILOSOPHY.md`
- **Pipeline**: See `03_PIPELINE_FLOW.md`
- **API**: See `05_API_ENDPOINTS.md`
- **Code**: Read inline comments in files
