"""
Sentinel Campus CV Engine - Main Entrypoint
Exports FastAPI app from face_engine for Vercel multi-service deployment.
"""
from face_engine import app

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
