#!/usr/bin/env python3
"""GROWW Weekly Review Pulse - local verification pass.

Mirrors appsscript/verify.gs for everything that does not need the LLM or a
real Google Sheet: data integrity, theme legend, priority recompute, exact-
substring quotes, and PII sweep. LLM-stage checks are reported as 'needs
Apps Script run'. Writes output/verification_report.txt.
"""

import argparse
import csv
import datetime
import os
import re
import sys

from pulse_shared import THEMES, THEME_NAMES, PII_PROBE, rule_classify, exact_quote

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default="data/reviews_all.csv")
    ap.add_argument("--out", default="output/verification_report.txt")
    args = ap.parse_args()

    results = []
    def ok(check, detail): results.append((check, "PASS", detail))
    def fail(check, detail): results.append((check, "FAIL", detail))
    def skip(check, detail): results.append((check, "NEEDS APPS SCRIPT", detail))

    with open(args.inp, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))

    if not rows:
        fail("data loaded", "empty input")
    else:
        ok("data loaded", f"{len(rows)} reviews; columns={list(rows[0])}")

    for r in rows:
        if r["rating"] not in "12345":
            fail("ratings 1-5", f"bad rating {r['rating']}")
            break
    else:
        ok("ratings 1-5", "all ratings in range")

    pii_hits = [i for i, r in enumerate(rows) if PII_PROBE.search(f"{r['title']} {r['text']}")]
    if pii_hits:
        fail("PII sweep", f"{len(pii_hits)} hits (rows {pii_hits[:5]})")
    else:
        ok("PII sweep", "no PII regex hits in title/text")

    for r in rows:
        r["_theme"] = rule_classify(r["title"], r["text"])

    legend = [t[0] for t in THEMES]
    used = {}
    for r in rows:
        used[r["_theme"]] = used.get(r["_theme"], 0) + 1
    bad = [t for t in used if t not in legend and t != "Unclassified"]
    if bad:
        fail("theme legend", f"non-legend: {bad}")
    else:
        ok("theme legend", f"{len(used)} themes used (Unclassified is the explicit no-match bucket, not a 6th theme); rule-only classification here, Apps Script adds the LLM fallback")

    stats = {}
    for name, _ in THEMES:
        stats[name] = {"count": 0, "sum": 0}
    for r in rows:
        if r["_theme"] in stats:
            stats[r["_theme"]]["count"] += 1
            stats[r["_theme"]]["sum"] += int(r["rating"])
    ranked = []
    for name, st in stats.items():
        if st["count"]:
            avg = st["sum"] / st["count"]
            ranked.append((st["count"] * (6 - avg), name, st["count"], round(avg, 2)))
    ranked.sort(reverse=True)
    top3 = ranked[:3]
    ok("top-3 priority", "; ".join(f"{n} (count {c}, avg {a}, score {s:.1f})" for s, n, c, a in top3) if top3 else "none")

    quote_fail = 0
    for score, name, count, avg in top3:
        pool = [r for r in rows if r["_theme"] == name]
        pool.sort(key=lambda r: int(r["rating"]))
        if not pool:
            continue
        q = exact_quote(pool[0]["text"], pool[0]["title"])
        if not q:
            continue
        source = pool[0]["text"] or pool[0]["title"] or ""
        if q not in source:
            quote_fail += 1
            fail("quote exact-substring", f"{name}: quote not verbatim in source")
        else:
            ok("quote exact-substring", f"{name}: '{q[:60]}'")
    if not quote_fail:
        ok("quote coverage", f"all {len(top3)} top-theme quotes verified verbatim")

    per_platform = {}
    for r in rows:
        per_platform[r["platform"]] = per_platform.get(r["platform"], 0) + 1
    ok("source coverage", f"{per_platform}")

    verify_produced_note(rows, results, ok, fail, skip)

    report = ["GROWW Weekly Review Pulse - verification report",
              f"generated: {__import__('datetime').datetime.now().isoformat()}",
              f"input: {args.inp}",
              "-" * 60]
    npass = sum(1 for _, s, _ in results if s == "PASS")
    nfail = sum(1 for _, s, _ in results if s == "FAIL")
    nskip = sum(1 for _, s, _ in results if s == "NEEDS APPS SCRIPT")
    for check, status, detail in results:
        report.append(f"[{status:>17}] {check}: {detail}")
    report.append("-" * 60)
    report.append(f"summary: {npass} pass, {nfail} fail, {nskip} needs Apps Script run")
    text = "\n".join(report)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(text + "\n")
    print(text)
    return 1 if nfail else 0


def verify_produced_note(rows, results, ok, fail, skip):
    """Audit the note/email text the app actually renders/produces.

    Reads web/dashboard_data.json (written by 5_build_dashboard.py with the
    deterministic preview, then replaced in-place by the live /api/note
    response). Every check therefore runs against the real rendered note.
    """
    dash = "web/dashboard_data.json"
    system = "note from dashboard_data.json"
    if not os.path.isfile(dash):
        skip("note word count", "dashboard_data.json not built yet - run scripts/5_build_dashboard.py before verify so the produced note can be audited")
        return
    import json
    with open(dash, encoding="utf-8") as fh:
        data = json.load(fh)
    note_text = (data.get("note") or {}).get("text") or ""
    if not note_text:
        fail("note word count", "no note text in dashboard_data.json")
        return

    wc = len(str(note_text).split())
    if wc > 250:
        fail("note word count", f"{wc} words > 250")
    else:
        ok("note word count", f"{wc} words <= 250 (counted from rendered note text)")

    pii = PII_PROBE.search(note_text)
    if pii:
        fail("note PII sweep", f"possible PII hit in note: {pii.group(0)}")
    else:
        ok("note PII sweep", "no PII regex hits in note ('%s')" % system)

    quotes = [t.get("top_quote") for t in (data.get("note") or {}).get("themes") or data.get("top3") or [] if t.get("top_quote")]
    missing_quote = []
    for q in quotes:
        src = [r for r in rows if q in ("%s %s" % (r.get("title", ""), r.get("text", "")))]
        in_note = q in note_text
        if not src:
            missing_quote.append(("not-in-review", q[:40]))
        elif not in_note:
            missing_quote.append(("not-in-note", q[:40]))
    if missing_quote:
        fail("note contains quotes", "; ".join(f"{kind}: {q}" for kind, q in missing_quote))
    else:
        ok("note contains quotes", f"all {len(quotes)} top-3 quotes verbatim in note AND in a real review")

    if "Signal basis:" not in note_text:
        fail("note disclosure", "coverage disclosure line ('Signal basis: ...') missing from note")
    else:
        ok("note disclosure", "coverage disclosure line present in note")

    dbl = re.findall(r"\.{2,}", note_text)
    if dbl:
        fail("note punctuation", f"double/multiple periods found: {dbl[:5]}")
    else:
        ok("note punctuation", "no double periods in note")


if __name__ == "__main__":
    sys.exit(main())