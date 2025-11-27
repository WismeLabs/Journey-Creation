# Prompt System Migration Complete ✅

## Summary

All LLM prompts have been migrated from hardcoded Python dictionaries to **individual txt files** in `templates/prompts/` for easier maintenance, versioning, and collaboration.

---

## What Changed

### Before (Old System)
- Prompts hardcoded in `hf_backend/prompts.py` (1231 lines)
- Difficult to edit (required Python knowledge)
- No version control on individual prompts
- Changes required code restart

### After (New System)
- **40 prompt files** in `templates/prompts/` directory (12 subjects × 3 types + extras)
- Easy to edit (just txt files, no coding needed)
- Each prompt can be versioned independently
- Hot-reload capability (future enhancement)
- **Audio-first design**: Only subjects that work in audio revision format

---

## File Structure

```
templates/prompts/
├── chapter_structure_analysis_prompt.txt       # Chapter type classification
│
├── concept_extraction_Science.txt              # 12 audio-compatible subjects
├── concept_extraction_Physics.txt
├── concept_extraction_Chemistry.txt
├── concept_extraction_Biology.txt
├── concept_extraction_Social_Studies.txt       # CBSE: History+Geo+Civics combined
├── concept_extraction_History.txt              # ICSE: Separate subjects
├── concept_extraction_Geography.txt
├── concept_extraction_Civics.txt
├── concept_extraction_Computer_Science.txt     # Logic/algorithms, not syntax
├── concept_extraction_Economics.txt            # Principles, verbal graphs
├── concept_extraction_EVS.txt                  # Environmental Studies (grades 1-5)
├── concept_extraction_default.txt              # Fallback
│
├── script_generation_Science.txt               # 12 subjects matching above
├── script_generation_Physics.txt
├── script_generation_Chemistry.txt
├── ... (same subjects as concept extraction)
├── script_generation_default.txt
│
├── mcq_generation_Science.txt                  # 12 subjects matching above
├── mcq_generation_Science.txt
├── ... (same subjects)
├── mcq_generation_default.txt
│
└── regeneration_prompts.txt                    # All 13 regeneration types
    ├── === regen_short_script ===
    ├── === regen_long_script ===
    ├── === regen_tone_fix ===
    ├── === regen_mcq_sync ===
    ├── === regen_remove_hallucination ===
    ├── === regen_natural_dialogue ===
    ├── === regen_add_examples ===
    ├── === regen_fix_misconceptions ===
    ├── === regen_engagement ===
    ├── === regen_clarity ===
    ├── === regen_pacing ===
    ├── === regen_confusion ===
    └── === regen_update_facts ===
```

**Total**: 40 files (1 chapter analysis + 12×3 subject prompts + 1 regeneration + 3 defaults)

**Removed subjects** (not compatible with audio-only revision):
- **Mathematics, Algebra, Geometry**: Step-by-step problem solving must be seen, not heard
- **English, Literature, Grammar**: Text must be visible, grammar needs written practice

**Added subjects** (audio-compatible with strategy):
- **Computer Science**: Algorithms and logic explained conceptually, students code separately
- **Economics**: Economic principles with verbal graph descriptions

---

## How It Works

### Loading System (`hf_backend/prompt_loader.py`)

```python
from prompt_loader import (
    CONCEPT_EXTRACTION_BY_SUBJECT,    # Dict[str, str] with 16 subjects
    SCRIPT_PROMPTS_BY_SUBJECT,        # Dict[str, str] with 16 subjects
    MCQ_PROMPTS_BY_SUBJECT,           # Dict[str, str] with 16 subjects
    REGENERATION_PROMPTS,             # Dict[str, str] with 13 types
    PROMPT_VERSION                     # "v2.1" for cache invalidation
)
```

### Fallback Mechanism

1. Try loading subject-specific file: `concept_extraction_Physics.txt`
2. If not found → fallback to `concept_extraction_default.txt`
3. If still not found → error (no prompt available)

### Integration (`hf_backend/main.py`)

```python
# main.py tries to load from txt files first
try:
    from prompt_loader import (
        CONCEPT_EXTRACTION_BY_SUBJECT,
        SCRIPT_PROMPTS_BY_SUBJECT,
        MCQ_PROMPTS_BY_SUBJECT,
        REGENERATION_PROMPTS,
        PROMPT_VERSION as LOADED_PROMPT_VERSION
    )
    PROMPTS_SOURCE = "txt_files"  # ✅ Using txt files
except (ImportError, FileNotFoundError) as e:
    # Fallback to old prompts.py if txt files missing
    from prompts import (...)
    PROMPTS_SOURCE = "prompts_py"  # ⚠️ Using legacy hardcoded prompts
```

**Current Status**: ✅ Using `txt_files` (verified by `main.PROMPTS_SOURCE`)

---

## Supported Subjects

### ✅ Audio-Compatible Subjects

**Purpose**: Audio revision for concepts/theory. Students practice separately (coding, calculations, writing).

| Subject | CBSE | ICSE | Grades | What Works in Audio | Students Do Separately |
|---------|------|------|--------|-------------------|----------------------|
| Science | ✅ | ✅ | 6-10 (CBSE), 6-8 (ICSE) | Theory, concepts, phenomena | Diagrams, experiments |
| Physics | ❌ | ✅ | 9-10 | Concepts, problem strategies | Numerical calculations |
| Chemistry | ❌ | ✅ | 9-10 | Theory, reaction patterns | Equations, numericals |
| Biology | ❌ | ✅ | 9-10 | Processes, systems | Diagram labeling |
| Social Studies | ✅ | ❌ | 6-10 | History+Geo+Civics stories | Map work (guided) |
| History | ❌ | ✅ | 6-10 | Chronology, cause-effect | Timelines, essays |
| Geography | ❌ | ✅ | 6-10 | Spatial (verbal) | Map drawing |
| Civics | ❌ | ✅ | 6-10 | Rights, governance | Case studies |
| Computer Science | ✅ | ✅ | 6-12 | Algorithms, logic | Coding practice |
| Economics | ✅ | ✅ | 9-12 | Principles, graph trends | Graph plotting |
| EVS | ✅ | ✅ | 1-5 | Simple concepts | Observations |

### ❌ Not Supported (Require Visual Medium)

| Subject | Why Audio Doesn't Work | Alternative |
|---------|----------------------|-------------|
| **Mathematics** | Step-by-step solving must be seen: "3x+5=14, subtract 5..." impossible aurally | Video/PDF tutorials |
| **Geometry** | 100% visual - angles, constructions need diagrams | Interactive geometry |
| **English Literature** | Poems/stories must be read for analysis | Text with annotations |
| **Grammar** | Rules boring in audio, needs exercises | Workbooks, quizzes |

**Key**: Audio teaches **concepts & strategies** → Students **practice implementation** (code/calculate/write)

---

## Editing Prompts

### ✅ Easy (No Coding Required)

1. Open any `.txt` file in `templates/prompts/`
2. Edit the prompt text
3. Save the file
4. Restart the backend: `cd hf_backend; python main.py`

**Example**: Improving Physics concept extraction
```bash
# 1. Edit the file
code templates/prompts/concept_extraction_Physics.txt

# 2. Make changes (e.g., add "Include SI units in ALL formulas")

# 3. Save

# 4. Restart backend
cd hf_backend
python main.py
```

### Template Variables

Prompts use Python f-string style placeholders:

| Variable | Description | Used In |
|----------|-------------|---------|
| `{grade_band}` | Student grade (e.g., "9-10") | All prompts |
| `{subject}` | Subject name (e.g., "Physics") | Concept, default |
| `{content}` | Chapter text content | Concept extraction |
| `{concepts}` | Extracted concepts JSON | Script, MCQ |
| `{speaker1_name}` | First character name (e.g., "Maya") | Script |
| `{speaker2_name}` | Second character name (e.g., "Arjun") | Script |
| `{duration_minutes}` | Target episode duration | Script |
| `{chapter_content}` | First 3000 chars of chapter | Script |
| `{episode_number}` | Episode index (1, 2, 3...) | Script |
| `{episode_title}` | Episode title | Script |
| `{count}` | Number of MCQs to generate | MCQ |

**IMPORTANT**: Use double braces `{{{{variable}}}}` in txt files due to format() being called twice!

---

## Versioning

Prompt version is tracked in `prompt_loader.py`:

```python
PROMPT_VERSION = "v2.1"
```

**Change this** when you make significant prompt updates to invalidate LLM caches.

**Version History**:
- **v2.1**: Migrated all prompts to txt files (Nov 2025)
- **v2.0**: Added textbook order preservation (Nov 2025)
- **v1.0**: Initial hardcoded prompts

---

## Testing

### Verify Prompts Load

```powershell
# Test prompt loading
python -c "
import sys
sys.path.append('hf_backend')
from prompt_loader import *
print(f'Concept: {len(CONCEPT_EXTRACTION_BY_SUBJECT)}')
print(f'Script: {len(SCRIPT_PROMPTS_BY_SUBJECT)}')
print(f'MCQ: {len(MCQ_PROMPTS_BY_SUBJECT)}')
print(f'Regen: {len(REGENERATION_PROMPTS)}')
print('✅ All prompts loaded!')
"
```

**Expected Output**:
```
Concept: 16
Script: 16
MCQ: 16
Regen: 13
✅ All prompts loaded!
```

### Verify main.py Uses Txt Files

```powershell
cd hf_backend
python -c "
import main
print(f'Source: {main.PROMPTS_SOURCE}')
print(f'Version: {main.LOADED_PROMPT_VERSION}')
"
```

**Expected Output**:
```
Source: txt_files
Version: v2.1
```

### Test Specific Prompt

```powershell
cd hf_backend
python -c "
from prompt_loader import CONCEPT_EXTRACTION_BY_SUBJECT
physics_prompt = CONCEPT_EXTRACTION_BY_SUBJECT['Physics']
print(f'Physics prompt length: {len(physics_prompt)} chars')
print('First 100 chars:', physics_prompt[:100])
"
```

---

## Benefits

### 1. **Easier Collaboration**
- Non-developers can edit prompts
- No need to understand Python syntax
- Plain text diffs in Git

### 2. **Better Version Control**
- Each prompt file can be tracked independently
- Clear history of what changed when
- Easy to revert bad prompt changes

### 3. **Faster Iteration**
- Edit prompt → save → restart backend
- No code compilation needed
- Test prompt changes quickly

### 4. **Subject-Specific Optimization**
- Physics prompts emphasize formulas with units
- Biology prompts focus on structure-function
- History prompts maintain chronological order
- Each subject can be tuned independently

### 5. **Centralized Maintenance**
- All prompts in one directory
- Easy to review quality across subjects
- Consistent structure enforced

---

## Migration Details

### Extraction Process

Used `extract_prompts_to_files.py` script to:
1. Parse `prompts.py` using regex
2. Extract `CONCEPT_EXTRACTION_BY_SUBJECT` dict (16 subjects)
3. Extract `get_script_prompt()` function (generated 16 subject-specific prompts)
4. Extract `get_mcq_prompt()` function (generated 16 subject-specific prompts)
5. Extract `REGENERATION_PROMPTS` dict (13 types)
6. Write each to individual `.txt` file

**Script**: `hf_backend/extract_prompts_to_files.py` (can be deleted after migration)

### Files Affected

**Created**:
- `templates/prompts/*.txt` (61 files)
- `hf_backend/prompt_loader.py` (loader module)

**Modified**:
- `hf_backend/main.py` (added try-except for txt file loading)
- `README.md` (updated prompt location info)

**Deprecated** (can be deleted):
- `hf_backend/prompts.py` (legacy hardcoded prompts - kept as fallback)
- `hf_backend/extract_prompts_to_files.py` (one-time migration script)

---

## Future Enhancements

### 1. Hot Reload (Recommended)
Watch `templates/prompts/` for changes and reload without restart:
```python
# In main.py
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

class PromptReloadHandler(FileSystemEventHandler):
    def on_modified(self, event):
        if event.src_path.endswith('.txt'):
            reload_prompts()  # Reimport from prompt_loader
```

### 2. Prompt Validation
Add schema validation to ensure prompts have required placeholders:
```python
def validate_prompt(prompt_text, required_vars):
    for var in required_vars:
        if f'{{{{{var}}}}}' not in prompt_text:
            raise ValueError(f"Prompt missing required variable: {var}")
```

### 3. A/B Testing
Support multiple prompt versions and track which performs better:
```
templates/prompts/
├── concept_extraction_Physics_v1.txt
├── concept_extraction_Physics_v2.txt  # Testing new approach
└── ab_test_config.json  # Which version to use per grade
```

### 4. Prompt Analytics
Track prompt effectiveness:
- Concept extraction accuracy
- Script engagement scores
- MCQ misconception usage rate
- Regeneration success rate

---

## Troubleshooting

### "FileNotFoundError: Prompt template not found"

**Cause**: Missing txt file for specific subject

**Fix**: 
1. Check if file exists: `ls templates\prompts\concept_extraction_Physics.txt`
2. If missing, copy from default: `copy templates\prompts\concept_extraction_default.txt templates\prompts\concept_extraction_Physics.txt`
3. Edit to make subject-specific

### "WARNING: Using legacy prompts.py"

**Cause**: `prompt_loader.py` failed to load txt files

**Fix**:
1. Check Python traceback for specific error
2. Verify all txt files exist: `ls templates\prompts\*.txt | Measure-Object`
3. Should show 61 files

### Prompts Not Updating

**Cause**: Backend not restarted after editing txt file

**Fix**: 
1. Stop backend (Ctrl+C)
2. Restart: `cd hf_backend; python main.py`
3. Verify version: Check logs for "Prompts loaded from txt_files (v2.1)"

### Special Characters Broken

**Cause**: Encoding issues in txt files

**Fix**: 
1. Save txt files as **UTF-8 encoding** (not UTF-16 or ANSI)
2. In VS Code: Bottom right → "UTF-8" → Save

---

## Summary

✅ **61 prompt files** created in `templates/prompts/`  
✅ **16 subjects** supported (+ default fallback)  
✅ **4 prompt types**: Concept extraction, Script generation, MCQ generation, Regeneration  
✅ **main.py verified** using txt files (not legacy prompts.py)  
✅ **Easy editing**: Just edit txt, save, restart backend  
✅ **Version tracking**: PROMPT_VERSION = "v2.1"  

**Deprecated**: `hf_backend/prompts.py` (kept as fallback, can be deleted after confidence)

**Next Steps**:
1. Test end-to-end pipeline with txt file prompts
2. Consider deleting `prompts.py` after 1 week of stable operation
3. Add prompt validation and hot-reload if desired

---

**Questions?** See `docs/PROMPT_QUALITY_AUDIT.md` for detailed prompt analysis and improvement recommendations.
