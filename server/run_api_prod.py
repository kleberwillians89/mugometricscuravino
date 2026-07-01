#!/usr/bin/env python3
"""
Production server: Serve React static files + FastAPI backend
"""
import os
import sys
from pathlib import Path

# Add server directory to path
sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app import app as fastapi_app

# Path to React build
dist_path = Path(__file__).parent.parent / "dist"

# Mount React static files with SPA fallback
if dist_path.exists():
    print(f"✅ Mounting React app from: {dist_path}")
    fastapi_app.mount(
        "/",
        StaticFiles(directory=str(dist_path), html=True),
        name="static"
    )
else:
    print(f"⚠️  dist folder not found at {dist_path}")
    print("   Make sure to run: npm run build")

if __name__ == "__main__":
    import uvicorn
    
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")
    
    print(f"🚀 Starting server at {host}:{port}")
    print(f"📦 React build path: {dist_path}")
    print(f"   Serving React from /")
    print(f"   API endpoints at /api/*")
    
    uvicorn.run(
        fastapi_app,
        host=host,
        port=port,
        log_level="info",
    )
