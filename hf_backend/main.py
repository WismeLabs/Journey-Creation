from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import os
import json
import logging
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv
from pathlib import Path
import time
import hashlib

# Ensure we load environment variables from the repository root (.env)
ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / '.env')
# Also respect any environment variables already set (fallback to default search)
load_dotenv()

from google import generativeai as genai
from contextlib import asynccontextmanager

# Configure structured logging per MIGRATION.md
import sys

# Create logs directory if it doesn't exist
log_dir = os.path.join(os.path.dirname(__file__), '..', 'logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, 'llm_service.log')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(log_file, encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)

# Fix Windows console encoding for emojis
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

def get_gemini_model():
    """Get configured Gemini model - REQUIRES valid API key for production"""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key.strip() == "":
        error_msg = (
            "[ERROR] GEMINI_API_KEY is required for the K-12 educational content pipeline. "
            "Please:\n"
            "1. Get your API key from: https://makersuite.google.com/app/apikey\n"
            "2. Add it to your .env file: GEMINI_API_KEY=your_actual_key_here\n"
            "3. Restart the backend service"
        )
        logger.error(error_msg)
        raise HTTPException(status_code=500, detail=error_msg)
    
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.0-flash-exp")
        
        # Test API connectivity 
        test_response = model.generate_content(
            "Test connection", 
            generation_config=genai.types.GenerationConfig(max_output_tokens=10)
        )
        
        if not test_response or not test_response.text:
            raise ValueError("API key validation failed")
            
        logger.info("[OK] Gemini API configured and validated successfully")
        return model, api_key
        
    except Exception as e:
        logger.error(f"[ERROR] Gemini API setup failed: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Gemini API configuration error: {str(e)}"
        )

# Mock content generation removed - system now requires real Gemini API integration

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager - validates Gemini API on startup"""
    try:
        get_gemini_model()
        logger.info("[OK] LLM Service started successfully - all systems operational")
    except Exception as e:
        logger.error(f"[WARNING] Startup validation failed - service may not function correctly: {str(e)}")
    yield
    # Cleanup on shutdown (if needed)
    logger.info("[SHUTDOWN] LLM Service shutting down")

app = FastAPI(
    title="Journey Creation Content Pipeline LLM Service", 
    version="2.0.0",
    description="Complete LLM service with all 13 regeneration prompts per MIGRATION.md",
    lifespan=lifespan
)

# Request/Response Models per MIGRATION.md requirements
class ConceptExtractionRequest(BaseModel):
    markdown_content: str
    metadata: Dict[str, Any]

class ScriptGenerationRequest(BaseModel):
    concepts: List[Dict[str, Any]]
    episode_title: str
    grade: str
    subject: str
    duration_minutes: int
    source_content: str
    speaker_config: Optional[Dict[str, str]] = {
        "speaker1_name": "StudentA",
        "speaker2_name": "StudentB",
        "speaker1_role": "student",
        "speaker2_role": "student",
        "speaker1_personality": "confident",
        "speaker2_personality": "curious"
    }

class MCQGenerationRequest(BaseModel):
    concepts: List[Dict[str, Any]]
    script: Dict[str, Any]
    count: int
    difficulty: str

class RegenerationRequest(BaseModel):
    prompt_type: str
    input_data: Dict[str, Any]
    temperature: float = 0.0

class ChapterAnalysisRequest(BaseModel):
    markdown_content: str
    grade_band: str
    subject: str
    language: str = "en-IN"

# Educational prompt templates per MIGRATION.md requirements
EDUCATIONAL_PROMPTS = {
    "concept_extraction": """
SYSTEM: You are an educational content analyzer for K-12 textbooks. 
INPUT: chapter_markdown, grade_band, subject
TASK: Extract key educational concepts from the chapter content.
OUTPUT: Return JSON with concepts array and prerequisite graph.

For each concept include:
- id: snake_case identifier
- name: human readable name
- type: definition|process|formula|example|application  
- difficulty: easy|medium|hard (grade-appropriate)
- blooms: remember|understand|apply|analyze|evaluate|create
- source_excerpt: reference like "p3:lines 1-7"
- related: array of prerequisite concept ids
- definition: clear explanation of the concept

Create a concept graph showing prerequisite relationships.
Focus on concepts that can be explained in 4-8 minute peer conversations.
Ensure concepts are grade {grade_band} appropriate for {subject}.

Chapter content:
{content}

Return valid JSON only:
{{
  "concepts": [
    {{
      "id": "concept_id",
      "name": "Concept Name", 
      "type": "definition",
      "difficulty": "medium",
      "blooms": "understand",
      "source_excerpt": "line_15",
      "related": ["prerequisite_id"],
      "definition": "Clear explanation"
    }}
  ],
  "graph": [["prerequisite_id", "concept_id"]]
}}
""",

    "episode_script": """
SYSTEM: You are a K-12 educational script writer with strict source alignment. Generate peer-to-peer dialogue between two students.
INPUT: episode_config, concepts, chapter_content
CONSTRAINTS: 
- Only StudentA (confident) and StudentB (curious) voices
- Word count: 450-1100 words, target 500-900
- Sections: hook(10-20s), core1, micro-example(≤30s), core2, recall-break, mini-summary(≤30s)
- CRITICAL: Attach source_reference to every factual statement or mark as inferred:true

SOURCE ALIGNMENT RULES (MANDATORY per MIGRATION.md):
- Every assertive sentence must include source_reference field
- source_reference format: "p[page]:lines [start]-[end]" or "block_[id]"  
- If no direct source found, mark as "inferred": true with soft language
- Use "Scientists think...", "It is believed that..." for inferred content
- Never make high-confidence claims without source reference
- Grade {grade_band} appropriate vocabulary
- No teacher voice, no narrator, no intros/outros
- Stories only if memory-aiding, ≤30s
- Include timestamps in seconds for each section

Concepts to cover: {concepts}
Target duration: {duration_minutes} minutes
Source content: {chapter_content}

Return valid JSON only:
{{
  "episode_index": 1,
  "title": "{episode_title}",
  "estimated_duration_seconds": {duration_seconds},
  "word_count": 720,
  "style_lock": "style_v1.json",
  "sections": [
    {{
      "id": "hook",
      "start": 0,
      "end": 18,
      "type": "hook",
      "text": "{speaker1_name}: Hey, have you ever wondered why...?\n{speaker2_name}: Actually, yes! I was just thinking about that..."
    }},
    {{
      "id": "core1", 
      "start": 18,
      "end": 120,
      "type": "core",
      "text": "{speaker1_name}: So let me explain...\n{speaker2_name}: That makes sense, but what about..."
    }}
  ],
  "concept_ids": {concept_ids},
  "pronunciation_hints": {{"difficult_word": "pronunciation"}}
}}
""",

    "mcq_generation": """
SYSTEM: You are an MCQ generator for educational content.
INPUT: final_script, concept_list, episode_duration
RULES:
- Generate {count} MCQs strictly from script content
- 4 options each, exactly 1 correct
- Include timestamp_ref pointing to section start seconds  
- Types: 40% recall, 30% understanding, 30% application
- Plausible distractors from common confusions
- Grade appropriate language
- Each MCQ must reference content that appears in the script

Script: {script}
Concepts: {concepts}

Return valid JSON only:
{{
  "mcqs": [
    {{
      "qid": "q1",
      "timestamp_ref": 45,
      "concept_id": "photosynthesis",
      "difficulty": 3,
      "type": "recall",
      "question_text": "According to the conversation, what is photosynthesis?",
      "options": [
        "Process plants use to make food",
        "Way plants reproduce", 
        "How plants move water",
        "Method of plant growth"
      ],
      "correct_index": 0,
      "explanation": "As StudentA explained, photosynthesis is the process plants use to make their own food using sunlight."
    }}
  ]
}}
"""
}

# All 13 Regeneration prompts from MIGRATION.md (VERBATIM)
REGENERATION_PROMPTS = {
    "regen_short_script": """
SYSTEM: You are a script editor for a K-12 educational audio episode. 
INPUT: episode_plan, style_lock, chapter_concepts, current_script. 
CONSTRAINTS: two speakers only ({speaker1_name}, {speaker2_name}). TARGET_WORD_MIN: 450. TARGET_WORD_MAX: 1100. 
TONE: peer-to-peer, {speaker1_name} {speaker1_personality}, {speaker2_name} {speaker2_personality}. NO teacher voice. 
STORY allowed only if memory-aiding, <=30s. 
OUTPUT: produce a revised script that expands content organically to hit at least 450 words while preserving existing correct statements and all source references. 
Do not invent new high-confidence facts; any added factual claims must be traced to chapter_concepts or marked as "inferred" with low-certainty phrasing. 
Keep micro-story length <=30 seconds. Include section markers and estimated start/end seconds. 
Return only JSON with keys: {script_text, word_count, sections:[{id,start,end,text}], change_log}.
""",

    "regen_long_script": """
SYSTEM: You are a script compressor for a K-12 educational episode. 
INPUT: current_script, style_lock. 
CONSTRAINTS: reduce word_count to <=1100 and preserve conceptual coverage and core facts. 
Keep two speakers only. Remove redundant sentences, shorten analogies, compress examples. 
Do NOT remove any core concepts listed in episode_plan. 
Avoid altering MCQs references; if timestamps move, output new timestamp map. 
OUTPUT only JSON {script_text, word_count, sections:[...], change_log}.
""",

    "regen_tone_fix": """
SYSTEM: You are a tone-correction engine. 
INPUT: current_script, style_lock (defines forbidden words and allowed phrasing). 
TASK: Rewrite the script to eliminate teacher-tone and narration. 
Replace phrases that sound like "lecture", "as we discussed" or "today we'll learn" with peer phrasing. 
Keep content meaning identical, keep sources. Keep word_count within +/-10% of original. 
OUTPUT JSON {script_text, change_log}.
""",

    "regen_mcq_sync": """
SYSTEM: You are an MCQ generator and synchronizer. 
INPUT: final_script (authoritative), desired_mcq_count (3-6), concept_list. 
RULES: generate MCQs strictly from sentences/phrases present in final_script. 
For each question include timestamp_ref (map to section start). 
Ensure each concept in concept_list has at least one MCQ across episode set if possible. 
Provide plausible distractors derived from nearby phrases or common confusions. 
OUTPUT JSON {mcqs:[...], change_log}.
""",

    "regen_remove_hallucination": """
SYSTEM: You are a factual aligner. 
INPUT: script, flagged_sentences (list), chapter_sources. 
TASK: For each flagged sentence that lacks a source reference, either (A) rephrase to a hypothetical/soft phrasing ("Scientists think..." / "It is believed that...") or (B) remove it. 
Prefer (A) only if a reasonable low-confidence paraphrase can be created; otherwise remove. 
Mark any remaining sentences as "inferred":true. 
Return JSON {script_text, removed_sentences:[...], modified_sentences:[...], inferred_sentences:[...]}.
""",

    "regen_pronunciation_map": """
SYSTEM: You are a pronunciation mapper. 
INPUT: script_text, detected_terms[], language. 
OUTPUT: JSON mapping of term -> phonetic_hint. 
Use common-sense phonetics for en-IN. Also add SSML-compatible substitutions for GoogleTTS/ElevenLabs where possible. 
{pronunciation_hints:{term:"KLAWR-uh-fill", ...}}
""",

    "regen_structure_fix": """
SYSTEM: You are a structure-corrector. 
INPUT: raw_text, extracted_headings, detected_ocr_errors. 
RULES: reconstruct logical headings using numbering patterns, bold/uppercase heuristics, and nearby sentence starts. 
Fix obvious OCR artefacts (l|1, O|0). If uncertainty > threshold for a heading (confidence <0.7), mark as "uncertain_heading" and add to error_report. 
OUTPUT: cleaned_markdown and list{fixed_spans, uncertain_spans}.
""",

    "regen_dedup": """
SYSTEM: You are a deduplication editor. 
INPUT: script_text. 
TASK: Remove or compress repeated ideas appearing >2 times. 
Merge duplicate examples. Keep at least one clear explanation per concept. 
OUTPUT JSON {script_text, removed_passages:[...], change_log}.
""",

    "regen_split_episode": """
SYSTEM: You are an episode splitter. 
INPUT: original_episode_plan, script_text (>1100 words), chapter_concepts. 
RULES: Identify a logical split point between concept clusters, produce two coherent episodes each satisfying 450–1100 word rules. 
Keep voice/style consistent and update timestamps. 
Output JSON {episodes:[{script_text,concepts,metadata},{...}], change_log}.
""",

    "regen_merge_episode": """
SYSTEM: You are an episode merger. 
INPUT: episode_A_script (short<450), episode_B_script, episode_plan. 
RULES: Merge A+B into a single coherent episode, reflow sections, ensure total <=1100 words. 
Prefer merging concepts that are direct prerequisites. 
Output merged script JSON and mark ep indexes changed.
""",

    "regen_time_sync": """
SYSTEM: You are an audio-to-script syncer. 
INPUT: script sections with estimated seconds, generated audio final_audio.mp3, cues.json. 
TASK: Recompute actual section start/end times from audio, update cues.json, and update all MCQ timestamp_refs to new times. 
If section durations differ >25% from estimates, add note to change_log. 
OUTPUT updated cues.json and mcqs.json.
""",

    "regen_style_lock": """
SYSTEM: You enforce chapter-level style. 
INPUT: style_lock.json, all_episode_scripts[]. 
TASK: For each episode that violates style rules (vocab level, speaker personality), regenerate only the offending episodes reusing prior prompts but with explicit style directives. 
OUTPUT change_log with re-gen attempts.
""",

    "human_review_summary": """
SYSTEM: You produce a tightly formatted human review summary. 
INPUT: failed_checks[], error_report, sample_script_snippets. 
OUTPUT: Markdown with bullet points: problem, location (file/line), suggested fix, high-priority flag. 
Keep it actionable with exact sentences that need edit. Do NOT include raw logs.
"""
}

@app.post("/extract_concepts")
async def extract_concepts(request: ConceptExtractionRequest):
    """Extract educational concepts from chapter content"""
    try:
        model, api_key = get_gemini_model()
        logger.info(f"Extracting concepts for {request.metadata.get('subject', 'unknown')} content using Gemini API")
        
        prompt = EDUCATIONAL_PROMPTS["concept_extraction"].format(
            content=request.markdown_content[:5000],  # Limit content size
            grade_band=request.metadata.get("grade_band", "7"),
            subject=request.metadata.get("subject", "general")
        )

        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.3,
                max_output_tokens=4000,
                response_mime_type="application/json"
            )
        )

        # Parse and validate response
        result = json.loads(response.text)
        
        if not result.get("concepts"):
            raise ValueError("No concepts extracted from content")

        logger.info(f"Successfully extracted {len(result['concepts'])} concepts")
        return result

    except Exception as e:
        logger.error(f"Concept extraction failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Concept extraction failed: {str(e)}")

@app.post("/generate_script")
async def generate_script(request: ScriptGenerationRequest):
    """Generate educational script per MIGRATION.md requirements"""
    try:
        model, api_key = get_gemini_model()
        logger.info(f"Generating script for episode: {request.episode_title} using Gemini API")
        
        concept_names = [c.get('name', c.get('id', 'Unknown')) for c in request.concepts]
        concept_ids = [c.get('id', 'unknown') for c in request.concepts]
        duration_seconds = request.duration_minutes * 60

        # Get speaker configuration with defaults
        speaker_config = request.speaker_config or {}
        speaker1_name = speaker_config.get('speaker1_name', 'StudentA')
        speaker2_name = speaker_config.get('speaker2_name', 'StudentB')
        speaker1_personality = speaker_config.get('speaker1_personality', 'confident')
        speaker2_personality = speaker_config.get('speaker2_personality', 'curious')

        prompt = EDUCATIONAL_PROMPTS["episode_script"].format(
            concepts=concept_names,
            episode_title=request.episode_title,
            grade_band=request.grade,
            duration_minutes=request.duration_minutes,
            duration_seconds=duration_seconds,
            concept_ids=concept_ids,
            chapter_content=request.source_content[:3000],
            speaker1_name=speaker1_name,
            speaker2_name=speaker2_name,
            speaker1_personality=speaker1_personality,
            speaker2_personality=speaker2_personality
        )

        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.4,
                max_output_tokens=3000,
                response_mime_type="application/json"
            )
        )

        result = json.loads(response.text)
        
        # Validate required fields
        if not result.get("sections"):
            raise ValueError("Script generation failed - no sections created")

        logger.info(f"Successfully generated script with {len(result['sections'])} sections")
        return {"script": result}

    except Exception as e:
        logger.error(f"Script generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Script generation failed: {str(e)}")

@app.post("/generate_mcqs")
async def generate_mcqs(request: MCQGenerationRequest):
    """Generate MCQs from script content per MIGRATION.md"""
    try:
        model, api_key = get_gemini_model()
        logger.info(f"Generating {request.count} MCQs using Gemini API")
        
        script_text = ""
        if isinstance(request.script, dict):
            # Extract text from sections
            sections = request.script.get('sections', [])
            script_text = "\\n".join([section.get('text', '') for section in sections])
        else:
            script_text = str(request.script)

        concept_names = [c.get('name', c.get('id', 'Unknown')) for c in request.concepts]

        prompt = EDUCATIONAL_PROMPTS["mcq_generation"].format(
            count=request.count,
            script=script_text[:2000],  # Limit script size
            concepts=concept_names
        )

        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.2,
                max_output_tokens=2000,
                response_mime_type="application/json"
            )
        )

        result = json.loads(response.text)
        
        if not result.get("mcqs"):
            raise ValueError("MCQ generation failed - no questions created")

        logger.info(f"Successfully generated {len(result['mcqs'])} MCQs")
        return result

    except Exception as e:
        logger.error(f"MCQ generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"MCQ generation failed: {str(e)}")

@app.post("/regenerate")
async def regenerate_content(request: RegenerationRequest):
    """Handle content regeneration using specific prompts per MIGRATION.md"""
    try:
        model, api_key = get_gemini_model()
        if not model:
            raise HTTPException(status_code=500, detail="Gemini API not configured")

        prompt_type = request.prompt_type.lower()
        
        if prompt_type not in REGENERATION_PROMPTS:
            raise HTTPException(status_code=400, detail=f"Unknown regeneration prompt type: {prompt_type}")

        logger.info(f"Running regeneration prompt: {prompt_type}")
        
        # Get the appropriate regeneration prompt
        base_prompt = REGENERATION_PROMPTS[prompt_type]
        
        # Format prompt with input data
        formatted_prompt = base_prompt + "\\n\\nINPUT DATA:\\n" + json.dumps(request.input_data, indent=2)
        
        # Generate with deterministic settings for regeneration (temperature=0.0)
        response = model.generate_content(
            formatted_prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=request.temperature,
                max_output_tokens=3000,
                response_mime_type="application/json"
            )
        )

        # Parse response
        try:
            result = json.loads(response.text)
        except json.JSONDecodeError:
            # Fallback if JSON parsing fails
            result = {"regenerated_content": response.text, "success": False}

        # Add regeneration metadata
        result["regeneration_metadata"] = {
            "prompt_type": prompt_type,
            "temperature": request.temperature,
            "timestamp": time.time(),
            "generation_version": "content_pipeline_v1"
        }

        logger.info(f"Successfully completed regeneration: {prompt_type}")
        return result

    except Exception as e:
        logger.error(f"Regeneration failed for {request.prompt_type}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Regeneration failed: {str(e)}")

@app.post("/analyze_chapter")
async def analyze_chapter(request: ChapterAnalysisRequest):
    """Complete chapter analysis per MIGRATION.md requirements"""
    try:
        model, api_key = get_gemini_model()
        if not model:
            raise HTTPException(status_code=500, detail="Gemini API not configured")

        logger.info(f"Analyzing chapter for {request.subject} grade {request.grade_band}")
        
        analysis_prompt = f"""
SYSTEM: You are a comprehensive educational content analyzer.
INPUT: chapter_markdown, grade_band, subject, language
TASK: Perform complete chapter analysis including:
1. Content structure assessment
2. Key learning objectives identification  
3. Concept difficulty mapping
4. Curriculum alignment check
5. Episode planning recommendations

Chapter: {request.markdown_content[:4000]}
Grade: {request.grade_band}
Subject: {request.subject}
Language: {request.language}

Return comprehensive JSON analysis:
{{
  "structure_analysis": {{
    "heading_count": 0,
    "paragraph_count": 0,
    "estimated_reading_time": 0,
    "content_quality_score": 0.0
  }},
  "learning_objectives": [],
  "concept_map": [],
  "difficulty_assessment": "medium",
  "curriculum_alignment": "high",
  "episode_recommendations": {{
    "suggested_episode_count": 5,
    "concept_clustering": [],
    "estimated_total_duration": 30
  }},
  "quality_flags": []
}}
"""

        response = model.generate_content(
            analysis_prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.2,
                max_output_tokens=3000,
                response_mime_type="application/json"
            )
        )

        result = json.loads(response.text)
        
        logger.info("Chapter analysis completed successfully")
        return result

    except Exception as e:
        logger.error(f"Chapter analysis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Chapter analysis failed: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    model, api_key = get_gemini_model()
    return {
        "status": "healthy",
        "gemini_configured": api_key is not None,
        "timestamp": time.time(),
        "version": "content_pipeline_v1",
        "regeneration_prompts_count": len(REGENERATION_PROMPTS)
    }

@app.get("/regeneration_prompts")
async def list_regeneration_prompts():
    """List all available regeneration prompts"""
    return {
        "prompts": list(REGENERATION_PROMPTS.keys()),
        "count": len(REGENERATION_PROMPTS),
        "migration_md_compliance": "all_13_prompts_implemented"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)