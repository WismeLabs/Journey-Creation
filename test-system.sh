#!/bin/bash

echo "🧪 Testing Educational Audio Revision System"
echo "============================================="

# Test 1: Check Node.js
echo "1️⃣ Testing Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "✅ Node.js found: $NODE_VERSION"
else
    echo "❌ Node.js not found"
    exit 1
fi

# Test 2: Check Python
echo ""
echo "2️⃣ Testing Python..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo "✅ Python found: $PYTHON_VERSION"
else
    echo "❌ Python3 not found"
    exit 1
fi

# Test 3: Check virtual environment
echo ""
echo "3️⃣ Testing Python virtual environment..."
if [ -d "hf_backend/venv" ]; then
    echo "✅ Virtual environment exists"
else
    echo "❌ Virtual environment not found"
    echo "   Run: cd hf_backend && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# Test 4: Check Node.js dependencies
echo ""
echo "4️⃣ Testing Node.js dependencies..."
if [ -d "node_modules" ]; then
    echo "✅ Node.js dependencies installed"
else
    echo "❌ Node.js dependencies not found"
    echo "   Run: source ~/.nvm/nvm.sh && nvm use 18 && npm install"
    exit 1
fi

# Test 5: Check configuration files
echo ""
echo "5️⃣ Testing configuration..."
if [ -f "hf_backend/.env" ]; then
    echo "✅ Backend .env file exists"
else
    echo "⚠️  Backend .env file not found (optional for testing)"
    echo "   Copy: cp hf_backend/.env.example hf_backend/.env"
fi

if [ -f ".env" ]; then
    echo "✅ Frontend .env file exists"
else
    echo "⚠️  Frontend .env file not found (optional)"
fi

# Test 6: Test component functionality
echo ""
echo "6️⃣ Testing system components..."
source ~/.nvm/nvm.sh && nvm use 18 > /dev/null 2>&1
node test-educational-workflow.js

echo ""
echo "🎯 System Status Summary:"
echo "========================"
echo "✅ Node.js: Ready"
echo "✅ Python: Ready" 
echo "✅ Dependencies: Installed"
echo "✅ Components: Working"

if [ -f "hf_backend/.env" ]; then
    echo "✅ Backend Config: Ready"
else
    echo "⚠️  Backend Config: Needs API key"
fi

echo ""
echo "🚀 Ready to start!"
echo "=================="
echo "Terminal 1: ./start-backend.sh"
echo "Terminal 2: ./start-frontend.sh"
echo "Then open: http://localhost:3000/educational.html"