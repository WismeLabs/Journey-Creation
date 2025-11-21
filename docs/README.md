# 🎓 K-12 Educational Content Pipeline - Documentation

**Production-Ready System for Educational Content Generation**

Professional system that transforms textbooks into engaging podcast-style episodes with AI-generated scripts, quiz questions, and professional voice synthesis.

---

## 📖 Documentation Index

### Getting Started
- **[Complete Generation Guide](./COMPLETE_GENERATION_GUIDE.md)** - ⭐ **START HERE** - Complete setup, configuration, and usage guide
  - Initial setup and API key configuration
  - Multi-LLM provider setup (GPT-5.1, GPT-4o, Gemini)
  - Content generation process
  - Monitoring and troubleshooting

### Configuration Guides
- **[TTS Configuration](./TTS_CONFIGURATION.md)** - Voice and audio settings
  - Voice selection and customization
  - Audio quality settings
  - Language and accent configuration

### Technical Documentation
- **[Migration Guide](./MIGRATION.md)** - System updates and version changes
  - Breaking changes
  - Upgrade instructions
  - Feature updates

---

## 🎯 What This System Does

**Complete K-12 Educational Content Pipeline**
- 🤖 **Multi-LLM Support**: GPT-5.1, GPT-4o, Gemini 2.0 Flash with automatic 3-tier fallback
- 🎙️ **Professional Google TTS**: Multi-voice episode audio with natural student dialogue
- 📚 **Advanced PDF Processing**: OCR, structure recovery, educational content analysis
- 🎯 **Curriculum-Aligned Output**: Grade-appropriate content, quiz difficulty, learning objectives
- ✅ **Quality Assurance**: Validation, automated repair, teacher review interface
- 📦 **Complete Episode Structure**: Scripts, audio, quizzes, metadata - ready for deployment

---

## ⚡ Quick Reference

### Prerequisites
- Node.js 22+
- Python 3.13+
- OpenAI API Key (recommended) or Gemini API Key
- Google Cloud TTS API Key

### Start System
```bash
# Terminal 1: Python Backend
cd hf_backend
python main.py

# Terminal 2: Node Server
node server.js
```

### Access Interface
- Upload Interface: http://localhost:3002/teacher/upload.html
- API Documentation: http://localhost:8000/docs

---

## 📁 Output Structure

```
outputs/CBSE/Grade-8/chapter_id/
├── concepts.json              # AI-extracted educational concepts
├── episode_plan.json          # Episode structure (4-6 episodes)
├── Episode-1/
│   ├── script.json            # Complete episode script
│   ├── mcqs.json             # Quiz questions with explanations
│   └── audio/
│       ├── audio.mp3         # Complete episode (8-12 min)
│       └── segments/         # Individual voice clips
└── Episode-2/ ... Episode-N/
```

---

## 🔧 System Architecture

- **Node.js Server** (port 3002): Main pipeline orchestration
- **Python Backend** (port 8000): Multi-LLM service (OpenAI + Gemini)
- **Real API Integration**: Production-ready OpenAI, Gemini & Google TTS
- **Quality Assurance**: Multi-layer validation and automated repair

---

## 📊 Performance Metrics

- **Processing Time**: 5-15 minutes per chapter
- **Episode Generation**: 4-6 episodes per chapter (auto-planned)
- **Episode Duration**: 8-12 minutes per episode
- **Audio Quality**: 24kHz, professional broadcast-ready
- **Cost**: ~$0.64-2.50 per 100 chapters (depending on LLM provider)

---

## 🆘 Support

For detailed setup instructions, see the [Complete Generation Guide](./COMPLETE_GENERATION_GUIDE.md).

For TTS configuration help, see the [TTS Configuration Guide](./TTS_CONFIGURATION.md).

For migration and update information, see the [Migration Guide](./MIGRATION.md).

---

**Ready for Production K-12 Content Generation** 🚀