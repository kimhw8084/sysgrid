"""Serve the built desktop UI and API from one PaaS process."""

from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

from .main import app

DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if not (DIST / "index.html").is_file():
    raise RuntimeError("Frontend build is missing. Run: python3 scripts/paas.py build")

# The API's existing root route returns JSON. The combined service uses `/` for
# the UI; all existing /api and documentation routes retain their precedence.
app.router.routes[:] = [
    route for route in app.router.routes
    if not (getattr(route, "path", None) == "/" and "GET" in getattr(route, "methods", set()))
]


@app.get("/{path:path}", include_in_schema=False)
def serve_frontend(path: str):
    if path == "api" or path.startswith("api/"):
        raise HTTPException(status_code=404)

    candidate = (DIST / path).resolve()
    if not candidate.is_relative_to(DIST.resolve()):
        raise HTTPException(status_code=404)
    if candidate.is_file():
        return FileResponse(candidate)
    if "." in Path(path).name:
        raise HTTPException(status_code=404)
    return FileResponse(DIST / "index.html")
