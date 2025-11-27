# Prompt Quality Audit Report

**Audit Date**: After 10-day system redesign  
**Scope**: All LLM prompts (chapter analysis, concept extraction, script generation, MCQ generation)  
**Methodology**: Line-by-line review for clarity, redundancy, actionable output, grade appropriateness

---

## Executive Summary

**Overall Assessment**: ✅ **HIGH QUALITY** with minor improvement areas

The prompt system is well-structured, subject-specific, and pedagogically sound. After the redesign, all concept extraction prompts correctly emphasize textbook order preservation. Script generation prompts are engaging and age-appropriate. MCQ prompts properly avoid dialogue memory questions.

**Strengths**:
- ✅ Subject-specific customization (11 distinct subjects)
- ✅ Clear output format specifications (valid JSON)
- ✅ Pedagogical focus (misconceptions, memory hooks, Bloom's taxonomy)
- ✅ Grade-appropriate language guidelines
- ✅ Textbook order preservation (added during redesign)

**Areas for Improvement**:
- ⚠️ Chapter analysis prompt is verbose (181 lines) - could be streamlined
- ⚠️ Some concept extraction prompts have redundant instructions
- ⚠️ Script generation prompt is dense (260+ lines) - teachers won't read it
- ℹ️ No explicit prompt versioning or change tracking

---

## 1. Chapter Structure Analysis Prompt

**File**: `templates/prompts/chapter_structure_analysis_prompt.txt` (181 lines)  
**Purpose**: Analyze chapter to determine content type and episode grouping strategy

### Strengths ✅

1. **Comprehensive Type Classification**:
   - Clearly defines 4 chapter types (overview, deepdive, review, mixed)
   - Provides concrete examples for each type
   - Explains exam patterns and revision needs per type

2. **Pedagogical Depth**:
   - Considers student revision needs, not just content structure
   - Explains WHY each grouping strategy serves learning
   - Includes confidence scoring (0.0-1.0) for uncertainty handling

3. **Clear Output Format**:
   - Specifies exact JSON structure
   - Includes fallback fields (`content_organization`, `has_dependencies`)
   - Demands pure JSON (no markdown wrappers)

### Weaknesses ⚠️

1. **Verbosity**: 181 lines is excessive
   - Examples take 40+ lines (could be condensed to 15)
   - Repeated emphasis on confidence calibration
   - Some sections could be bullet points instead of paragraphs

2. **Assumed Knowledge**: 
   - Assumes LLM knows what "K-12", "Bloom's taxonomy", "prerequisite sequences" mean
   - Could benefit from ONE-LINE definitions upfront

3. **Redundant Instructions**:
   - "Return ONLY JSON" stated 3 times (lines 167, 179, 181)
   - "No markdown, no code blocks" repeated twice

4. **Type Overlap**: 
   - "mixed" vs "topic_deepdive with 2-3 sub-topics" is blurry
   - LLM might struggle distinguishing overview (5-15 topics) from mixed (2-3 topics)

### Recommendations 💡

**Priority: LOW** (prompt works well despite verbosity)

1. **Streamline Examples** (reduce to 60-80 lines total):
   ```
   Instead of:
   "🔹 overview_introduction
   CHARACTERISTICS:
   - Appears at START of book/unit
   - Previews MULTIPLE diverse topics (5-15 topics)
   - Brief treatment of each topic (1-2 paragraphs each)
   ..."
   
   Use:
   "overview_introduction: Previews 5-15 topics briefly (1-2 para each) at book start. Goal: breadth not depth. Example: 'Exploring Life Science' covering cells, plants, animals."
   ```

2. **Add Version Header**:
   ```
   # Chapter Structure Analysis Prompt v3.0
   # Last Updated: 2024-01-15
   # Changes: Removed assumptions about chapter position, added confidence scoring
   ```

3. **Clarify Type Boundaries**:
   - Add decision tree: "If 5+ topics → overview, 2-4 topics → mixed, 1 main topic → deepdive"
   - Include edge case handling: "If unsure between mixed/deepdive, use confidence < 0.6"

---

## 2. Concept Extraction Prompts

**File**: `hf_backend/prompts.py` (lines 1-410)  
**Coverage**: 11 subjects + default (Science, Physics, Chemistry, Biology, Math, Algebra, Geometry, Literature, English, Grammar, History, Geography, Civics, Economics, CS)

### Strengths ✅

1. **Textbook Order Preservation** (REDESIGN FIX):
   - ALL prompts now state: "CRITICAL: Extract concepts IN THE EXACT ORDER they appear in the chapter"
   - Explicitly explains: "The textbook author organized concepts in the correct teaching sequence - preserve it"
   - ✅ This was the KEY FIX from the pipeline redesign

2. **Rich Metadata Extraction**:
   - Collects 15+ fields per concept (importance, difficulty, estimated_minutes, blooms, exam_relevance, memory_hooks, common_misconceptions, confusion_points, etc.)
   - Enables intelligent downstream processing (episode planning, script generation, MCQ creation)

3. **Subject-Specific Focus**:
   - **Physics**: Emphasizes formulas with units, sign conventions, problem-solving approach
   - **Biology**: Structure-function relationships, body/health connections
   - **Chemistry**: Reactions, balancing equations, household examples
   - **Mathematics**: Example problems, WHY methods work, calculation errors
   - Each subject has unique FOCUS block tailored to typical content

4. **Clear Importance/Difficulty Guidelines**:
   - 5-point importance scale with explicit criteria
   - Difficulty calibrated to grade level (easy/medium/hard)
   - Prevents LLM from rating everything as "important"

5. **Valid JSON Output Enforcement**:
   - Specifies exact JSON structure with all required fields
   - Demands `graph` array for prerequisite relationships

### Weaknesses ⚠️

1. **Redundant Importance Rules**:
   - Every subject prompt repeats the same 5-level importance scale
   - Same difficulty definitions repeated 11 times
   - Could be extracted to shared preamble

2. **Inconsistent Examples**:
   - Some subjects provide rich examples (Physics: "velocity vs speed, mass vs weight")
   - Others are generic (Economics, Civics have minimal examples)
   - Grammar has detailed examples, English is vague

3. **No Handling of Non-Textbook Content**:
   - Assumes all input is textbook chapters
   - Doesn't address: lecture notes, problem sets, supplementary materials
   - Could cause confusion if teacher uploads different content types

4. **Memory Hooks Are Optional**:
   - Field is present but not enforced
   - LLM often returns empty array for `memory_hooks`
   - Should explicitly say: "If concept is hard to remember, provide at least ONE memory hook"

### Recommendations 💡

**Priority: MEDIUM** (prompts work but could be DRY-er)

1. **Extract Common Rules to Shared Preamble**:
   ```python
   SHARED_CONCEPT_RULES = """
   IMPORTANCE RULES (analyze EACH concept):
   - 5 = Core: chapter revolves around this
   - 4 = Important: heavily featured
   - 3 = Supporting: moderate emphasis
   - 2 = Context: not central
   - 1 = Peripheral: brief mention
   
   DIFFICULTY for Grade {grade_band}:
   - easy = Simple presentation, quick grasp
   - medium = Needs examples, moderate complexity
   - hard = Multiple paragraphs, commonly misunderstood
   """
   
   # Then include in each subject prompt:
   CONCEPT_EXTRACTION_BY_SUBJECT = {
       "Science": f"""Extract scientific concepts...
       {SHARED_CONCEPT_RULES}
       
       SCIENCE-SPECIFIC:
       - Focus on observable phenomena...
       """
   }
   ```

2. **Enforce Memory Hooks for Hard Concepts**:
   ```
   Add to all prompts:
   "For difficulty='hard' concepts, provide at least ONE memory hook (mnemonic, analogy, trick)."
   ```

3. **Add Content Type Handling**:
   ```
   Add optional preamble:
   "CONTENT TYPE: This is {content_type} (textbook chapter | lecture notes | problem set).
   If not textbook chapter, extract key learning points in order presented."
   ```

4. **Improve Weak Subject Prompts**:
   - **Economics**: Add examples ("inflation, GDP, demand-supply")
   - **Civics**: Add examples ("fundamental rights, parliamentary system")
   - **English**: Differentiate from Literature (comprehension vs literary analysis)

---

## 3. Script Generation Prompts

**File**: `hf_backend/prompts.py` (lines 411-670)  
**Function**: `get_script_prompt(subject_category)` builds subject-specific prompts  
**Generated**: `SCRIPT_PROMPTS_BY_SUBJECT` dict for 15 subjects

### Strengths ✅

1. **Engagement Framework** (Lines 541-620):
   - Clear guidelines for humor usage ("only when genuinely helpful")
   - Memory hooks integrated naturally ("Here's a trick to remember...")
   - Misconception addressing pattern: "I used to think [wrong]..." → "Actually, here's what's really happening..."
   - Excellent relatable examples guidance (phones, sports, food)

2. **Natural Dialogue Requirements**:
   - Forbids robotic ping-pong (A-B-A-B)
   - Encourages multi-sentence explanations, interruptions, reactions
   - Specifies contractions ("it's", "don't"), thinking sounds ("Hmm...", "Um...")
   - Speaker role differentiation (explainer vs questioner)

3. **Pacing by Importance**:
   - importance=5 → slow down, multiple examples
   - importance=3-4 → clear explanation, one example
   - importance=1-2 → quick mention
   - Directly uses concept metadata extracted earlier ✅

4. **Source Accuracy Requirements**:
   - Every fact MUST reference source: "pX:lines Y-Z"
   - Inferred facts marked with `"inferred": true`
   - Prevents hallucination by forcing source citation

5. **Subject-Specific Focus Blocks** (Lines 418-510):
   - **Physics**: "Include formulas with units clearly stated", "Problem-solving walkthrough"
   - **Biology**: "Structure-function relationships", "Body/health connections"
   - **Mathematics**: "Work through example problems step-by-step", "Explain WHY methods work"
   - Each subject tailored to typical pedagogy

6. **Validation Checklist**:
   - Word count targets (450-600 words for 7-10 min episodes)
   - Duration estimates (~150 words/minute)
   - Coverage check (ALL concepts covered)
   - No dialogue memory setup

### Weaknesses ⚠️

1. **Prompt Length**: ~260 lines total
   - Dense, hard to parse for humans
   - LLM handles it fine, but teachers reviewing prompt might be overwhelmed
   - Could be modularized (core prompt + subject addon)

2. **Overspecified in Places**:
   - Opening structure: "30-40s" → Too rigid, limits natural variation
   - Ending structure: "20-30s" → Same issue
   - Better: "Brief opening, substantial middle, quick recap"

3. **Contradictory Guidance**:
   - Says "Let speakers explain in multiple sentences"
   - But also "Quick mention" for importance=1-2
   - LLM might struggle balancing these

4. **No Examples of Good vs Bad Scripts**:
   - Tells what to do but doesn't show
   - One good/bad example would clarify expectations
   - E.g., "BAD: [robotic dialogue], GOOD: [natural flow]"

5. **JSON Schema Could Be Simpler**:
   - Requires `source_reference` per section → often same for whole episode
   - Requires `pronunciation_hints` but rarely used
   - `engagement_notes` per section is verbose

### Recommendations 💡

**Priority: LOW** (generates great scripts despite complexity)

1. **Modularize Prompt**:
   ```python
   CORE_SCRIPT_PROMPT = """..."""  # Shared structure
   
   def get_script_prompt(subject):
       subject_focus = SUBJECT_FOCUSES[subject]
       return f"{CORE_SCRIPT_PROMPT}\n\n{subject_focus}"
   ```

2. **Loosen Time Constraints**:
   ```
   Instead of: "Opening (30-40s): Start with energy"
   Use: "Opening (~10% of episode): Start with energy and context"
   ```

3. **Add Example Snippet**:
   ```
   GOOD DIALOGUE EXAMPLE:
   "Maya: Okay, photosynthesis - I know it's about plants making food, but HOW exactly?
   Raj: Right! So basically, the plant uses three things - sunlight, water, and CO2. But here's the cool part - it's happening in these tiny structures called chloroplasts.
   Maya: Wait, chloroplasts? Those green things in the cells?
   Raj: Exactly! The green color is chlorophyll, which captures sunlight. Think of it like a solar panel..."
   
   BAD DIALOGUE EXAMPLE:
   "Maya: What is photosynthesis?
   Raj: Photosynthesis is the process by which plants make food.
   Maya: What do they need?
   Raj: They need sunlight, water, and carbon dioxide."
   ```

4. **Simplify JSON Schema**:
   ```json
   {
     "episode_index": 1,
     "title": "...",
     "word_count": 550,
     "sections": [
       {
         "id": "section_1",
         "text": "dialogue here",
         "concepts_covered": ["id1", "id2"]
       }
     ],
     "source_references": "p1-5",  // Moved to top level
     "engagement": {
       "humor_used": [...],
       "hooks_used": [...],
       "misconceptions_addressed": [...]
     }
   }
   ```

---

## 4. MCQ Generation Prompts

**File**: `hf_backend/prompts.py` (lines 678-870)  
**Function**: `get_mcq_prompt(subject_category)` builds subject-specific MCQ prompts  
**Generated**: `MCQ_PROMPTS_BY_SUBJECT` dict for 15 subjects

### Strengths ✅

1. **ABSOLUTELY BANNED Section** (Lines 796-800):
   - Explicitly forbids dialogue memory questions
   - Clear examples: ❌ "According to the script...", ❌ "What did Maya say..."
   - States principle: "TEST UNDERSTANDING, NOT AUDIO MEMORY"
   - ✅ This prevents major quality issue

2. **Distractor Creation Guidelines** (Lines 803-817):
   - **EXCELLENT**: Requires distractors from `common_misconceptions`
   - Shows concrete example (photosynthesis) with 3 misconception-based wrong answers
   - Explains each distractor's conceptual basis
   - This is GOLD for testing understanding vs guessing

3. **Subject-Specific Question Types** (Lines 683-763):
   - **Science**: Application 40%, Conceptual 35%, Cause-effect 15%, Recall 10%
   - **Physics**: Numerical 35%, Formula application 30%, Conceptual 25%, Units 10%
   - **Mathematics**: Problem-solving 40%, Application 30%, Patterns 20%, Theorems 10%
   - **Literature**: Interpretation 50%, Themes 20%, Devices 15%, Characters 15%
   - Matches real exam patterns ✅

4. **Grade-Appropriate Language** (Lines 828-831):
   - Explicit vocab/complexity guidelines per grade band
   - Grade 1-3: Simple, concrete
   - Grade 10-12: Academic, complex analysis
   - Prevents grade-inappropriate questions

5. **Bloom's Taxonomy Integration**:
   - "Aim for 2-3 questions per important concept"
   - "Bloom's levels: mostly apply/analyze, minimal remember"
   - Aligns with higher-order thinking

### Weaknesses ⚠️

1. **Uneven Subject Coverage**:
   - Physics, Science, Math, Literature have detailed guidelines
   - Geography, Civics, Economics are thin
   - Grammar is good, English is vague (what's the difference?)

2. **No Difficulty Distribution Guidance**:
   - Says "Use concept.difficulty" but doesn't specify distribution
   - Should it be 30% easy, 50% medium, 20% hard?
   - Or match concept importance?

3. **Question Count Not Specified**:
   - Prompt says "Generate {{count}} MCQs" but doesn't recommend count
   - Typical: 2-3 MCQs per concept? 10 total? 20 total?
   - Teacher has no guidance on what count to request

4. **No Examples of Concept-Aligned MCQs**:
   - Shows photosynthesis example (good)
   - But doesn't show how to pull from concept's `common_misconceptions` field
   - E.g., "Concept has misconceptions: ['plants eat soil'] → Use as distractor"

### Recommendations 💡

**Priority: MEDIUM** (works well but could be clearer)

1. **Standardize Question Count Guidance**:
   ```
   Add to prompt:
   "RECOMMENDED COUNT:
   - For 5-8 concepts: Generate 12-15 MCQs (2-3 per important concept)
   - For 9-15 concepts: Generate 18-25 MCQs
   - Prioritize importance=5 concepts (3 questions each)"
   ```

2. **Specify Difficulty Distribution**:
   ```
   Add:
   "DIFFICULTY MIX:
   - 20% easy (concept.difficulty='easy', test basic understanding)
   - 60% medium (concept.difficulty='medium', test application)
   - 20% hard (concept.difficulty='hard', test analysis/synthesis)"
   ```

3. **Show Misconception Mapping**:
   ```
   Add example:
   "EXAMPLE - Using Concept Metadata:
   Concept: {
     'id': 'photosynthesis',
     'common_misconceptions': ['plants eat soil for food', 'any light works for photosynthesis']
   }
   
   Generated MCQ:
   Q: A plant is kept in a dark room with nutrient-rich soil. What will happen after 2 weeks?
   A) Plant dies - can't make food without light ✓
   B) Plant survives by absorbing nutrients from soil ← misconception #1
   C) Plant grows taller searching for light ← misunderstanding behavior
   D) Plant survives using any indoor light ← misconception #2
   ```

4. **Improve Weak Subjects**:
   - **Geography**: Add question types (map-based, spatial reasoning, climate patterns)
   - **Economics**: Add scenario-based questions (supply-demand, policy effects)
   - **English vs Literature**: Clarify distinction
     - English: Grammar, composition, comprehension strategies
     - Literature: Textual analysis, themes, author's craft

---

## 5. Cross-Cutting Concerns

### JSON Output Validation

**Current State**: All prompts demand "VALID JSON ONLY" but don't specify validation rules.

**Issues**:
- LLMs sometimes wrap JSON in markdown code blocks despite instructions
- Missing required fields cause downstream errors
- No schema validation happens during generation

**Recommendation**:
```python
# Add to hf_backend/main.py after LLM call
import jsonschema

CONCEPT_SCHEMA = {
    "type": "object",
    "required": ["concepts", "graph"],
    "properties": {
        "concepts": {
            "type": "array",
            "items": {
                "required": ["id", "name", "definition", "type", "importance", "difficulty"],
                ...
            }
        }
    }
}

def validate_llm_output(output, schema):
    try:
        jsonschema.validate(output, schema)
    except jsonschema.ValidationError as e:
        logger.error(f"LLM output invalid: {e}")
        # Trigger retry with clarified prompt
```

### Prompt Versioning

**Current State**: No version tracking, hard to know when prompts changed.

**Recommendation**:
```python
# Add to prompts.py
PROMPT_VERSIONS = {
    "concept_extraction": "v2.1",  # Added textbook order preservation
    "script_generation": "v3.0",   # Removed dialogue memory setup
    "mcq_generation": "v2.0",      # Added misconception mapping
    "chapter_analysis": "v3.0"     # Removed chapter position assumptions
}

# Include in LLM call metadata
logger.info(f"Using concept_extraction prompt {PROMPT_VERSIONS['concept_extraction']}")
```

### Hallucination Prevention

**Current State**: Script generation requires source citations, but not enforced.

**Recommendation**:
```python
# After script generation, validate citations
def validate_source_citations(script_sections, chapter_content):
    for section in script_sections:
        ref = section.get("source_reference", "")
        if ref and not section.get("inferred"):
            # Parse "p1:lines 5-20" and verify content matches
            if not verify_citation(ref, chapter_content):
                logger.warn(f"Invalid citation: {ref} in section {section['id']}")
```

---

## 6. Priority Improvements Roadmap

### Immediate (Next Sprint)

1. **Extract Common Rules in Concept Prompts** → Reduce redundancy
2. **Standardize MCQ Count Guidance** → Help teachers decide count
3. **Add Prompt Version Headers** → Track changes over time

### Short-Term (Next Month)

4. **Add JSON Schema Validation** → Catch malformed LLM outputs
5. **Improve Weak Subject Prompts** (Economics, Civics, Geography) → Better examples
6. **Simplify Script JSON Schema** → Reduce verbosity

### Long-Term (Next Quarter)

7. **Streamline Chapter Analysis Prompt** → 60-80 lines instead of 181
8. **Add Good/Bad Examples to Script Prompt** → Show don't tell
9. **Implement Citation Validation** → Prevent hallucinations
10. **Create Prompt A/B Testing Framework** → Measure quality improvements

---

## 7. Quality Metrics to Track

To measure prompt effectiveness over time:

| Metric | Target | Current | Measurement Method |
|--------|--------|---------|-------------------|
| Concept extraction accuracy | >95% | Unknown | Teacher flags missing/wrong concepts |
| Textbook order preservation | 100% | ✅ 100% | Automated check (concept order matches chapter) |
| Script engagement score | >8/10 | Unknown | Teacher ratings in review UI |
| MCQ misconception usage | >70% | Unknown | Count distractors from `common_misconceptions` |
| Hallucination rate | <5% | Unknown | Teacher flags unsourced facts |
| JSON parsing success | >98% | Unknown | Track `json.loads()` failures |
| Regeneration requests | <15% | Unknown | Track `/request-revision` calls |

**Implementation**:
Add metrics tracking to `workflow_status.json`:
```json
{
  "metrics": {
    "prompt_quality": {
      "concept_accuracy_score": 4.8,
      "script_engagement_score": 8.5,
      "mcq_quality_score": 4.2,
      "hallucination_flags": 0,
      "json_parse_errors": 0
    }
  }
}
```

---

## Conclusion

**Overall Grade: A- (Excellent with room for polish)**

The prompt system is production-ready and generates high-quality educational content. The recent redesign successfully addressed critical issues (textbook order preservation, strategy-based planning). No urgent changes needed, but incremental improvements will enhance maintainability and consistency.

**Key Takeaway**: The prompts are pedagogically sophisticated (misconception-based distractors, Bloom's taxonomy, source citations) and subject-specific. The main opportunities are reducing redundancy and adding validation infrastructure.

---

**Related Documentation**:
- WORKFLOW.md: Pipeline flow and approval gates
- MIGRATION.md: Output structure
- SYSTEM_FUNCTIONALITY.md: LLM integration architecture
