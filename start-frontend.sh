#!/bin/bash

echo "🚀 Starting Educational Audio Revision System - Frontend"
echo "======================================================="

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+ or use nvm:"
    echo "   nvm use 18"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version)
echo "📦 Using Node.js: $NODE_VERSION"

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📥 Installing Node.js dependencies..."
    source ~/.nvm/nvm.sh && nvm use 18 && npm install
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚠️  Warning: .env file not found in root directory"
    echo "   For full functionality, create .env with:"
    echo "   GOOGLE_TTS_API_KEY=your_google_tts_key"
    echo "   SUPABASE_BASE_URL=your_supabase_url (optional)"
    echo "   SUPABASE_KEY=your_supabase_key (optional)"
    echo ""
fi

echo "🌐 Starting Node.js Express server on http://localhost:3000"
echo "   - Main interface: http://localhost:3000"
echo "   - Educational interface: http://localhost:3000/educational.html"
echo "   - API endpoints: /api/upload-pdf, /api/generate-script, /api/start"
echo "   - Logs will appear below..."
echo ""

# Ensure we're using the right Node.js version
source ~/.nvm/nvm.sh && nvm use 18 && npm start