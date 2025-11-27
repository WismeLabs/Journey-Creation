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

# Load prompts from templates directory (centralized in txt files)
# Fallback to prompts.py for prompts not yet migrated
try:
    from prompt_loader import (
        CONCEPT_EXTRACTION_BY_SUBJECT,
        SCRIPT_PROMPTS_BY_SUBJECT,
        MCQ_PROMPTS_BY_SUBJECT,
        REGENERATION_PROMPTS,
        PROMPT_VERSION as LOADED_PROMPT_VERSION
    )
    PROMPTS_SOURCE = "txt_files"
except (ImportError, FileNotFoundError) as e:
    # Fallback to old prompts.py if txt files not ready
    from prompts import (
        CONCEPT_EXTRACTION_BY_SUBJECT,
        SCRIPT_PROMPTS_BY_SUBJECT,
        MCQ_PROMPTS_BY_SUBJECT,
        REGENERATION_PROMPTS
    )
    LOADED_PROMPT_VERSION = "v2.0_legacy"
    PROMPTS_SOURCE = "prompts_py"
    print(f"WARNING: Using legacy prompts.py: {e}")

# Prompt version for cache keys
PROMPT_VERSION = LOADED_PROMPT_VERSION

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

# LLM Response Cache with versioning
CACHE_DIR = Path(__file__).resolve().parent.parent / 'cache' / 'llm_responses'
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_ENABLED = os.getenv('LLM_CACHE_ENABLED', 'true').lower() == 'true'
CACHE_TTL_DAYS = int(os.getenv('LLM_CACHE_TTL_DAYS', '7'))
PROMPT_VERSION = "v2.1"  # Increment when prompts change significantly

cache_stats = {
    'hits': 0,
    'misses': 0,
    'saves': 0
}

def get_cache_key(task_type: str, content: str, metadata: Dict, version: str = PROMPT_VERSION) -> str:
    """Generate cache key with prompt version"""
    # Include prompt version in hash to invalidate cache when prompts change
    cache_data = {
        'task': task_type,
        'content_hash': hashlib.sha256(content.encode('utf-8')).hexdigest(),
        'metadata': {k: v for k, v in metadata.items() if k in ['grade_band', 'subject', 'language']},
        'version': version
    }
    cache_string = json.dumps(cache_data, sort_keys=True)
    return hashlib.sha256(cache_string.encode('utf-8')).hexdigest()

def get_cached_response(cache_key: str) -> Optional[Dict]:
    """Retrieve cached LLM response if valid"""
    if not CACHE_ENABLED:
        return None
    
    cache_file = CACHE_DIR / f"{cache_key}.json"
    if not cache_file.exists():
        cache_stats['misses'] += 1
        return None
    
    try:
        with open(cache_file, 'r', encoding='utf-8') as f:
            cached = json.load(f)
        
        # Check TTL
        cached_time = datetime.fromisoformat(cached['timestamp'])
        age_days = (datetime.now() - cached_time).days
        
        if age_days > CACHE_TTL_DAYS:
            cache_file.unlink()  # Delete expired cache
            cache_stats['misses'] += 1
            logger.info(f"Cache expired: {cache_key} (age: {age_days} days)")
            return None
        
        cache_stats['hits'] += 1
        logger.info(f"Cache hit: {cache_key} (age: {age_days} days)")
        return cached['response']
    
    except Exception as e:
        logger.warning(f"Cache read error: {e}")
        cache_stats['misses'] += 1
        return None

def save_to_cache(cache_key: str, response: Dict):
    """Save LLM response to cache"""
    if not CACHE_ENABLED:
        return
    
    try:
        cache_file = CACHE_DIR / f"{cache_key}.json"
        cache_data = {
            'timestamp': datetime.now().isoformat(),
            'version': PROMPT_VERSION,
            'response': response
        }
        
        with open(cache_file, 'w', encoding='utf-8') as f:
            json.dump(cache_data, f, ensure_ascii=False, indent=2)
        
        cache_stats['saves'] += 1
        logger.info(f"Cached response: {cache_key}")
    
    except Exception as e:
        logger.warning(f"Cache save error: {e}")

def clear_cache(version: Optional[str] = None):
    """Clear cache files. If version specified, only clear that version."""
    cleared = 0
    try:
        for cache_file in CACHE_DIR.glob("*.json"):
            if version:
                try:
                    with open(cache_file, 'r', encoding='utf-8') as f:
                        cached = json.load(f)
                    if cached.get('version') == version:
                        cache_file.unlink()
                        cleared += 1
                except:
                    pass
            else:
                cache_file.unlink()
                cleared += 1
        
        logger.info(f"Cleared {cleared} cache files")
        return cleared
    except Exception as e:
        logger.error(f"Cache clear error: {e}")
        return 0

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
    episode_number: int  # Episode index (1-based)
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

# All prompts are now in prompts.py - imported at top of file
# CONCEPT_EXTRACTION_BY_SUBJECT, SCRIPT_PROMPTS_BY_SUBJECT, 
# MCQ_PROMPTS_BY_SUBJECT, REGENERATION_PROMPTS
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
        
        subject = request.metadata.get('subject', 'general')
        logger.info(f"[{job_id}] Extracting concepts for {subject} content using {provider_name}")
        
        # Normalize subject to category (match to supported audio-compatible subjects)
        subject_norm = subject.strip()
        subject_category = 'default'
        
        # Direct match first
        if subject_norm in CONCEPT_EXTRACTION_BY_SUBJECT:
            subject_category = subject_norm
        else:
            # Fuzzy match to supported subjects
            subject_lower = subject_norm.lower()
            if 'physic' in subject_lower:
                subject_category = 'Physics'
            elif 'chemis' in subject_lower or 'chem' in subject_lower:
                subject_category = 'Chemistry'
            elif 'bio' in subject_lower:
                subject_category = 'Biology'
            elif 'science' in subject_lower:
                subject_category = 'Science'
            elif 'social' in subject_lower:
                subject_category = 'Social Studies'
            elif 'history' in subject_lower or 'hist' in subject_lower:
                subject_category = 'History'
            elif 'geography' in subject_lower or 'geo' in subject_lower:
                subject_category = 'Geography'
            elif 'civic' in subject_lower or 'politic' in subject_lower:
                subject_category = 'Civics'
            elif 'econom' in subject_lower:
                subject_category = 'Economics'
            elif 'comput' in subject_lower or 'coding' in subject_lower or 'programming' in subject_lower or 'cs' == subject_lower:
                subject_category = 'Computer Science'
            elif 'evs' in subject_lower or 'environmental' in subject_lower:
                subject_category = 'EVS'
            # Unsupported subjects - reject explicitly
            elif 'math' in subject_lower or 'algebra' in subject_lower or 'geometry' in subject_lower:
                raise HTTPException(status_code=400, detail=f"Subject '{subject}' is not supported in audio-only format. Mathematics requires visual problem-solving.")
            elif 'english' in subject_lower or 'literature' in subject_lower or 'grammar' in subject_lower:
                raise HTTPException(status_code=400, detail=f"Subject '{subject}' is not supported in audio-only format. English/Literature requires text visibility.")
        
        # Get subject-specific prompt
        prompt_template = CONCEPT_EXTRACTION_BY_SUBJECT[subject_category]
        
        grade_band = request.metadata.get('grade_band', '7')
        
        prompt = prompt_template.format(
            content=request.markdown_content[:5000],
            subject=subject,
            grade_band=grade_band
        )
        
        logger.info(f"[{job_id}] Using '{subject_category}' extraction strategy for Grade {grade_band}")

        # Track BEFORE calling LLM
        track_job(job_id, "processing", {
            "task": "Calling LLM for concept extraction",
            "stage": "calling_llm",
            "estimated_time": "15-30 seconds"
        })
        
        response_text = await generate_with_llm(prompt, temperature=0.3, max_tokens=6000, json_mode=True, provider_override=provider_override)
        
        # Track AFTER LLM responds
        track_job(job_id, "processing", {
            "task": "Parsing LLM response",
            "stage": "parsing_response"
        })

        # Extract JSON from response (handle cases where LLM adds text before/after JSON)
        response_text = response_text.strip()
        
        # Try to find JSON object in response
        json_start = response_text.find('{')
        json_end = response_text.rfind('}') + 1
        
        if json_start >= 0 and json_end > json_start:
            json_text = response_text[json_start:json_end]
        else:
            json_text = response_text
        
        # Parse and validate response
        try:
            result = json.loads(json_text)
        except json.JSONDecodeError as je:
            logger.error(f"[{job_id}] JSON parse error. Response text: {response_text[:500]}")
            raise ValueError(f"Invalid JSON response from LLM: {str(je)}")
        
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
        
        # Get subject and route to appropriate prompt
        subject = getattr(request, 'subject', 'general')
        subject_norm = subject.strip()
        subject_category = 'default'
        
        # Match subject to category (same logic as concept extraction)
        if subject_norm in SCRIPT_PROMPTS_BY_SUBJECT:
            subject_category = subject_norm
        else:
            subject_lower = subject_norm.lower()
            if 'physic' in subject_lower:
                subject_category = 'Physics'
            elif 'chemis' in subject_lower or 'chem' in subject_lower:
                subject_category = 'Chemistry'
            elif 'bio' in subject_lower:
                subject_category = 'Biology'
            elif 'science' in subject_lower:
                subject_category = 'Science'
            elif 'algebra' in subject_lower:
                subject_category = 'Algebra'
            elif 'geometry' in subject_lower or 'geom' in subject_lower:
                subject_category = 'Geometry'
            elif 'math' in subject_lower:
                subject_category = 'Mathematics'
            elif 'literature' in subject_lower or 'lit' in subject_lower:
                subject_category = 'Literature'
            elif 'english' in subject_lower:
                subject_category = 'English'
            elif 'grammar' in subject_lower or 'language' in subject_lower:
                subject_category = 'Grammar'
            elif 'history' in subject_lower or 'hist' in subject_lower:
                subject_category = 'History'
            elif 'geography' in subject_lower or 'geo' in subject_lower:
                subject_category = 'Geography'
            elif 'civic' in subject_lower or 'politic' in subject_lower:
                subject_category = 'Civics'
            elif 'econom' in subject_lower:
                subject_category = 'Economics'
            elif 'comput' in subject_lower or 'coding' in subject_lower or 'programming' in subject_lower:
                subject_category = 'Computer Science'
        
        logger.info(f"[{job_id}] Using '{subject_category}' script generation strategy")
        
        # Get subject-specific prompt
        prompt_template = SCRIPT_PROMPTS_BY_SUBJECT[subject_category]
        
        prompt = prompt_template.format(
            concepts=concept_names,
            episode_number=request.episode_number,
            episode_title=request.episode_title,
            grade_band=request.grade,
            duration_minutes=request.duration_minutes,
            duration_seconds=duration_seconds,
            target_words=target_words,
            min_words=min_words,
            concept_ids=concept_ids,
            chapter_content=request.source_content[:3000],
            speaker1_name=speaker1_name,
            speaker2_name=speaker2_name,
            subject=subject
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
            
            # Track BEFORE calling LLM
            track_job(job_id, "processing", {
                "task": f"Calling LLM for script generation (attempt {attempt}/{max_attempts})",
                "stage": "calling_llm",
                "estimated_time": "20-40 seconds"
            })
            
            response_text = await generate_with_llm(attempt_prompt, temperature=0.4, max_tokens=3000, json_mode=True, provider_override=provider_override)
            
            # Track AFTER LLM responds
            track_job(job_id, "processing", {
                "task": "Parsing and validating script",
                "stage": "parsing_response"
            })
            
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
        
        # Get subject and route to appropriate MCQ prompt
        subject = getattr(request, 'subject', 'general')
        subject_norm = subject.strip()
        subject_category = 'default'
        
        # Match subject to category
        if subject_norm in MCQ_PROMPTS_BY_SUBJECT:
            subject_category = subject_norm
        else:
            subject_lower = subject_norm.lower()
            if 'physic' in subject_lower:
                subject_category = 'Physics'
            elif 'chemis' in subject_lower or 'chem' in subject_lower:
                subject_category = 'Chemistry'
            elif 'bio' in subject_lower:
                subject_category = 'Biology'
            elif 'science' in subject_lower:
                subject_category = 'Science'
            elif 'algebra' in subject_lower:
                subject_category = 'Algebra'
            elif 'geometry' in subject_lower or 'geom' in subject_lower:
                subject_category = 'Geometry'
            elif 'math' in subject_lower:
                subject_category = 'Mathematics'
            elif 'literature' in subject_lower or 'lit' in subject_lower:
                subject_category = 'Literature'
            elif 'english' in subject_lower:
                subject_category = 'English'
            elif 'grammar' in subject_lower or 'language' in subject_lower:
                subject_category = 'Grammar'
            elif 'history' in subject_lower or 'hist' in subject_lower:
                subject_category = 'History'
            elif 'geography' in subject_lower or 'geo' in subject_lower:
                subject_category = 'Geography'
            elif 'civic' in subject_lower or 'politic' in subject_lower:
                subject_category = 'Civics'
            elif 'econom' in subject_lower:
                subject_category = 'Economics'
            elif 'comput' in subject_lower or 'coding' in subject_lower or 'programming' in subject_lower:
                subject_category = 'Computer Science'
        
        logger.info(f"[{job_id}] Using '{subject_category}' MCQ generation strategy")
        
        # Get subject-specific MCQ prompt
        prompt_template = MCQ_PROMPTS_BY_SUBJECT[subject_category]
        
        prompt = prompt_template.format(
            count=request.count,
            concepts=concepts_json,
            grade_band=grade_band,
            subject=subject
        )

        # Track BEFORE calling LLM
        track_job(job_id, "processing", {
            "task": f"Calling LLM for MCQ generation ({request.count} questions)",
            "stage": "calling_llm",
            "estimated_time": "10-20 seconds"
        })

        response_text = await generate_with_llm(prompt, temperature=0.3, max_tokens=2000, json_mode=True, provider_override=provider_override)

        # Track AFTER LLM responds
        track_job(job_id, "processing", {
            "task": "Parsing and validating MCQs",
            "stage": "parsing_response"
        })

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
    """
    Complete chapter analysis using comprehensive educational prompt
    Returns pedagogical classification and episode planning strategy
    """
    job_id = None
    try:
        # Create job tracking
        job_id = create_job_id("chapter_analysis", {
            "chapter_id": "unknown",
            "subject": request.subject
        })
        track_job(job_id, "processing", {"task": "Analyzing chapter", "subject": request.subject})
        
        logger.info(f"[{job_id}] Starting chapter analysis for {request.subject} grade {request.grade_band}")
        
        # Check cache first
        cache_key = get_cache_key(
            "analyze_chapter",
            request.markdown_content,
            {"grade_band": request.grade_band, "subject": request.subject, "language": request.language}
        )
        
        cached_response = get_cached_response(cache_key)
        if cached_response:
            logger.info(f"[{job_id}] Returning cached chapter analysis")
            track_job(job_id, "completed", {"source": "cache"})
            return cached_response
        
        # Load chapter analysis prompt from template
        prompt_template = Path(__file__).resolve().parents[1] / 'templates' / 'prompts' / 'chapter_structure_analysis_prompt.txt'
        with open(prompt_template, 'r', encoding='utf-8') as f:
            prompt = f.read()
        
        # Replace placeholders
        prompt = prompt.replace('{grade_band}', str(request.grade_band))
        prompt = prompt.replace('{subject}', request.subject)
        prompt = prompt.replace('{content}', request.markdown_content[:6000])

        # Track BEFORE calling LLM
        track_job(job_id, "processing", {
            "task": "Calling LLM for chapter analysis",
            "stage": "calling_llm",
            "estimated_time": "15-30 seconds"
        })

        # Use LLM to analyze chapter
        response_text = await generate_with_llm(
            prompt, 
            temperature=0.4,  # Slightly higher for nuanced classification
            max_tokens=1500,  # More room for detailed reasoning
            json_mode=True,
            provider_override=getattr(request, 'llm_provider', None)
        )
        
        # Track AFTER LLM responds
        track_job(job_id, "processing", {
            "task": "Parsing chapter analysis",
            "stage": "parsing_response"
        })
        
        # Parse JSON response
        response_text = response_text.strip()
        json_start = response_text.find('{')
        json_end = response_text.rfind('}') + 1
        
        if json_start >= 0 and json_end > json_start:
            json_text = response_text[json_start:json_end]
        else:
            json_text = response_text
        
        try:
            result = json.loads(json_text)
        except json.JSONDecodeError as je:
            logger.error(f"[{job_id}] JSON parse error in chapter analysis. Response: {response_text[:500]}")
            raise ValueError(f"Invalid JSON response from LLM: {str(je)}")
        
        # Validate required fields - UPDATED for open-ended analysis
        required_fields = ['content_type', 'main_focus', 'confidence']
        for field in required_fields:
            if field not in result:
                raise ValueError(f"Missing required field in analysis: {field}")
        
        # Validate confidence range
        if not (0.0 <= result['confidence'] <= 1.0):
            logger.warn(f"[{job_id}] Invalid confidence: {result['confidence']}, defaulting to 0.5")
            result['confidence'] = 0.5
        
        # Save to cache
        save_to_cache(cache_key, result)
        
        logger.info(f"[{job_id}] Chapter analysis completed: {result.get('content_type', 'unknown')} (confidence: {result['confidence']})")
        track_job(job_id, "completed", {
            "content_type": result.get('content_type'),
            "confidence": result['confidence']
        })
        
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
            "regeneration_prompts_count": len(REGENERATION_PROMPTS),
            "cache": {
                "enabled": CACHE_ENABLED,
                "ttl_days": CACHE_TTL_DAYS,
                "prompt_version": PROMPT_VERSION,
                "stats": cache_stats
            }
        }
    except Exception as e:
        logger.error(f"Health check failed: {str(e)}")
        return {
            "status": "degraded",
            "error": str(e),
            "timestamp": time.time()
        }

@app.post("/cache/clear")
async def clear_cache_endpoint(version: Optional[str] = None):
    """Clear LLM response cache. Optionally specify version to clear only that version."""
    cleared = clear_cache(version)
    return {
        "success": True,
        "cleared_count": cleared,
        "version": version or "all"
    }

@app.get("/cache/stats")
async def get_cache_stats():
    """Get cache statistics"""
    total_requests = cache_stats['hits'] + cache_stats['misses']
    hit_rate = (cache_stats['hits'] / total_requests * 100) if total_requests > 0 else 0
    
    return {
        "enabled": CACHE_ENABLED,
        "ttl_days": CACHE_TTL_DAYS,
        "prompt_version": PROMPT_VERSION,
        "stats": {
            **cache_stats,
            "total_requests": total_requests,
            "hit_rate_percent": round(hit_rate, 2)
        },
        "cache_dir": str(CACHE_DIR)
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