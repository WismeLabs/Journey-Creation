"""
Prompt Loader - Loads all LLM prompts from templates/prompts directory
This centralizes all prompts in txt files for easy maintenance and versioning
"""
import os
from pathlib import Path
from typing import Dict

# Get templates directory path
TEMPLATES_DIR = Path(__file__).resolve().parents[1] / 'templates' / 'prompts'

def load_prompt(filename: str) -> str:
    """Load a prompt template from file"""
    prompt_path = TEMPLATES_DIR / filename
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt template not found: {filename}")
    
    with open(prompt_path, 'r', encoding='utf-8') as f:
        return f.read()

def load_subject_prompts(base_name: str, subjects: list) -> Dict[str, str]:
    """Load subject-specific prompts (e.g., concept_extraction_Science.txt)"""
    prompts = {}
    for subject in subjects:
        # Replace spaces with underscores for filenames
        filename = f"{base_name}_{subject.replace(' ', '_')}.txt"
        try:
            prompts[subject] = load_prompt(filename)
        except FileNotFoundError:
            # Try default fallback
            try:
                prompts[subject] = load_prompt(f"{base_name}_default.txt")
            except FileNotFoundError:
                raise FileNotFoundError(f"No prompt found for {subject} or default fallback")
    return prompts

# Define supported subjects (CBSE + ICSE curricula, grades 1-10)
# PURPOSE: Audio revision for concepts/theory students already studied
# APPROACH: Explain concepts, problem-solving strategies, common mistakes
#           Students then practice problems/exercises separately
SUBJECTS = [
    "Science",               # CBSE 6-10, ICSE 6-8 - theory + problem-solving approach
    "Physics",               # ICSE 9-10 - concepts + numerical strategies
    "Chemistry",             # ICSE 9-10 - theory + stoichiometry/calculation patterns
    "Biology",               # ICSE 9-10 - processes, systems (verbal diagram descriptions)
    "Social Studies",        # CBSE 6-10 (History+Geo+Civics) - perfect for audio
    "History",               # ICSE 6-10 - chronology, events, cause-effect
    "Geography",             # ICSE 6-10 - spatial descriptions, map skills verbally
    "Civics",                # ICSE 6-10 - concepts, rights, governance
    "Computer Science",      # Programming concepts, algorithms, logic (not syntax drills)
    "Economics",             # Economic principles, graph trends described verbally
    "EVS",                   # Environmental Studies (grades 1-5) - simple, descriptive
    "default"                # Fallback for unrecognized subjects
]

# Subjects NOT supported (audio revision doesn't make sense)
UNSUPPORTED_SUBJECTS = [
    "Mathematics",           # Every topic needs worked examples on paper - audio can't show steps
    "Algebra",               # Equation manipulation must be seen, not heard
    "Geometry",              # 100% visual - diagrams, constructions, proofs need paper
    "English",               # Literature needs text, grammar needs written practice
    "Literature",            # Poems/stories require reading, not just listening about them
    "Grammar",               # Rule memorization + exercises - not audio-friendly
]

def is_subject_supported(subject: str) -> tuple:
    """
    Check if subject is compatible with audio-only revision format.
    Returns: (is_supported: bool, message: str)
    """
    if subject in UNSUPPORTED_SUBJECTS:
        return False, f"{subject} is not supported in audio-only format. Requires visual/interactive elements."
    if subject in SUBJECTS:
        return True, "Supported"
    return True, "Using default prompts"  # Unknown subjects get default treatment

# Load all prompts from txt files
CONCEPT_EXTRACTION_BY_SUBJECT = load_subject_prompts("concept_extraction", SUBJECTS)
SCRIPT_PROMPTS_BY_SUBJECT = load_subject_prompts("script_generation", SUBJECTS)
MCQ_PROMPTS_BY_SUBJECT = load_subject_prompts("mcq_generation", SUBJECTS)

# Load regeneration prompts (single file with all types)
def load_regeneration_prompts() -> Dict[str, str]:
    """Load regeneration prompt templates"""
    regeneration_file = TEMPLATES_DIR / "regeneration_prompts.txt"
    if not regeneration_file.exists():
        return {}
    
    prompts = {}
    with open(regeneration_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Parse sections marked with === PROMPT_NAME ===
    sections = content.split('===')
    for i in range(1, len(sections), 2):
        if i + 1 < len(sections):
            prompt_name = sections[i].strip()
            prompt_content = sections[i + 1].strip()
            prompts[prompt_name] = prompt_content
    
    return prompts

REGENERATION_PROMPTS = load_regeneration_prompts()

# Prompt version for cache invalidation
PROMPT_VERSION = "v2.1"
