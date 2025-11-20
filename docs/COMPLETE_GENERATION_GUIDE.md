# 🎓 K-12 Educational Content Pipeline - Complete Generation Guide

## 📖 Overview
This guide walks you through the entire process of generating professional K-12 educational content - from initial setup to reviewing final episode audio. The system transforms textbook PDFs into engaging podcast-style episodes with AI-generated scripts, quiz questions, and professional voice synthesis.

---

## 🚀 Part 1: Initial Setup & Configuration

### Prerequisites
- **Node.js 16+** (for main server and PDF processing)
- **Python 3.8+** (for AI/LLM backend service)  
- **API Keys** (critical for production functionality)

### Step 1: Get Required API Keys

#### 1.1 Gemini API Key (REQUIRED)
1. Visit: https://makersuite.google.com/app/apikey
2. Sign in with your Google account
3. Create a new API key
4. Copy the key (starts with `AIza...`)

#### 1.2 Google Cloud TTS API Key (REQUIRED)
1. Visit: https://console.cloud.google.com/
2. Create a new project or select existing
3. Enable the Text-to-Speech API
4. Go to APIs & Services → Credentials
5. Create API Key (or use Service Account JSON)
6. Copy the API key

### Step 2: Configure Environment
```bash
# 1. Navigate to project directory
cd Journey-Creation

# 2. Copy environment template
cp .env.template .env

# 3. Edit .env file with your API keys
# Add your actual keys (no quotes needed):
GEMINI_API_KEY=AIzaSyC-your-actual-gemini-key-here
GOOGLE_TTS_API_KEY=AIzaSyB-your-actual-tts-key-here

# Optional: Use service account instead
# GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
```

### Step 3: Install Dependencies
```bash
# Install Node.js dependencies
npm install

# Install Python backend dependencies
cd hf_backend
pip install -r requirements.txt
cd ..
```

---

## 🔧 Part 2: Starting the System

### Step 1: Start Backend LLM Service
```bash
# Terminal 1: Start the AI/LLM backend
cd hf_backend
python main.py

# Expected output:
# INFO: Uvicorn running on http://127.0.0.1:8000
# ✅ Gemini API configured and validated successfully
```

### Step 2: Start Main Server
```bash
# Terminal 2: Start the main content pipeline server
npm start

# Expected output:
# ✅ concept_extractor_initialized
# Journey Creation School Pipeline server running on port 3000
```

### Step 3: Verify System Health
Open browser and visit:
- **Upload Interface**: http://localhost:3000/teacher/upload.html
- **API Health**: http://localhost:8000/docs (FastAPI documentation)
- **Backend Status**: Check Terminal 1 for "[OK] Gemini API" messages

---

## 📚 Part 3: Content Generation Process

### Step 1: Prepare Your Educational Content
**Supported Formats:**
- PDF files (text-based PDFs recommended)
- Text content (direct paste)

**Important PDF Notes:**
- ⚠️ **Text-based PDFs work best** - PDFs with selectable text extract fastest
- 🖼️ **Image-only PDFs** - Scanned/image PDFs require OCR (slower, may have errors)
- 📄 **For best results** - Use PDFs exported from Word/Google Docs rather than scanned documents

**Best Practices:**
- Use clear, well-structured PDFs with selectable text
- Ensure content is not image-only unless necessary
- 5-50 pages per chapter works best
- Include grade level and subject information

### Step 2: Upload Content via Web Interface

1. **Open Upload Interface**
   ```
   http://localhost:3002/teacher/upload.html
   ```

2. **Fill Form Details:**
   - **Chapter ID**: Unique identifier (e.g., "math_chapter_5")
   - **Grade**: Student grade level (1-12)
   - **Subject**: Subject area (Mathematics, Science, etc.)
   - **Language**: Content language (en-IN, en-US, etc.)
   - **Speaker Names**: Customize dialogue speaker names (e.g., "Riya" and "Arjun")
   - **Voice Selection**: Choose TTS voices for each speaker (Chirp3-HD, Neural2, etc.)
   - **Teacher Review**: Enable for human review step

3. **Upload Methods:**
   - **PDF Upload**: Select your PDF file (text-based PDFs work best)
   - **Text Input**: Paste content directly

4. **Submit Processing**
   - Click "Generate Educational Content"
   - Note the Job ID for tracking

### Step 3: Monitor Processing Pipeline

The system processes content through 5 stages:

#### Stage 1: PDF Text Extraction (20% complete)
```
✅ Direct PDF parsing (preferred)
🔄 OCR fallback for scanned documents
📝 Structure recovery and formatting
```

#### Stage 2: AI Concept Extraction (40% complete)  
```
🤖 Gemini AI analyzes content
📋 Identifies key educational concepts
🔗 Maps prerequisite relationships
📊 Quality validation and scoring
```

#### Stage 3: Episode Planning (60% complete)
```
📐 Determines optimal episode count (4-6 per chapter)
⚖️ Balances content complexity and time constraints
🎯 Groups related concepts logically
📅 Creates episode sequence plan
```

#### Stage 4: Script & Quiz Generation (80% complete)
```
✍️ Generates 8-12 minute episode scripts
👥 Creates dialogue between StudentA (confident) & StudentB (curious)
❓ Develops curriculum-aligned quiz questions
✅ Validates educational quality and accuracy
```

#### Stage 5: Professional Audio Generation (100% complete)
```
🎙️ Synthesizes professional voices using Google TTS
🎵 Creates segment audio files
🔧 Processes and mixes final episode audio
⏰ Synchronizes audio with script timing
```

### Step 4: Track Job Progress

#### Via Web Interface
1. Check the job status display
2. Monitor progress percentage (0-100%)
3. View real-time processing logs

#### Via API
```bash
# Check job status
curl http://localhost:3000/api/status/{your-job-id}

# Example response:
{
  "jobId": "abc123",
  "status": "generating_audio", 
  "progress": 85,
  "currentStage": "Creating episode 2 audio",
  "error": null
}
```

#### Via Server Logs
Monitor Terminal 2 for detailed processing logs:
```
info: ✅ Concept extraction complete - 4 concepts found
info: ✅ Episode planning complete - 5 episodes planned  
info: ✅ Script generation complete for episode 1
info: ✅ Audio generation complete for all episodes
```

---

## 📁 Part 4: Understanding Generated Content

### Output Directory Structure
```
outputs/chapter_{your-chapter-id}/
├── manifest.json              # Complete metadata and summary
├── chapter.md                # Clean markdown of original content
├── raw_text.txt              # Extracted text from PDF
├── processing_metadata.json   # Technical processing details
├── concepts.json             # AI-extracted educational concepts
├── episode_plan.json         # Episode structure and planning
├── episodes/                 # Individual episode content
│   ├── ep01/
│   │   ├── script.json       # Complete episode script
│   │   ├── mcqs.json        # Quiz questions with answers
│   │   ├── audio/           # Professional audio files
│   │   │   ├── final_episode.mp3    # Complete episode audio
│   │   │   ├── a_segments/          # StudentA voice segments
│   │   │   ├── b_segments/          # StudentB voice segments
│   │   │   └── cues.json           # Audio timing data
│   │   └── validation.json  # Quality assessment report
│   ├── ep02/ ... ep05/      # Additional episodes
└── validation_report.json    # Overall chapter quality report
```

### Key Files Explained

#### **manifest.json** - Chapter Overview
```json
{
  "chapter_id": "math_chapter_5", 
  "subject": "Mathematics",
  "grade_band": "8",
  "total_episodes": 5,
  "total_duration_minutes": 42,
  "concepts_covered": ["Linear Equations", "Graphing", "Slope"],
  "generation_timestamp": "2025-11-16T10:30:00Z",
  "quality_score": 0.89,
  "teacher_review_required": false
}
```

#### **episodes/ep01/script.json** - Episode Content
```json
{
  "episode_number": 1,
  "title": "Introduction to Linear Equations",
  "duration_minutes": 8.5,
  "sections": [
    {
      "type": "introduction",
      "speaker": "StudentA", 
      "text": "Hi everyone! Today we're diving into linear equations...",
      "start_time": 0,
      "duration": 15
    }
  ],
  "concepts": ["linear_equations", "variables"],
  "learning_objectives": ["Understand what linear equations are", ...]
}
```

#### **episodes/ep01/mcqs.json** - Quiz Questions
```json
{
  "questions": [
    {
      "id": 1,
      "question": "What is a linear equation?",
      "options": [
        "An equation with variables to the first power",
        "An equation with curved graphs", 
        "An equation with multiple variables",
        "An equation with fractions"
      ],
      "correct_answer": 0,
      "explanation": "Linear equations have variables raised only to the first power...",
      "difficulty": "medium",
      "concept_reference": "linear_equations"
    }
  ]
}
```

---

## 🎧 Part 5: Reviewing Generated Episodes

### Step 1: Audio Quality Review

#### Listen to Complete Episodes
```bash
# Navigate to episode audio
cd outputs/chapter_{your-id}/episodes/ep01/audio/
# Play: final_episode.mp3
```

**Quality Checklist:**
- ✅ Clear, professional voice quality
- ✅ Natural pacing and pronunciation  
- ✅ Smooth transitions between speakers
- ✅ Appropriate educational tone
- ✅ Accurate timing (8-12 minutes per episode)

#### Review Individual Segments
```bash
# StudentA segments (confident voice)
ls a_segments/*.mp3

# StudentB segments (curious voice) 
ls b_segments/*.mp3
```

### Step 2: Content Quality Review

#### Educational Accuracy
1. **Review Scripts**: Check `episodes/ep0X/script.json`
   - Verify factual accuracy
   - Ensure age-appropriate language
   - Confirm logical progression

2. **Validate Concepts**: Check `concepts.json`
   - Ensure all key topics covered
   - Verify prerequisite relationships
   - Check difficulty appropriateness

3. **Quiz Quality**: Review `episodes/ep0X/mcqs.json`
   - Questions test key learning objectives
   - Distractors are plausible but incorrect
   - Explanations are clear and helpful

#### Curriculum Alignment
```json
// Check validation_report.json for alignment scores
{
  "curriculum_alignment": {
    "grade_appropriateness": 0.92,
    "concept_coverage": 0.88, 
    "difficulty_progression": 0.85
  }
}
```

### Step 3: Teacher Review Process

If teacher review was enabled:

1. **Access Review Interface**
   ```
   http://localhost:3000/review/{chapter-id}
   ```

2. **Review Categories:**
   - **Content Accuracy**: Mark factual errors
   - **Pedagogical Quality**: Rate teaching effectiveness
   - **Audio Quality**: Flag pronunciation issues
   - **Quiz Validity**: Validate question quality

3. **Approval Workflow:**
   - Approve episodes for student use
   - Request regeneration for specific issues
   - Add teacher notes and modifications

---

## 🔧 Part 6: Advanced Operations

### Regenerating Content

If content needs improvement, use regeneration endpoints:

```bash
# Regenerate specific episode script
curl -X POST http://localhost:8000/regenerate \
  -H "Content-Type: application/json" \
  -d '{
    "prompt_type": "regen_simplify",
    "input_data": {"episode_id": "ep01"},
    "temperature": 0.3
  }'

# Available regeneration types:
# - regen_simplify: Make content easier
# - regen_expand: Add more detail
# - regen_clarify: Improve explanations
# - regen_quiz: Regenerate quiz questions
```

### Monitoring System Health

#### Check API Status
```bash
# Backend health
curl http://localhost:8000/health

# Main server status
curl http://localhost:3000/api/health
```

#### Log Analysis
```bash
# Backend logs
tail -f hf_backend/logs/api.log

# PDF processing logs
tail -f logs/pdf_processor.log

# TTS generation logs  
tail -f logs/tts.log
```

### Batch Processing

For multiple chapters:

```bash
# Process multiple PDFs
for pdf in *.pdf; do
  curl -X POST http://localhost:3000/api/upload \
    -F "file=@$pdf" \
    -F "grade=8" \
    -F "subject=Mathematics"
done
```

---

## 🚨 Troubleshooting Guide

### Common Issues & Solutions

#### "Gemini API key required" Error
```bash
# Solution: Add valid API key to .env
GEMINI_API_KEY=AIzaSyC-your-actual-key-here
# Restart backend: python main.py
```

#### "Google TTS not initialized" Error
```bash
# Solution: Add TTS API key to .env  
GOOGLE_TTS_API_KEY=AIzaSyB-your-actual-key-here
# Or use service account:
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

#### Poor PDF Text Extraction
- **Check PDF quality**: Ensure text is selectable, not image-only
- **Monitor OCR logs**: System automatically falls back to OCR for scanned docs
- **Verify ImageMagick**: Install for advanced OCR capabilities

#### Audio Generation Fails
- **Check TTS quota**: Verify Google Cloud billing and quotas
- **Monitor segment count**: Large episodes may hit rate limits
- **Review voice settings**: Ensure supported voice names in config

#### Content Quality Issues
- **Adjust temperature**: Lower values (0.2-0.4) for more focused content
- **Use regeneration**: Try different regeneration prompts
- **Check source quality**: Better source PDFs produce better output

### Performance Optimization

#### For Large Batches
```bash
# Adjust concurrent processing
MAX_CONCURRENT_GENERATIONS=2

# Increase timeouts
CHAPTER_PROCESSING_TIMEOUT_MS=3600000
```

#### For Better Quality
```bash
# Enable detailed analysis
ENABLE_DETAILED_LOGS=true

# Use higher-quality TTS voices
TTS_VOICE_MALE=en-IN-Neural2-B
TTS_VOICE_FEMALE=en-IN-Neural2-A
```

---

## 📊 Part 7: Quality Metrics & Analytics

### Understanding Quality Scores

#### Content Quality Metrics
```json
{
  "quality_metrics": {
    "concept_extraction_confidence": 0.89,
    "script_educational_value": 0.92,
    "audio_clarity_score": 0.95,
    "quiz_difficulty_appropriateness": 0.87,
    "overall_chapter_quality": 0.91
  }
}
```

#### Performance Metrics
- **Processing Time**: Target 5-15 minutes per chapter
- **API Usage**: ~50-100 requests per chapter
- **Audio Quality**: 24kHz, 128kbps MP3
- **Episode Length**: 8-12 minutes optimal

### Success Criteria

A successful generation should have:
- ✅ Overall quality score > 0.8
- ✅ All episodes 8-12 minutes duration
- ✅ Clear, professional audio output
- ✅ 3-5 quiz questions per episode
- ✅ Proper concept progression
- ✅ Grade-appropriate language

---

## 🎯 Part 8: Best Practices & Tips

### Content Preparation
1. **Use High-Quality Sources**: Well-formatted textbooks work best
2. **Chunk Appropriately**: 5-20 page chapters are optimal
3. **Include Context**: Add grade level and subject information
4. **Review Before Processing**: Ensure source accuracy

### System Configuration  
1. **Monitor API Quotas**: Check Google Cloud usage
2. **Adjust Voice Settings**: Customize for your audience
3. **Enable Logging**: Use detailed logs for troubleshooting
4. **Test Small First**: Process sample content before large batches

### Quality Assurance
1. **Review First Episodes**: Check initial output quality
2. **Validate Concepts**: Ensure educational accuracy
3. **Test Audio Playback**: Verify cross-device compatibility  
4. **Gather Feedback**: Use teacher review features

### Production Deployment
1. **Scale Infrastructure**: Increase server resources for volume
2. **Monitor Performance**: Track processing times and success rates
3. **Backup Outputs**: Save generated content safely
4. **Version Control**: Track system updates and configurations

---

## 🔗 Quick Reference Links

### System URLs
- **Upload Interface**: http://localhost:3002/teacher/upload.html  
- **API Documentation**: http://localhost:8000/docs
- **Server Status**: http://localhost:3002/api/health

### Configuration Files
- **Main Config**: `.env`
- **Backend Config**: `hf_backend/.env`
- **Server Config**: `server.js` 

### Key Directories
- **Outputs**: `outputs/chapter_{id}/`
- **Logs**: `logs/`  
- **Uploads**: `Chapter_PDF/`
- **Templates**: `.env.template`

### Support & Documentation
- **This Guide**: `COMPLETE_GENERATION_GUIDE.md`
- **Setup Guide**: `SETUP_PRODUCTION.md`
- **Migration Specs**: `MIGRATION.md`

---

## 🏁 Conclusion

You now have a complete K-12 educational content generation system that transforms textbook content into engaging, professional podcast-style episodes. The system handles everything from PDF processing to final audio generation with AI-powered content creation and quality assurance.

**Next Steps:**
1. Set up your API keys following Part 1
2. Start the services using Part 2
3. Process your first chapter using Part 3
4. Review the generated content using Part 5

The system is production-ready and will generate high-quality educational content suitable for K-12 students across all subjects and grade levels.

**Need Help?** Check the troubleshooting section or review the server logs for detailed error messages.