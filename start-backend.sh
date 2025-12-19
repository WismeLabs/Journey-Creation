#!/bin/bash

echo "🚀 Starting Educational Audio Revision System - Backend"
echo "=================================================="

# Check if virtual environment exists
if [ ! -d "hf_backend/venv" ]; then
    echo "❌ Virtual environment not found. Please run:"
    echo "   cd hf_backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# Check if .env file exists
if [ ! -f "hf_backend/.env" ]; then
    echo "⚠️  Warning: .env file not found in hf_backend/"
    echo "   Please create hf_backend/.env with your GEMINI_API_KEY"
    echo ""
    echo "   Quick setup:"
    echo "   1. Copy the example: cp hf_backend/.env.example hf_backend/.env"
    echo "   2. Edit hf_backend/.env and add your Gemini API key"
    echo "   3. Get API key from: https://makersuite.google.com/app/apikey"
    echo ""
    echo "   The server will start but won't generate content without the API key."
    echo ""
fi

echo "🐍 Activating Python virtual environment..."
cd hf_backend
source venv/bin/activate

echo "🤖 Starting Python FastAPI backend on http://localhost:8000"
echo "   - Endpoint: /generate (for Gemini AI text generation)"
echo "   - Logs will appear below..."
echo ""

python main.py