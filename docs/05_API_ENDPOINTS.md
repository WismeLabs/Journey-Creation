# API Endpoints

## Base URLs

- **Node.js Backend**: `http://localhost:3000`
- **Python Backend**: `http://localhost:8000`

---

## Node.js Backend (Port 3000)

### Content Generation

#### Upload & Generate
```http
POST /api/v1/generate
Content-Type: multipart/form-data

Body:
- file: PDF file (optional if text provided)
- text_content: Plain text (optional if file provided)
- grade_band: "8"
- subject: "Science"
- curriculum: "CBSE"
- language: "English"
- speaker1_name: "Maya" (optional, default: Maya)
- speaker2_name: "Arjun" (optional, default: Arjun)
- llm_provider: "auto" | "openai" | "gemini"

Response:
{
  "success": true,
  "chapter_id": "chapter_abc123",
  "message": "Processing started"
}
```

#### Check Status
```http
GET /api/v1/status/:chapter_id

Response:
{
  "chapter_id": "chapter_abc123",
  "status": "content_generating",
  "current_step": "Generating episode scripts",
  "progress": 60,
  "episodes_completed": 2,
  "total_episodes": 5
}
```

### Chapter Management

#### Get All Chapters
```http
GET /api/v1/chapters/all

Response:
{
  "chapters": [
    {
      "chapter_id": "chapter_abc123",
      "curriculum": "CBSE",
      "grade_band": "8",
      "subject": "Science",
      "chapter_name": "Photosynthesis",
      "status": "plan_generated",
      "episode_count": 5,
      "created_at": "2025-11-26T10:30:00Z"
    }
  ]
}
```

#### Get Chapter Details
```http
GET /api/v1/chapter/:chapter_id

Response:
{
  "chapter_id": "chapter_abc123",
  "metadata": { ... },
  "concepts": [ ... ],
  "episode_plan": { ... },
  "episodes": [ ... ],
  "workflow_status": "plan_generated"
}
```

#### Get Workflow Status
```http
GET /api/v1/chapter/:chapter_id/workflow-status

Response:
{
  "status": "content_generating",
  "step": "script_generation",
  "progress": 60,
  "last_updated": "2025-11-26T10:35:00Z"
}
```

### Approval & Regeneration

#### Approve Episode Plan
```http
POST /api/v1/chapter/:chapter_id/approve-plan

Response:
{
  "success": true,
  "message": "Episode plan approved",
  "next_step": "content_generation"
}
```

#### Approve Individual Episode
```http
POST /api/v1/chapter/:chapter_id/approve-episode/:episode_num

Response:
{
  "success": true,
  "episode_number": 1,
  "message": "Episode approved"
}
```

#### Request Revision
```http
POST /api/v1/chapter/:chapter_id/request-revision
Content-Type: application/json

Body:
{
  "episode_number": 1,
  "regeneration_type": "regen_natural_dialogue",
  "feedback": "Make dialogue more engaging"
}

Response:
{
  "success": true,
  "message": "Regeneration started"
}
```

### Voice & Audio

#### Get Available Voices
```http
GET /api/v1/voices

Response:
{
  "voices": [
    {
      "name": "en-US-Neural2-A",
      "gender": "FEMALE",
      "language": "en-US",
      "provider": "google"
    }
  ]
}
```

#### Generate Audio
```http
POST /api/v1/generate-audio
Content-Type: application/json

Body:
{
  "chapter_id": "chapter_abc123",
  "voice_config": {
    "speaker1_name": "Maya",
    "speaker1_voice": "en-US-Neural2-C",
    "speaker2_name": "Arjun",
    "speaker2_voice": "en-US-Neural2-D"
  }
}

Response:
{
  "success": true,
  "message": "Audio generation started",
  "estimated_time": "10-15 minutes"
}
```

#### Get Audio Status
```http
GET /api/v1/chapter/:chapter_id/audio-status

Response:
{
  "status": "audio_generating",
  "episodes_completed": 2,
  "total_episodes": 5,
  "current_episode": 3
}
```

### System Monitoring

#### System Metrics
```http
GET /api/v1/metrics

Response:
{
  "uptime": 3600,
  "requests_total": 42,
  "active_jobs": 2,
  "cache_hits": 15,
  "cache_misses": 8,
  "memory_usage_mb": 256
}
```

#### Cache Stats
```http
GET /api/v1/cache/stats

Response:
{
  "total_entries": 42,
  "cache_hit_rate": 65.2,
  "estimated_savings_usd": 12.50,
  "cache_size_mb": 5.2,
  "oldest_entry": "2025-11-20T10:00:00Z"
}
```

#### Clear Cache
```http
DELETE /api/v1/cache/clear

Response:
{
  "success": true,
  "entries_cleared": 42,
  "message": "Cache cleared successfully"
}
```

#### Get Logs
```http
GET /api/v1/logs?level=error&limit=100

Response:
{
  "logs": [
    {
      "timestamp": "2025-11-26T10:30:00Z",
      "level": "ERROR",
      "message": "LLM timeout on concept extraction",
      "stack": "..."
    }
  ]
}
```

---

## Python Backend (Port 8000)

### Health Check

```http
GET /health

Response:
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600
}
```

### Concept Extraction

```http
POST /extract_concepts
Content-Type: application/json

Body:
{
  "markdown_content": "# Chapter 1\n\nPhotosynthesis is...",
  "metadata": {
    "grade_band": "8",
    "subject": "Science",
    "llm_provider": "openai"
  }
}

Response:
{
  "concepts": [
    {
      "id": "photosynthesis",
      "name": "Photosynthesis",
      "importance": 5,
      "difficulty": "medium",
      "exam_relevance": ["long_answer", "diagram"],
      "common_misconceptions": ["Plants eat soil"],
      "memory_hooks": ["Solar-powered food factory"],
      "humor_potential": "high",
      ...
    }
  ],
  "graph": [["chlorophyll", "photosynthesis"]]
}
```

### Script Generation

```http
POST /generate_script
Content-Type: application/json

Body:
{
  "episode_plan": {
    "episode_number": 1,
    "title": "Photosynthesis Basics",
    "concepts": ["photosynthesis", "chlorophyll"]
  },
  "concepts": [ ... ],
  "chapter_content": "...",
  "metadata": {
    "grade_band": "8",
    "speaker1_name": "Maya",
    "speaker2_name": "Arjun",
    "duration_minutes": 7,
    "llm_provider": "openai"
  }
}

Response:
{
  "episode_index": 1,
  "title": "Episode 1: Photosynthesis Basics",
  "estimated_duration_seconds": 420,
  "word_count": 685,
  "engagement_score": 8,
  "humor_used": ["Solar panel analogy"],
  "sections": [ ... ],
  "concept_ids": ["photosynthesis", "chlorophyll"]
}
```

### MCQ Generation

```http
POST /generate_mcqs
Content-Type: application/json

Body:
{
  "script": { ... },
  "concepts": [ ... ],
  "metadata": {
    "grade_band": "8",
    "count": 6
  }
}

Response:
{
  "mcqs": [
    {
      "qid": "q1",
      "concept_id": "photosynthesis",
      "type": "application",
      "difficulty": 3,
      "question_text": "A plant kept in dark closet for 2 weeks will...",
      "options": [ ... ],
      "correct_index": 0,
      "explanation": "...",
      "misconception_addressed": "Plants eat soil"
    }
  ]
}
```

### Content Regeneration

```http
POST /regenerate
Content-Type: application/json

Body:
{
  "prompt_type": "regen_natural_dialogue",
  "content": { ... },
  "metadata": { ... }
}

Response:
{
  "script_text": "...",
  "naturalness_improvements": [ ... ],
  "engagement_score": 9
}
```

### TTS Generation

```http
POST /tts/generate
Content-Type: application/json

Body:
{
  "script": { ... },
  "voice_config": {
    "speaker1_voice": "en-US-Neural2-C",
    "speaker2_voice": "en-US-Neural2-D"
  },
  "output_path": "outputs/chapter_abc/Episode-1/audio.mp3"
}

Response:
{
  "success": true,
  "audio_file": "outputs/chapter_abc/Episode-1/audio.mp3",
  "duration_seconds": 425
}
```

---

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message",
  "details": "Detailed error information",
  "code": "ERROR_CODE"
}
```

Common HTTP Status Codes:
- `200` - Success
- `400` - Bad request (invalid parameters)
- `404` - Resource not found
- `500` - Server error
- `503` - Service unavailable (LLM/TTS down)

---

## Rate Limiting

No rate limiting currently implemented (internal tool).

For production:
- Consider implementing rate limits
- Add authentication/API keys
- Monitor usage per user/team

---

## WebSocket (Future)

For real-time progress updates:
```javascript
const ws = new WebSocket('ws://localhost:3000/ws/progress');
ws.onmessage = (event) => {
  const progress = JSON.parse(event.data);
  console.log(progress);
};
```

Not currently implemented - using polling for status updates.

---

## File Outputs

Generated files accessible via filesystem:

```
outputs/chapter_{id}/gen_{timestamp}/
├── chapter.md
├── concepts.json
├── episode_plan.json
├── workflow_status.json
├── Episode-1/
│   ├── script.json
│   ├── mcqs.json
│   └── audio.mp3
```

Served via static file server:
```
GET /outputs/chapter_abc123/gen_123456/Episode-1/audio.mp3
```

---

## Testing Endpoints

Use curl or Postman:

```powershell
# Upload chapter
curl -X POST http://localhost:3000/api/v1/generate `
  -F "file=@chapter.pdf" `
  -F "grade_band=8" `
  -F "subject=Science" `
  -F "curriculum=CBSE"

# Check status
curl http://localhost:3000/api/v1/status/chapter_abc123

# Get all chapters
curl http://localhost:3000/api/v1/chapters/all

# Health check
curl http://localhost:8000/health
```
