from fastapi import FastAPI
from pydantic import BaseModel
import os
from dotenv import load_dotenv

load_dotenv()

from google import generativeai as genai


def get_gemini_model():
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None, None
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.5-pro")  # Use pro for higher quality text
    return model, api_key

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

    # Prepare messages for Gemini: each history/context as a message, then the prompt
    messages = []
    for h in req.history:
        messages.append({"role": "user", "parts": [str(h)]})
    messages.append({"role": "user", "parts": [req.prompt]})

    try:
        response = model.generate_content(messages)
        return {"response": response.text}
    except Exception as e:
        return {"response": f"Error calling Gemini API: {str(e)}"}

@app.get("/")
def root():
    return {"status": "ok"}
