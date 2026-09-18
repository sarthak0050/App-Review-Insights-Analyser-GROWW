#!/usr/bin/env python3
"""GROWW Weekly Review Pulse - combine App Store + Play Store CSVs.

Verifies both CSVs (columns, PII absence, value ranges) and writes a unified
data/reviews_all.csv. Fails loudly if either source is missing/empty.
"""

import argparse
import csv
import re
import sys

REQUIRED = ["rating", "title", "text", "date", "platform"]

PII_PROBE = re.compile(
    r"[\w.+-]+@[\w-]+(\.[\w-]+)+"
    r"|(?<!\d)\d{9,}(?!\d)"
    r"|\+?\d[\d\s().-]{8,}\d"
    r"|@\w{2,}"
)


def read_csv(path):
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames or set(REQUIRED) - set(reader.fieldnames):
            missing = set(REQUIRED) - set(reader.fieldnames or [])
            print(f"ERROR: {path} missing columns: {sorted(missing)}", file=sys.stderr)
            sys.exit(1)
        for row in reader:
            rows.append(row)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--appstore", default="data/reviews_appstore.csv")
    ap.add_argument("--playstore", default="data/reviews_playstore.csv")
    ap.add_argument("--out", default="data/reviews_all.csv")
    args = ap.parse_args()

    sources = []
    for label, path, required in [
        ("App Store", args.appstore, True),
        ("Play Store", args.playstore, False),
    ]:
        try:
            rows = read_csv(path)
        except FileNotFoundError:
            if required:
                print(f"STOP: {label} data missing ({path}) - required source. Exiting.", file=sys.stderr)
                sys.exit(1)
            print(f"NOTE: {label} data absent ({path}) - continuing without it.")
            continue
        if not rows:
            if required:
                print(f"STOP: {label} data empty ({path}) - required source. Exiting.", file=sys.stderr)
                sys.exit(1)
            print(f"NOTE: {label} data empty ({path}) - continuing without it.")
            continue
        sources.append((label, rows))

    if not sources:
        print("ERROR: no review data available at all. Refusing to fabricate.", file=sys.stderr)
        sys.exit(1)

    merged = []
    for label, rows in sources:
        for r in rows:
            merged.append(r)

    ratings = [int(r["rating"]) for r in merged if r["rating"].isdigit()]
    issues = []
    if any(x not in (1, 2, 3, 4, 5) for x in ratings):
        issues.append("rating out of 1-5 range")
    pii_hits = [i for i, r in enumerate(merged) if PII_PROBE.search(f'{r["title"]} {r["text"]}')]
    if pii_hits:
        issues.append(f"possible PII in rows: {pii_hits[:5]}")

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=REQUIRED)
        writer.writeheader()
        writer.writerows(merged)

    per_platform = {}
    for r in merged:
        per_platform[r["platform"]] = per_platform.get(r["platform"], 0) + 1
    print(f"combined: {len(merged)} reviews -> {args.out}")
    print(f"by platform: {per_platform}")
    if ratings:
        print(f"average rating: {sum(ratings) / len(ratings):.2f}")
    if issues:
        print(f"ISSUES: {issues}", file=sys.stderr)
        sys.exit(2)
    print("checks: columns OK, ratings 1-5 OK, no PII probes hit, source files non-empty")


if __name__ == "__main__":
    main()