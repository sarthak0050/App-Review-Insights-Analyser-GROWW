"""GROWW Weekly Review Pulse - prompt-based note + email generation.

Uses the free Gemini API (aistudio.google.com, no card) when GEMINI_API_KEY
is set; otherwise falls back to a deterministic preview so every part of the
pipeline is exercisable without a key. Mirrors appsscript/note_generator.gs
and appsscript/email_generator.gs so local and Google-side outputs match
contracts: note <= 250 words, top-3 quotes verbatim, one action per theme.
"""

import json
import os
import re
import ssl
import urllib.request
import urllib.error

try:
    import certifi
except ImportError:
    certifi = None

try:
    from pulse_shared import THEME_NAMES, rule_classify, exact_quote, theme_stats, sentence, coverage_footer
except ImportError:
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
    from pulse_shared import THEME_NAMES, rule_classify, exact_quote, theme_stats, sentence, coverage_footer

MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GEMINI_RETRY_MAX = 3
WORD_LIMIT = 250


def gemini_key():
    return os.environ.get("GEMINI_API_KEY", "").strip()


def gemini_text(system, prompt, temperature=0.4, max_tokens=1024):
    key = gemini_key()
    if not key:
        raise RuntimeError("GEMINI_API_KEY not set")
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "systemInstruction": {"parts": [{"text": system}]},
        "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens},
    }
    url = API_BASE.replace("{model}", MODEL) + "?key=" + key
    data = json.dumps(body).encode("utf-8")
    context = ssl.create_default_context(cafile=certifi.where()) if certifi else None
    for attempt in range(GEMINI_RETRY_MAX + 1):
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=90, context=context) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            parts = payload.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts)
            if text:
                return text.strip()
            raise RuntimeError("Gemini returned no text: " + json.dumps(payload)[:200])
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                import time
                time.sleep(3 * (attempt + 1))
                continue
            raise
    raise RuntimeError("Gemini: exhausted retries (429)")


def gemini_json(system, prompt, **kw):
    raw = gemini_text(system, prompt, **kw)
    match = re.search(r"\[[\s\S]*\]", raw)
    return json.loads(match.group(0) if match else raw)


def word_count(s):
    return len([w for w in str(s).split() if w])


def quote_for_theme(theme_rows):
    pool = [r for r in theme_rows if str(r.get("text") or "").strip()]
    pool.sort(key=lambda r: int(r["rating"]))
    if not pool:
        return {"quote": "", "rating": ""}
    q = exact_quote(pool[0]["text"], pool[0]["title"])
    src = pool[0]["text"] or pool[0]["title"] or ""
    if not q or q not in src:
        return {"quote": "", "rating": ""}
    return {"quote": q, "rating": pool[0]["rating"]}


def load_context(csv_path):
    import csv
    with open(csv_path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    for r in rows:
        r["_theme"] = rule_classify(r.get("title"), r.get("text"))
        r["rating"] = int(r["rating"])
    stats, unclassified = theme_stats(rows)
    by_theme = {}
    for r in rows:
        by_theme.setdefault(r["_theme"], []).append(r)
    for s in stats:
        q = quote_for_theme(by_theme.get(s["theme"], []))
        s["top_quote"] = q["quote"]
        s["top_quote_rating"] = q["rating"]
    top3 = [s for s in stats if s["rank"] <= 3 and s["count"] > 0 and s["top_quote"]][:3]
    return {"rows": rows, "themes": stats, "top3": top3, "unclassified": unclassified}


def build_overview(top3):
    top = top3[0]
    feed = (
        f"Ranked themes this week (most urgent first): {', '.join(t['theme'] for t in top3)}. "
        f"Most urgent: {top['theme']}. "
        "Do NOT repeat any counts, ratings or priority scores (the numbered list below shows them). "
        "Instead give ONE cross-cutting observation: tone, concentration, or a shared root cause "
        "that runs across this week's reviews."
    )
    system = (
        "You write one concise factual sentence (under 45 words) giving a cross-cutting observation "
        "about Groww app reviews this week. Base claims ONLY on the data provided. Never repeat stat "
        "numbers you were shown. No user names, no invented facts."
    )
    try:
        return gemini_text(system, feed, temperature=0.3, max_tokens=120)
    except RuntimeError as e:
        return (
            "Money movement and trade execution carry most of this window's friction — "
            "the ranked themes below show where attention is needed."
            if top
            else "No review signals this week."
        )


def build_theme_lines(top3):
    feed = "\n".join(
        f"{t['theme']}: {t['count']} reviews, avg {t['avg_rating']}/5, quote \"{t['top_quote']}\""
        for t in top3
    )
    system = (
        "For each of three themes return ONE sentence (max 35 words) summarising its signal and ONE action "
        "idea (max 25 words). Do not end sentences with a period more than once. Never invent data. "
        "Respond with ONLY this JSON array: "
        '[{"theme":"...","commentary":"...","action":"..."}]'
    )
    try:
        arr = gemini_json(system, "Themes:\n" + feed, temperature=0.4, max_tokens=700)
        return {item["theme"]: {"commentary": item.get("commentary", ""), "action": item.get("action", "")} for item in arr}
    except (RuntimeError, ValueError, KeyError):
        fallback = {}
        for t in top3:
            fallback[t["theme"]] = {
                "commentary": f"{t['count']} reviews averaging {t['avg_rating']}/5.",
                "action": f"Prioritise {t['theme']} investigation this week.",
            }
        return fallback


def assemble_note(overview, lines, top3, unclassified, total):
    header = "WEEKLY REVIEW PULSE - GROWW"
    footer = coverage_footer(total, unclassified)
    body = [overview]
    for t in top3:
        l = lines.get(t["theme"], {})
        commentary = sentence(l.get("commentary", ""))
        action = sentence(l.get("action", "")) if l.get("action") else ""
        line = f"{t['rank']}. {t['theme']} ({t['count']} reviews, ~{t['avg_rating']}/5): \"{t['top_quote']}\" - {commentary}"
        if action:
            line += f" Action: {action}"
        body.append(line)
    truncated = False
    body_max = max(1, WORD_LIMIT - word_count(footer))
    parts = [header] + body
    while word_count(" ".join(parts)) > body_max and len(parts) > 2:
        truncated = True
        tail = parts[-1].split(" ")
        parts[-1] = " ".join(tail[:-1])
    note = "\n".join(parts) + "\n" + footer
    return {"text": note, "word_count": word_count(note), "truncated": truncated}


def generate_note(csv_path="data/reviews_all.csv"):
    ctx = load_context(csv_path)
    if not ctx["top3"]:
        text = "WEEKLY REVIEW PULSE - GROWW\nNo qualifying themes this week."
        return {"text": text, "word_count": word_count(text), "truncated": False, "preview": False, "themes": []}
    overview = build_overview(ctx["top3"])
    lines = build_theme_lines(ctx["top3"])
    unclassified = ctx["unclassified"]
    total = len(ctx["rows"])
    note = assemble_note(overview, lines, ctx["top3"], unclassified, total)
    used_key = bool(gemini_key())
    note["is_preview"] = not used_key
    note["used_api_key"] = used_key
    note["themes"] = ctx["top3"]
    note["coverage"] = {
        "total": total,
        "classified": total - unclassified,
        "unclassified": unclassified,
    }
    return note


def generate_email(note_text, top3, coverage=None):
    urgent = top3[0] if top3 else None
    date = context_date()
    if not urgent:
        return {
            "subject": "Weekly Review Pulse - GROWW (no signals)",
            "body": "Hi team,\n\nThis week no theme crossed the priority threshold.\n\n"
                    "\u2014 Weekly Review Pulse (automated summary, " + date + ")",
        }

    frame_feed = (
        f"Most urgent theme: {urgent['theme']}. Ranked: {', '.join(t['theme'] for t in top3)}. "
        "Quote: \"" + urgent['top_quote'] + "\". "
        "Write ONE lead-in sentence (max 25 words) that hooks a product/leadership reader on what "
        "reviewers are telling us. Do NOT repeat the counts, ratings or priority numbers (the digest "
        "below shows them). Quote usage verbatim is allowed."
    )
    frame_sys = (
        "You write one lead-in sentence (max 25 words) for a product-leadership digest built from app "
        "reviews of Groww. Base it only on the data given, do not repeat stat numbers, no user names."
    )
    ask_feed = (
        f"Based on theme {urgent['theme']} ({urgent['count']} reviews, avg {urgent['avg_rating']}/5), "
        "write ONE direct next-step ask for the product team (max 20 words, no invented data)."
    )
    ask_sys = "You write one direct next-step ask for a product team, max 20 words, based only on the data given."
    try:
        frame = sentence(gemini_text(frame_sys, frame_feed, temperature=0.3, max_tokens=120))
        if frame == ".":
            frame = "Reviewer feedback this week points at money movement and trade execution."
    except RuntimeError:
        frame = "Reviewer feedback this week points at money movement and trade execution."
    try:
        ask = sentence(gemini_text(ask_sys, ask_feed, temperature=0.4, max_tokens=120))
    except RuntimeError:
        ask = f"Please treat {urgent['theme']} as the top priority this week."

    bullets = []
    for t in top3:
        score = t.get("priority_score")
        score_txt = f", priority {score:.1f}" if isinstance(score, (int, float)) else ""
        bullets.append(
            f"• {t['theme']} \u2014 {t['count']} reviews, ~{t['avg_rating']}/5{score_txt}: "
            f"\"{t['top_quote']}\""
        )
    body = "\n".join(
        [
            "Hi team,",
            "",
            frame,
            "",
            "What reviewers are telling us:",
            *bullets,
            "",
            "Next step: " + ask,
            "",
            "\u2014 Weekly Review Pulse (automated summary, " + date + ")" + coverage_footer_suffix(coverage),
        ]
    )
    return {
        "subject": f"Weekly Review Pulse - GROWW ({date})",
        "body": body,
    }


def coverage_footer_suffix(coverage):
    if not coverage:
        return ""
    return " · " + coverage_footer(
        coverage.get("total", 0), coverage.get("unclassified", 0)
    ).rstrip(".")


def context_date():
    import datetime
    return datetime.date.today().isoformat()