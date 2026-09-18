#!/usr/bin/env python3
"""GROWW Weekly Review Pulse - Google Play Store importer.

Uses google-play-scraper's public Play Store endpoints (no login, no session
tokens). PII is stripped at import time: user names, review IDs and device
info are dropped before anything is written to disk.

COMPLIANCE (stop-and-report): if the pull fails, is rate-limited, or returns
no usable reviews, this script exits non-zero WITHOUT writing output and
prints a clear message. It never fabricates or substitutes data.
"""

import argparse
import csv
import re
import sys
from datetime import datetime, timedelta, timezone

from google_play_scraper import reviews, Sort

APP_ID = "com.nextbillion.groww"

PII_PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+"), "[EMAIL]"),
    (re.compile(r"(?<!\d)\d{9,}(?!\d)"), "[NUMBER]"),
    (re.compile(r"\+?\d[\d\s().-]{8,}\d"), "[PHONE]"),
    (re.compile(r"@\w{2,}"), "[HANDLE]"),
    (re.compile(r"\d{4,}"), "[NUMBER]"),
]

DROPPED_FIELDS = ["userName", "userImage", "reviewId", "appVersion", "replyContent", "repliedAt", "thumbsUpCount", "reviewCreatedVersion", "device"]


def scrub(text):
    if not text:
        return ""
    out = text
    for pat, rep in PII_PATTERNS:
        out = pat.sub(rep, out)
    return " ".join(out.split())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=200, help="max reviews per page (newest first)")
    ap.add_argument("--pages", type=int, default=2, help="request this many continuation pages; each may return up to count reviews but the endpoint rarely has more than ~3-5 days of history for high-volume apps")
    ap.add_argument("--country", default="in")
    ap.add_argument("--lang", default="en", help="play store review language; 'en' is the reliable one, 'in' often returns stale/empty")
    ap.add_argument("--days", type=int, default=84, help="keep reviews newer than this many days (84 = 12 weeks; the public endpoint itself only exposes the newest few days for high-volume apps)")
    ap.add_argument("--out", default="data/reviews_playstore.csv")
    args = ap.parse_args()

    rows_raw = []
    token = None
    first_failure = False
    for page in range(max(1, args.pages)):
        try:
            raw, token = reviews(APP_ID, count=args.count, sort=Sort.NEWEST, country=args.country, lang=args.lang, continuation_token=token)
            if not raw:
                break
            rows_raw.extend(raw)
        except Exception as exc:
            if page == 0:
                first_failure = True
                break
            print("NOTE: page %d failed (%s) - using %d already-fetched reviews" % (page + 1, exc, len(rows_raw)), file=sys.stderr)
            break

    if first_failure:
        print("PLAY STORE PULL FAILED - stopping per spec (no data substituted).", file=sys.stderr)
        print(f"detail: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(3)

    if not rows_raw:
        print("PLAY STORE PULL RETURNED ZERO REVIEWS - stopping per spec (rate-limited or empty).", file=sys.stderr)
        sys.exit(3)

    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)
    rows = []
    for item in rows_raw:
        if any(k in item for k in DROPPED_FIELDS):
            for dropped in DROPPED_FIELDS:
                item.pop(dropped, None)
        for dropped in DROPPED_FIELDS:
            item.pop(dropped, None)
        at = item.get("at")
        try:
            date = at.date().isoformat() if getattr(at, "date", None) else str(at)[:10]
        except Exception:
            date = ""
        if date and date < cutoff.date().isoformat():
            continue
        rows.append({
            "rating": item["score"],
            "title": scrub(item.get("title") or ""),
            "text": scrub(item.get("content") or ""),
            "date": date,
            "platform": "Play Store",
        })

    if not rows:
        print("PLAY STORE PULL RETURNED NO REVIEWS IN WINDOW - stopping per spec.", file=sys.stderr)
        sys.exit(3)

    seen_dates = sorted({r["date"] for r in rows if r["date"]})
    print(f"kept {len(rows)} reviews in last {args.days} days, date range {seen_dates[0] or '-'} .. {seen_dates[-1] or '-'}")

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["rating", "title", "text", "date", "platform"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()