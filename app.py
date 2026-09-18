"""GROWW Weekly Review Pulse - Vercel entrypoint (FastAPI).

Serves the static dashboard (web/) AND the note/email generation endpoints,
reusing the canonical modules in api/_lib (shared with the local pipeline).
"""
import json
import os
import sys

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "api", "_lib"))

import pulse_generate  # noqa: E402

app = FastAPI(title="GROWW Weekly Review Pulse")


@app.post("/api/note")
def api_note():
    try:
        note = pulse_generate.generate_note(os.path.join(ROOT, "data", "reviews_all.csv"))
        note["used_api_key"] = bool(pulse_generate.gemini_key())
        return note
    except Exception as exc:  # pragma: no cover
        return JSONResponse({"error": str(exc)}, status_code=500)


@app.post("/api/email")
def api_email():
    data_file = os.path.join(ROOT, "web", "dashboard_data.json")
    try:
        with open(data_file, encoding="utf-8") as fh:
            data = json.load(fh)
        existing = data.get("note") or {}
        note_text = existing.get("text") or ""
        top3 = existing.get("themes") or data.get("top3") or []
        coverage = existing.get("coverage")
        if isinstance(top3[0], str):
            by_name = {t["theme"]: t for t in data.get("themes") or []}
            top3 = [by_name[n] for n in top3 if n in by_name]
        if not note_text:
            generated = pulse_generate.generate_note(os.path.join(ROOT, "data", "reviews_all.csv"))
            note_text = generated["text"]
            top3 = generated.get("themes") or []
            coverage = generated.get("coverage")
        email = pulse_generate.generate_email(note_text, top3, coverage)
        email["used_api_key"] = bool(pulse_generate.gemini_key())
        return email
    except Exception as exc:  # pragma: no cover
        return JSONResponse({"error": str(exc)}, status_code=500)


app.mount("/", StaticFiles(directory=os.path.join(ROOT, "web"), html=True), name="dashboard")