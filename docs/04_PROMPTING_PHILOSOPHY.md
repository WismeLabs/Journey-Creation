# Prompting Philosophy

## Core Approach: Revision, Not Teaching

### The Fundamental Difference

**WRONG Psychology** (Teaching):
- "Let me teach you this concept"
- "Today we'll learn about..."
- Explaining from scratch to blank slate
- Formal, educational tone

**CORRECT Psychology** (Revision):
- "Let's refresh what you already learned"
- "Remember when we studied this?"
- Reinforcing existing knowledge
- Friendly, conversational tone

---

## The Revision Mindset

### When Students Use This

- **After school**: Quick daily review
- **Weekend**: Going over past chapters
- **Before tests**: Exam preparation
- **Anytime**: Casual learning, staying sharp

### What Students Need

1. **REFRESH** memory (recall what they learned)
2. **CLARIFY** doubts (clear up confusions)
3. **SOLIDIFY** understanding (make it stick)
4. **ENGAGE** them (make it interesting, not boring)

---

## Tone & Style

### Speaker Roles

**{speaker1_name}** (default: Maya)
- Often explains concepts clearly
- Enthusiastic about helping
- Uses examples and analogies
- Shares memory tricks

**{speaker2_name}** (default: Arjun)
- Asks clarifying questions
- Makes real-world connections
- Voices common confusions
- Reacts naturally ("Oh!", "That makes sense!")

### Conversation Style

**Natural, Not Robotic:**
- Let one speaker talk for multiple sentences
- Natural interruptions: "Wait...", "Oh that reminds me..."
- Reactions: "Interesting!", "Ohh I see!", "Wait what?"
- Thinking sounds: "Hmm...", "Um..."
- Contractions: "it's", "don't", "you're"

**Addressing the Listener:**
- "So when YOU see this question..."
- "Make sure YOU remember..."
- "You probably learned this but..."
- "Got it? Cool!"

**NOT Like This:**
- Mechanical back-and-forth every sentence
- Formal: "Now let us discuss..."
- Setup questions: "So what is photosynthesis?"
- Teacher voice: "Today's lesson is about..."

---

## Engagement Techniques

### 1. Humor (When It Helps Memory)

**Use When**: `humor_potential: high` in concept metadata

**Examples**:
- "Mitochondria is the powerhouse - yeah everyone says that, but it's actually true!"
- "Atoms are drama queens - they REALLY want 8 electrons and will do anything to get them"
- "Gravity is that friend who's ALWAYS pulling you down... literally!"

**Don't**:
- Force jokes on serious topics
- Use humor that doesn't help understanding
- Make it feel childish

### 2. Relatable Examples

**Use**: `relatable_examples` from concept metadata

**Grade-Specific**:
- **1-3**: Toys, pets, playground, cartoons
- **4-6**: Gaming, YouTube, school activities
- **7-9**: Phones, social media, friend drama
- **10-12**: Technology, social issues, careers

**Examples**:
- "Like when your phone battery dies - chemical energy to electrical"
- "It's the same as when you're trying to convince your friend..."
- "Think about charging your phone with a solar panel"

### 3. Memory Tricks

**Use When**: `memory_hooks` provided in concept metadata

**Types**:
- Acronyms: "VIBGYOR for rainbow colors"
- Rhymes: "In 1492, Columbus sailed the ocean blue"
- Visual: "Imagine a plant as a solar-powered factory"
- Connections: "Link it to something you already know"

**Share Naturally**:
- "Oh here's a great trick to remember this..."
- "I always remember it like this..."
- "Easy way: just think..."

**Don't**:
- Force memory tricks where they don't help
- Make them feel cheesy
- Use for naturally memorable concepts

### 4. Addressing Confusions

**Use**: `common_misconceptions` from concept metadata

**Pattern**:
```
Student 2: "Wait, I thought plants eat soil for food?"
Student 1: "Oh that's super common! Actually, they MAKE food using sunlight. The soil just gives them water and minerals."
Student 2: "Ohhh! So photosynthesis is making food, not eating it. Got it!"
```

**Key Points**:
- Voice the confusion naturally
- Clarify the difference
- Emphasize what's correct vs wrong
- Make it memorable

### 5. Stories & Scenarios

**Use When**: `story_potential: high`

**Keep Short**: 30-60 seconds max

**Examples**:
- "Imagine you're at a party and there's one chip bowl everyone wants..."
- "My cousin once tried to prove this wrong by..."
- "Back in the 1920s, scientists thought..."

**Must**:
- Actually illustrate the concept
- Be interesting/memorable
- Not just tangent storytelling

---

## Exam Awareness (But Not Obsessive)

### When Relevant

For concepts with `exam_relevance` filled:

**Mention**:
- "This usually comes up as a 5-mark question"
- "In exams, they test this by asking..."
- "Make sure you mention [key point] - that gets you marks"

**Don't**:
- Make everything about exams
- Sound like test prep only
- Stress students out
- Ignore non-exam concepts

### Question Types

Based on `exam_relevance` array:
- `mcq`: Multiple choice recall
- `short_answer`: 1-2 mark questions
- `long_answer`: 5+ mark descriptive
- `numerical`: Calculations
- `diagram`: Draw/label
- `compare`: Compare & contrast
- `application`: Apply to new scenario
- `quote_based`: Remember specific quotes (literature)
- `date_based`: Chronology (history)
- `map_based`: Geography

---

## Pacing & Emphasis

### By Importance

**Importance 5** (Exam-critical):
- Explain thoroughly
- Multiple examples
- Emphasize: "This is SUPER important"
- Repeat key points in different ways
- Slow down, make sure it's clear

**Importance 4** (Major):
- Clear explanation
- At least one example
- Mention exam relevance if applicable

**Importance 3** (Supporting):
- Concise but complete
- Connect to main concepts

**Importance 2** (Minor):
- Quick explanation
- Brief mention

**Importance 1** (Peripheral):
- One sentence if time permits
- Can skip if episode is tight

### By Difficulty

**Hard** (for that grade):
- Slow down
- Break into smaller steps
- Multiple explanations from different angles
- Check understanding: "Make sense?"

**Medium**:
- Clear explanation
- One good example
- Move at steady pace

**Easy**:
- Quick and efficient
- Don't over-explain
- Move on

---

## What We DON'T Do

### Avoid These Patterns

❌ **Teaching from scratch**: "Let me explain what photosynthesis is..."  
✅ **Revision**: "Remember photosynthesis? Let's make sure you got it..."

❌ **Formal lecture**: "Today we will discuss the three states of matter"  
✅ **Casual review**: "Okay, so states of matter - solid, liquid, gas. Let's refresh..."

❌ **Robotic Q&A**: Alternating single sentences  
✅ **Natural flow**: One speaker explains for a bit, other reacts/asks

❌ **Boring repetition**: Restating textbook verbatim  
✅ **Interesting reinforcement**: Using humor, examples, analogies

❌ **Exam obsession**: "This will come in exam!" every 2 minutes  
✅ **Helpful pointers**: Mention exam patterns when relevant

❌ **Forced techniques**: Memory trick for every single concept  
✅ **Smart usage**: Only where it genuinely helps

---

## Prompt Structure

All prompts in: `hf_backend/main.py` → `EDUCATIONAL_PROMPTS` dictionary

### 1. Concept Extraction Prompt

**Purpose**: Extract concepts with metadata for engaging revision

**Key Instructions**:
- Revision psychology (refresh/clarify/solidify)
- Extract exam awareness
- Identify humor/story potential
- List common misconceptions
- Suggest memory hooks (only when useful)
- Provide relatable examples

### 2. Episode Script Prompt

**Purpose**: Generate engaging revision dialogue

**Key Instructions**:
- Two students helping YOU revise
- Anytime use (not just exams)
- Use humor intelligently (when `humor_potential: high`)
- Share memory tricks (when provided)
- Address confusions (when marked)
- Relatable examples from student's life
- Natural conversation flow
- Pacing by importance & difficulty

### 3. MCQ Generation Prompt

**Purpose**: Test understanding after revision

**Key Instructions**:
- Test UNDERSTANDING, not dialogue recall
- BANNED: "According to the script...", "What did [speaker] say..."
- Use `common_misconceptions` for distractors
- Application and analysis questions
- Grade-appropriate scenarios

### 4. Regeneration Prompts (16 total)

**Purpose**: Fix/improve generated content

**Examples**:
- `regen_short_script`: Expand too-short scripts (keep engaging)
- `regen_long_script`: Compress too-long (keep humor/examples)
- `regen_tone_fix`: Remove teacher tone, add revision tone
- `regen_natural_dialogue`: Fix robotic speech
- `regen_fix_misconceptions`: Address confusions explicitly
- `regen_add_examples`: Add relatable examples

All updated to revision psychology + engagement focus.

---

## Quality Checks

### Before Approving Scripts

✓ Sounds like friends helping you revise (not teachers lecturing)?  
✓ Uses humor/examples where helpful?  
✓ Addresses common confusions?  
✓ Natural conversation (not robotic)?  
✓ Age-appropriate language?  
✓ Engaging and memorable (not boring)?  
✓ Covers all assigned concepts?  
✓ Factually accurate?

### Red Flags

🚩 Too formal/academic  
🚩 Boring repetition  
🚩 No personality/engagement  
🚩 Robotic Q&A pattern  
🚩 Forced humor that doesn't help  
🚩 Ignoring confusions  
🚩 Missing important concepts  
🚩 Wrong facts

---

## Examples

### Good Revision Dialogue

```
Maya: "Alright Arjun, let's make sure you remember photosynthesis before tomorrow's test!"

Arjun: "Yeah! So basically, plants are like solar-powered food factories, right?"

Maya: "Exactly! They take CO2 from air, water from soil, and use sunlight to make glucose - that's their food."

Arjun: "And a lot of students think plants EAT the soil for food, but that's wrong. The soil just gives them water and minerals."

Maya: "Good catch! The actual food-making happens through photosynthesis. Here's an easy way to remember the equation: 6CO2 + 6H2O + light → C6H12O6 + 6O2"

Arjun: "Ooh and they release oxygen! So we breathe what they don't need."

Maya: "Yep! Think of it like how a solar panel converts sunlight to electricity - plants convert sunlight to food energy. Make sense?"

Arjun: "Yeah, that's a great way to remember it!"
```

### Bad Teaching Dialogue (What NOT to do)

```
Student A: "What is photosynthesis?"

Student B: "Photosynthesis is the process by which green plants manufacture their food using sunlight."

Student A: "What are the requirements for photosynthesis?"

Student B: "The requirements are carbon dioxide, water, chlorophyll, and sunlight."

Student A: "Thank you for that explanation."
```

---

## Summary

**Core Philosophy**:
- Revision (not teaching)
- Anytime learning (not just exams)
- Engaging & memorable (not boring)
- Natural conversation (not robotic)
- Smart engagement (not forced)

**Key Techniques**:
- Humor when it helps memory
- Relatable examples from student's life
- Memory tricks where useful
- Address common confusions
- Vary pacing by importance
- Exam tips when relevant

**Goal**: Make revision enjoyable and effective - students actually WANT to listen and concepts STICK in their memory.
