from fastapi import FastAPI
from pydantic import BaseModel
import os
import sys
import warnings

# Suppress warnings for older Python versions
warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("python-dotenv not found, using environment variables directly")

try:
    from google import generativeai as genai
except ImportError as e:
    print(f"Error importing google-generativeai: {e}")
    print("Please install with: pip install google-generativeai")
    sys.exit(1)


def get_gemini_model():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("❌ GEMINI_API_KEY not found in environment variables")
        print("   Please create hf_backend/.env with: GEMINI_API_KEY=your_api_key_here")
        return None, None
    
    try:
        genai.configure(api_key=api_key)
        # Use Gemini 2.0 Flash - latest model for educational content
        try:
            model = genai.GenerativeModel("gemini-2.0-flash-exp")
            print(f"✅ Using Gemini 2.0 Flash model")
        except Exception as e:
            print(f"⚠️  Gemini 2.0 Flash not available, trying fallback: {e}")
            try:
                model = genai.GenerativeModel("gemini-1.5-flash")
                print(f"✅ Using Gemini 1.5 Flash model")
            except:
                model = genai.GenerativeModel("gemini-pro")
                print(f"✅ Using Gemini Pro model")
        print(f"✅ Gemini model initialized successfully")
        return model, api_key
    except Exception as e:
        print(f"❌ Error configuring Gemini: {e}")
        return None, None

app = FastAPI()

class PromptRequest(BaseModel):
    prompt: str
    history: list = []


@app.post("/generate")
def generate(req: PromptRequest):
    model, api_key = get_gemini_model()
    if not api_key:
        return {"response": "Error: Gemini API key not set. Please add GEMINI_API_KEY to your .env file."}
    if not model:
        return {"response": "Error: Gemini model failed to initialize."}

    try:
        # For educational content, use a simpler approach
        # Just send the prompt directly for better compatibility
        print(f"🤖 Generating content with prompt length: {len(req.prompt)} characters")
        
        response = model.generate_content(req.prompt)
        
        if response and response.text:
            print(f"✅ Generated response length: {len(response.text)} characters")
            return {"response": response.text}
        else:
            print("❌ Empty response from Gemini")
            return {"response": "Error: Empty response from Gemini API"}
            
    except Exception as e:
        print(f"❌ Error calling Gemini API: {e}")
        return {"response": f"Error calling Gemini API: {str(e)}"}

@app.get("/")
def root():
    model, api_key = get_gemini_model()
    return {
        "status": "ok",
        "gemini_configured": api_key is not None,
        "model_available": model is not None
    }

if __name__ == "__main__":
    import uvicorn
    print("🚀 Starting Educational Audio Revision Backend")
    print("===============================================")
    print("📍 Server: http://localhost:8000")
    print("🔗 Endpoints:")
    print("   GET  /          - Health check")
    print("   POST /generate  - Generate educational content")
    print("")
    
    # Test Gemini connection
    model, api_key = get_gemini_model()
    if not api_key:
        print("⚠️  Warning: GEMINI_API_KEY not configured")
        print("   Create hf_backend/.env with your API key")
    
    uvicorn.run(app, host="0.0.0.0", port=8000)
