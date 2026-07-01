#!/usr/bin/env python3
"""Production server: serve the React build and the FastAPI backend."""
import os
import sys
from pathlib import Path

# Add server directory to path
sys.path.insert(0, str(Path(__file__).parent))

from app import app
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

dist_path = Path(__file__).parent.parent / "dist"


class SPAStaticFiles(StaticFiles):
    """Serve index.html for client-side routes handled by React Router."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code == 404 and scope["method"] in {"GET", "HEAD"}:
                if path == "api" or path.startswith("api/"):
                    raise
                return await super().get_response("index.html", scope)
            raise


def remove_api_root_route() -> None:
    app.router.routes = [
        route
        for route in app.router.routes
        if not (
            getattr(route, "path", None) == "/"
            and "GET" in getattr(route, "methods", set())
        )
    ]


if dist_path.exists():
    print(f"Mounting React app from: {dist_path}")
    remove_api_root_route()
    app.mount("/", SPAStaticFiles(directory=str(dist_path), html=True), name="static")
else:

    @app.get("/{full_path:path}")
    async def fallback(full_path: str):
        """Fallback for development when dist doesn't exist"""
        return {
            "message": "React app not built yet. Run 'npm run build' first.",
            "path": full_path,
        }

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "0.0.0.0")

    print(f"Starting server at {host}:{port}")
    print(f"React build path: {dist_path}")
    print("API endpoints remain available under /api/*")

    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
    )
