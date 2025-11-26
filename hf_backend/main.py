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

# In-memory log storage for web UI (last 500 logs)
from collections import deque
from datetime import datetime

class LogHandler(logging.Handler):
    """Custom handler to capture logs for web UI"""
    def __init__(self, maxlen=500):
        super().__init__()
        self.logs = deque(maxlen=maxlen)
    
    def emit(self, record):
        log_entry = {
            'timestamp': datetime.fromtimestamp(record.created).isoformat(),
            'level': record.levelname,
            'source': record.name,
            'message': self.format(record),
            'module': record.module,
            'funcName': record.funcName
        }
        self.logs.append(log_entry)

# Add custom handler to logger
web_log_handler = LogHandler(maxlen=500)
web_log_handler.setFormatter(logging.Formatter('%(message)s'))
logging.getLogger().addHandler(web_log_handler)

# Job tracking (for monitoring active requests)
active_jobs = {}
job_history = deque(maxlen=100)

def create_job_id(task_type: str, data: Dict) -> str:
    """Create unique job ID"""
    timestamp = time.time()
    data_hash = hashlib.md5(json.dumps(data, sort_keys=True).encode()).hexdigest()[:8]
    return f"{task_type}_{int(timestamp)}_{data_hash}"

def track_job(job_id: str, status: str, metadata: Dict = None):
    """Track job status"""
    job_info = {
        'id': job_id,
        'status': status,
        'timestamp': datetime.now().isoformat(),
        'metadata': metadata or {}
    }
    
    if status in ['queued', 'processing']:
        active_jobs[job_id] = job_info
    elif status in ['completed', 'failed']:
        if job_id in active_jobs:
            del active_jobs[job_id]
        job_history.append(job_info)
    
    logger.info(f"Job {job_id}: {status}")

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
            
            # Handle gpt-5.1's different parameter requirements
            is_gpt51 = "gpt-5.1" in model_name.lower() or "gpt-5" in model_name.lower()
            
            kwargs = {
                "model": model_name,
                "messages": messages,
                "temperature": temperature,
            }
            
            # gpt-5.1 uses max_completion_tokens instead of max_tokens
            if is_gpt51:
                kwargs["max_completion_tokens"] = max_tokens
            else:
                kwargs["max_tokens"] = max_tokens
            
            # gpt-5.1 doesn't support response_format in some API versions
            if json_mode and not is_gpt51:
                kwargs["response_format"] = {"type": "json_object"}
            
            logger.info(f"[OpenAI] Trying model: {model_name}")
            try:
                # Primary: chat.completions
                response = await client.chat.completions.create(**kwargs)
                return response.choices[0].message.content
            except Exception as chat_err:
                error_str = str(chat_err)
                
                # Check for rate limit (429) - skip retry and fail fast
                if "429" in error_str or "rate limit" in error_str.lower():
                    logger.warning(f"[OpenAI] {model_name} rate limited (429), skipping retry")
                    raise chat_err
                
                logger.warning(f"[OpenAI] {model_name} via chat.completions failed: {error_str[:100]}")
                # Try Responses API as fallback for this model (skip for gpt-5.1 as it's incompatible)
                if not is_gpt51:
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
                else:
                    raise chat_err  # For gpt-5.1, don't try Responses API
            
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
    target_words: Optional[int] = None  # From episode planner
    word_count_range: Optional[List[int]] = None  # [min, max] from planner
    episode_rationale: Optional[str] = None  # Why concepts grouped together
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
- common_misconceptions: array of typical student confusions about this concept (e.g., ["Students think plants eat soil for food", "Confuse weight with mass"])
- confusion_points: specific aspects that are tricky (e.g., "Difference between heat and temperature")
- prerequisite_gaps: what students need to know first (e.g., "Understanding of atoms needed before molecules")

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
      "estimated_minutes": 10,
      "common_misconceptions": [
        "Plants eat soil for food",
        "Plants only need water to grow",
        "Photosynthesis happens at night",
        "Only leaves perform photosynthesis"
      ],
      "confusion_points": "Difference between making food (photosynthesis) vs getting water/nutrients from soil",
      "prerequisite_gaps": "Students may not understand chemical reactions or energy transformation"
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
      "estimated_minutes": 2,
      "common_misconceptions": [
        "Chlorophyll is plant food",
        "All plants have the same amount of chlorophyll"
      ],
      "confusion_points": "Role of chlorophyll in capturing light vs being the food itself",
      "prerequisite_gaps": "Understanding of pigments and light absorption"
    }}
  ],
  "graph": [["chlorophyll", "photosynthesis"]]
}}
""",

    "episode_script": """
SYSTEM: You are an expert K-12 educational dialogue writer creating authentic peer-to-peer conversations between two students learning together.

CORE MISSION: Write a natural, flowing conversation where two curious students explore concepts together through genuine discussion. This should sound like real students talking, not actors reading a script.

SPEAKERS:
- {speaker1_name}: Student who often explains concepts clearly
- {speaker2_name}: Student who asks insightful questions and makes connections
- CRITICAL: Use ONLY these exact names. Never use "StudentA" or "StudentB"

CONVERSATIONAL PRINCIPLES (NO RIGID STRUCTURE):

1. **Authentic Dialogue Flow**:
   - Write how real Grade {grade_band} students naturally talk and think aloud
   - Let conversations develop organically - ideas should build, circle back, and connect naturally
   - Allow students to interrupt with questions, make connections mid-thought, go "oh wait!" when they realize something
   - Use natural speech patterns: contractions, verbal thinking ("hmm", "oh!", "wait", "interesting!"), sentence fragments
   - Let enthusiasm show naturally - students get excited when they understand something
   
2. **Natural Progression** (NOT a template to follow):
   - Start wherever feels natural - a question, an observation, something surprising, a connection to their lives
   - Explore concepts through genuine curiosity, not forced "sections"
   - Let understanding build gradually through back-and-forth discussion
   - Allow tangents if they help understanding, but return to core concepts
   - End when the conversation naturally concludes, not when a timer says to
   
3. **Genuine Student Thinking**:
   - {speaker2_name} asks real questions students would wonder about ("but why...", "what if...", "how does...")
   - Both students make connections to things they know ("oh, like when...", "that's kind of like...")
   - Include moments of confusion and clarification ("wait, I'm confused about...", "oh, so you mean...")
   - Use analogies that students would naturally think of from their own experiences
   - Let "aha moments" emerge naturally from the dialogue

4. **Age-Appropriate Expression**:
   - Grade 1-3: Short sentences, simple words, lots of enthusiasm, concrete examples from daily life (pets, family, playground)
   - Grade 4-6: More complex sentences, some technical terms explained simply, relatable examples (school, hobbies, friendships)
   - Grade 7-9: Deeper reasoning, thoughtful questions, real-world connections, technical terms with context
   - Grade 10-12: Analytical thinking, academic vocabulary used naturally, abstract concepts explored thoroughly

TARGET GUIDELINES (STRICT REQUIREMENTS):
- Duration: {duration_minutes} minutes of natural conversation
- Word count: MINIMUM {min_words} words, TARGET {target_words} words (based on 150 words/minute speaking pace)
- Speaking pace varies naturally - students slow down for complex ideas, speed up when excited
- MUST thoroughly cover ALL assigned concepts - this is not optional
- Use concrete examples to ensure deep understanding

CONCEPT COVERAGE: MUST thoroughly explain all these concepts: {concepts}
- Don't just mention - actually explain through natural dialogue
- Build understanding gradually through questions and discussion
- Connect concepts to each other and to real-world experience
- Use examples, analogies, and applications that students would actually think of

SOURCE ALIGNMENT (CRITICAL):
- Every factual claim MUST have source_reference: "p[page]:lines [start]-[end]" or "block_[id]"
- If making logical inferences or simplifying for grade level, mark "inferred": true and use tentative language ("scientists think", "it seems like", "probably")
- NEVER state uncertain facts with high confidence - always hedge appropriately

WHAT MAKES DIALOGUE SOUND ROBOTIC (AVOID):
- Alternating speakers mechanically every sentence
- Following a rigid pattern (introduce → define → example → recap)
- Using formal transitions ("Now let's move on to...", "In conclusion...")
- Asking setup questions that only exist to prompt the next speaker ("So what is photosynthesis?")
- Teaching voice or narrator mode
- Textbook language read aloud
- Forced "aha moments" that feel scripted

WHAT MAKES DIALOGUE SOUND NATURAL (DO THIS):
- Let one student talk for several sentences when explaining something complex
- Interrupt naturally with quick questions or reactions
- Circle back to earlier points when making connections
- Use filler words and thinking sounds appropriately ("um", "like", "you know")
- Make mistakes and correct them in conversation
- Show genuine reactions to learning something new
- Build ideas collaboratively across multiple exchanges

Episode: {episode_title}
Duration: {duration_minutes} minutes
Grade: {grade_band}
Concepts to fully cover: {concepts}
Source: {chapter_content}

Return ONLY valid JSON with organic sections (NOT rigid types):
{{
  "episode_index": 1,
  "title": "{episode_title}",
  "estimated_duration_seconds": {duration_seconds},
  "word_count": 720,
  "grade_level": {grade_band},
  "style_lock": "style_v1.json",
  "sections": [
    {{
      "id": "section_1",
      "start": 0,
      "end": 180,
      "type": "dialogue",
      "text": "{speaker1_name}: [Natural conversation line]\\n{speaker2_name}: [Natural response]\\n{speaker1_name}: [Continues thought...]",
      "source_reference": "p1:lines 1-15",
      "concepts_covered": ["concept_id1", "concept_id2"],
      "dialogue_quality_notes": "Natural flow, authentic student voice, builds understanding gradually"
    }},
    {{
      "id": "section_2",
      "start": 180,
      "end": 420,
      "type": "dialogue",
      "text": "[Continue natural conversation exploring concepts]",
      "source_reference": "p2:lines 10-30",
      "concepts_covered": ["concept_id3"],
      "dialogue_quality_notes": "Includes student questions, connections, aha moments"
    }}
  ],
  "concept_ids": {concept_ids},
  "concepts_coverage_check": {{"concept_id": "fully_explained"}},
  "pronunciation_hints": {{"difficult_word": "pronunciation"}},
  "age_appropriate_check": true,
  "dialogue_naturalness_score": 9,
  "vocabulary_level_appropriate": true
}}
""",

    "mcq_generation": """
SYSTEM: You are an expert MCQ generator for K-12 education. Create questions that test genuine understanding and thinking, never trivial recall.

CRITICAL RULES:
1. ABSOLUTELY BANNED phrases in questions:
   - "According to the script..."
   - "What did [speaker name] say..."
   - "In the conversation..."
   - "The students mentioned..."
   - Any phrasing that asks students to recall literal dialogue

2. QUESTION REQUIREMENTS:
   - Test conceptual understanding (why/how something works)
   - Require thinking and reasoning, not memory
   - Apply concepts to NEW scenarios not in the script
   - Make students demonstrate they understand, not that they remember
   - Use grade-appropriate language and context

3. DISTRACTOR REQUIREMENTS:
   - Based on COMMON STUDENT MISCONCEPTIONS about the concept
   - Plausible enough that students who don't understand would pick them
   - Wrong for a specific conceptual reason (not just random)
   - Show understanding of how students typically get confused

4. QUESTION TYPES DISTRIBUTION:
   - 0% trivial recall (BANNED)
   - 30% conceptual understanding (why/how concepts work)
   - 40% application (applying concepts to new situations)
   - 30% analysis (comparing, evaluating, predicting)

GOOD EXAMPLES:
- "Why would a plant in a dark closet eventually die?" (tests photosynthesis understanding)
- "If you wanted to make ice cream freeze faster, what should you add to the ice?" (tests heat transfer application)
- "What would happen to Earth's seasons if the axis wasn't tilted?" (tests analysis)

BAD EXAMPLES (NEVER DO THIS):
- "According to the script, what is photosynthesis?" ❌
- "What did Alex say about the three states of matter?" ❌
- "The students mentioned that plants need sunlight. Why is this?" ❌

REQUIREMENTS:
- Generate EXACTLY {count} MCQs testing concepts from the script (~3 MCQs per concept)
- Cover ALL concepts provided - create multiple questions per concept for comprehensive assessment
- 4 options each, exactly 1 correct
- Include timestamp_ref pointing to when concept was discussed
- Use concept_misconceptions from concept_list to create realistic distractors
- Grade-appropriate language for {grade_band}
- Each question must require understanding, not memory

Script: {script}
Concepts with misconceptions: {concepts}
Grade: {grade_band}
Speakers: {speaker1_name}, {speaker2_name}

Return valid JSON only:
{{
  "mcqs": [
    {{
      "qid": "q1",
      "timestamp_ref": 45,
      "concept_id": "photosynthesis",
      "difficulty": 3,
      "type": "application",
      "question_text": "A student put a healthy plant in a dark closet for two weeks. What would most likely happen and why?",
      "options": [
        "The plant would die because it can't produce food without light energy",
        "The plant would grow taller trying to reach sunlight",
        "The plant would turn brown but survive by eating nutrients from soil",
        "The plant would be fine because it stores enough energy in its roots"
      ],
      "correct_index": 0,
      "explanation": "Plants need sunlight to perform photosynthesis and create their own food (glucose). Without light, they cannot produce energy and will eventually die. This is different from animals which get energy by eating food.",
      "misconception_addressed": "Plants eat soil for food"
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

    "regen_natural_dialogue": """
SYSTEM: You are a dialogue naturalness editor for K-12 educational content.
INPUT: current_script, robotic_patterns_detected (list of specific issues), grade_band
TASK: Rewrite dialogue to sound like real Grade {grade_band} students talking naturally.

FIX THESE ROBOTIC PATTERNS:
- Mechanical speaker alternation (A says one line, B says one line, repeat)
- Formal transitions ("Now let's discuss...", "Moving on to...", "In conclusion...")
- Setup questions that only exist to prompt next speaker ("So what is X?", "Can you explain Y?")
- Textbook language read aloud
- Forced structure (intro-body-conclusion)
- Unnatural formality for student age

MAKE IT NATURAL:
- Let one speaker talk for multiple sentences when explaining something
- Use natural interruptions and reactions ("Oh!", "Wait, so...", "That makes sense!")
- Include thinking sounds ("Hmm", "Um", "Like")
- Let students make connections to their own experiences organically
- Show genuine curiosity and confusion followed by understanding
- Build ideas collaboratively across multiple exchanges
- Use contractions and informal language appropriate for age

PRESERVE:
- All factual content and source references
- Concept coverage completeness
- Word count within +/-15% of original
- Section timing estimates

OUTPUT: JSON {{script_text, sections:[...], naturalness_improvements:[list of specific changes], word_count}}
""",

    "regen_simplify_vocabulary": """
SYSTEM: You are a vocabulary simplification specialist for K-12 content.
INPUT: current_script, overly_complex_words_detected, target_grade_band, flesch_kincaid_target
TASK: Simplify vocabulary to match Grade {grade_band} reading level while preserving meaning.

GUIDELINES BY GRADE:
- Grade 1-3: 3-6 word sentences, concrete nouns, basic verbs, everyday vocabulary
- Grade 4-6: Varied sentence length, introduce some technical terms WITH simple explanations
- Grade 7-9: More complex sentences, academic vocabulary explained in context
- Grade 10-12: Advanced vocabulary appropriate for college prep

SIMPLIFICATION STRATEGIES:
- Replace complex words with simpler synonyms students know
- Break long sentences into shorter ones
- Explain technical terms using analogies and examples
- Use "like" comparisons and "for example" to clarify
- Keep explanations conversational, not dictionary definitions

PRESERVE:
- Technical terms that are learning objectives (but explain them better)
- All source references
- Conceptual accuracy
- Natural dialogue flow
- Student voice and personality

TARGET: Flesch-Kincaid Grade Level = {grade_band} +/- 1 grade

OUTPUT: JSON {{script_text, sections:[...], vocabulary_changes:[{{original_word, simplified_version, reason}}], flesch_kincaid_score, word_count}}
""",

    "regen_add_examples": """
SYSTEM: You are a concrete example generator for K-12 educational content.
INPUT: current_script, abstract_concepts_flagged (concepts lacking examples), grade_band
TASK: Add concrete, relatable examples to make abstract concepts tangible for Grade {grade_band} students.

EXAMPLE REQUIREMENTS:
- Draw from students' actual daily lives (school, home, hobbies, friends, technology they use)
- Age-appropriate and culturally relevant
- Short (20-40 seconds in dialogue)
- Integrated naturally into conversation, not forced asides
- Actually illuminate the concept, not just name-drop an example

EXAMPLE SOURCES BY GRADE:
- Grade 1-3: Toys, pets, family, playground, food, cartoons
- Grade 4-6: School activities, sports, video games, social media, cooking
- Grade 7-9: Real-world technology, current events, social situations, future careers
- Grade 10-12: Complex systems, societal issues, academic applications, career paths

INTEGRATION STYLE:
- Student naturally connects concept to their experience ("Oh, that's like when...")
- Use analogy format ("It's kind of like how...")
- Build on example to deepen understanding, don't just mention and move on
- Other student can react, extend, or relate their own example

PRESERVE:
- All existing factual content and source references
- Natural dialogue flow
- Target word count +/- 10%
- Timing estimates for sections

OUTPUT: JSON {{script_text, sections:[...], examples_added:[{{concept_id, example_description, timestamp}}], word_count}}
""",

    "regen_fix_misconceptions": """
SYSTEM: You are a misconception-addressing specialist for educational dialogue.
INPUT: current_script, misconceptions_not_addressed (from concept analysis), grade_band
TASK: Ensure common student misconceptions are explicitly addressed and corrected in the dialogue.

MISCONCEPTION ADDRESSING STRATEGIES:
- Have student voice the misconception as a genuine confusion ("Wait, I thought plants eat dirt for food?")
- Other student gently corrects with clear explanation
- Explicitly contrast correct understanding with misconception
- Use examples that highlight why the misconception is wrong
- Make the correction memorable through analogy or "aha moment"

EFFECTIVE PATTERNS:
Speaker A: "But doesn't [misconception]?"
Speaker B: "Actually, that's a common mix-up! The real thing is [correct concept]. Here's why: [explanation]"
Speaker A: "Oh! So it's not [misconception], it's [correct understanding]. That makes sense because [connection]."

WHAT NOT TO DO:
- Just state correct fact without acknowledging misconception
- Make student sound dumb for having misconception
- Rush past misconception without full explanation
- Use teacher voice to lecture about it

PRESERVE:
- Natural student dialogue style
- All source references
- Word count within +/-15%
- Other concept coverage

OUTPUT: JSON {{script_text, sections:[...], misconceptions_addressed:[{{misconception, how_addressed, timestamp}}], word_count}}
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
    job_id = None
    try:
        # Create job tracking
        job_id = create_job_id("concept_extraction", {
            "subject": request.metadata.get('subject', 'unknown'),
            "grade": request.metadata.get('grade_band', 'unknown')
        })
        track_job(job_id, "processing", {"task": "Extracting concepts", "subject": request.metadata.get('subject')})
        
        provider_pref = (request.metadata or {}).get('llm_provider', None)
        provider_override = provider_pref if provider_pref in ("openai", "gemini") else None
        provider_name = (provider_override or (CURRENT_PROVIDER or LLM_PROVIDER)).upper()
        logger.info(f"[{job_id}] Extracting concepts for {request.metadata.get('subject', 'unknown')} content using {provider_name}")
        
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

        logger.info(f"[{job_id}] Successfully extracted {len(result['concepts'])} concepts")
        track_job(job_id, "completed", {"concepts_count": len(result['concepts'])})
        return result

    except Exception as e:
        logger.error(f"[{job_id}] Concept extraction failed: {str(e)}")
        if job_id:
            track_job(job_id, "failed", {"error": str(e)})
        raise HTTPException(status_code=500, detail=f"Concept extraction failed: {str(e)}")

def validate_script(script_data: Dict[str, Any], min_words: int, max_words: int, concept_names: List[str], grade_band: str) -> tuple[bool, List[str]]:
    """
    Validate generated script for quality and completeness
    
    Returns: (is_valid, list_of_errors)
    """
    errors = []
    
    # Check required fields
    if not script_data.get("sections"):
        errors.append("Script missing 'sections' field")
        return False, errors
    
    sections = script_data["sections"]
    
    if len(sections) == 0:
        errors.append("Script has no sections")
        return False, errors
    
    # Count total words
    total_words = 0
    for section in sections:
        text = section.get("text", "")
        if text:
            total_words += len(text.split())
    
    # Word count validation
    if total_words < min_words:
        shortage = min_words - total_words
        shortage_pct = int((shortage / min_words) * 100)
        errors.append(f"Script too short: {total_words} words (need {min_words}-{max_words}). SHORT BY {shortage} words ({shortage_pct}%). MUST write more content to meet target duration.")
    elif total_words > max_words:
        excess = total_words - max_words
        excess_pct = int((excess / max_words) * 100)
        errors.append(f"Script too long: {total_words} words (need {min_words}-{max_words}). EXCEEDED BY {excess} words ({excess_pct}%). MUST reduce content.")
    
    # Concept coverage validation
    script_text = " ".join([s.get("text", "") for s in sections]).lower()
    uncovered_concepts = []
    
    for concept_name in concept_names:
        if concept_name.lower() not in script_text:
            uncovered_concepts.append(concept_name)
    
    if uncovered_concepts:
        errors.append(f"Concepts not covered in script: {', '.join(uncovered_concepts)}. MUST include explanations for ALL concepts.")
    
    # Section structure validation
    if len(sections) < 3:
        errors.append(f"Script has only {len(sections)} sections. Educational scripts should have at least 3 sections (introduction, main content, conclusion).")
    
    # Check for speaker dialogue (educational requirement)
    has_dialogue = any(section.get("speaker") for section in sections)
    if not has_dialogue:
        errors.append("Script has no speaker assignments. Educational scripts should be dialogues between speakers.")
    
    # Reading level check (simple heuristic)
    grade = int(grade_band.split('-')[0]) if '-' in grade_band else int(grade_band or 7)
    avg_word_length = sum(len(word) for section in sections for word in section.get("text", "").split()) / max(total_words, 1)
    
    # Very rough grade level check
    if grade <= 5 and avg_word_length > 6:
        errors.append(f"Language may be too complex for grade {grade}. Average word length: {avg_word_length:.1f} letters (should be < 6 for elementary).")
    elif grade <= 8 and avg_word_length > 7:
        errors.append(f"Language may be too complex for grade {grade}. Average word length: {avg_word_length:.1f} letters (should be < 7 for middle school).")
    
    is_valid = len(errors) == 0
    
    return is_valid, errors

@app.post("/generate_script")
async def generate_script(request: ScriptGenerationRequest):
    """Generate educational script per MIGRATION.md requirements"""
    job_id = None
    try:
        # Create job tracking
        job_id = create_job_id("script_generation", {
            "episode": request.episode_title,
            "grade": request.grade
        })
        track_job(job_id, "processing", {"task": "Generating script", "episode": request.episode_title})
        
        provider_pref = getattr(request, 'llm_provider', None)
        provider_override = provider_pref if provider_pref in ("openai", "gemini") else None
        provider_name = (provider_override or (CURRENT_PROVIDER or LLM_PROVIDER)).upper()
        logger.info(f"[{job_id}] Generating script for episode: {request.episode_title} using {provider_name}")
        
        concept_names = [c.get('name', c.get('id', 'Unknown')) for c in request.concepts]
        concept_ids = [c.get('id', 'unknown') for c in request.concepts]
        duration_seconds = request.duration_minutes * 60
        
        # Use target_words from episode planner if provided, otherwise calculate
        if hasattr(request, 'target_words') and request.target_words:
            target_words = request.target_words
            if hasattr(request, 'word_count_range') and request.word_count_range and len(request.word_count_range) == 2:
                min_words = request.word_count_range[0]
                max_words = request.word_count_range[1]
            else:
                min_words = int(target_words * 0.85)
                max_words = int(target_words * 1.15)
        else:
            # Fallback: calculate from duration (150 words/minute speaking pace)
            target_words = int(request.duration_minutes * 150)
            min_words = int(target_words * 0.85)
            max_words = int(target_words * 1.15)

        # Get speaker configuration with defaults
        speaker_config = request.speaker_config or {}
        speaker1_name = speaker_config.get('speaker1_name', 'StudentA')
        speaker2_name = speaker_config.get('speaker2_name', 'StudentB')
        speaker1_personality = speaker_config.get('speaker1_personality', 'confident')
        speaker2_personality = speaker_config.get('speaker2_personality', 'curious')

        # Add episode rationale context if provided by planner
        episode_context = ""
        if hasattr(request, 'episode_rationale') and request.episode_rationale:
            episode_context = f"\n\nPLANNING CONTEXT:\nThese concepts were grouped together because: {request.episode_rationale}\nEnsure your dialogue flows naturally given this pedagogical reasoning.\n"
        
        prompt = EDUCATIONAL_PROMPTS["episode_script"].format(
            concepts=concept_names,
            episode_title=request.episode_title,
            grade_band=request.grade,
            duration_minutes=request.duration_minutes,
            duration_seconds=duration_seconds,
            target_words=target_words,
            min_words=min_words,
            max_words=max_words,
            concept_ids=concept_ids,
            chapter_content=request.source_content[:3000],
            speaker1_name=speaker1_name,
            speaker2_name=speaker2_name,
            speaker1_personality=speaker1_personality,
            speaker2_personality=speaker2_personality
        ) + episode_context

        # Generate script with validation retry loop (max 2 attempts)
        max_attempts = 2
        validation_errors = []
        
        for attempt in range(1, max_attempts + 1):
            logger.info(f"[{job_id}] Script generation attempt {attempt}/{max_attempts}")
            
            # Add feedback from previous attempt if retrying
            attempt_prompt = prompt
            if attempt > 1 and validation_errors:
                feedback = "\\n\\nPREVIOUS ATTEMPT FAILED WITH THESE ISSUES:\\n" + "\\n".join(validation_errors)
                feedback += "\\n\\nPLEASE FIX THESE ISSUES IN THIS ATTEMPT."
                attempt_prompt = prompt + feedback
            
            response_text = await generate_with_llm(attempt_prompt, temperature=0.4, max_tokens=3000, json_mode=True, provider_override=provider_override)
            result = json.loads(response_text)
            
            # Validate script
            is_valid, errors = validate_script(
                result, 
                min_words, 
                max_words, 
                concept_names,
                request.grade
            )
            
            if is_valid:
                logger.info(f"[{job_id}] Script validation passed on attempt {attempt}")
                logger.info(f"[{job_id}] Successfully generated script with {len(result['sections'])} sections")
                track_job(job_id, "completed", {"sections_count": len(result['sections']), "attempts": attempt})
                return {"script": result, "validation": {"passed": True, "attempts": attempt}}
            else:
                validation_errors = errors
                logger.warning(f"[{job_id}] Script validation failed on attempt {attempt}: {errors}")
                
                if attempt < max_attempts:
                    logger.info(f"[{job_id}] Retrying script generation...")
                else:
                    logger.error(f"[{job_id}] Script validation failed after {max_attempts} attempts")
                    # Return the script anyway but with validation warnings
                    track_job(job_id, "completed_with_warnings", {
                        "sections_count": len(result['sections']),
                        "validation_errors": errors,
                        "attempts": attempt
                    })
                    return {
                        "script": result,
                        "validation": {
                            "passed": False,
                            "errors": errors,
                            "attempts": attempt,
                            "warning": "Script generated but did not pass all validation checks"
                        }
                    }

    except Exception as e:
        logger.error(f"[{job_id}] Script generation failed: {str(e)}")
        if job_id:
            track_job(job_id, "failed", {"error": str(e)})
        raise HTTPException(status_code=500, detail=f"Script generation failed: {str(e)}")

@app.post("/generate_mcqs")
async def generate_mcqs(request: MCQGenerationRequest):
    """Generate MCQs from script content per MIGRATION.md"""
    job_id = None
    try:
        # Create job tracking
        job_id = create_job_id("mcq_generation", {
            "count": request.count
        })
        track_job(job_id, "processing", {"task": "Generating MCQs", "count": request.count})
        
        provider_pref = getattr(request, 'llm_provider', None)
        provider_override = provider_pref if provider_pref in ("openai", "gemini") else None
        provider_name = (provider_override or (CURRENT_PROVIDER or LLM_PROVIDER)).upper()
        logger.info(f"[{job_id}] Generating {request.count} MCQs using {provider_name}")
        
        script_text = ""
        if isinstance(request.script, dict):
            # Extract text from sections
            sections = request.script.get('sections', [])
            script_text = "\\n".join([section.get('text', '') for section in sections])
        else:
            script_text = str(request.script)

        # Format concepts with misconceptions for MCQ generation
        concepts_with_misconceptions = []
        for concept in request.concepts:
            concept_info = {
                'id': concept.get('id', 'unknown'),
                'name': concept.get('name', concept.get('id', 'Unknown')),
                'misconceptions': concept.get('common_misconceptions', []),
                'definition': concept.get('definition', '')
            }
            concepts_with_misconceptions.append(concept_info)
        
        # Serialize concepts as JSON string for prompt
        concepts_json = json.dumps(concepts_with_misconceptions, indent=2)
        
        # Get speaker names from request or use defaults
        speaker_config = getattr(request, 'speaker_config', {})
        speaker1_name = speaker_config.get('speaker1_name', 'StudentA')
        speaker2_name = speaker_config.get('speaker2_name', 'StudentB')
        
        # Get grade band for age-appropriate questions
        grade_band = getattr(request, 'grade_band', '7')

        prompt = EDUCATIONAL_PROMPTS["mcq_generation"].format(
            count=request.count,
            script=script_text[:2000],  # Limit script size
            concepts=concepts_json,
            grade_band=grade_band,
            speaker1_name=speaker1_name,
            speaker2_name=speaker2_name
        )

        response_text = await generate_with_llm(prompt, temperature=0.3, max_tokens=2000, json_mode=True, provider_override=provider_override)

        result = json.loads(response_text)
        
        if not result.get("mcqs"):
            raise ValueError("MCQ generation failed - no questions created")
        
        # Ensure we have at least the requested count
        if len(result['mcqs']) < request.count:
            logger.warning(f"[{job_id}] Generated {len(result['mcqs'])} MCQs, requested {request.count}")

        logger.info(f"[{job_id}] Successfully generated {len(result['mcqs'])} MCQs")
        track_job(job_id, "completed", {"mcqs_count": len(result['mcqs'])})
        return result

    except Exception as e:
        logger.error(f"[{job_id}] MCQ generation failed: {str(e)}")
        if job_id:
            track_job(job_id, "failed", {"error": str(e)})
        raise HTTPException(status_code=500, detail=f"MCQ generation failed: {str(e)}")

@app.post("/regenerate")
async def regenerate_content(request: RegenerationRequest):
    """Handle content regeneration using specific prompts per MIGRATION.md"""
    job_id = None
    try:
        prompt_type = request.prompt_type.lower()
        
        if prompt_type not in REGENERATION_PROMPTS:
            raise HTTPException(status_code=400, detail=f"Unknown regeneration prompt type: {prompt_type}")

        # Create job tracking
        job_id = create_job_id("regenerate", {"prompt_type": prompt_type})
        track_job(job_id, "processing", {"task": f"Regenerating: {prompt_type}"})

        provider_pref = getattr(request, 'llm_provider', None)
        provider_override = provider_pref if provider_pref in ("openai", "gemini") else None
        provider_name = (provider_override or (CURRENT_PROVIDER or LLM_PROVIDER)).upper()
        logger.info(f"[{job_id}] Running regeneration prompt: {prompt_type} using {provider_name}")
        
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
            "generation_version": "content_pipeline_v2_multi_llm"
        }

        logger.info(f"[{job_id}] Successfully completed regeneration: {prompt_type}")
        track_job(job_id, "completed", {"prompt_type": prompt_type})
        return result

    except Exception as e:
        logger.error(f"[{job_id}] Regeneration failed for {request.prompt_type}: {str(e)}")
        if job_id:
            track_job(job_id, "failed", {"error": str(e)})
        raise HTTPException(status_code=500, detail=f"Regeneration failed: {str(e)}")

@app.post("/analyze_chapter")
async def analyze_chapter(request: ChapterAnalysisRequest):
    """Complete chapter analysis per MIGRATION.md requirements"""
    job_id = None
    try:
        # Create job tracking
        job_id = create_job_id("chapter_analysis", {
            "chapter_id": request.metadata.get("chapter_id", "unknown")
        })
        track_job(job_id, "processing", {"task": "Analyzing chapter", "chapter": request.metadata.get("chapter_id")})
        
        logger.info(f"[{job_id}] Starting chapter analysis")
        
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
        
        logger.info(f"[{job_id}] Chapter analysis completed successfully")
        track_job(job_id, "completed", {"concepts_found": len(result.get("concepts", []))})
        return result

    except Exception as e:
        logger.error(f"[{job_id}] Chapter analysis failed: {str(e)}")
        if job_id:
            track_job(job_id, "failed", {"error": str(e)})
        raise HTTPException(status_code=500, detail=f"Chapter analysis failed: {str(e)}")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        openai_configured = bool(os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_API_KEY").strip())
        gemini_configured = bool(os.getenv("GEMINI_API_KEY") and os.getenv("GEMINI_API_KEY").strip())
        
        return {
            "status": "healthy",
            "llm_provider": LLM_PROVIDER,
            "current_provider": CURRENT_PROVIDER,
            "fallback_provider": FALLBACK_PROVIDER,
            "openai_configured": openai_configured,
            "gemini_configured": gemini_configured,
            "timestamp": time.time(),
            "version": "content_pipeline_v2_multi_llm",
            "regeneration_prompts_count": len(REGENERATION_PROMPTS)
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return {
            "status": "degraded",
            "error": str(e),
            "timestamp": time.time()
        }

@app.get("/regeneration_prompts")
async def list_regeneration_prompts():
    """List all available regeneration prompts"""
    return {
        "prompts": list(REGENERATION_PROMPTS.keys()),
        "count": len(REGENERATION_PROMPTS),
        "migration_md_compliance": "all_13_prompts_implemented"
    }

@app.get("/api/v1/logs")
async def get_logs(limit: int = 500):
    """Get recent system logs for web UI"""
    try:
        logs_list = list(web_log_handler.logs)
        # Return most recent first
        logs_list.reverse()
        return {
            "logs": logs_list[:limit],
            "total": len(logs_list)
        }
    except Exception as e:
        logger.error(f"Failed to fetch logs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/jobs")
async def get_jobs():
    """Get active jobs and recent job history"""
    try:
        active_list = list(active_jobs.values())
        history_list = list(job_history)
        history_list.reverse()  # Most recent first
        
        return {
            "jobs": active_list,
            "active_count": len(active_list),
            "history": history_list[:20],  # Last 20 completed jobs
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Failed to fetch jobs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    
    # Get frontend port from environment or use default
    frontend_port = os.getenv("PORT", "3000")
    
    # Print startup information
    print("\n" + "="*60)
    print("🚀 K-12 Educational Content Pipeline - Backend Service")
    print("="*60)
    print(f"📡 Backend API:     http://127.0.0.1:8000")
    print(f"📚 API Docs:        http://127.0.0.1:8000/docs")
    print(f"🔧 Health Check:    http://127.0.0.1:8000/health")
    print("\n🌐 FRONTEND INTERFACES:")
    print(f"   📤 Upload:       http://localhost:{frontend_port}/teacher/upload.html")
    print(f"   🎤 Voice Config: http://localhost:{frontend_port}/teacher/voice-config.html")
    print(f"   🧪 Voice Test:   http://localhost:{frontend_port}/teacher/voice-test.html")
    print(f"   📝 Review:       http://localhost:{frontend_port}/teacher/review.html")
    print(f"   📊 System Logs:  http://localhost:{frontend_port}/teacher/logs.html")
    print("\n💡 LLM Provider: " + LLM_PROVIDER.upper())
    if LLM_PROVIDER == "auto":
        print(f"   Primary:   {CURRENT_PROVIDER.upper() if CURRENT_PROVIDER else 'None'}")
        print(f"   Fallback:  {FALLBACK_PROVIDER.upper() if FALLBACK_PROVIDER else 'None'}")
    print("="*60 + "\n")
    
    uvicorn.run(app, host="127.0.0.1", port=8000)