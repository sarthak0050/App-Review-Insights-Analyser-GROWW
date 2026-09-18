#!/usr/bin/env python3
"""GROWW Weekly Review Pulse - local server.

Serves the static web/ dashboard AND exposes the generate endpoints so the
UI has real buttons:

    GET  /                     static dashboard (web/index.html + assets)
    POST /api/note             generate weekly note (Gemini if key set, else preview)
    POST /api/email            generate email draft from the current note

No dependencies (stdlib only). Set GEMINI_API_KEY to enable real generation:

    GEMINI_API_KEY=... python3 serve_dashboard.py 8000

Later Vercel host: the same endpoints become api/note.py + api/email.py.
"""

import json
import mimetypes
import os
import smtplib
import sys
import urllib.parse
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.join(os.path.dirname(__file__), "..", "web")
DATA_FILE = os.path.join(ROOT, "dashboard_data.json")
CSV_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "reviews_all.csv")

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_EMAIL = os.environ.get("SMTP_EMAIL", "")
SMTP_APP_PASSWORD = os.environ.get("SMTP_APP_PASSWORD", "")

sys.path.insert(0, os.path.dirname(__file__))
import pulse_generate  # noqa: E402

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}


def send_email(to, subject, text):
    if not SMTP_EMAIL or not SMTP_APP_PASSWORD:
        raise RuntimeError(
            "SMTP not configured. Restart with SMTP_EMAIL + SMTP_APP_PASSWORD (Gmail App Password, "
            "see README 'Send email for real').")
    msg = MIMEText(text, "plain", "utf-8")
    msg["From"] = formataddr(("Weekly Review Pulse", SMTP_EMAIL))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as s:
        s.ehlo()
        s.starttls()
        s.ehlo()
        s.login(SMTP_EMAIL, SMTP_APP_PASSWORD)
        s.sendmail(SMTP_EMAIL, [to], msg.as_string())


def smtp_configured():
    return bool(SMTP_EMAIL and SMTP_APP_PASSWORD)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def _send_json(self, payload, code=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_static(self, path):
        if path in ("/", "/index.html"):
            path = "/index.html"
        rel = urllib.parse.unquote(path.lstrip("/"))
        full = os.path.abspath(os.path.join(ROOT, rel))
        if not full.startswith(os.path.abspath(ROOT) + os.sep):
            self.send_error(403)
            return
        if not os.path.isfile(full):
            self.send_error(404)
            return
        ctype = MIME.get(os.path.splitext(full)[1], "application/octet-stream")
        with open(full, "rb") as fh:
            body = fh.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8") or "{}")

    def _load_data(self):
        if os.path.isfile(DATA_FILE):
            with open(DATA_FILE, encoding="utf-8") as fh:
                return json.load(fh)
        return {}

    def _save_note(self, note):
        data = self._load_data()
        data["note"] = note
        with open(DATA_FILE, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path in ("/api/note", "/api/email"):
            self._send_json({"message": "use POST", "note": "GET only serves static files"}, 405)
            return
        self._send_static(path)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        try:
            if path == "/api/note":
                key = bool(pulse_generate.gemini_key())
                note = pulse_generate.generate_note(CSV_FILE)
                self._save_note(note)
                note["used_api_key"] = key
                self._send_json(note)
                return
            if path == "/api/email":
                data = self._load_data()
                existing = data.get("note") or {}
                note_text = existing.get("text") or ""
                top3 = existing.get("themes") or data.get("top3") or []
                coverage = existing.get("coverage")
                key = bool(pulse_generate.gemini_key())
                if not note_text:
                    generated = pulse_generate.generate_note(CSV_FILE)
                    note_text = generated["text"]
                    top3 = generated.get("themes") or []
                    coverage = generated.get("coverage")
                    self._save_note(generated)
                email = pulse_generate.generate_email(note_text, top3, coverage)
                email["used_api_key"] = key
                email["smtp_configured"] = smtp_configured()
                self._send_json(email)
                return
            if path == "/api/send":
                body = self._read_body()
                to = str(body.get("recipient") or "").strip()
                subject = str(body.get("subject") or "").strip()
                text = str(body.get("body") or "").strip()
                if not to or not subject or not text:
                    self._send_json({"error": "recipient, subject and body are required"}, 400)
                    return
                try:
                    send_email(to, subject, text)
                except RuntimeError as exc:
                    self._send_json({"error": str(exc)}, 400)
                    return
                except Exception as exc:
                    self._send_json({"error": "%s: %s" % (type(exc).__name__, exc)}, 502)
                    return
                self._send_json({"ok": True, "to": to})
                return
        except RuntimeError as exc:
            self._send_json({"error": str(exc)}, 502)
            return
        except Exception as exc:
            self._send_json({"error": "%s: %s" % (type(exc).__name__, exc)}, 500)
            return
        self.send_error(404)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Serving dashboard at http://localhost:{port}")
    print("GEMINI_API_KEY " + ("set -> real generation" if pulse_generate.gemini_key() else "NOT set -> deterministic previews"))
    print("SMTP " + ("configured -> Send email enabled" if smtp_configured() else "NOT configured -> draft-only (.eml / copy)"))
    print("POST /api/note | /api/email | /api/send")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()