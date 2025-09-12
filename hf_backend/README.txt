# To run the Hugging Face backend:
# 1. Open a terminal in this folder.
# 2. (Optional but recommended) Create a virtual environment:
#    python -m venv venv
#    venv\Scripts\activate  (Windows) or source venv/bin/activate (Linux/Mac)
# 3. Install dependencies:
#    pip install -r requirements.txt
# 4. Start the server:
#    uvicorn main:app --host 127.0.0.1 --port 8000
#
# The API will be available at http://127.0.0.1:8000/generate
#
# Example request (from Node.js or curl):
# curl -X POST http://127.0.0.1:8000/generate -H "Content-Type: application/json" -d '{"prompt": "Hello!"}'
