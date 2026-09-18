#!/usr/bin/env python3
"""GROWW Weekly Review Pulse - export one-page note + email draft deliverables.

Reads web/dashboard_data.json (built by 5_build_dashboard.py), writes:
  output/weekly_note.md      - the one-page weekly note
  output/email_draft.txt     - email draft in plain text
  output/email_draft.html    - email draft as an HTML mail-ready document

Email is synthesised deterministically from the note (generate_email falls
back to fixed lead/ask text when no GEMINI_API_KEY is set), so this step
never requires an LLM key.
"""
import json
import html
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import pulse_generate  # noqa: E402

DATA_FILE = os.path.join(ROOT, "web", "dashboard_data.json")
OUT_DIR = os.path.join(ROOT, "output")


def main():
    with open(DATA_FILE, encoding="utf-8") as fh:
        data = json.load(fh)

    note = data.get("note") or {}
    note_text = note.get("text") or ""
    top3 = data.get("top3") or note.get("themes") or []
    coverage = note.get("coverage") or data.get("coverage")
    legend = data.get("legend") or []

    if top3 and isinstance(top3[0], str):
        themes = data.get("themes") or []
        by_name = {t["theme"]: t for t in themes}
        top3 = [by_name[name] for name in top3 if name in by_name]

    os.makedirs(OUT_DIR, exist_ok=True)

    generated_at = data.get("generated_at", "unknown")
    src = data.get("source_breakdown") or {}
    src_txt = " + ".join(f"{k} {v}" for k, v in src.items())
    date_range = data.get("date_range") or {}
    range_txt = f"{date_range.get('min')} \u2192 {date_range.get('max')}"

    md_lines = [
        "# GROWW \u2014 Weekly Review Pulse",
        "",
        f"Generated: {generated_at}  \u00b7  Source: {src_txt}  \u00b7  Total {data.get('source_count', 0)} reviews  \u00b7  Window: {range_txt}",
        "",
        note_text,
        "",
        "---",
        "",
        "## Theme legend",
        "",
    ]
    if legend and isinstance(legend[0], str):
        md_lines += [f"- **{name}**" for name in legend]
    elif legend:
        md_lines += [f"- **{entry.get('theme', '')}** \u2014 {entry.get('definition', '')}" for entry in legend]
    else:
        md_lines += ["- The note's bold headings are the detected themes (max 5)."]
    md_lines += [""]
    md_text = "\n".join(md_lines)

    email = pulse_generate.generate_email(note_text, top3, coverage)
    subject = email["subject"]
    body = email["body"]

    with open(os.path.join(OUT_DIR, "weekly_note.md"), "w", encoding="utf-8") as fh:
        fh.write(md_text)
    with open(os.path.join(OUT_DIR, "email_draft.txt"), "w", encoding="utf-8") as fh:
        fh.write(f"Subject: {subject}\n\n{body}\n")
    with open(os.path.join(OUT_DIR, "email_draft.html"), "w", encoding="utf-8") as fh:
        fh.write(
            "<!DOCTYPE html><html><head><meta charset='utf-8'>"
            "<title>GROWW Weekly Review Pulse - email draft</title></head>"
            "<body style='font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:24px auto;"
            "line-height:1.5;color:#222'>"
            f"<h2>{html.escape(subject)}</h2>"
            f"<pre style='white-space:pre-wrap;font:inherit'>{html.escape(body)}</pre>"
            "</body></html>"
        )

    words = len(note_text.split())
    print("Wrote output/weekly_note.md")
    print("Wrote output/email_draft.txt")
    print("Wrote output/email_draft.html")
    print(f"Note words: {words} (limit 250)  \u00b7  Email subject: {subject}")
    if words > 250:
        print("WARN: note exceeds 250 words", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())