# Pipeline Flow

## Complete Processing Pipeline

```
📄 PDF Upload
    ↓
📖 Text Extraction (with OCR if needed)
    ↓
🔍 Chapter Structure Analysis (LLM determines content type & strategy)
    ↓
🧠 Concept Extraction IN TEXTBOOK ORDER (LLM + metadata)
    ↓
📋 Episode Planning (strategy-based, preserves order)
    ↓
👀 🛑 PAUSE #1: Teacher Approves Plan
    ↓
✍️ Script Generation (parallel, 3 at a time, uses textbook content)
    ↓
📝 MCQ Generation (misconception-focused)
    ↓
👀 🛑 PAUSE #2: Teacher Approves Scripts
    ↓
🎤 Voice Configuration (choose character voices)
    ↓
🔊 Audio Generation (TTS synthesis with progress tracking)
    ↓
👀 🛑 PAUSE #3: Teacher Approves Each Episode
    ↓
✅ Complete - Ready for Student Distribution
```

**Approval Gates** (see `docs/WORKFLOW.md` for details):
1. **Plan Approval** (`POST /approve-plan`): Teacher reviews episode grouping before script generation
2. **Script Approval** (`POST /approve-scripts`): Teacher reviews all scripts before audio generation
3. **Audio Approval** (`POST /approve-episode/:num`): Teacher approves each episode individually

**Pipeline Control Flow**:
- `processChapter()` function executes stages 1-4, then **STOPS** at line 2348
- `generateScriptsAfterApproval()` function continues after plan approval
- Audio generation triggered manually after voice configuration

---

## Stage 1: PDF Upload

**Endpoint**: `POST /api/v1/generate`

**Input**:
- PDF file or text content
- Metadata: grade, subject, curriculum, language
- Character names (default: Maya & Arjun)
- LLM provider preference

**Process**:
1. Create unique chapter ID
2. Create folder: `outputs/chapter_{id}/gen_{timestamp}/`
3. Save chapter content as `chapter.md`
4. Initialize `workflow_status.json`

**State**: `uploaded`

---

## Stage 2: Text Extraction

**Service**: `services/ingest/pdf_processor.js`

**Process**:
1. Try PDF text extraction (pdf-parse)
2. If fails or low quality → OCR with Tesseract
3. Clean extracted text
4. Identify structure (headings, paragraphs)
5. Save as markdown

**Output**: Clean chapter text in `chapter.md`

**State**: `extracting` → `extracted`

---

## Stage 3: Chapter Structure Analysis

**Endpoint**: Internal to concept extraction flow (Python backend)

**Service**: Uses `chapter_structure_analysis_prompt.txt` in `templates/prompts/`

**Purpose**: Understand chapter's pedagogical intent BEFORE extracting concepts

**Process**:
1. LLM reads entire chapter
2. Classifies into type: `overview_introduction`, `topic_deepdive`, `review_consolidation`, or `mixed`
3. Identifies: topic count, concept interconnectedness, prerequisite sequences
4. Recommends episode strategy: `single_overview_episode`, `topic_clusters`, `prerequisite_flow`, or `time_balanced`
5. Returns confidence score (0.0-1.0)

**Output**: Embedded in `concepts.json` → `chapter_analysis`

**State**: `analyzing` → `analyzed`

**Example Analysis**:
```json
{
  "content_type": "topic_deepdive",
  "pedagogical_intent": "Master photosynthesis process comprehensively",
  "content_structure": {
    "topic_count": 1,
    "concepts_interconnected": true,
    "has_prerequisite_sequence": true
  },
  "episode_grouping_strategy": "prerequisite_flow",
  "main_focus": "Complete understanding of photosynthesis",
  "content_organization": "sequential",
  "confidence": 0.85
}
```

---

## Stage 4: Concept Extraction

**Endpoint**: `POST /extract_concepts` (Python backend)

**Service**: Uses subject-specific prompts in `hf_backend/prompts.py` → `CONCEPT_EXTRACTION_BY_SUBJECT`

**CRITICAL REQUIREMENT** (redesign fix):
- ALL prompts state: **"Extract concepts IN THE EXACT ORDER they appear in the chapter"**
- Textbook author organized concepts in correct teaching sequence
- System NEVER reorders - preserves pedagogical flow

**Process**:
1. Select subject-specific prompt (Science, Physics, Chemistry, Biology, Math, etc.)
2. Send chapter text + grade + subject to LLM
3. LLM extracts concepts with rich metadata:
   - `id`, `name`, `definition`, `type`
   - `importance` (1-5), `difficulty` (easy/medium/hard)
   - `estimated_minutes` (revision time)
   - `exam_relevance`: [mcq, short_answer, long_answer, numerical, etc.]
   - `common_misconceptions`: What students get wrong
   - `memory_hooks`: Mnemonics (only when useful)
   - `humor_potential`: high/medium/low
   - `relatable_examples`: From student's life
   - `key_points`: Must-remember bullets
   - `quick_recap`: One-sentence summary
4. Build prerequisite graph (concept dependencies)
5. Track progress: "calling_llm" → "parsing_response" → "validating_concepts"

**Output**: `concepts.json` with `concepts` array (IN TEXTBOOK ORDER) and `graph`

**State**: `extracting` → `extracted`

**Example Concept**:
```json
{
  "id": "photosynthesis",
  "name": "Photosynthesis",
  "definition": "How plants make their own food using sunlight, water, and CO2",
  "importance": 5,
  "difficulty": "medium",
  "estimated_minutes": 5,
  "exam_relevance": ["long_answer", "diagram", "application"],
  "common_misconceptions": [
    "Plants eat soil for food",
    "Plants breathe only CO2"
  ],
  "memory_hooks": [
    "Plants are like solar-powered food factories!",
    "6CO2 + 6H2O + light → C6H12O6 + 6O2"
  ],
  "humor_potential": "high",
  "relatable_examples": [
    "Like solar panels converting sunlight to electricity"
  ]
}
```

---

## Stage 4: Episode Planning

**Service**: `services/planner/episode_planner.js`

**CRITICAL REDESIGN** (fixed broken strategy selection):
- Previously: Planner IGNORED `chapter_analysis.strategy_recommendation` and always used time-based grouping
- Now: Planner **USES** the strategy determined by LLM, routing to correct grouping method
- **NEVER reorders concepts** - preserves textbook sequence in all strategies

**Process**:
1. Load concepts from `concepts.json` (already in textbook order)
2. Read `chapter_analysis.strategy_recommendation`
3. Route to appropriate grouping method via **switch statement** (line 162-168):
   - `sequential_flow` / `chronological_order` / `textbook_order` → `groupConceptsByTimePreservingOrder()`
   - `thematic_grouping` → `groupConceptsByThemePreservingOrder()`
   - `overview_introduction` → `createOverviewEpisodes()`
   - Default fallback → `groupConceptsByTimePreservingOrder()`
4. Group concepts while preserving order:
   - Target duration by grade (4-10 min)
   - Allow 70%-130% flexibility for pedagogical coherence
   - Split at natural boundaries (theme shifts, difficulty changes)
5. Add `planning_metadata` to output:
   - `chapter_analysis`: Full LLM understanding of chapter
   - `strategy_used`: Which strategy was applied
   - `target_duration_minutes`: Per-episode target
   - `textbook_order_preserved`: true (always)

**Grouping Strategies**:
- **Time-Based Preserving Order**: Groups concepts sequentially to hit target duration (7-10 min episodes)
- **Theme-Based Preserving Order**: Detects theme boundaries, groups by theme, preserves relative order within themes
- **Overview Episodes**: Creates 1-2 broad episodes for introduction chapters (5-15 topics)

**Output**: `episode_plan.json` with `episodes` array and `planning_metadata`

**State**: `planning` → `plan_generated` → **PAUSE #1 (awaiting teacher approval)**

**Example Episode Plan**:
```json
{
  "episodes": [
    {
      "episode_number": 1,
      "title": "Photosynthesis Basics",
      "concepts": ["photosynthesis", "chlorophyll", "stomata"],
      "estimated_duration_minutes": 7,
      "rationale": "Foundational concepts about how plants make food",
      "prerequisite_episodes": []
    }
  ]
}
```

---

## Stage 5: Script Generation

**Endpoint**: `POST /generate_script` (Python backend)

**Service**: Uses `EDUCATIONAL_PROMPTS["episode_script"]` in `hf_backend/main.py`

**Process** (PARALLEL - 3 episodes at once):
1. For each episode:
   - Load assigned concepts with metadata
   - Load chapter excerpt for context
   - Send to LLM with script generation prompt
2. LLM generates:
   - Natural dialogue between {speaker1_name} and {speaker2_name}
   - Uses humor when `humor_potential: high`
   - Shares memory tricks from `memory_hooks`
   - Addresses `common_misconceptions`
   - Uses `relatable_examples`
   - Appropriate pacing by `importance` and `difficulty`
3. Parse JSON response
4. Save to `Episode-N/script.json`

**Output**: `Episode-{N}/script.json` for each episode

**State**: `content_generating` → `content_generated`

**Parallelization**: Uses `p-limit` to run 3 episodes simultaneously

**Example Script Section**:
```json
{
  "sections": [
    {
      "id": "section_1",
      "text": "Maya: Hey Arjun! Let's revise photosynthesis before the test tomorrow.\nArjun: Yeah! So you remember the basics, right? Plants are basically solar-powered food factories!\nMaya: Haha exactly! They use sunlight to turn CO2 and water into glucose. That's their food.\nArjun: And they release oxygen as a bonus. We breathe what they don't need!",
      "concepts_covered": ["photosynthesis"],
      "engagement_notes": "Used solar panel analogy, humor to make memorable"
    }
  ]
}
```

---

## Stage 6: MCQ Generation

**Endpoint**: `POST /generate_mcqs` (Python backend)

**Service**: Uses `EDUCATIONAL_PROMPTS["mcq_generation"]` in `hf_backend/main.py`

**Process**:
1. Load script and concepts
2. Generate 2-3 MCQs per concept
3. Questions test UNDERSTANDING (not dialogue recall)
4. Use `common_misconceptions` for distractors
5. Consider `exam_relevance` for question types

**Output**: `Episode-{N}/mcqs.json`

**State**: `content_generating` → `content_generated`

**Example MCQ**:
```json
{
  "qid": "q1",
  "concept_id": "photosynthesis",
  "type": "application",
  "question_text": "A plant is kept in a dark closet for two weeks. What will happen?",
  "options": [
    "The plant will die because it can't make food without light",
    "The plant will survive by eating nutrients from soil",
    "The plant will grow taller searching for light",
    "The plant will use stored energy from roots"
  ],
  "correct_index": 0,
  "explanation": "Plants need sunlight for photosynthesis to make food. Without light, they can't produce glucose and will die.",
  "misconception_addressed": "Plants eat soil for food"
}
```

---

## Stage 7: Review & Approve Plan

**UI**: `teacher_ui/review.html` (Section 2: Episode Plan)

**What Teacher Reviews**:
- How many episodes planned
- Which concepts are grouped together
- Episode durations and rationale
- Coherence of concept grouping

**Actions**:
- **Approve Plan**: `POST /api/v1/chapter/:id/approve-plan` → Triggers script generation
- **Request Changes**: Request plan regeneration with feedback

**State**: `plan_generated` → `plan_approved` (triggers Stage 5)

---

## Stage 8: Review & Approve Scripts

**UI**: `teacher_ui/review.html` (Section 3: Generated Scripts)

**What Teacher Reviews**:
- Script dialogue quality (engaging, natural, age-appropriate)
- Concept coverage (all concepts explained clearly)
- Engagement techniques used (humor, examples, memory tricks)
- MCQs quality (test understanding, not dialogue recall)
- Validation issues (word count, concept coverage, tone)

**Actions**:
- **Approve Individual Episode**: `POST /api/v1/chapter/:id/approve-episode/:num`
- **Approve All**: Approve all episodes at once
- **Request Revision**: `POST /api/v1/chapter/:id/request-revision` with specific type:
  - `regen_natural_dialogue`: Make dialogue more conversational
  - `regen_engagement`: Add more humor/examples
  - `regen_clarity`: Simplify explanation
  - `regen_confusion`: Better address misconceptions
  - `regen_pacing`: Adjust depth/speed
  - And 11 more regeneration types

**State**: `content_generated` → `content_approved` (enables Stage 9)

---

## Stage 9: Voice Configuration

**UI**: `teacher_ui/review.html` (Section 4: Voice Configuration)
**Enabled**: Only after scripts approved

**Process**:
1. Choose voices for {speaker1_name} and {speaker2_name}
2. Test voices with sample text
3. Submit configuration

**Available Voices**: Fetched from `GET /api/v1/voices` (Google Cloud TTS)

---

## Stage 10: Audio Generation

**Endpoint**: `POST /api/v1/generate-audio`

**Service**: `hf_backend/main.py` → TTS orchestration

**Process**:
1. For each episode:
   - Split script by speaker
   - Generate TTS for each line using configured voices
   - Concatenate with slight pauses (300ms between lines)
2. Save as `Episode-{N}/audio.mp3`

**State**: `audio_generating` → `audio_complete`

**Output**: Ready-to-listen revision audio files

---

## Workflow States

Track in `workflow_status.json`:

1. `uploaded` - Chapter uploaded
2. `extracting` - Text extraction in progress
3. `extracted` - Concepts extracted
4. `planning` - Creating episode plan
5. `plan_generated` - **Plan ready for teacher review** (APPROVAL GATE 1)
6. `plan_approved` - Plan approved, triggers script generation
7. `content_generating` - Generating scripts & MCQs in parallel
8. `content_generated` - **Scripts ready for teacher review** (APPROVAL GATE 2)
9. `content_approved` - Scripts approved, enables voice config & audio generation
10. `audio_generating` - Creating audio files with TTS
11. `audio_complete` - Ready to listen

**Approval Gates Explained**:
- **Gate 1 (Plan)**: Ensures episode grouping makes pedagogical sense before spending time on script generation
- **Gate 2 (Scripts)**: Ensures content quality (engaging, accurate, age-appropriate) before audio generation

---

## Parallel Processing

**Episodes Generated in Parallel**: 3 at a time

**Implementation**: `p-limit` library
```javascript
const limit = pLimit(3);
const promises = episodes.map(ep => 
  limit(() => generateEpisodeScript(ep))
);
await Promise.all(promises);
```

**Benefit**: 3x faster than sequential

---

## Error Handling

Each stage can fail and retry:
- LLM timeout → retry with exponential backoff
- Invalid JSON → request regeneration
- OCR failure → manual text input option
- TTS failure → retry with different voice

Errors logged to `logs/` folder and visible in UI.

---

## Endpoints Used

See `05_API_ENDPOINTS.md` for complete API reference.
