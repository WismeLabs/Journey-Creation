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
from openai import AsyncOpenAI
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

# LLM Provider Configuration
# Options: "gemini", "openai", or "auto" (tries OpenAI first, falls back to Gemini)
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "auto").lower()

# Track which provider is currently active (for auto mode)
CURRENT_PROVIDER = None
FALLBACK_PROVIDER = None

def initialize_providers():
    """Initialize available LLM providers"""
    global CURRENT_PROVIDER, FALLBACK_PROVIDER
    
    openai_available = os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_API_KEY").strip()
    gemini_available = os.getenv("GEMINI_API_KEY") and os.getenv("GEMINI_API_KEY").strip()
    
    if LLM_PROVIDER == "auto":
        if openai_available and gemini_available:
            CURRENT_PROVIDER = "openai"
            FALLBACK_PROVIDER = "gemini"
            logger.info("[AUTO MODE] Primary: OpenAI GPT-4o | Fallback: Gemini 2.0 Flash")
        elif openai_available:
            CURRENT_PROVIDER = "openai"
            FALLBACK_PROVIDER = None
            logger.info("[AUTO MODE] Only OpenAI available")
        elif gemini_available:
            CURRENT_PROVIDER = "gemini"
            FALLBACK_PROVIDER = None
            logger.info("[AUTO MODE] Only Gemini available")
        else:
            raise ValueError("No LLM provider configured. Please add OPENAI_API_KEY or GEMINI_API_KEY to .env")
    elif LLM_PROVIDER == "openai":
        if not openai_available:
            raise ValueError("OPENAI_API_KEY required when LLM_PROVIDER=openai")
        CURRENT_PROVIDER = "openai"
        FALLBACK_PROVIDER = "gemini" if gemini_available else None
    elif LLM_PROVIDER == "gemini":
        if not gemini_available:
            raise ValueError("GEMINI_API_KEY required when LLM_PROVIDER=gemini")
        CURRENT_PROVIDER = "gemini"
        FALLBACK_PROVIDER = "openai" if openai_available else None
    
    return CURRENT_PROVIDER, FALLBACK_PROVIDER

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
        # Using Gemini 2.0 Flash - best balance of cost, speed, and quality for educational content
        # Cheaper than 1.5 Pro ($0.025 vs $0.15 per chapter), faster, better instruction following
        model = genai.GenerativeModel("gemini-2.0-flash-001")
        
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

def get_openai_client():
    """Get configured OpenAI client - supports GPT-5, GPT-4o, and GPT-4o-mini"""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or api_key.strip() == "":
        error_msg = (
            "[ERROR] OPENAI_API_KEY is required when LLM_PROVIDER=openai. "
            "Please:\n"
            "1. Get your API key from: https://platform.openai.com/api-keys\n"
            "2. Add it to your .env file: OPENAI_API_KEY=your_actual_key_here\n"
            "3. Restart the backend service"
        )
        logger.error(error_msg)
        raise HTTPException(status_code=500, detail=error_msg)
    
    try:
        client = AsyncOpenAI(api_key=api_key)
        logger.info("[OK] OpenAI API configured successfully")
        return client, api_key
    except Exception as e:
        logger.error(f"[ERROR] OpenAI API setup failed: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"OpenAI API configuration error: {str(e)}"
        )

def parse_openai_model_list():
    """Parse OPENAI_MODEL env var - supports comma-separated fallback list"""
    model_str = os.getenv("OPENAI_MODEL", "gpt-4o")
    # Support format: "gpt-5,gpt-4o" or single model "gpt-4o"
    models = [m.strip() for m in model_str.split(",") if m.strip()]
    return models if models else ["gpt-4o"]

async def generate_with_llm(prompt: str, temperature: float = 0.4, max_tokens: int = 3000, json_mode: bool = True, provider_override: str = None) -> str:
    """Universal LLM generation function with automatic fallback support
    
    Args:
        prompt: The prompt to send to the LLM
        temperature: Generation temperature
        max_tokens: Maximum tokens to generate
        json_mode: Whether to request JSON formatted output
        provider_override: Override the default provider selection ("openai" or "gemini")
    
    Returns:
        Generated text response
    """
    # Determine which provider to use
    use_provider = provider_override if provider_override else CURRENT_PROVIDER
    
    async def try_provider(provider_name: str, model_override: str = None) -> str:
        """Attempt generation with a specific provider and optional model"""
        if provider_name == "openai":
            client, _ = get_openai_client()
            model_name = model_override or "gpt-4o"
            
            messages = [{"role": "user", "content": prompt}]
            
            kwargs = {
                "model": model_name,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens
            }
            
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}
            
            logger.info(f"[OpenAI] Trying model: {model_name}")
            try:
                # Primary: chat.completions
                response = await client.chat.completions.create(**kwargs)
                return response.choices[0].message.content
            except Exception as chat_err:
                logger.warning(f"[OpenAI] {model_name} via chat.completions failed: {str(chat_err)[:100]}")
                # Try Responses API as fallback for this model
                try:
                    rsp_kwargs = {
                        "model": model_name,
                        "input": prompt,
                        "temperature": temperature,
                    }
                    if json_mode:
                        rsp_kwargs["response_format"] = {"type": "json_object"}
                    rsp = await client.responses.create(**rsp_kwargs)
                    if hasattr(rsp, "output_text") and rsp.output_text:
                        return rsp.output_text
                    try:
                        parts = rsp.output[0].content if hasattr(rsp, "output") else []
                        texts = [p.text for p in parts if hasattr(p, "text")]
                        return "\n".join(texts) if texts else json.dumps(rsp.model_dump())
                    except Exception:
                        return json.dumps(getattr(rsp, "model_dump", lambda: str(rsp))())
                except Exception as rsp_err:
                    logger.warning(f"[OpenAI] {model_name} via responses API also failed: {str(rsp_err)[:100]}")
                    raise chat_err  # Re-raise original error for fallback handling
            
        else:  # Gemini
            model, _ = get_gemini_model()
            
            config_kwargs = {
                "temperature": temperature,
                "max_output_tokens": max_tokens
            }
            
            if json_mode:
                config_kwargs["response_mime_type"] = "application/json"
            
            logger.info("[Gemini] Using model: gemini-2.0-flash-001")
            response = model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(**config_kwargs)
            )
            
            return response.text
    
    # 3-Tier Fallback Strategy: GPT-5 → GPT-4o → Gemini
    errors = []
    
    if use_provider == "openai":
        # Try each OpenAI model in order
        openai_models = parse_openai_model_list()
        for model_name in openai_models:
            try:
                result = await try_provider("openai", model_override=model_name)
                logger.info(f"✓ Successfully generated content using OpenAI ({model_name})")
                return result
            except Exception as e:
                error_msg = f"OpenAI ({model_name}): {str(e)[:150]}"
                errors.append(error_msg)
                logger.warning(f"✗ {error_msg}")
        
        # All OpenAI models failed, try Gemini if available
        if FALLBACK_PROVIDER == "gemini":
            logger.warning(f"→ All OpenAI models failed. Attempting Gemini fallback...")
            try:
                result = await try_provider("gemini")
                logger.info(f"✓ Successfully generated content using fallback Gemini")
                return result
            except Exception as gemini_error:
                errors.append(f"Gemini: {str(gemini_error)[:150]}")
                logger.error(f"✗ Gemini fallback also failed: {str(gemini_error)[:150]}")
        
        # All providers exhausted
        raise HTTPException(
            status_code=500,
            detail=f"All providers failed. Tried: {' | '.join(errors)}"
        )
    
    else:
        # Gemini primary (or other provider)
        try:
            result = await try_provider(use_provider)
            logger.info(f"✓ Successfully generated content using {use_provider.upper()}")
            return result
        except Exception as e:
            logger.error(f"✗ {use_provider.upper()} failed: {str(e)}")
            
            # Try OpenAI models as fallback if available
            if FALLBACK_PROVIDER == "openai":
                logger.warning(f"→ Attempting OpenAI fallback...")
                openai_models = parse_openai_model_list()
                for model_name in openai_models:
                    try:
                        result = await try_provider("openai", model_override=model_name)
                        logger.info(f"✓ Successfully generated content using fallback OpenAI ({model_name})")
                        return result
                    except Exception as fallback_error:
                        logger.warning(f"✗ OpenAI ({model_name}) fallback failed: {str(fallback_error)[:150]}")
            
            # No fallback or all failed
            raise HTTPException(status_code=500, detail=f"{use_provider.upper()} failed: {str(e)}")
            logger.warning(f"→ Attempting fallback to {FALLBACK_PROVIDER.upper()}...")
            try:
                result = await try_provider(FALLBACK_PROVIDER)
                logger.info(f"✓ Successfully generated content using fallback {FALLBACK_PROVIDER.upper()}")
                return result
            except Exception as fallback_error:
                logger.error(f"✗ Fallback {FALLBACK_PROVIDER.upper()} also failed: {str(fallback_error)}")
                raise HTTPException(
                    status_code=500,
                    detail=f"Both providers failed. Primary ({use_provider}): {str(e)}. Fallback ({FALLBACK_PROVIDER}): {str(fallback_error)}"
                )
        else:
            # No fallback available
            raise HTTPException(status_code=500, detail=f"{use_provider.upper()} failed: {str(e)}")

# Mock content generation removed - system now requires real Gemini API integration

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager - validates LLM API on startup"""
    try:
        initialize_providers()
        
        if CURRENT_PROVIDER == "openai":
            get_openai_client()
        if CURRENT_PROVIDER == "gemini" or FALLBACK_PROVIDER == "gemini":
            get_gemini_model()
        if FALLBACK_PROVIDER == "openai":
            get_openai_client()
            
        logger.info("[OK] All systems operational")
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
    llm_provider: Optional[str] = None

class MCQGenerationRequest(BaseModel):
    concepts: List[Dict[str, Any]]
    script: Dict[str, Any]
    count: int
    difficulty: str
    llm_provider: Optional[str] = None

class RegenerationRequest(BaseModel):
    prompt_type: str
    input_data: Dict[str, Any]
    temperature: float = 0.0
    llm_provider: Optional[str] = None

class ChapterAnalysisRequest(BaseModel):
    markdown_content: str
    grade_band: str
    subject: str
    language: str = "en-IN"

# Educational prompt templates per MIGRATION.md requirements
EDUCATIONAL_PROMPTS = {
    "concept_extraction": """
SYSTEM: You are an educational content analyzer for K-12 textbooks with hierarchical concept mapping.
INPUT: chapter_markdown, grade_band, subject
TASK: Extract ALL concepts with importance ranking and grouping.
OUTPUT: Return JSON with hierarchical concepts array and prerequisite graph.

CONCEPT HIERARCHY - Extract and classify:

1. CORE CONCEPTS (importance: 5) - Major chapter topics
   - Main learning objectives
   - Key processes and theories
   - Must-know definitions
   - Can standalone as episode (8-12 min dialogue)

2. SUPPORTING CONCEPTS (importance: 3-4) - Important details
   - Secondary definitions and terms
   - Examples and applications
   - Related processes
   - Can be combined with core concepts

3. VOCABULARY & FACTS (importance: 1-2) - Foundational knowledge
   - Technical terms
   - Quick facts and data points
   - Simple definitions
   - Should be grouped together or embedded in other concepts

For each concept include:
- id: snake_case identifier
- name: human readable name
- importance: 1-5 (5=core, 3-4=supporting, 1-2=vocabulary/facts)
- groupable: true|false (can this be combined with other concepts?)
- type: definition|process|formula|example|application|vocabulary|fact
- difficulty: easy|medium|hard (grade-appropriate)
- blooms: remember|understand|apply|analyze|evaluate|create
- source_excerpt: reference like "p3:lines 1-7"
- related: array of prerequisite concept ids
- parent_concept: id of parent concept (if this is a supporting detail)
- definition: clear explanation
- estimated_minutes: 2-12 (dialogue time needed)

Create a concept graph showing prerequisite relationships.
Ensure comprehensive coverage but smart grouping for episode planning.
Grade {grade_band} appropriate for {subject}.

Chapter content:
{content}

Return valid JSON only:
{{
  "concepts": [
    {{
      "id": "photosynthesis",
      "name": "Photosynthesis Process", 
      "importance": 5,
      "groupable": false,
      "type": "process",
      "difficulty": "medium",
      "blooms": "understand",
      "source_excerpt": "line_15",
      "related": ["chlorophyll"],
      "parent_concept": null,
      "definition": "Process by which plants make food using sunlight",
      "estimated_minutes": 10
    }},
    {{
      "id": "chlorophyll",
      "name": "Chlorophyll",
      "importance": 2,
      "groupable": true,
      "type": "vocabulary",
      "difficulty": "easy",
      "blooms": "remember",
      "source_excerpt": "line_8",
      "related": [],
      "parent_concept": "photosynthesis",
      "definition": "Green pigment in plants",
      "estimated_minutes": 2
    }}
  ],
  "graph": [["chlorophyll", "photosynthesis"]]
}}
""",

    "episode_script": """
SYSTEM: You are an expert K-12 educational dialogue writer creating engaging peer-to-peer conversations between two friends discussing what they're learning.

CORE MISSION: Create a natural, conversational podcast-style dialogue where two curious students explore and teach each other educational concepts through friendly discussion.

SPEAKERS:
- {speaker1_name} ({speaker1_personality}): The more confident friend who often explains concepts
- {speaker2_name} ({speaker2_personality}): The curious friend who asks great questions and relates concepts to real life
- CRITICAL: Use ONLY these exact names. Never use "StudentA" or "StudentB"

DIALOGUE STYLE REQUIREMENTS:
1. **Natural Conversation**: Write how real Grade {grade_band} students actually talk to each other
   - Use contractions ("it's", "that's", "we're") naturally
   - Include verbal thinking ("hmm", "oh!", "wait", "interesting!")
   - Let them interrupt, build on each other's ideas, use examples from their lives
   - Grade 1-3: Simple sentences, everyday examples, lots of enthusiasm
   - Grade 4-6: More complex ideas but still playful, relatable examples
   - Grade 7-9: Deeper reasoning, real-world connections, some technical terms
   - Grade 10-12: Analytical discussion, academic vocabulary, complex applications

2. **Engaging Hooks**: Start with something that immediately grabs attention
   - Personal story, surprising fact, relatable problem, or intriguing question
   - Make them WANT to keep listening

3. **Concept Coverage**: MUST cover ALL these concepts thoroughly: {concepts}
   - Don't just mention concepts - actually explain them through dialogue
   - Use examples, analogies, and real-world applications
   - Build from simple to complex
   - Connect concepts to each other naturally

4. **Interactive Elements**:
   - {speaker2_name} asks "why?" and "how?" questions that students would actually wonder
   - Use analogies and comparisons ("it's like...", "imagine if...")
   - Include mini "aha!" moments where concepts click
   - Relate to students' everyday experiences

STRUCTURE (8-12 minutes, 500-1100 words):
- **Hook** (10-20s): Grab attention with something surprising or relatable
- **Core1** (2-3 min): Introduce and explore first main concept(s)
- **Micro-Example** (≤30s): Quick concrete example to solidify understanding
- **Core2** (3-4 min): Develop deeper understanding or additional concepts
- **Recall-Break** (30-45s): Quick review through conversational recap
- **Mini-Summary** (≤30s): Natural wrap-up that ties concepts together

GRADE-APPROPRIATE LANGUAGE:
- Grade 1-3: 50-100 words per minute, 3-6 word sentences, concrete examples (pets, toys, family)
- Grade 4-6: 100-150 words per minute, varied sentence length, school/hobby examples
- Grade 7-9: 150-180 words per minute, introduce technical terms with explanations
- Grade 10-12: 180-200 words per minute, academic vocabulary, abstract concepts OK

SOURCE ALIGNMENT (CRITICAL):
- Every factual claim needs source_reference: "p[page]:lines [start]-[end]" or "block_[id]"
- If inferring or simplifying, mark "inferred": true and use soft language ("scientists think", "it seems like")
- Never state uncertain facts with high confidence

WHAT TO AVOID:
- Teacher/narrator voice or formal lecture style
- Robotic back-and-forth (let conversations flow naturally)
- Just reading facts - make it a real discussion
- Skipping concepts or only mentioning them briefly
- Age-inappropriate vocabulary or examples
- Boring textbook language

Episode: {episode_title}
Duration: {duration_minutes} minutes
Grade: {grade_band}
Concepts to fully cover: {concepts}
Source: {chapter_content}

Return ONLY valid JSON:
{{
  "episode_index": 1,
  "title": "{episode_title}",
  "estimated_duration_seconds": {duration_seconds},
  "word_count": 720,
  "grade_level": {grade_band},
  "style_lock": "style_v1.json",
  "sections": [
    {{
      "id": "hook",
      "start": 0,
      "end": 18,
      "type": "hook",
      "text": "{speaker1_name}: [Natural, engaging opening that hooks the listener]\\n{speaker2_name}: [Curious response that sets up the topic]",
      "source_reference": "p1:lines 1-5",
      "concepts_covered": ["concept_id"]
    }},
    {{
      "id": "core1",
      "start": 18,
      "end": 180,
      "type": "core",
      "text": "[Actual conversation with both speakers exploring concepts naturally]",
      "source_reference": "p2:lines 10-25",
      "concepts_covered": ["concept_id1", "concept_id2"]
    }}
  ],
  "concept_ids": {concept_ids},
  "concepts_coverage_check": {{"concept_id": "fully_explained"}},
  "pronunciation_hints": {{"difficult_word": "pronunciation"}},
  "age_appropriate_check": true
}}
""",

    "mcq_generation": """
SYSTEM: You are an MCQ generator for educational content. Generate high-quality, thoughtful questions that test understanding, not trivial recall.
INPUT: final_script, concept_list, episode_duration
RULES:
- Generate EXACTLY {count} MCQs strictly from script content
- 4 options each, exactly 1 correct
- Include timestamp_ref pointing to section start seconds  
- Types: 20% recall (basic facts), 40% understanding (concepts), 40% application (real-world scenarios)
- Plausible distractors from common student misconceptions
- Grade-appropriate language
- Each MCQ must reference substantial content from the script, not trivial details
- Focus on WHY and HOW questions, not just WHAT questions
- Use speaker names from script: {speaker1_name} and {speaker2_name}
- Avoid questions about speaker names themselves or literal phrases

AVOID:
- Questions like "According to the script, what term is used..."
- Questions that test only memorization of specific phrases
- Questions about who said what
- Trivial literal recall

PREFER:
- Questions that test conceptual understanding
- Application to new scenarios
- Analysis and reasoning
- Making connections between concepts

Script: {script}
Concepts: {concepts}
Speakers: {speaker1_name}, {speaker2_name}

Return valid JSON only:
{{
  "mcqs": [
    {{
      "qid": "q1",
      "timestamp_ref": 45,
      "concept_id": "photosynthesis",
      "difficulty": 3,
      "type": "understanding",
      "question_text": "Based on the conversation, why do plants need sunlight for photosynthesis?",
      "options": [
        "Sunlight provides energy to convert water and CO2 into glucose",
        "Sunlight heats the plant to make it grow faster", 
        "Sunlight attracts insects that help plants",
        "Sunlight changes the color of leaves to green"
      ],
      "correct_index": 0,
      "explanation": "{speaker1_name} explained that sunlight provides the energy plants need to convert water and carbon dioxide into glucose during photosynthesis."
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
        provider_pref = (request.metadata or {}).get('llm_provider', None)
        provider_override = provider_pref if provider_pref in ("openai", "gemini") else None
        provider_name = (provider_override or (CURRENT_PROVIDER or LLM_PROVIDER)).upper()
        logger.info(f"Extracting concepts for {request.metadata.get('subject', 'unknown')} content using {provider_name}")
        
        prompt = EDUCATIONAL_PROMPTS["concept_extraction"].format(
            content=request.markdown_content[:5000],  # Limit content size
            grade_band=request.metadata.get("grade_band", "7"),
            subject=request.metadata.get("subject", "general")
        )

        response_text = await generate_with_llm(prompt, temperature=0.3, max_tokens=4000, json_mode=True, provider_override=provider_override)

        # Parse and validate response
        result = json.loads(response_text)
        
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
        provider_pref = getattr(request, 'llm_provider', None)
        provider_override = provider_pref if provider_pref in ("openai", "gemini") else None
        provider_name = (provider_override or (CURRENT_PROVIDER or LLM_PROVIDER)).upper()
        logger.info(f"Generating script for episode: {request.episode_title} using {provider_name}")
        
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

        response_text = await generate_with_llm(prompt, temperature=0.4, max_tokens=3000, json_mode=True, provider_override=provider_override)

        result = json.loads(response_text)
        
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
        provider_pref = getattr(request, 'llm_provider', None)
        provider_override = provider_pref if provider_pref in ("openai", "gemini") else None
        provider_name = (provider_override or (CURRENT_PROVIDER or LLM_PROVIDER)).upper()
        logger.info(f"Generating {request.count} MCQs using {provider_name}")
        
        script_text = ""
        if isinstance(request.script, dict):
            # Extract text from sections
            sections = request.script.get('sections', [])
            script_text = "\\n".join([section.get('text', '') for section in sections])
        else:
            script_text = str(request.script)

        concept_names = [c.get('name', c.get('id', 'Unknown')) for c in request.concepts]
        
        # Get speaker names from request or use defaults
        speaker_config = getattr(request, 'speaker_config', {})
        speaker1_name = speaker_config.get('speaker1_name', 'StudentA')
        speaker2_name = speaker_config.get('speaker2_name', 'StudentB')

        prompt = EDUCATIONAL_PROMPTS["mcq_generation"].format(
            count=request.count,
            script=script_text[:2000],  # Limit script size
            concepts=concept_names,
            speaker1_name=speaker1_name,
            speaker2_name=speaker2_name
        )

        response_text = await generate_with_llm(prompt, temperature=0.3, max_tokens=2000, json_mode=True, provider_override=provider_override)

        result = json.loads(response_text)
        
        if not result.get("mcqs"):
            raise ValueError("MCQ generation failed - no questions created")
        
        # Ensure we have at least the requested count
        if len(result['mcqs']) < request.count:
            logger.warning(f"Generated {len(result['mcqs'])} MCQs, requested {request.count}")

        logger.info(f"Successfully generated {len(result['mcqs'])} MCQs")
        return result

    except Exception as e:
        logger.error(f"MCQ generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"MCQ generation failed: {str(e)}")

@app.post("/regenerate")
async def regenerate_content(request: RegenerationRequest):
    """Handle content regeneration using specific prompts per MIGRATION.md"""
    try:
        prompt_type = request.prompt_type.lower()
        
        if prompt_type not in REGENERATION_PROMPTS:
            raise HTTPException(status_code=400, detail=f"Unknown regeneration prompt type: {prompt_type}")

        provider_pref = getattr(request, 'llm_provider', None)
        provider_override = provider_pref if provider_pref in ("openai", "gemini") else None
        provider_name = (provider_override or (CURRENT_PROVIDER or LLM_PROVIDER)).upper()
        logger.info(f"Running regeneration prompt: {prompt_type} using {provider_name}")
        
        # Get the appropriate regeneration prompt
        base_prompt = REGENERATION_PROMPTS[prompt_type]
        
        # Format prompt with input data
        formatted_prompt = base_prompt + "\\n\\nINPUT DATA:\\n" + json.dumps(request.input_data, indent=2)
        
        # Generate with deterministic settings for regeneration (temperature=0.0)
        response_text = await generate_with_llm(formatted_prompt, temperature=request.temperature, max_tokens=3000, json_mode=True, provider_override=provider_override)

        # Parse response
        try:
            result = json.loads(response_text)
        except json.JSONDecodeError:
            # Fallback if JSON parsing fails
            result = {"regenerated_content": response_text, "success": False}

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
    
    # Print startup information
    print("\n" + "="*60)
    print("🚀 K-12 Educational Content Pipeline - Backend Service")
    print("="*60)
    print(f"📡 Backend API:     http://127.0.0.1:8000")
    print(f"📚 API Docs:        http://127.0.0.1:8000/docs")
    print(f"🔧 Health Check:    http://127.0.0.1:8000/health")
    print("\n🌐 FRONTEND INTERFACES:")
    print(f"   📤 Upload:       http://localhost:3002/teacher/upload.html")
    print(f"   🎤 Voice Config: http://localhost:3002/teacher/voice-config.html")
    print(f"   🧪 Voice Test:   http://localhost:3002/teacher/voice-test.html")
    print(f"   📝 Review:       http://localhost:3002/teacher/review.html")
    print("\n💡 LLM Provider: " + LLM_PROVIDER.upper())
    if LLM_PROVIDER == "auto":
        print(f"   Primary:   {CURRENT_PROVIDER.upper() if CURRENT_PROVIDER else 'None'}")
        print(f"   Fallback:  {FALLBACK_PROVIDER.upper() if FALLBACK_PROVIDER else 'None'}")
    print("="*60 + "\n")
    
    uvicorn.run(app, host="127.0.0.1", port=8000)