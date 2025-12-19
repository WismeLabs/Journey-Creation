/**
 * Educational prompt template for generating revision scripts
 */
const EDUCATIONAL_PROMPT_TEMPLATE = `Generate a comprehensive revision conversation between two Grade {grade_band} students covering ALL content from the provided chapter.

CRITICAL REQUIREMENT: You MUST use the exact content, terms, names, dates, and concepts from this chapter text: {chapter_content}

CONTEXT:
Two students - {speaker1_name} and {speaker2_name} - are doing final revision for their exam. 
They need to cover EVERY important point, term, name, date, and concept from the chapter.
The listener (YOU) needs complete coverage of all chapter content for exam success.

STUDENT CHARACTERISTICS FOR GRADE {grade_band}:
• Use age-appropriate vocabulary and sentence structure
• Show genuine curiosity and confusion like real students
• Make mistakes and correct each other naturally
• Reference "our teacher said..." or "remember when sir/ma'am explained..."
• Use casual language: "like", "you know", "wait what?", "oh yeah!"
• Show excitement when understanding something
• Admit when they don't fully get something

CONVERSATION STYLE:
• SOUND LIKE ACTUAL {grade_band} STUDENTS - not adults explaining to children
• One student often knows more, the other asks questions and gets confused
• Include the listener: "You remember this right?", "We all learned this together"
• Natural interruptions and "aha!" moments
• Students building on each other's understanding
• Casual references to classroom experience: "When teacher drew that diagram..."

EXAM PREPARATION REQUIREMENTS:

EXACT TERMINOLOGY USAGE:
• Use EXACT terms, definitions, and phrases from the chapter content
• When one student doesn't know a term, the other should provide the textbook definition
• Emphasize key terms that will appear in exams: "Make sure you remember the exact definition of..."
• Quote important statements from the chapter when relevant
• Mention page numbers or sections when referencing specific content

STUDY SESSION DIALOGUE:
• "I don't remember what [exact term] means" → Other student provides textbook definition
• "Let me check what the chapter says about..." 
• "The exact definition is..." 
• "This is important for the exam because..."
• "We need to remember this word-for-word"
• "The chapter mentions that..." 
• "According to our textbook..."

KEY CONCEPTS FOCUS:
• Cover all major concepts from the extracted content: {concepts}
• Ensure exact terminology is used and explained
• Provide textbook definitions when terms are mentioned
• Connect concepts logically as they appear in the chapter
• Emphasize exam-relevant information

INCLUDE THE LISTENER:
• "You probably remember this better than me..."
• "We all struggled with this in class, right?"
• "You were sitting next to me when teacher explained this"
• "Make sure you don't forget this for the test"
• "This is the part we all found confusing"

CONTENT STRUCTURE:
Opening (exam-focused start):
  "{speaker1_name}: Let's go through this chapter for our exam. I want to make sure I know all the key terms."
  "{speaker2_name}: Good idea. I'm still unclear about some definitions..."

Main Discussion - MUST COVER ALL OF THESE FROM THE CHAPTER:
  - ALL names mentioned: James Mill, James Rennel, Robert Clive, Warren Hastings, Lord Mountbatten, etc.
  - ALL dates mentioned: 1817 (Mill's book), 1782 (Rennel's map), 1773 (Hastings), etc.
  - ALL terms: periodisation, colonialism, calligraphists, census, surveys, archives, etc.
  - ALL concepts: Hindu-Muslim-British periods, ancient-medieval-modern, official records, etc.
  - ALL examples: tea/coffee drinking, railways, newspapers, Governor-Generals list, etc.
  - ALL sources mentioned: diaries, autobiographies, newspapers, government records, etc.
  - EXACT quotes from the chapter when defining terms
  - Cover systematically: dates → periodisation → sources → problems with records

Ending (exam-ready):
  "Now I feel confident about these terms for the exam!"
  "Let's quickly review the key definitions one more time..."

IMPORTANT GUIDELINES:
• Students should sound their actual age - not like mini-professors
• Include natural hesitations, corrections, and "um"s
• Show the learning process, not just final understanding
• Reference the classroom setting and shared experience
• Make it feel like overhearing real students study together

MANDATORY CONTENT COVERAGE:
• MUST mention ALL names: James Mill, James Rennel, Robert Clive, Warren Hastings, Wellesley, Bentinck, Dalhousie, Canning, Lawrence, Lytton, Ripon, Curzon, Harding, Irwin, Lord Mountbatten
• MUST mention ALL dates: 1817, 1782, 1773, and any other dates in the chapter
• MUST define ALL terms: periodisation, colonialism, calligraphists, census, surveys, archives, official records
• MUST explain ALL concepts: Hindu-Muslim-British periods, ancient-medieval-modern classification, problems with each
• MUST mention ALL examples: tea/coffee, railways, newspapers, botanical surveys, zoological surveys, archaeological surveys
• MUST discuss ALL source types: official records, diaries, autobiographies, newspapers, government files
• MUST explain why official records have limitations
• MUST explain why the book is called 'Our Pasts' (plural)
• Use EXACT phrases and definitions from the chapter text: {chapter_content}

BEFORE WRITING THE SCRIPT:
1. Read the ENTIRE chapter content: {chapter_content}
2. Make a mental list of ALL names, dates, terms, and concepts mentioned
3. Ensure your dialogue covers EVERY important point from the chapter
4. Do NOT skip any major concept, name, date, or term
5. Students should discuss the content systematically and thoroughly

RETURN VALID JSON ONLY (no markdown, no extra text):
{{
  "episode_index": {episode_number},
  "title": "Episode {episode_number}: {episode_title}",
  "estimated_duration_seconds": {duration_seconds},
  "word_count": <actual_number>,
  "grade_level": "{grade_band}",
  "content_coverage": "comprehensive",
  "names_mentioned": ["all names from chapter"],
  "dates_mentioned": ["all dates from chapter"],
  "terms_defined": ["all key terms from chapter"],
  "sections": [
    {{
      "id": "section_1",
      "start": 0,
      "end": 120,
      "type": "dialogue",
      "text": "{speaker1_name}: [comprehensive discussion of chapter content]\\n{speaker2_name}: [response with exact terms and details]\\n...",
      "chapter_content_covered": ["specific topics from this section"],
      "exam_focus": "high"
    }}
  ],
  "chapter_coverage_percentage": 95,
  "missing_content": ["any important points not covered"],
  "pronunciation_hints": {{"difficult_word": "pronunciation"}}
}}`;

/**
 * Build educational prompt with user inputs
 * @param {Object} metadata - User-provided metadata
 * @param {string} chapterContent - Extracted PDF content
 * @returns {string} - Complete prompt for Gemini
 */
function buildEducationalPrompt(metadata, chapterContent) {
  const {
    gradeBand = "9-10",
    durationMinutes = 10,
    speaker1Name = "Alex",
    speaker2Name = "Sam",
    episodeNumber = 1,
    episodeTitle = "Chapter Revision",
    concepts = "Auto-extracted from content"
  } = metadata;

  const durationSeconds = durationMinutes * 60;
  const minWords = Math.floor(durationMinutes * 120); // ~120 words/minute (slower pace)
  const targetWords = Math.floor(durationMinutes * 150); // ~150 words/minute

  return EDUCATIONAL_PROMPT_TEMPLATE
    .replace(/{grade_band}/g, gradeBand)
    .replace(/{speaker1_name}/g, speaker1Name)
    .replace(/{speaker2_name}/g, speaker2Name)
    .replace(/{duration_minutes}/g, durationMinutes)
    .replace(/{duration_seconds}/g, durationSeconds)
    .replace(/{min_words}/g, minWords)
    .replace(/{target_words}/g, targetWords)
    .replace(/{chapter_content}/g, chapterContent)
    .replace(/{episode_number}/g, episodeNumber)
    .replace(/{episode_title}/g, episodeTitle)
    .replace(/{concepts}/g, concepts)
    .replace(/{concept_ids}/g, '["auto_extracted"]');
}

/**
 * Extract meaningful educational concepts from chapter content
 * @param {string} content - Chapter text content
 * @returns {string} - Properly formatted educational concepts
 */
function extractBasicConcepts(content) {
  // For now, let's not try to be too smart about concept extraction
  // Instead, let's provide a summary that the AI can work with
  
  const wordCount = content.split(/\s+/).length;
  const firstParagraph = content.substring(0, 500).trim();
  
  // Extract the first few sentences to understand the topic
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 20);
  const topicSentences = sentences.slice(0, 3).map(s => s.trim()).join('. ');
  
  return `Topic: Based on the chapter content about ${topicSentences}. Word count: ${wordCount} words. Students should focus on key terms, definitions, important dates, names, and concepts mentioned in the text.`;
}

/**
 * Validate educational script JSON response
 * @param {string} response - Gemini response
 * @returns {Object} - Validation result with parsed script
 */
function validateEducationalScript(response) {
  try {
    // Clean response - remove markdown formatting if present
    const cleanResponse = response
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    const script = JSON.parse(cleanResponse);
    
    // Validate required fields
    const requiredFields = [
      'episode_index', 'title', 'estimated_duration_seconds',
      'word_count', 'grade_level', 'sections'
    ];
    
    const missing = requiredFields.filter(field => !script[field]);
    if (missing.length > 0) {
      return {
        isValid: false,
        error: `Missing required fields: ${missing.join(', ')}`,
        script: null
      };
    }
    
    // Validate sections
    if (!Array.isArray(script.sections) || script.sections.length === 0) {
      return {
        isValid: false,
        error: 'Script must have at least one section',
        script: null
      };
    }
    
    return {
      isValid: true,
      script: script,
      wordCount: script.word_count,
      duration: script.estimated_duration_seconds
    };
    
  } catch (error) {
    return {
      isValid: false,
      error: `JSON parsing error: ${error.message}`,
      script: null
    };
  }
}

module.exports = {
  buildEducationalPrompt,
  extractBasicConcepts,
  validateEducationalScript,
  EDUCATIONAL_PROMPT_TEMPLATE
};