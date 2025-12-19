# Google Cloud TTS Setup Guide

## Issue
Google Cloud Text-to-Speech API requires service account authentication, not just API keys.

## Quick Fix Options

### Option 1: Use Service Account (Recommended)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Text-to-Speech API
4. Go to "IAM & Admin" → "Service Accounts"
5. Create a new service account
6. Download the JSON key file
7. Set environment variable:
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"
   ```

### Option 2: Use ElevenLabs (Simpler)
1. Get ElevenLabs API key from [ElevenLabs](https://elevenlabs.io/)
2. Update `.env` file:
   ```env
   ELEVENLABS_API_KEY=your_elevenlabs_key_here
   TTS_PROVIDER=elevenlabs
   ```

### Option 3: Use Browser Speech Synthesis (Free, Limited)
- No API keys needed
- Limited voice options
- Works in browser only

## Current Status
- ❌ Google TTS: Needs service account setup
- ✅ Script cleaning: Working
- ✅ PDF processing: Working
- ✅ AI script generation: Working

## Recommended Next Steps
1. Set up Google Cloud service account (best quality, Indian voices)
2. OR switch to ElevenLabs (easier setup, good quality)
3. OR use browser TTS (free, basic quality)