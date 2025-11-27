"""
Educational Content Generation Prompts
All LLM prompts organized by stage
"""

# ============================================================================
# CONCEPT EXTRACTION PROMPTS (by subject)
# ============================================================================

CONCEPT_EXTRACTION_BY_SUBJECT = {
    "Science": """Extract scientific concepts for Grade {grade_band} audio revision.

CRITICAL: Extract concepts IN THE EXACT ORDER they appear in the chapter.
The textbook author organized concepts in the correct teaching sequence - preserve it.

FOCUS: processes, experiments, laws, phenomena, organisms, systems
EXAMPLES: photosynthesis, cell division, states of matter

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY:
{{
  "concepts": [{{
    "id": "snake_case_id",
    "name": "Concept Name",
    "definition": "Clear conversational explanation",
    "type": "process|definition|formula|fact|experiment|principle",
    "importance": 1-5,
    "difficulty": "easy|medium|hard",
    "estimated_minutes": 0.5-6,
    "groupable": true,
    "blooms": "remember|understand|apply|analyze",
    "exam_relevance": ["mcq", "long_answer", "diagram"],
    "typical_marks": "1-2 marks" or "3-5 marks",
    "memory_hooks": ["mnemonic if helpful"],
    "humor_potential": "high|medium|low",
    "relatable_examples": ["daily life connections"],
    "common_misconceptions": ["typical errors"],
    "confusion_points": "tricky aspects",
    "key_points": ["must remember 1", "must remember 2"],
    "quick_recap": "one-sentence summary"
  }}],
  "graph": [["prereq_id", "concept_id"]]
}}

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

SCIENCE-SPECIFIC:
- Focus on observable phenomena and experiments
- Emphasize cause-effect relationships
- Include real-world applications
- Note common confusions
""",

    "Physics": """Extract physics concepts for Grade {grade_band} audio revision.

CRITICAL: Extract concepts IN THE EXACT ORDER they appear in the chapter.
The textbook author organized concepts in the correct teaching sequence - preserve it.

FOCUS: forces, motion, energy, laws, formulas, phenomena
EXAMPLES: Newton's laws, energy conservation, circuits

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY:
{{
  "concepts": [{{
    "id": "snake_case_id",
    "name": "Concept Name",
    "definition": "Clear conversational explanation with units",
    "type": "law|formula|principle|phenomenon|application",
    "importance": 1-5,
    "difficulty": "easy|medium|hard",
    "estimated_minutes": 0.5-6,
    "groupable": true,
    "blooms": "remember|understand|apply|analyze",
    "exam_relevance": ["numerical", "mcq", "derivation"],
    "typical_marks": "1-2 marks" or "3-5 marks",
    "memory_hooks": ["formula tricks", "unit mnemonics"],
    "humor_potential": "high|medium|low",
    "relatable_examples": ["sports", "vehicles", "daily physics"],
    "common_misconceptions": ["velocity vs speed", "mass vs weight"],
    "confusion_points": "sign conventions, unit errors",
    "key_points": ["formula with units", "when to apply"],
    "quick_recap": "one-sentence summary"
  }}],
  "graph": [["prereq_id", "concept_id"]]
}}

IMPORTANCE RULES (analyze EACH concept):
- 5 = Core: fundamental law/principle
- 4 = Important: major application
- 3 = Supporting: connecting concept
- 2 = Context: background info
- 1 = Peripheral: brief mention

DIFFICULTY for Grade {grade_band}:
- easy = Basic concept, simple formula
- medium = Multiple steps, common in problems
- hard = Complex derivation, counter-intuitive

PHYSICS-SPECIFIC:
- Always include units with formulas
- Note sign conventions and common errors
- Emphasize problem-solving approach
- Connect to real-world applications
""",

    "Chemistry": """Extract chemistry concepts for Grade {grade_band} audio revision.

CRITICAL: Extract concepts IN THE EXACT ORDER they appear in the chapter.
The textbook author organized concepts in the correct teaching sequence - preserve it.

FOCUS: reactions, elements, compounds, bonding, equations, properties
EXAMPLES: chemical bonding, acid-base reactions, periodic trends

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

CHEMISTRY-SPECIFIC:
- Chemical equations and balancing
- Reaction conditions and mechanisms
- Household chemistry examples
- Safety considerations where relevant
- Common confusions: ionic vs covalent, atom vs molecule
""",

    "Biology": """Extract biology concepts for Grade {grade_band} audio revision.

CRITICAL: Extract concepts IN THE EXACT ORDER they appear in the chapter.
The textbook author organized concepts in the correct teaching sequence - preserve it.

FOCUS: organisms, systems, processes, structures, functions
EXAMPLES: cell structure, photosynthesis, human body systems

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

BIOLOGY-SPECIFIC:
- Structure-function relationships
- Body/health connections students can feel
- Processes with clear sequential steps
- Diagrams that need verbal description
- Common confusions: mitosis vs meiosis, DNA vs RNA
""",

    "Mathematics": """Extract math concepts for Grade {grade_band} audio revision.

CRITICAL: Extract concepts IN THE EXACT ORDER they appear in the chapter.
The textbook author organized concepts in the correct teaching sequence - preserve it.

FOCUS: theorems, formulas, methods, problem-solving techniques
EXAMPLES: quadratic equations, geometry theorems, algebraic identities

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

MATHEMATICS-SPECIFIC:
- Step-by-step problem-solving methods
- When to use which formula/theorem
- Common calculation errors to avoid
- Visual reasoning for geometry
- Real applications: measurement, money, ratios
""",

    "Algebra": """Extract algebra concepts for Grade {grade_band} audio revision.

CRITICAL: Extract concepts IN THE EXACT ORDER they appear in the chapter.
The textbook author organized concepts in the correct teaching sequence - preserve it.

FOCUS: equations, variables, expressions, solving methods
EXAMPLES: linear equations, factorization, algebraic identities

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

ALGEBRA-SPECIFIC:
- Solving methods with clear steps
- Sign errors and distribution mistakes to watch
- Graphing concepts when relevant
- Word problems translated to equations
""",

    "Geometry": """Extract geometry concepts for Grade {grade_band} audio revision.

CRITICAL: Extract concepts IN THE EXACT ORDER they appear in the chapter.
The textbook author organized concepts in the correct teaching sequence - preserve it.

FOCUS: shapes, theorems, proofs, formulas, transformations
EXAMPLES: Pythagoras theorem, circle properties, area formulas

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

GEOMETRY-SPECIFIC:
- Visualize shapes and transformations verbally
- Proofs with logical reasoning
- Formulas for area, perimeter, volume
- Common confusions: area vs perimeter, congruent vs similar
""",

    "Literature": """Extract literature concepts for Grade {grade_band} audio revision.

FOCUS: characters, themes, literary devices, plot, analysis
EXAMPLES: character development, symbolism, narrative techniques

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

LITERATURE-SPECIFIC:
- Character analysis with textual evidence
- Themes and their development
- Literary devices and their effects
- Author's purpose and craft
- Multiple valid interpretations
""",

    "English": """Extract English concepts for Grade {grade_band} audio revision.

FOCUS: comprehension, writing, analysis, language skills
EXAMPLES: inference, main idea, essay structure, rhetorical devices

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

ENGLISH-SPECIFIC:
- Comprehension strategies (inference, main idea)
- Writing techniques and composition
- Analysis of language choices
- Grammar in context
""",

    "Grammar": """Extract grammar concepts for Grade {grade_band} audio revision.

FOCUS: rules, tenses, structure, usage, punctuation
EXAMPLES: subject-verb agreement, tenses, active/passive voice

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

GRAMMAR-SPECIFIC:
- Rule statement with clear explanation
- Correct usage examples
- Common mistakes students make
- When to apply this rule
- Similar rules that might confuse
""",

    "History": """Extract history concepts for Grade {grade_band} audio revision.

CRITICAL: Extract concepts IN THE EXACT ORDER they appear in the chapter.
For historical events, maintain chronological sequence as presented in the textbook.

FOCUS: events, figures, causes, effects, chronology, significance
EXAMPLES: independence movement, world wars, revolutions

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

HISTORY-SPECIFIC:
- Chronological sequence (what happened when)
- Cause-effect relationships (why did X lead to Y)
- Key figures and their specific roles
- Significance and long-term impact
- Connection to present-day relevance
""",

    "Geography": """Extract geography concepts for Grade {grade_band} audio revision.

CRITICAL: Extract concepts IN THE EXACT ORDER they appear in the chapter.
The textbook author organized concepts in the correct teaching sequence - preserve it.

FOCUS: places, features, climate, maps, human-environment interaction
EXAMPLES: landforms, climate zones, resource distribution

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

GEOGRAPHY-SPECIFIC:
- Spatial relationships and map visualization
- Physical features described clearly
- Human-environment interactions
- Patterns and distributions
- Location memory tricks
""",

    "Civics": """Extract civics concepts for Grade {grade_band} audio revision.

FOCUS: rights, duties, governance, democracy, constitution
EXAMPLES: fundamental rights, electoral process, government structure

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

CIVICS-SPECIFIC:
- Rights, duties, and democratic processes
- Constitutional provisions when relevant
- Real civic scenarios and applications
- Why this matters in democracy
""",

    "Economics": """Extract economics concepts for Grade {grade_band} audio revision.

FOCUS: concepts, systems, markets, policies, decision-making
EXAMPLES: supply-demand, market types, economic development

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

ECONOMICS-SPECIFIC:
- Observable economic phenomena
- Decision-making scenarios
- Supply-demand in real markets
- Graphical representations described
- Personal finance connections
""",

    "Computer Science": """Extract CS concepts for Grade {grade_band} audio revision.

FOCUS: algorithms, logic, structures, programming, computational thinking
EXAMPLES: sorting algorithms, data structures, programming constructs

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY with same structure as Science.

CS-SPECIFIC:
- Algorithm logic step-by-step
- Code examples when helpful
- Debugging common errors
- Time/space efficiency concepts
- Computational thinking approach
""",

    "default": """Extract concepts for Grade {grade_band} audio revision in {subject}.

CRITICAL: Extract concepts IN THE EXACT ORDER they appear in the chapter.
The textbook author organized concepts in the correct teaching sequence - preserve it.

CHAPTER CONTENT:
{content}

Return VALID JSON ONLY:
{{
  "concepts": [{{
    "id": "snake_case_id",
    "name": "Concept Name",
    "definition": "Clear explanation",
    "type": "concept_type",
    "importance": 1-5,
    "difficulty": "easy|medium|hard",
    "estimated_minutes": 0.5-6,
    "groupable": true,
    "blooms": "remember|understand|apply|analyze",
    "exam_relevance": ["type1", "type2"],
    "typical_marks": "...",
    "memory_hooks": ["if helpful"],
    "humor_potential": "high|medium|low",
    "relatable_examples": ["daily life"],
    "common_misconceptions": ["typical errors"],
    "confusion_points": "tricky aspects",
    "key_points": ["must remember"],
    "quick_recap": "one-sentence summary"
  }}],
  "graph": [["prereq_id", "concept_id"]]
}}

Extract comprehensively with appropriate subject-specific focus.
"""
}


# ============================================================================
# SCRIPT GENERATION - SUBJECT-SPECIFIC HELPERS
# ============================================================================

def get_script_prompt(subject_category, **kwargs):
    """Build comprehensive script prompt with subject-specific focus"""
    
    # Subject-specific focus blocks
    subject_focuses = {
        "Science": """SCIENCE FOCUS:
- Explain processes step-by-step (what → why → how)
- Use cause-effect: "This happens BECAUSE..."
- Daily life analogies: cooking, weather, sports
- Observable phenomena students can relate to
- Address common confusions: mixtures vs compounds, heat vs temperature""",

        "Physics": """PHYSICS FOCUS:
- Include formulas with units clearly stated
- Real-world examples: sports (projectile motion), vehicles (friction), phones (circuits)
- Problem-solving walkthrough with steps
- Conceptual understanding BEFORE formula application
- Common mistakes: velocity ≠ speed, mass ≠ weight, distance ≠ displacement""",

        "Chemistry": """CHEMISTRY FOCUS:
- Chemical equations and balancing
- Reaction types and conditions
- Household chemistry examples
- Safety considerations where relevant
- Common confusions: ionic vs covalent, atom vs molecule, element vs compound""",

        "Biology": """BIOLOGY FOCUS:
- Structure-function relationships
- Body/health connections students can feel
- Diagrams described verbally when needed
- Processes with clear steps (e.g., photosynthesis, digestion)
- Common confusions: mitosis vs meiosis, DNA vs RNA, respiration vs photosynthesis""",

        "Mathematics": """MATHEMATICS FOCUS:
- Work through example problems step-by-step
- Explain WHY methods work, not just HOW
- Common calculation errors to avoid
- When to use which formula/theorem
- Real applications: measurement, money, ratios in cooking""",

        "Algebra": """ALGEBRA FOCUS:
- Solving methods with clear steps
- Sign errors and distribution mistakes to watch
- Graphing concepts when relevant
- Word problems translated to equations
- Why algebra is useful (real scenarios)""",

        "Geometry": """GEOMETRY FOCUS:
- Visualize shapes and transformations verbally
- Proofs with logical reasoning
- Formulas for area, perimeter, volume
- Common confusions: area vs perimeter, congruent vs similar
- Diagrams described clearly""",

        "Literature": """LITERATURE FOCUS:
- Character analysis with textual evidence
- Themes and their development
- Literary devices and their effects
- Author's purpose and craft
- Multiple valid interpretations
- Universal human experiences in the text""",

        "English": """ENGLISH FOCUS:
- Comprehension strategies (inference, main idea)
- Writing techniques and composition
- Analysis of language choices
- Grammar in context (not isolated rules)
- Critical thinking about texts""",

        "Grammar": """GRAMMAR FOCUS:
- Rule statement with clear explanation
- Correct usage examples
- Incorrect usage examples (common mistakes)
- When to apply this rule
- Practice tips for mastery
- Similar rules that might confuse""",

        "History": """HISTORY FOCUS:
- Chronological sequence (what happened when)
- Cause-effect relationships (why did X lead to Y)
- Key figures and their specific roles
- Significance and long-term impact
- Connection to present-day relevance
- Multiple perspectives on events""",

        "Geography": """GEOGRAPHY FOCUS:
- Spatial relationships and map visualization
- Physical features described clearly
- Human-environment interactions
- Patterns and distributions
- Real-world observations students can make
- Location memory tricks""",

        "Civics": """CIVICS FOCUS:
- Rights, duties, and democratic processes
- Constitutional provisions when relevant
- Real civic scenarios and applications
- Why this matters in democracy
- Current/recent examples
- Balance between individual and collective good""",

        "Economics": """ECONOMICS FOCUS:
- Observable economic phenomena
- Decision-making scenarios
- Supply-demand in real markets
- Graphical representations described
- Personal finance connections
- Policies and their effects""",

        "Computer Science": """CS FOCUS:
- Algorithm logic step-by-step
- Code examples when helpful
- Debugging common errors
- Time/space efficiency concepts
- Real programming applications
- Computational thinking approach""",

        "default": f"""GENERAL FOCUS:
- Clear explanations appropriate for {kwargs.get('subject', 'this subject')}
- Examples students can relate to
- Address common misunderstandings
- Make concepts memorable"""
    }
    
    subject_focus = subject_focuses.get(subject_category, subject_focuses["default"])
    
    # Build comprehensive prompt
    prompt = f"""Generate engaging audio revision script for Grade {{grade_band}} students.

CONTEXT:
Two students - {{speaker1_name}} and {{speaker2_name}} - are helping YOU (the listener) revise at home.
You studied this already but want to REFRESH memory, CLARIFY doubts, and REMEMBER well.

INPUTS:
- Concepts: {{concepts}} 
  (Each concept has: importance, difficulty, memory_hooks, common_misconceptions, key_points)
- Duration: {{duration_minutes}} minutes ({{duration_seconds}} seconds)
- Target Words: {{min_words}}-{{target_words}} (~150 words/minute)
- Source: {{chapter_content}}
- Episode: #{{episode_number}} - {{episode_title}}

{subject_focus}

ENGAGEMENT FRAMEWORK:

1. USE HUMOR intelligently:
   - When concept has humor_potential="high"
   - Funny analogies that AID MEMORY
   - Examples: "Mitochondria - basically the cell's battery", "Atoms are drama queens wanting 8 electrons"
   - NOT forced jokes, only when genuinely helpful

2. USE MEMORY HOOKS from concepts:
   - Share mnemonics naturally: "Here's a trick to remember..."
   - Explain WHY it works
   - Make it seem helpful, not cheesy

3. ADDRESS MISCONCEPTIONS explicitly:
   - Have one student voice the common misconception
   - Other clarifies the confusion clearly
   - Emphasize DIFFERENCE between wrong and right
   - Pattern: "Wait, I used to think [wrong]..." "Actually, here's what's really happening..."

4. USE RELATABLE EXAMPLES:
   - From student's actual daily life (phones, social media, sports, food)
   - Make abstract → concrete
   - Age-appropriate references

DIALOGUE REQUIREMENTS:

NATURAL CONVERSATION:
- NOT robotic ping-pong (A-B-A-B)
- Let speakers explain in multiple sentences
- Natural interruptions: "Oh wait!", "Hold on..."
- Reactions: "Ohh!", "That makes sense!", "Wait what?"
- Contractions: "it's", "don't", "you're", "can't"
- Thinking sounds: "Hmm...", "Um...", "Like..."
- Enthusiasm: "This is cool!", "Check this out!"

SPEAKER ROLES:
- {{speaker1_name}}: Often explains, enthusiastic, confident
- {{speaker2_name}}: Asks questions, makes connections, curious
- Address listener: "Make sure you remember...", "You probably learned this but..."

PACING BY IMPORTANCE:
- importance=5: Slow down, multiple examples, check understanding
- importance=3-4: Clear explanation, one good example
- importance=1-2: Quick mention, efficient coverage

STRUCTURE:
Opening (30-40s): Start with energy
  "{{speaker1_name}}: Hey! Ready to revise [topic]?"
  "{{speaker2_name}}: Yeah, let's make sure I remember this..."

Main Content: Cover all concepts
  - Follow importance-based pacing
  - Use concept metadata (hooks, misconceptions, examples)
  - Natural conversation flow

Ending (20-30s): Quick recap
  "So basically, remember: [2-3 key points]"
  "You got this!"

SOURCE ACCURACY (CRITICAL):
- Every fact MUST reference source: "pX:lines Y-Z"
- If inferring/simplifying, mark "inferred": true
- NEVER state unsourced facts confidently

VALIDATION CHECKLIST:
✓ ALL concepts covered thoroughly
✓ Word count: {{min_words}}-{{target_words}}
✓ Duration: ~{{duration_minutes}} minutes
✓ All facts sourced or marked inferred
✓ Natural Grade {{grade_band}} language
✓ Engaging (humor, examples, misconceptions addressed)
✓ No dialogue memory questions setup

RETURN VALID JSON ONLY (no markdown, no extra text):
{{{{
  "episode_index": {{{{episode_number}}}},
  "title": "Episode {{{{episode_number}}}}: {{{{episode_title}}}}",
  "estimated_duration_seconds": {{{{duration_seconds}}}},
  "word_count": <actual_number>,
  "grade_level": {{{{grade_band}}}},
  "engagement_score": 7-10,
  "humor_used": ["list of humorous moments/analogies"],
  "memory_hooks_used": ["mnemonics shared"],
  "misconceptions_addressed": ["confusions clarified"],
  "sections": [
    {{{{
      "id": "section_1",
      "start": 0,
      "end": 120,
      "type": "dialogue",
      "text": "{{{{speaker1_name}}}}: [natural conversation]\\n{{{{speaker2_name}}}}: [response]\\n...",
      "source_reference": "p1:lines 5-20",
      "concepts_covered": ["concept_id1", "concept_id2"],
      "engagement_notes": "Used phone analogy for energy transfer"
    }}}}
  ],
  "concept_ids": {{{{concept_ids}}}},
  "concepts_coverage_check": {{{{"concept_id": "fully_covered"}}}},
  "pronunciation_hints": {{{{"difficult_word": "pronunciation"}}}}
}}}}
"""
    return prompt


# Generate script prompts for all subjects
SCRIPT_PROMPTS_BY_SUBJECT = {
    subject: get_script_prompt(subject) 
    for subject in [
        "Science", "Physics", "Chemistry", "Biology",
        "Mathematics", "Algebra", "Geometry",
        "Literature", "English", "Grammar",
        "History", "Geography", "Civics", "Economics",
        "Computer Science", "default"
    ]
}


# ============================================================================
# MCQ GENERATION - SUBJECT-SPECIFIC HELPERS
# ============================================================================

def get_mcq_prompt(subject_category, **kwargs):
    """Build comprehensive MCQ prompt with subject-specific focus"""
    
    subject_focuses = {
        "Science": """SCIENCE MCQ FOCUS:
Question Types:
- Application to new experiments/scenarios (40%)
- Conceptual understanding (why/how processes work) (35%)
- Cause-effect analysis (15%)
- Critical recall only (10%)

Examples:
✓ "A plant is kept in darkness for 2 weeks. What will happen?" (application)
✓ "Why do ice cubes melt faster in warm water?" (conceptual)
✗ "What is photosynthesis?" (trivial recall)
✗ "According to the script, what did Maya say..." (dialogue memory)

Distractors from common_misconceptions:
- "Plant survives by eating soil" (misconception: plants eat soil)
- "Plant grows taller to find light" (misunderstanding behavior)""",

        "Physics": """PHYSICS MCQ FOCUS:
Question Types:
- Numerical problem-solving (35%)
- Formula application to new scenarios (30%)
- Conceptual understanding (25%)
- Calculation/unit analysis (10%)

Include:
- Formula-based questions with different values
- Conceptual questions WITHOUT calculation
- Unit conversion/dimensional analysis

Distractors:
- Common formula misapplications
- Sign errors, unit errors
- Conceptual confusions (velocity vs speed)""",

        "Mathematics": """MATH MCQ FOCUS:
Question Types:
- Problem-solving with new numbers (40%)
- Concept application (30%)
- Pattern recognition (20%)
- Theorem understanding (10%)

Include:
- Word problems requiring method selection
- New scenarios needing same concept
- Common mistake options as distractors

Avoid:
- Pure formula recall
- Identical to worked examples""",

        "Literature": """LITERATURE MCQ FOCUS:
Question Types:
- Interpretation and analysis (50%)
- Theme identification (20%)
- Literary device recognition (15%)
- Character understanding (15%)

Include:
- Quote-based inference questions
- "Why did author..." questions
- Multiple valid interpretations

Avoid:
- Plot recall only
- "What happened in chapter X?"
- Dialogue memory from audio""",

        "History": """HISTORY MCQ FOCUS:
Question Types:
- Cause-effect relationships (40%)
- Significance/impact analysis (30%)
- Chronological reasoning (15%)
- Critical dates/events (15%)

Include:
- "What led to..." questions
- "What was the significance..." questions
- Connecting events logically

Avoid:
- Pure date memorization
- Isolated fact recall""",

        "Grammar": """GRAMMAR MCQ FOCUS:
Question Types:
- Error identification (40%)
- Correct usage application (35%)
- Sentence formation (15%)
- Rule understanding (10%)

Include:
- Sentences with errors to fix
- Choose correct form questions
- Contextual usage

Distractors:
- Common grammatical errors
- Confused rules (their/there)""",

        "default": """GENERAL MCQ FOCUS:
- Test understanding and application
- NOT dialogue recall
- Use concept misconceptions for distractors
- Age-appropriate scenarios
- Multiple difficulty levels"""
    }
    
    subject_focus = subject_focuses.get(subject_category, subject_focuses["default"])
    
    prompt = f"""Generate {{{{count}}}} MCQs for Grade {{{{grade_band}}}} {subject_category} revision.

PURPOSE: Test whether student UNDERSTOOD the concepts after revision.

ABSOLUTELY BANNED:
❌ "According to the script..."
❌ "What did [speaker name] say..."
❌ "In the conversation..."
❌ "The students mentioned..."
❌ Any phrasing about recalling dialogue

TEST UNDERSTANDING, NOT AUDIO MEMORY.
Questions should work even if student read textbook instead.

{subject_focus}

INPUTS:
- Concepts: {{{{concepts}}}} (with common_misconceptions, exam_relevance, difficulty)
- Grade: {{{{grade_band}}}}

DISTRACTOR CREATION (CRITICAL):
Each wrong option must:
1. Come from concept's common_misconceptions when possible
2. Be plausible to confused students
3. Be wrong for a specific conceptual reason
4. Test actual understanding

Example for photosynthesis concept:
Correct: "Plant dies - can't make food without light"
Wrong 1: "Plant survives by eating soil nutrients" ← common_misconception
Wrong 2: "Plant grows taller searching for light" ← misunderstanding behavior  
Wrong 3: "Plant stores energy in roots to survive" ← confusion about storage

QUESTION DISTRIBUTION:
- Use concept.exam_relevance to match typical exam patterns
- Use concept.difficulty to calibrate question complexity
- Aim for 2-3 questions per important concept
- Bloom's levels: mostly apply/analyze, minimal remember

GRADE-APPROPRIATE LANGUAGE:
- Grade 1-3: Simple, concrete, basic vocab
- Grade 4-6: Moderate complexity, familiar contexts
- Grade 7-9: Abstract thinking, technical terms explained
- Grade 10-12: Academic scenarios, complex analysis

RETURN VALID JSON ONLY:
{{{{
  "mcqs": [
    {{{{
      "qid": "q1",
      "timestamp_ref": 45,
      "concept_id": "concept_id",
      "difficulty": 1-5,
      "type": "application|conceptual|analysis|recall",
      "question_text": "Clear question testing understanding",
      "options": ["Correct answer", "Wrong (misconception 1)", "Wrong (misconception 2)", "Wrong (related confusion)"],
      "correct_index": 0,
      "explanation": "Why correct answer is right AND why wrong answers are wrong. Reference the misconceptions addressed.",
      "misconception_addressed": "Specific misconception this tests",
      "aligned_with_revision": true
    }}}}
  ]
}}}}
"""
    return prompt


# Generate MCQ prompts for all subjects
MCQ_PROMPTS_BY_SUBJECT = {
    subject: get_mcq_prompt(subject)
    for subject in [
        "Science", "Physics", "Chemistry", "Biology",
        "Mathematics", "Algebra", "Geometry",
        "Literature", "English", "Grammar",
        "History", "Geography", "Civics", "Economics",
        "Computer Science", "default"
    ]
}


# ============================================================================
# REGENERATION PROMPTS (13 types)
# ============================================================================

REGENERATION_PROMPTS = {
    "regen_short_script": """
SYSTEM: You are a script editor for K-12 audio REVISION content.
INPUT: episode_plan, style_lock, chapter_concepts, current_script.
CONSTRAINTS: two speakers only ({speaker1_name}, {speaker2_name}). TARGET_WORD_MIN: 450. TARGET_WORD_MAX: 1100.
TONE: peer-to-peer revision helpers, {speaker1_name} {speaker1_personality}, {speaker2_name} {speaker2_personality}. NO teacher voice.
PURPOSE: Help student revise at home anytime - make it ENGAGING and MEMORABLE.
STORY/HUMOR allowed if memory-aiding or makes content stick, <=30s.
OUTPUT: Expand script to hit 450+ words while keeping it interesting and clear.
- Add relatable examples, humor, or memory tricks where helpful
- Address common confusions explicitly
- Keep it conversational and fun, not boring repetition
- Preserve all source references
- Mark any new facts as "inferred" with tentative phrasing if not from source
Return JSON: {script_text, word_count, sections:[{id,start,end,text}], change_log, engagement_additions:["what you added to make it engaging"]}.
""",

    "regen_long_script": """
SYSTEM: You are a script compressor for K-12 audio REVISION content.
INPUT: current_script, style_lock.
CONSTRAINTS: reduce word_count to <=1100 while keeping it ENGAGING.
TASK: Remove redundancy but KEEP:
- Humor, jokes, or funny analogies that help memory
- Stories/examples that make concepts stick
- Addressing common confusions
- Memory tricks and mnemonics
- The fun, interesting parts that make revision enjoyable

REMOVE:
- Redundant repetition (unless for emphasis)
- Over-long examples that could be shorter
- Unnecessary formality or boring language

Do NOT remove core concepts. Keep two speakers only.
If timestamps change, output new timestamp map.
OUTPUT JSON: {script_text, word_count, sections:[...], change_log, what_kept:["engaging elements preserved"], what_removed:["redundancies cut"]}.
""",

    "regen_tone_fix": """
SYSTEM: You are a tone-correction engine for K-12 audio REVISION.
INPUT: current_script, style_lock.
TASK: Rewrite to sound like friendly revision helpers, NOT teachers or lecturers.

BAD TONE (eliminate):
- "Today we'll learn..." → Change to "Let's revise..."
- "As we discussed..." → Change to "Remember when..."
- "Now class..." → NO. This is NOT a classroom.
- Formal, dry, textbook language
- Boring, monotone explanations

GOOD TONE (aim for):
- Friends helping you revise at home
- Conversational, natural, engaging
- Humor where appropriate
- Enthusiastic about making concepts clear
- "You got this!", "This is actually pretty cool...", "Here's an easy way to remember..."

Keep content meaning, sources, and word_count within +/-10%.
OUTPUT JSON {script_text, change_log, tone_improvements:["specific changes made"]}.
""",

    "regen_mcq_sync": """
SYSTEM: You are an MCQ generator for K-12 audio REVISION content.
INPUT: final_script, desired_mcq_count (3-6), concept_list.
TASK: Create questions that test whether student UNDERSTOOD the revision (not whether they remember the dialogue).

RULES:
- Test UNDERSTANDING of concepts covered in script, not recall of dialogue
- Application and analysis questions, not "what did the students say"
- Use common_misconceptions from concept_list for distractors
- Each question should work even if student read textbook instead of listening
- timestamp_ref: when concept was discussed (for reference back)
- Each concept gets at least 1 MCQ

QUESTION TYPES:
- Conceptual understanding (why/how)
- Application to new scenarios
- Analysis/comparison
- NOT trivial recall

DISTRACTORS:
- Based on common misconceptions
- Plausible to confused students
- Wrong for specific conceptual reasons

Grade-appropriate language and scenarios.

OUTPUT JSON: {{mcqs:[{{qid, timestamp_ref, concept_id, difficulty, type, question_text, options, correct_index, explanation, misconception_addressed}}], change_log}}
""",

    "regen_remove_hallucination": """
SYSTEM: You are a factual accuracy checker for K-12 audio REVISION.
INPUT: script, flagged_sentences (unsourced claims), chapter_sources.
TASK: Ensure factual accuracy - revision content must be trustworthy!

FOR EACH UNSOURCED SENTENCE:
Option A: Soften to tentative phrasing ("Scientists think...", "It seems like...", "Probably...")
Option B: Remove if can't be softened

Choose A if:
- It's a reasonable inference from the material
- Softening maintains usefulness
- It helps understanding

Choose B if:
- Claim is too specific to guess
- Unsure if it's accurate
- Better to skip than risk wrong info

Mark softened sentences as "inferred":true.

WHY THIS MATTERS:
Students revising at home trust this content - we can't give them wrong information!

OUTPUT JSON: {script_text, hallucinations_fixed:["what was changed"], confidence_scores:{sentence_id:0.8}}.
""",

    "regen_natural_dialogue": """
SYSTEM: You are a dialogue naturalness editor for K-12 audio REVISION.
INPUT: current_script (may sound robotic/unnatural).
TASK: Make dialogue sound like real students talking, NOT scripted Q&A.

BAD PATTERNS (fix these):
- Mechanical back-and-forth every sentence
- Unnatural: "What is photosynthesis?" "Photosynthesis is..."
- No reactions or thinking sounds
- Perfect grammar (too formal)
- No interruptions or overlap

GOOD PATTERNS (aim for):
- Natural flow: let one speaker talk for multiple sentences
- Reactions: "Ohh!", "Wait what?", "That makes sense!"
- Interruptions: "Oh but wait...", "Hold on..."
- Contractions: "it's", "don't", "you're"
- Thinking: "Hmm...", "Um...", "Like..."
- Enthusiasm: "This is cool!", "Check this out!"

Keep content and word_count similar (+/-10%).
OUTPUT JSON: {script_text, naturalness_score:8, improvements:["specific changes"]}.
""",

    "regen_add_examples": """
SYSTEM: You are an example enrichment specialist for K-12 audio REVISION.
INPUT: current_script, concept_list (with relatable_examples).
TASK: Add relatable examples from concept metadata to make abstract → concrete.

WHERE TO ADD:
- Difficult concepts (difficulty="hard")
- Abstract concepts needing grounding
- When student says "I'm confused..." or similar

TYPES OF EXAMPLES:
- Daily life: phones, social media, sports, cooking, gaming
- Analogies: "It's like when you..."
- Scenarios: "Imagine you're..."
- Grade-appropriate: match student's world

HOW TO ADD:
- Have speaker naturally introduce: "Think of it like...", "For example..."
- Keep brief (15-30 seconds)
- Must actually illuminate the concept

DON'T:
- Add examples just for filler
- Use examples that don't help
- Over-explain easy concepts

OUTPUT JSON: {script_text, examples_added:[{concept_id, example, timestamp}], word_count}.
""",

    "regen_fix_misconceptions": """
SYSTEM: You are a misconception handler for K-12 audio REVISION.
INPUT: current_script, concept_list (with common_misconceptions).
TASK: Explicitly address common misconceptions from concept metadata.

PATTERN:
1. Student B voices the misconception: "Wait, I thought [wrong thing]..."
2. Student A clarifies: "Oh that's a super common confusion! Actually, [correct]"
3. Emphasize the difference clearly
4. Student B confirms: "Ohhh so [correct interpretation]. Got it!"

WHERE TO INSERT:
- When introducing the concept
- After explaining the concept
- In natural dialogue flow

EXAMPLES:
"Wait, don't plants eat soil for food?"
"No! That's what a lot of people think. Plants MAKE food using sunlight through photosynthesis. Soil just gives them water and minerals."

MAKE IT NATURAL:
- Not forced or random
- Fits conversation flow
- Student genuinely sounds confused then enlightened

OUTPUT JSON: {script_text, misconceptions_addressed:[{concept_id, misconception, timestamp}]}.
""",

    "regen_engagement": """
SYSTEM: You are an engagement optimizer for K-12 audio REVISION.
INPUT: current_script (may be dry/boring), concept_list.
TASK: Make script more engaging using humor, stories, memory tricks from metadata.

USE WHEN PRESENT:
- humor_potential="high" → Add funny analogy or joke
- memory_hooks → Share mnemonic naturally
- story_potential="high" → Brief relevant story
- relatable_examples → Connect to student's life

ENGAGEMENT TECHNIQUES:
1. Humor (if helpful):
   "Mitochondria - everyone calls it the powerhouse, and it's actually true!"
   "Atoms are drama queens - they REALLY want 8 electrons"

2. Memory tricks:
   "Here's an easy way to remember: VIBGYOR for rainbow colors"
   "I always think of it like..."

3. Brief stories (<=30s):
   "My cousin once tried to prove this wrong by..."
   "Back in the 1920s, scientists thought..."

4. Enthusiasm:
   "This is actually pretty cool!"
   "Wait till you hear this..."

DON'T:
- Force humor on serious topics
- Add cheesy or unhelpful tricks
- Make it childish or annoying

OUTPUT JSON: {script_text, engagement_score:8, techniques_used:["humor at 0:45", "memory trick at 2:10"]}.
""",

    "regen_clarity": """
SYSTEM: You are a clarity optimizer for K-12 audio REVISION.
INPUT: current_script (may be confusing/unclear).
TASK: Simplify explanations while keeping them accurate.

CLARITY TECHNIQUES:
1. Break complex into steps: "First..., then..., finally..."
2. Use simpler words: "huge" not "enormous", "use" not "utilize"
3. Add transitions: "So basically...", "Here's the thing...", "In other words..."
4. Repeat key points differently
5. Check understanding: "Make sense?", "Got it?"

SIMPLIFY WITHOUT:
- Dumbing down
- Removing important details
- Being condescending
- Losing accuracy

GRADE-APPROPRIATE:
- Grade 1-3: Very simple, concrete
- Grade 4-6: Moderate vocab
- Grade 7-9: More abstract OK
- Grade 10-12: Technical terms OK if explained

OUTPUT JSON: {script_text, clarity_improvements:[{timestamp, what_changed, why}], readability_grade}.
""",

    "regen_pacing": """
SYSTEM: You are a pacing optimizer for K-12 audio REVISION.
INPUT: current_script, concept_list (with importance ratings).
TASK: Adjust pacing - spend more time on important concepts, less on minor ones.

PACING BY IMPORTANCE:
- importance=5 (critical): Slow down, multiple examples, check understanding
  → Spend ~40% of time on these
- importance=4 (important): Clear explanation, one good example
  → Spend ~30% of time
- importance=3 (supporting): Concise but complete
  → Spend ~20% of time
- importance=2 (minor): Quick explanation
  → Spend ~8% of time
- importance=1 (peripheral): Brief mention or skip if tight
  → Spend ~2% of time

PACING BY DIFFICULTY:
- difficulty="hard": Slow down, break into steps, multiple angles
- difficulty="medium": Steady pace, one explanation
- difficulty="easy": Quick, don't over-explain

ADJUST:
- Expand: Add examples, slow down, check understanding
- Compress: Remove redundancy, move faster, combine points

Keep total duration within +/-10% of target.

OUTPUT JSON: {script_text, pacing_adjustments:[{concept_id, change, reason}], duration_seconds}.
""",

    "regen_confusion": """
SYSTEM: You are a confusion handler for K-12 audio REVISION.
INPUT: current_script, confusion_points from concept metadata.
TASK: Address tricky aspects that commonly confuse students.

CONFUSION POINTS:
These are subtle aspects that students often get wrong:
- Sign conventions in physics
- Similar-looking concepts that are different
- Counter-intuitive results
- Easy-to-mix-up terms

HOW TO ADDRESS:
1. Explicitly call out the confusion point:
   "This is tricky - people often mix up velocity and speed"

2. Clarify the difference:
   "Velocity has direction, speed doesn't. So two cars going 60 km/h in opposite directions have same speed but different velocities"

3. Emphasize what to watch for:
   "In problems, look for words like 'direction' - that means use velocity, not speed"

4. Provide memory aid:
   "Think: Velocity = Vector (both start with V, both have direction)"

MAKE IT CONVERSATIONAL:
Student B: "Wait, aren't velocity and speed the same thing?"
Student A: "That's what a lot of people think! But here's the difference..."

OUTPUT JSON: {script_text, confusions_addressed:[{concept_id, confusion_point, how_addressed}]}.
""",

    "regen_update_facts": """
SYSTEM: You are a fact updater for K-12 audio REVISION.
INPUT: current_script, updated_chapter_content.
TASK: Update facts/data in script based on new chapter content.

WHAT TO UPDATE:
- Numbers, dates, figures that changed
- Examples if better ones available
- Explanations if chapter has clearer version
- Terminology if changed

WHAT TO PRESERVE:
- Dialogue style and tone
- Speaker personalities
- Engagement techniques (humor, examples, memory tricks)
- Natural conversation flow
- Duration and pacing

HOW TO UPDATE:
1. Identify changed facts
2. Update seamlessly in dialogue
3. Maintain natural speech
4. Update source references
5. Keep word count similar

MARK CHANGES:
- Mark updated facts with new source_reference
- Log what changed and why

OUTPUT JSON: {script_text, facts_updated:[{fact, old_value, new_value, source_reference}], change_log}.
"""
}
