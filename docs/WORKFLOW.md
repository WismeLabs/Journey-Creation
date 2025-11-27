# Pipeline Workflow & Control Flow

**Last Updated**: After 10-day system redesign (textbook order preservation, strategy-based planning)

## Overview

The Journey Creation pipeline processes educational content through **5 stages**, with **3 teacher approval gates** that pause execution until manual approval. This document maps every pause point, continuation trigger, and workflow state.

---

## Pipeline Stages & Approval Gates

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         JOURNEY CREATION PIPELINE                       │
└─────────────────────────────────────────────────────────────────────────┘

1. UPLOAD & EXTRACTION
   ├─ Teacher uploads PDF or pastes text
   ├─ System extracts markdown, raw text, metadata
   └─ Status: extracted
        ↓ AUTO-CONTINUE

2. ANALYSIS & CONCEPT EXTRACTION
   ├─ LLM analyzes chapter structure (content_type, organization, strategy)
   ├─ LLM extracts concepts IN TEXTBOOK ORDER
   └─ Status: extracting
        ↓ AUTO-CONTINUE

3. EPISODE PLANNING
   ├─ Planner groups concepts using determined strategy
   ├─ Preserves textbook order (NEVER reorders)
   ├─ Saves episode_plan.json
   └─ Status: plan_generated
        ↓ 🛑 PAUSE #1 - TEACHER REVIEW

   📋 APPROVAL GATE #1: Plan Approval
   ├─ Teacher reviews episode plan in UI (review.html)
   ├─ POST /api/v1/chapter/:id/approve-plan
   └─ Status: plan_approved
        ↓ AUTO-CONTINUE (triggers generateScriptsAfterApproval)

4. SCRIPT GENERATION
   ├─ Generates scripts for all episodes (parallel, limit 3)
   ├─ Uses chapter content[:3000] for textbook examples
   ├─ Validates and repairs if needed
   └─ Status: content_generated
        ↓ 🛑 PAUSE #2 - TEACHER REVIEW

   📋 APPROVAL GATE #2: Script Approval
   ├─ Teacher reviews all episode scripts in UI
   ├─ POST /api/v1/chapter/:id/approve-scripts
   └─ Status: content_approved
        ↓ MANUAL TRIGGER (teacher configures voice)

5. VOICE CONFIGURATION
   ├─ Teacher selects voice model via voice-config.html
   ├─ Tests voice with sample text
   └─ Ready for TTS generation
        ↓ MANUAL TRIGGER (teacher clicks "Generate Audio")

6. AUDIO GENERATION
   ├─ Generates audio for each episode
   ├─ Saves .wav files
   └─ Status: audio_generating → audio_generated
        ↓ 🛑 PAUSE #3 - TEACHER REVIEW (per episode)

   📋 APPROVAL GATE #3: Audio Approval
   ├─ Teacher reviews/approves each episode audio
   ├─ POST /api/v1/chapter/:id/approve-episode/:num
   └─ Episode status: approved
        ↓ ALL APPROVED → COMPLETE

7. COMPLETE
   └─ All episodes approved, ready for student distribution
```

---

## Workflow Status Tracking

### `workflow_status.json` Structure

Every chapter has a `workflow_status.json` file tracking pipeline state:

```json
{
  "chapter_id": "phys_11_ch3",
  "current_stage": "plan_approved",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:45:00Z",
  
  "stages": {
    "extraction": {
      "status": "completed",
      "completed_at": "2024-01-15T10:32:00Z",
      "concept_count": 12,
      "word_count": 3500
    },
    "planning": {
      "status": "approved",
      "completed_at": "2024-01-15T10:40:00Z",
      "approved_at": "2024-01-15T10:45:00Z",
      "approved_by": "teacher",
      "episode_count": 4,
      "total_duration_minutes": 28
    },
    "content_generation": {
      "status": "processing",
      "started_at": "2024-01-15T10:45:00Z",
      "success_count": 2,
      "failed_count": 0
    },
    "content_review": {
      "status": "pending"
    },
    "audio_generation": {
      "status": "pending"
    }
  },
  
  "episodes": [
    {
      "episode_number": 1,
      "title": "Newton's Laws of Motion - Introduction",
      "status": "generated",
      "generated_at": "2024-01-15T10:50:00Z",
      "validation_status": "approved",
      "has_audio": false,
      "error": null
    }
  ],
  
  "metrics": {
    "teacherReviews": 1,
    "regenerationCount": 0,
    "hallucinations": 0
  },
  
  "metadata": {
    "grade_band": "11-12",
    "subject": "Physics",
    "language": "en-IN"
  }
}
```

### Stage Transitions

| Current Stage | Next Stage | Trigger |
|--------------|-----------|---------|
| `created` | `extracting` | Auto (processChapter starts) |
| `extracted` | `extracting` | Auto (concept extraction) |
| `extracting` | `plan_generated` | Auto (episode planning) |
| `plan_generated` | `plan_approved` | **Teacher approval** via `/approve-plan` |
| `plan_approved` | `content_generating` | Auto (script generation starts) |
| `content_generating` | `content_generated` | Auto (all scripts done) |
| `content_generated` | `content_approved` | **Teacher approval** via `/approve-scripts` |
| `content_approved` | `voice_configured` | Manual (teacher selects voice) |
| `voice_configured` | `audio_generating` | Manual (teacher clicks generate) |
| `audio_generating` | `audio_generated` | Auto (all audio files created) |
| `audio_generated` | `completed` | **Teacher approval** (all episodes) via `/approve-episode/:num` |

---

## API Endpoints for Workflow Control

### Job Creation
- **`POST /api/v1/generate`** - Start pipeline (upload PDF/text)
  - Parameters: `chapter_id`, `grade_band`, `subject`, `language`, `teacher_review`
  - Creates job, adds to queue
  - Returns: `{ job_id }`

### Approval Gates
- **`POST /api/v1/chapter/:id/approve-plan`** - Approve episode plan
  - Triggers: `generateScriptsAfterApproval()`
  - Status change: `plan_generated` → `plan_approved` → `content_generating`
  
- **`POST /api/v1/chapter/:id/approve-scripts`** - Approve all scripts
  - Status change: `content_generated` → `content_approved`
  - Unlocks voice configuration UI
  
- **`POST /api/v1/chapter/:id/approve-episode/:num`** - Approve single episode audio
  - Updates episode status to `approved`
  - When all episodes approved → chapter complete

### Regeneration
- **`POST /api/v1/chapter/:id/request-revision`** - Request episode/plan regeneration
  - Parameters: `episode_number`, `regeneration_type`, `feedback`
  - Creates new job for regeneration
  - Increments `metrics.regenerationCount`

### Status Queries
- **`GET /api/v1/chapter/:id`** - Get chapter data with workflow status
  - Returns: concepts, episode_plan, workflow_status, scripts, metadata
  
- **`GET /api/v1/job/:job_id`** - Get job progress
  - Returns: status, progress %, current stage, estimated time

---

## Key Functions

### Pipeline Orchestration

**`processChapter(jobId, pdfFile, markdownContent, metadata)`** (line 2207)
- Main pipeline function
- Executes stages 1-3 (upload → extract → analyze → plan)
- **STOPS at line 2348** with `return;` after plan generation
- Waits for teacher approval before script generation

**`generateScriptsAfterApproval(jobId, chapterId, metadata)`** (line 1809)
- Triggered by `/approve-plan` endpoint
- Loads episode_plan.json, concepts.json, chapter.md
- Generates scripts in parallel (limit 3 concurrent LLM calls)
- Updates workflow status with success/failed counts
- **DOES NOT auto-trigger audio generation** (manual voice config needed)

### Workflow State Management

**`updateWorkflowStatus(chapterId, updates, metadata)`** (line 2120)
- Updates `workflow_status.json` with new state
- Supports nested updates: `'stages.planning.status': 'approved'`
- Supports counters: `'metrics.teacherReviews': { $inc: 1 }`
- Automatically sets `updated_at` timestamp

**`updateJobStatus(jobId, status, progress, error, metadata)`**
- Updates in-memory job queue status
- Used for UI progress bars during LLM calls
- Includes estimated times: "calling_llm (estimated 15-40s)"

---

## Progress Tracking (LLM Calls)

All LLM calls now have detailed progress tracking:

```javascript
// BEFORE LLM call
track_job(job_id, "calling_llm", estimated_time=30, {
  stage: "concept_extraction",
  llm_model: "gpt-4o-mini"
});

// DURING LLM call
const result = await generate_with_llm(prompt);

// AFTER LLM call
track_job(job_id, "parsing_response", {
  stage: "validating_concepts",
  concept_count: result.concepts.length
});
```

**Stages tracked:**
1. Concept Extraction: `calling_llm` → `parsing_response` → `validating_concepts`
2. Script Generation: `calling_llm` → `parsing_response` → `validating_script`
3. MCQ Generation: `calling_llm` → `parsing_response` → `validating_mcqs`
4. Chapter Analysis: `calling_llm` → `parsing_response` → `determining_strategy`

---

## Episode Planning Strategies

The LLM analyzes chapter structure and recommends a planning strategy:

| Strategy | Used When | Grouping Method | Order Preservation |
|----------|-----------|-----------------|-------------------|
| `sequential_flow` | Concepts build linearly | Group by time (7-10 min episodes) | ✅ Textbook order |
| `thematic_grouping` | Multiple distinct themes | Detect theme boundaries | ✅ Relative order within themes |
| `chronological_order` | Historical chapters | Group by time periods | ✅ Chronological sequence |
| `textbook_order` | Default fallback | Simple sequential grouping | ✅ Exact order |
| `overview_introduction` | Many disconnected topics | Create overview + detail episodes | ✅ Listed order |

**Implementation:**
- `episode_planner.js` reads `chapter_analysis.strategy_recommendation`
- Routes to `groupConceptsByTimePreservingOrder()` or `groupConceptsByThemePreservingOrder()`
- **NEVER reorders concepts** - preserves teaching sequence

---

## Teacher Review UI Flow

### `teacher_ui/review.html` (Review Episode Plan)

1. Teacher uploads PDF → redirected to review.html
2. Page loads chapter data via `GET /api/v1/chapter/:id`
3. Displays:
   - Chapter metadata (grade, subject, word count)
   - Concepts extracted (in textbook order)
   - Episode plan (titles, durations, concept groupings)
4. Teacher actions:
   - **Approve Plan** → `POST /approve-plan` → Scripts start generating
   - **Request Revision** → `POST /request-revision` → Re-plan
   - **Edit Episodes** → Modify JSON manually → Re-save

### `teacher_ui/voice-config.html` (Configure Voice)

1. Opens after scripts approved
2. Teacher selects:
   - Voice model (e.g., "en-IN-PrabhatNeural")
   - Voice settings (pitch, rate, volume)
3. Tests voice with sample text
4. Saves config → `POST /api/v1/tts/config`

### Episode Audio Review (in review.html)

1. After audio generated, teacher listens to each episode
2. Actions per episode:
   - **Approve** → `POST /approve-episode/:num`
   - **Regenerate** → `POST /request-revision` with feedback
3. When all approved → Chapter complete

---

## Critical Design Decisions

### Why Pause After Plan Generation?

**Problem**: Generated scripts might not match teacher's pedagogical expectations.

**Solution**: Teacher reviews episode plan BEFORE spending compute on script generation.
- Can request re-planning if structure is wrong
- Can adjust episode boundaries/titles
- Prevents wasted LLM calls for 4-8 episodes if plan is flawed

### Why Manual Voice Configuration?

**Problem**: Voice selection is subjective and varies by teacher/school.

**Solution**: Explicit voice configuration step after script approval.
- Teacher tests different voices before committing
- Can preview sample text in chosen voice
- Saves voice config for future chapters (per grade/subject)

### Why Per-Episode Audio Approval?

**Problem**: Audio quality issues might affect some episodes but not others.

**Solution**: Granular approval at episode level.
- Teacher can regenerate single episode without re-doing all
- Can provide specific feedback per episode
- Tracks which episodes are ready for student access

---

## Error Handling & Recovery

### Script Generation Failures

If some episodes fail during script generation:
- `workflow_status.json` tracks `success_count` and `failed_count`
- Failed episodes marked with `status: 'failed'` and error message
- Teacher can:
  - Regenerate failed episodes individually
  - Approve successful episodes
  - Request full re-generation

### LLM Timeout/Rate Limits

If LLM call times out:
- Job status updated to `failed` with error
- `workflow_status.json` keeps last successful stage
- Teacher can retry from last checkpoint:
  - If failed during extraction → re-upload
  - If failed during scripts → re-approve plan (triggers generateScriptsAfterApproval)
  - If failed during audio → re-generate specific episode

### Partial Completions

System supports partial completion states:
- `content_generated_partial`: Some episodes generated, some failed
- `audio_generated_partial`: Some episodes have audio, some pending
- Teacher can approve completed parts while regenerating failed parts

---

## Workflow Metrics

Tracked in `workflow_status.json` → `metrics`:

| Metric | Description | Incremented By |
|--------|-------------|----------------|
| `teacherReviews` | Number of approval actions | `/approve-plan`, `/approve-scripts` |
| `regenerationCount` | Number of regeneration requests | `/request-revision` |
| `hallucinations` | Number of hallucination flags | Manual teacher flag (if implemented) |
| `totalProcessingTime` | Time from upload to completion | Calculated from timestamps |

---

## Future Enhancements

### Planned Improvements

1. **Auto-Approval Mode**: 
   - Flag `teacher_review=false` in upload request
   - Skip approval gates, auto-generate all
   - Useful for bulk processing trusted content

2. **Batch Processing**:
   - Upload multiple chapters at once
   - Queue all for processing
   - Teacher reviews batch results

3. **Approval Templates**:
   - Save approval decisions as templates
   - Auto-approve similar chapters in future
   - E.g., "Always use sequential_flow for Math chapters"

4. **Rollback Support**:
   - Revert to previous approved state
   - Undo regenerations
   - Restore old scripts/audio

---

## Related Documentation

- **MIGRATION.md**: Output structure and file organization
- **SYSTEM_FUNCTIONALITY.md**: LLM prompts and generation logic
- **TTS_CONFIGURATION.md**: Voice models and audio generation
- **COMPLETE_GENERATION_GUIDE.md**: End-to-end usage guide

---

## Quick Reference: Approval Checklist

**After uploading PDF:**
- [ ] Review extracted concepts (check order, completeness)
- [ ] Review episode plan (check structure, durations)
- [ ] Approve plan → Scripts start generating

**After scripts generated:**
- [ ] Read each episode script (check quality, accuracy)
- [ ] Approve all scripts → Unlock voice configuration

**After selecting voice:**
- [ ] Test voice with sample text
- [ ] Save voice config
- [ ] Click "Generate Audio"

**After audio generated:**
- [ ] Listen to each episode
- [ ] Approve each episode individually
- [ ] Chapter complete when all approved ✅
