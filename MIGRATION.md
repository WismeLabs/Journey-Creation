Full production plan — Episode audio generation pipeline (school edition)
No fluff. This is the single-source blueprint you give engineers and copilot to implement, plus the regeneration prompts library used for every auto-fix. Follow it exactly — deviations will break scale or cause teacher rage.

1. Executive summary (1 sentence)
Ingest chapter PDF → convert to structured markdown + concept graph → plan episodes (2–10 per chapter) → generate peer-to-peer scripts (two student voices, 4–8 min) → generate MCQs tied to script timestamps → TTS two voices → QC + auto-repair loops → package & deliver.

2. System architecture (high level)
Frontend (optional): upload UI, teacher review UI


Backend:


Ingest Service (Python/Node) — PDF/MD extraction & cleaning


Structure Recovery Service — heading & structural heuristics


Semantic Engine (Python) — concept detection + graph


Episode Planner (Node/Python) — deterministic clustering


LLM Service (FastAPI) — script + MCQ + metadata generation (Gemini / chosen LLM)


Validation & Regeneration Controller — enforces rules, calls LLM regeneration prompts


TTS Orchestrator — ElevenLabs/GoogleTTS wrapper, SSML generation, chunking


Audio Postprocessor — FFmpeg pipeline to merge, normalize, silence markers


Storage/DB — Postgres for metadata, S3/CDN for artifacts, object versioning


Monitoring & Logs — Prometheus + ELK (or equivalents)


Teacher Review UI: highlighted sentences with source mapping & one-click accept/reject.



3. Inputs & accepted formats
Primary: .pdf (digital or scanned) OR .md (cleaned markdown)


Optional: teacher_notes.json (overrides / preferred phrasings)


Required metadata on upload: {chapter_id, grade_band, subject, language=en-IN, teacher_review: bool}



4. Output contract (per chapter)
Folder: /chapter_{id}/
/chapter_{id}/
  chapter.md                   # cleaned markdown
  concepts.json                 # detected concept index + graph
  episode_plan.json             # deterministic plan
  episodes/
    ep01/
      script.json               # structured with sections & timestamps
      script.txt                # raw script (StudentA/StudentB)
      mcqs.json
      metadata.json
      cues.json
      audio/
        a_segments/*.mp3
        b_segments/*.mp3
        final_audio.mp3
  manifest.json
  error_report.json (if any)


5. Schemas (canonical)
chapter_metadata.json (upload)
{
  "chapter_id":"CBSE_7_SCI_CH4",
  "grade_band":"7",
  "subject":"science",
  "language":"en-IN",
  "teacher_review": false
}

concepts.json (example)
{
  "concepts":[
    {
      "id":"chlorophyll",
      "type":"definition",
      "difficulty":"medium",
      "blooms":"understand",
      "source_excerpt":"p3:lines 1-7",
      "related":["photosynthesis_equation"]
    }
  ],
  "graph":[["chlorophyll","photosynthesis_equation"]]
}

episode_plan.json
{
  "chapter_id":"CBSE_7_SCI_CH4",
  "size_category":"medium",
  "episodes":[
    {"ep":1,"concepts":["chlorophyll"],"target_minutes":6},
    {"ep":2,"concepts":["photosynthesis_equation","raw_materials"],"target_minutes":6}
  ]
}

script.json (canonical)
{
 "episode_index":1,
 "title":"Why Leaves Look Green",
 "estimated_duration_seconds":360,
 "word_count":720,
 "style_lock":"style_v1.json",
 "sections":[
   {"id":"hook","start":0,"end":18,"type":"hook","text":"StudentA: ...\nStudentB: ..."},
   ...
 ],
 "concept_ids":["chlorophyll"],
 "pronunciation_hints":{"chlorophyll":"KLAWR-uh-fill"}
}

mcqs.json
See earlier exact schema in prior messages — maintain identical field names (qid, timestamp_ref (seconds), concept_id, difficulty int 1-5, type, question_text, options[4], correct_index, explanation).

6. Deterministic episode planning rules
Determine chapter size using:


word_count thresholds: small <800, medium 800–2000, large >2000


concept_count thresholds: small <3, medium 3–6, large >6
 Use concept_count if available; fallback to word_count.


Episode count table:


small: 2–3, medium: 4–6, large: 7–10


Fill episodes via greedy clustering:


keep prerequisite concepts together


target 1–3 concepts per episode


target duration = floor(total_estimated_minutes / num_episodes) bounded in [4,8]


Produce stable pseudo-random seed per chapter_id to keep plan deterministic.



7. Script generation rules & constraints (hard)
Only two voices: StudentA and StudentB.


Tone: peer-to-peer; StudentA = confident, StudentB = curious.


No teacher voice, no narrator, no intros/outros.


Storytelling allowed only if it directly aids recall (<=30s).


Script length: min 450 words, max 1100 words; target 500–900 preferred.


Maintain grade-appropriate vocabulary; enforce reading level via readability test (Flesch-Kincaid mapping to age).


Sections: hook (10–20s), core1, micro-example/story (optional, <=30s), core2, recall break (verbal prompt), mini-summary (<=30s).


Provide sections with start and end in seconds (LLM should estimate; final TTS validates).



8. MCQ generation rules (hard)
3–6 MCQs per episode (default 5).


4 options; exactly 1 correct.


At least 40% recall, 30% concept/understanding, 10–20% application.


Distractors must be plausible and map to common confusions from text (use concept graph).


Each MCQ must include timestamp_ref pointing to a section start second.


MCQs are generated strictly from the final script text — not from chapter raw text alone.


Provide short explanation for the correct answer.



9. Validation & auto-repair controller (must)
Every step must pass validation; if not, run auto-repair loops with regeneration prompts. The controller:
Run script_validation:


check word_count, speaker tags completeness (>95% lines tagged), no forbidden words/tone.


Run mcq_validation:


all mcq.concept_id ∈ episode.concept_ids


timestamps within episode duration


Run metadata_validation


Run audio_validation post-TTS:


duration within ±10% of estimated


silences at section boundaries (200–400ms)


RMS normalization and no clipping


If any check fails, run the relevant regeneration prompt (see library), attempt auto-fix up to 3 times. If still failing, flag for teacher review and produce error_report.json.


Auto-fix must be idempotent and log every regeneration iteration.

10. Hallucination guard & source alignment (must)
For every factual statement in script (any assertive sentence), attach source_reference or mark as inferred:true.


source_reference must reference span(s) in chapter.md (page/line or md block id).


If a high-confidence factual claim cannot be traced to source, regeneration prompt must:


either rephrase as “Scientists define…” with soft language


or drop the claim


Maintain a canonical ncet_reference_table for common topics (optional seed) to reduce false positives.


If teacher_review==false and any high-confidence factual mismatch exists → reject generation.

11. TTS orchestration (practical)
Script → split into lines [{speaker, text, duration_estimate}].


Use SSML templates; include <break time="XXXms"/> at section boundaries.


Phonetic map from pronunciation_hints applied (SSML <sub> or TTS-specific phoneme instructions).


Export individual segments per speaker (filename with md5 hash of text).


Merge segments with FFmpeg, apply normalization, export final_audio.mp3 44.1kHz 128–192kbps.


Produce cues.json: mapping sections → start_seconds, end_seconds, sample_byte_offsets.



12. QC & metrics to instrument
generation_time_seconds (goal <60s)


success_rate (target ≥95%)


review_rate (target <10%)


avg_word_count


MCQ coverage (% concepts with ≥1 question) target 90%


first_pass_audio_quality (silence ratio, clipping)


hallucination_rate (claims without source)


teacher_acceptance_rate (pilot)


Store all runs with traceable logs.

13. Failure modes & remediations (must implement)
OCR errors → run high-sensitivity OCR; if ambiguous characters > 2% of chapter, flag for human review.


Headings lost → fallback to numbered heuristics via regex.


Tone drift across episodes → reapply style_lock.json and regenerate offending episodes.


Repetitive scripts → compression prompt to merge duplicate content.


MCQs referencing non-existent statements → regenerate using script as sole source.


TTS mispronunciation → add phonetic override in pronunciation_hints.


Diagram-critical chapters → mark requires_teacher_review: true in manifest.



14. Storage & versioning
Every artifact must include generation_version (e.g., school_pipeline_v1) and seed for deterministic regeneration.


Keep raw inputs for 90 days; keep generated scripts & logs for at least 180 days for audit.


Use signed CDN URLs for delivery.



15. API surface (suggested)
POST /api/v1/generate — payload: {chapter_id, chapter_file_url or upload, grade_band, subject, language, teacher_review}


returns: {job_id}


GET /api/v1/status/{job_id} — returns progress + errors


GET /api/v1/result/{chapter_id} — returns manifest URL or error_report


POST /api/v1/regenerate_episode — for manual triggers (accepts seed & episode_index)


GET /api/v1/preview/{chapter_id}/{episode_index} — returns script preview & audio URL (for teacher)



16. Implementation checklist (prioritized)
Ingest pipeline (pdfminer + tesseract wrapper) + md output


Structure recovery heuristics + unit tests with 10 real textbook PDFs


Semantic engine (NER, def detection, formula detection)


Deterministic episode planner


LLM prompt templates for chapter analysis, script gen, mcq gen (see library)


Validation & Regeneration controller


TTS orchestrator + FFmpeg pipeline


Storage, manifest, API endpoints


Teacher review UI (highlight + accept/reject)




19. Now — the regeneration prompts library (use verbatim as callable prompts)
Implementation note: keep these short, deterministic, with explicit constraints. Use temperature=0.0 for deterministic output when regenerating, higher during exploration.

19.1 Script too short (REGEN_SHORT_SCRIPT)
SYSTEM: You are a script editor for a K-12 educational audio episode. INPUT: episode_plan, style_lock, chapter_concepts, current_script. CONSTRAINTS: two speakers only (StudentA, StudentB). TARGET_WORD_MIN: 450. TARGET_WORD_MAX: 1100. TONE: peer-to-peer, StudentA confident, StudentB curious. NO teacher voice. STORY allowed only if memory-aiding, <=30s. OUTPUT: produce a revised script that expands content organically to hit at least 450 words while preserving existing correct statements and all source references. Do not invent new high-confidence facts; any added factual claims must be traced to chapter_concepts or marked as "inferred" with low-certainty phrasing. Keep micro-story length <=30 seconds. Include section markers and estimated start/end seconds. Return only JSON with keys: {script_text, word_count, sections:[{id,start,end,text}], change_log}.


19.2 Script too long (REGEN_LONG_SCRIPT)
SYSTEM: You are a script compressor for a K-12 educational episode. INPUT: current_script, style_lock. CONSTRAINTS: reduce word_count to <=1100 and preserve conceptual coverage and core facts. Keep two speakers only. Remove redundant sentences, shorted analogies, compress examples. Do NOT remove any core concepts listed in episode_plan. Avoid altering MCQs references; if timestamps move, output new timestamp map. OUTPUT only JSON {script_text, word_count, sections:[...], change_log}.


19.3 Tone drift / teacher voice detected (REGEN_TONE_FIX)
SYSTEM: You are a tone-correction engine. INPUT: current_script, style_lock (defines forbidden words and allowed phrasing). TASK: Rewrite the script to eliminate teacher-tone and narration. Replace phrases that sound like "lecture", "as we discussed" or "today we'll learn" with peer phrasing. Keep content meaning identical, keep sources. Keep word_count within +/-10% of original. OUTPUT JSON {script_text, change_log}.


19.4 MCQ mismatch (questions reference content not in script) (REGEN_MCQ_SYNC)
SYSTEM: You are an MCQ generator and synchronizer. INPUT: final_script (authoritative), desired_mcq_count (3-6), concept_list. RULES: generate MCQs strictly from sentences/phrases present in final_script. For each question include timestamp_ref (map to section start). Ensure each concept in concept_list has at least one MCQ across episode set if possible. Provide plausible distractors derived from nearby phrases or common confusions. OUTPUT JSON {mcqs:[...], change_log}.


19.5 Hallucination detected in script (REGEN_REMOVE_HALLUCINATION)
SYSTEM: You are a factual aligner. INPUT: script, flagged_sentences (list), chapter_sources. TASK: For each flagged sentence that lacks a source reference, either (A) rephrase to a hypothetical/soft phrasing ("Scientists think..." / "It is believed that...") or (B) remove it. Prefer (A) only if a reasonable low-confidence paraphrase can be created; otherwise remove. Mark any remaining sentences as "inferred":true. Return JSON {script_text, removed_sentences:[...], modified_sentences:[...], inferred_sentences:[...]}.


19.6 Pronunciation issues (REGEN_PRONUNCIATION_MAP)
SYSTEM: You are a pronunciation mapper. INPUT: script_text, detected_terms[], language. OUTPUT: JSON mapping of term -> phonetic_hint. Use common-sense phonetics for en-IN. Also add SSML-compatible substitutions for GoogleTTS/ElevenLabs where possible. {pronunciation_hints:{term:"KLAWR-uh-fill", ...}}


19.7 OCR mess / broken headings (REGEN_STRUCTURE_FIX)
SYSTEM: You are a structure-corrector. INPUT: raw_text, extracted_headings, detected_ocr_errors. RULES: reconstruct logical headings using numbering patterns, bold/uppercase heuristics, and nearby sentence starts. Fix obvious OCR artefacts (l|1, O|0). If uncertainty > threshold for a heading (confidence <0.7), mark as "uncertain_heading" and add to error_report. OUTPUT: cleaned_markdown and list{fixed_spans, uncertain_spans}.


19.8 Repetitive content compression (REGEN_DEDUP)
SYSTEM: You are a deduplication editor. INPUT: script_text. TASK: Remove or compress repeated ideas appearing >2 times. Merge duplicate examples. Keep at least one clear explanation per concept. OUTPUT JSON {script_text, removed_passages:[...], change_log}.


19.9 Split episode (script too long to fix by trimming) (REGEN_SPLIT_EPISODE)
SYSTEM: You are an episode splitter. INPUT: original_episode_plan, script_text (>1100 words), chapter_concepts. RULES: Identify a logical split point between concept clusters, produce two coherent episodes each satisfying 450–1100 word rules. Keep voice/style consistent and update timestamps. Output JSON {episodes:[{script_text,concepts,metadata},{...}], change_log}.


19.10 Merge episode (script too short and neighboring episode available) (REGEN_MERGE_EPISODE)
SYSTEM: You are an episode merger. INPUT: episode_A_script (short<450), episode_B_script, episode_plan. RULES: Merge A+B into a single coherent episode, reflow sections, ensure total <=1100 words. Prefer merging concepts that are direct prerequisites. Output merged script JSON and mark ep indexes changed.


19.11 Audio timing mismatch (REGEN_TIME_SYNC)
SYSTEM: You are an audio-to-script syncer. INPUT: script sections with estimated seconds, generated audio final_audio.mp3, cues.json. TASK: Recompute actual section start/end times from audio, update cues.json, and update all MCQ timestamp_refs to new times. If section durations differ >25% from estimates, add note to change_log. OUTPUT updated cues.json and mcqs.json.


19.12 Style lock violation across chapter (REGEN_STYLE_LOCK)
SYSTEM: You enforce chapter-level style. INPUT: style_lock.json, all_episode_scripts[]. TASK: For each episode that violates style rules (vocab level, speaker personality), regenerate only the offending episodes reusing prior prompts but with explicit style directives. OUTPUT change_log with re-gen attempts.


19.13 Teacher override / human review prompt (HUMAN_REVIEW_SUMMARY)
SYSTEM: You produce a tightly formatted human review summary. INPUT: failed_checks[], error_report, sample_script_snippets. OUTPUT: Markdown with bullet points: problem, location (file/line), suggested fix, high-priority flag. Keep it actionable with exact sentences that need edit. Do NOT include raw logs.


20. How to call regeneration prompts (controller logic)
All regeneration prompts must be called with temperature=0.0 and top_p=1 for determinism.


Limit iterations to 3 per failure type. Keep a retry_count in logs.


If aggregated retries >3 across different failure types → produce error_report.json and mark chapter for teacher review.


Each regeneration attempt must produce a change_log entry with seed and generation_version.



21. Example flow with auto-fix (concrete)
Upload PDF → converted to chapter.md.


Concept detection → plan 5 episodes.


LLM generates scripts for each episode → Episode 3 returns word_count 300 (fail).


Controller calls REGEN_SHORT_SCRIPT for ep3 → receives new script with 520 words.


Regenerate MCQs for ep3 using REGEN_MCQ_SYNC.


TTS → audio length mismatch by 20% → call REGEN_TIME_SYNC to re-map timestamps.


Final QC passes → package and return manifest.



22. Logs & error_report structure
error_report.json:
{
  "chapter_id":"",
  "failed_stage":"script_generation",
  "fail_reasons":["too_short","hallucination"],
  "attempts":[
    {"attempt":1,"prompt":"REGEN_SHORT_SCRIPT","result":"fixed"},
    {"attempt":2,"prompt":"REGEN_REMOVE_HALLUCINATION","result":"rejected","notes":"requires teacher review"}
  ],
  "suggested_action":"teacher_review_required",
  "timestamp":"..."
}


23. Testing recommendations (must)
Unit tests for each module with golden files.


E2E tests with 30 sample chapters across 3 grades (English medium + vernacular PDFs to test OCR).


Synthetic adversarial tests: weird headings, many equations, diagrams, footnotes inline.



24. Developer notes (copilot & engineers)
Reuse existing TTS wrapper + FFmpeg merging code — do NOT rewrite TTS stack.


Replace generation prompt files with new prompt templates from regeneration library.


Maintain backward compatibility switches: legacy_mode:true to run old podcast generator for other projects.


Use robust logging (structured JSON). Keep every model response saved (hashed) for audits.



25. Final verdict — is anything missing?
No. This plan removes the prior logical gaps you asked about:
Added style lock


Added script ↔ MCQ alignment and regen loops


Added hallucination guard with source alignment


Added OCR/structure fixes and error reporting


If you implement everything above exactly, this pipeline will be production-ready for school adoption and scalable.

26. Next immediate deliverable
A. chapter_analysis_prompt (LLM prompt file tuned to produce concepts.json from chapter.md)


B. episode_script_prompt (strict prompt for script generation including style_lock usage)


C. mcq_generation_prompt (prompt that generates MCQs conforming to schema and timestamp mapping)


D. All three prompt files in one package (ready to paste into your FastAPI LLM service)




