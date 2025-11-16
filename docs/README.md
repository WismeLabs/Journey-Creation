# 🎓 K-12 Educational Content Pipeline

**Production-Ready AI System for Educational Content Generation**

Professional system that transforms textbooks into engaging podcast-style episodes with AI-generated scripts, quiz questions, and professional voice synthesis. Complete end-to-end pipeline for K-12 education.

## 📖 **DOCUMENTATION**
- **[→ USER GUIDE ←](./USER_GUIDE.md)** - ⭐ **START HERE** - Simple step-by-step guide for everyone
- **[→ COMPLETE GENERATION GUIDE ←](./COMPLETE_GENERATION_GUIDE.md)** - Developer setup and technical details
- **[→ COMPREHENSIVE AUDIT ←](./COMPREHENSIVE_AUDIT.md)** - System status, gaps, and production readiness
- **[→ MIGRATION SPEC ←](./MIGRATION.md)** - Technical specification and requirements

## 🎯 What This System Does

**Complete K-12 Educational Content Pipeline (Production-Ready)**
- 🤖 **Real Gemini AI Integration**: Concept extraction, script generation, quiz creation
- 🎙️ **Professional Google TTS**: Multi-voice episode audio with StudentA/StudentB dialogue
- 📚 **Advanced PDF Processing**: OCR, structure recovery, educational content analysis  
- 🎯 **Curriculum-Aligned Output**: Grade-appropriate content, quiz difficulty, learning objectives
- ✅ **Quality Assurance**: Teacher review interface, validation reports, automated repair
- � **Complete Episode Structure**: Scripts, audio, quizzes, metadata - ready for deployment

## ⚠️ Production Requirements
- **Gemini API Key**: Required (no mocks - real AI content generation)
- **Google Cloud TTS API**: Required (professional voice synthesis)
- **Real Processing**: 5-15 minutes per chapter, ~$2-5 cost per chapter

## 🏗️ Architecture

```
PDF Input → Text Extraction → Concept Analysis → Episode Planning → Script Generation → MCQ Creation → TTS Pipeline → Quality Control → Asset Output
```

**Developer-Focused Pipeline**: This is a backend content generation tool, not a customer-facing platform. Use it to batch-generate educational audio content and metadata for your app.

### Core Services:
- **Ingest Service**: PDF processing with OCR fallback
- **Semantic Engine**: AI-powered concept extraction using Gemini
- **Episode Planner**: Deterministic curriculum chunking
- **LLM Service**: Educational script & assessment generation
- **TTS Orchestrator**: Multi-voice audio production
- **Validation Controller**: Quality gates with auto-repair

## 🚀 Quick Start

### 1. Get API Keys (Required)
- **Gemini API**: https://makersuite.google.com/app/apikey  
- **Google TTS API**: https://console.cloud.google.com/apis/credentials

### 2. Setup Environment
```bash
# Copy and edit with your API keys
cp .env.template .env

# Install dependencies
npm install
cd hf_backend && pip install -r requirements.txt
```

### 3. Start System
```bash
# Terminal 1: Backend AI service
cd hf_backend && python main.py

# Terminal 2: Main server  
npm start
```

### 4. Generate Content
Visit: http://localhost:3000/test_upload.html
- Upload PDF or paste text
- Select grade level and subject
## 📁 Complete Output Structure
```
outputs/chapter_{id}/
├── manifest.json              # Chapter metadata & summary
├── chapter.md                # Clean markdown content
├── concepts.json             # AI-extracted educational concepts  
├── episode_plan.json         # Episode structure (4-6 episodes)
├── episodes/
│   ├── ep01/
│   │   ├── script.json       # Complete episode script
│   │   ├── mcqs.json        # Quiz questions with explanations
│   │   ├── audio/           # Professional audio files
│   │   │   ├── final_episode.mp3    # Complete episode (8-12 min)
│   │   │   ├── a_segments/          # StudentA voice clips
│   │   │   └── b_segments/          # StudentB voice clips
│   │   └── validation.json  # Quality assessment
│   └── ep02/ ... ep05/      # Additional episodes
└── validation_report.json    # Overall quality metrics
```

## �️ Audio Features
- **StudentA Voice**: Confident, clear explanations
- **StudentB Voice**: Curious, asks clarifying questions  
- **Professional Quality**: Google TTS Chirp3-HD voices
- **Educational Pacing**: Optimized for learning retention
- **Complete Episodes**: 8-12 minutes per episode

## � System Capabilities
- **Processing Time**: 5-15 minutes per chapter
- **Episode Generation**: 4-6 episodes per chapter automatically
- **Content Quality**: Curriculum-aligned, grade-appropriate
- **Audio Quality**: Professional 24kHz, broadcast-ready
- **Quiz Generation**: 3-5 questions per episode with explanations

---

## � Documentation
- **[Complete Setup & Usage Guide](./COMPLETE_GENERATION_GUIDE.md)** - Full instructions
- **[Production Setup](./SETUP_PRODUCTION.md)** - API key configuration  
- **[Migration Specs](./MIGRATION.md)** - Technical specifications

## �️ System Architecture
- **Node.js Server** (port 3000): Main pipeline orchestration
- **Python Backend** (port 8000): AI/LLM service with Gemini integration
- **Real API Integration**: No mocks - production Gemini & Google TTS
- **Quality Assurance**: Multi-layer validation and teacher review

---

**Ready for Production K-12 Content Generation** 🚀