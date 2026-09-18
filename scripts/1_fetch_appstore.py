#!/usr/bin/env python3
"""GROWW Weekly Review Pulse - App Store (iTunes RSS) importer.

Fetches most-recent customer reviews for the GROWW iOS app via Apple's public
customer-reviews RSS feed (no auth, no login). Writes a CSV with columns:
    rating,title,text,date,platform

Public feed is limited to recent reviews only (high-volume apps show roughly
1-2 weeks at most). This is an honest, documented limitation of the source.
"""

import argparse
import csv
import re
import sys
import time

import requests
import certifi

APP_ID = "1404871703"
RSS_BASE = "https://itunes.apple.com/{country}/rss/customerreviews/page={page}/id={id}/sortby=mostrecent/json"
REVIEW_LINK_IDENTIFIER = "label"
TAG_LINK_TYPE = "type"

PII_PATTERNS = [
    (re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+"), "[EMAIL]"),
    (re.compile(r"(?<!\d)\d{9,}(?!\d)"), "[NUMBER]"),
    (re.compile(r"\+?\d[\d\s().-]{8,}\d"), "[PHONE]"),
    (re.compile(r"@\w{2,}"), "[HANDLE]"),
    (re.compile(r"\d{4,}"), "[NUMBER]"),
]


def scrub(text):
    if not text:
        return ""
    out = text
    for pat, rep in PII_PATTERNS:
        out = pat.sub(rep, out)
    return " ".join(out.split())


def fetch_page(country, page, retries=3):
    url = RSS_BASE.format(country=country, page=page, id=APP_ID)
    last_exc = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=60, verify=certifi.where())
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            last_exc = exc
            time.sleep(2 * (attempt + 1))
    raise last_exc


def parse_feed(country, page):
    data = fetch_page(country, page)
    entries = data.get("feed", {}).get("entry", [])
    rows = []
    for ent in entries:
        if not isinstance(ent, dict):
            continue
        rating = ent.get("im:rating", {}).get("label", "")
        title = ent.get("title", {}).get("label", "")
        content = ent.get("content", {}).get("label", "")
        updated = ent.get("updated", {}).get("label", "")
        try:
            rating = int(rating)
        except (TypeError, ValueError):
            continue
        if rating < 1 or rating > 5:
            continue
        date = updated[:10] if updated else ""
        rows.append({
            "rating": rating,
            "title": scrub(title),
            "text": scrub(content),
            "date": date,
            "platform": "App Store",
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pages", type=int, default=5, help="pages of the RSS feed to fetch")
    ap.add_argument("--country", default="in", help="iTunes store country code")
    ap.add_argument("--out", default="data/reviews_appstore.csv")
    args = ap.parse_args()

    all_rows = []
    seen = set()
    for page in range(1, args.pages + 1):
        try:
            rows = parse_feed(args.country, page)
        except Exception as exc:  # stop-and-report: never fabricate data
            print(f"ERROR: App Store fetch failed on page {page}: {exc}", file=sys.stderr)
            sys.exit(1)
        fresh = 0
        for row in rows:
            key = (row["rating"], row["title"], row["text"], row["date"])
            if key in seen:
                continue
            seen.add(key)
            all_rows.append(row)
            fresh += 1
        print(f"page {page}: {len(rows)} raw, {fresh} new")

    seen_dates = sorted({r["date"] for r in all_rows if r["date"]})
    print(f"total: {len(all_rows)} reviews (deduped), date range {seen_dates[0] if seen_dates else '-'} .. {seen_dates[-1] if seen_dates else '-'}")

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["rating", "title", "text", "date", "platform"])
        writer.writeheader()
        writer.writerows(all_rows)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()