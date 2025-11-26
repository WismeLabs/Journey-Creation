# REAL Integration Audit - Journey Creation
**Date**: November 26, 2025
**Focus**: ACTUAL bugs, not assumptions

---

## VERIFIED WORKING ✅

**Architecture Understanding**:
- ✅ Voice config IS in upload.html (lines 470-522) with voice test
- ✅ `/api/v1/chapter/:id` endpoint EXISTS (server.js lines 1293-1368)
- ✅ Navigation is correct: Upload → Review → Logs → Stats
- ✅ File structure: `outputs/CBSE/Grade-X/chapter-name/Episode-Y/`
- ✅ Episode files: script.json, mcqs.json, metadata.json, cues.json
- ✅ `findChapterDirectory()` searches all curriculum/grade combos
- ✅ Upload page saves job to sessionStorage for resume
- ✅ Review page reads from sessionStorage to load chapter

**Data Flow (Verified)**:
1. upload.html → `/api/v1/generate` → creates job
2. Job polls `/api/v1/status/:jobId` every 5s
3. On complete → saves `lastCompletedChapter` to sessionStorage
4. review.html reads sessionStorage → fetches `/api/v1/chapter/:id`
5. Endpoint loads: concepts.json, episode_plan.json, Episode-*/script.json

---

## ACTUAL BUGS FOUND 🐛

### BUG 1: Episode script_data vs script field mismatch
**Location**: server.js line 1956 + review.html line 681
**Problem**:
- server.js saves: `script_data: scriptData.script`  
- review.html reads: `const script = episode.script_data || {};`
- But `/api/v1/chapter/:id` loads from `Episode-*/script.json` and returns as `episode.script`

**Impact**: Review UI shows empty scripts because field name mismatch

**Fix**: server.js line 1340 should read `script_data` instead of `script`:
```javascript
// CURRENT (line 1340):
if (fs.existsSync(scriptPath)) {
  script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
}
episodes.push({ script, mcqs, ... });

// SHOULD BE:
if (fs.existsSync(scriptPath)) {
  script_data = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
}
episodes.push({ script_data, mcqs, ... });
```

---

### BUG 2: Concepts array structure mismatch
**Location**: server.js line 1320 + review.html line 579
**Problem**:
- server.js saves concepts.json as: `{ concepts: [...], graph: [...] }`
- But `/api/v1/chapter/:id` line 1320 reads: `concepts = JSON.parse(...)`
- Should unwrap: `concepts = JSON.parse(...).concepts`

**Impact**: Review UI displays empty concepts table

**Fix**: server.js line 1320:
```javascript
// CURRENT:
if (fs.existsSync(conceptsPath)) {
  concepts = JSON.parse(fs.readFileSync(conceptsPath, 'utf8'));
}

// SHOULD BE:
if (fs.existsSync(conceptsPath)) {
  const conceptsData = JSON.parse(fs.readFileSync(conceptsPath, 'utf8'));
  concepts = conceptsData.concepts || conceptsData; // Handle both formats
}
```

---

### BUG 3: Episode validation field not returned
**Location**: server.js line 1345 + review.html line 692
**Problem**:
- generateEpisodeContent() creates: `validation: scriptValidation`
- But `/api/v1/chapter/:id` doesn't load validation from saved episode files
- review.html expects: `episode.validation.passed`, `episode.validation.errors`

**Impact**: Validation status not displayed in review UI

**Fix**: server.js lines 1345-1360 should load validation from metadata.json:
```javascript
const metadataPath = path.join(episodePath, 'metadata.json');
let metadata = null;
if (fs.existsSync(metadataPath)) {
  metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
}

episodes.push({
  episode_number: parseInt(episodeDir.replace('Episode-', '')),
  script_data,
  mcqs,
  status: metadata?.validation_status || 'pending',
  validation: {
    passed: metadata?.validation_status === 'validated',
    errors: metadata?.validation_errors || [],
    attempts: metadata?.validation_attempts || 1
  }
});
```

---

### BUG 4: Episode plan episodes array structure
**Location**: server.js line 1324 + review.html line 618
**Problem**:
- review.html expects: `episodePlan.episodes[].concept_details[]`
- Need to verify episode_plan.json actually has this structure

**Status**: NEEDS VERIFICATION - check actual episode_plan.json format

---

### BUG 5: Falsy check for LLM fields (VALID CONCERN)
**Location**: concept_extractor.js line 452
**Problem**:
```javascript
importance: concept.importance || this.calculateImportance()
```
- If LLM returns `importance: 0`, JavaScript treats as falsy → recalculates
- Same for `estimated_minutes: 0`

**Impact**: Valid LLM data overwritten with calculated values

**Fix**: Use explicit undefined check:
```javascript
importance: concept.importance !== undefined ? concept.importance : this.calculateImportance()
estimated_minutes: concept.estimated_minutes !== undefined ? concept.estimated_minutes : this.estimateConceptMinutes()
```

---

## RECOMMENDED FIXES (Priority Order)

**HIGH PRIORITY** (Blocks review UI):
1. Fix concepts array unwrapping (Bug #2)
2. Fix script_data field name (Bug #1)  
3. Add validation field loading (Bug #3)

**MEDIUM PRIORITY** (Data quality):
4. Fix falsy check for LLM fields (Bug #5)

**LOW PRIORITY** (Verification needed):
5. Verify episode_plan structure (Bug #4)

---

## WHAT TO TEST AFTER FIXES

1. Generate a test chapter
2. Check concepts.json format
3. Check episode_plan.json format
4. Check Episode-*/script.json, metadata.json format
5. Open review.html?chapter=test_chapter
6. Verify:
   - Concepts table populates
   - Episode plan cards show
   - Scripts display with word counts
   - Validation status shows correctly

---

## NOTES

- Architecture is actually well-designed
- Main issues are field name consistency between generation → storage → retrieval
- Need to align on single schema: what gets saved vs what UI expects
- Consider creating TypeScript types or JSON schemas to prevent mismatches

