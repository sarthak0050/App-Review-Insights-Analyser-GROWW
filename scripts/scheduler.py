"""Weekly pulse scheduler.

Keeps the GROWW Weekly Review Pulse honest and current by re-running the
public-feeds pipeline on a schedule. A review window is considered *stale*
when the dashboard's `generated_at` stamp (or the pipeline run log) is older
than `--max-age-days`.

Modes:
    once        Run the pipeline now if the corpus is stale (or with --force).
    check       Report staleness and what would run; write nothing.
    daemon      Loop every --interval-days, refreshing when stale.

Exit codes:
    0   ok (corpus fresh, or refresh completed)
    1   refresh failed (e.g. Play Store pull rate-limited -> pipeline exit 3)
    2   check mode: corpus is stale (a refresh is due)

The refresh itself needs no API key: without GEMINI_API_KEY the note/email
artifacts use the deterministic keyless fallback (same as the hosted app).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DASHBOARD = ROOT / "web" / "dashboard_data.json"
PIPELINE = ROOT / "scripts" / "0_fetch_all.sh"
REFRESH_STATUS = ROOT / "output" / "refresh.json"
CSV_APPS = ROOT / "data" / "reviews_appstore.csv"
CSV_PLAY = ROOT / "data" / "reviews_playstore.csv"
CSV_ALL = ROOT / "data" / "reviews_all.csv"

DEFAULT_MAX_AGE_DAYS = 8  # weekly cadence -> allow a small grace period


class SchedulerError(RuntimeError):
    pass


@dataclass
class Freshness:
    last_generated_at: str
    age_hours: float
    stale: bool
    source_count: int
    reason: str


def _parse_generated_at(text: str) -> datetime | None:
    for candidate in (text, text.replace("Z", "+00:00")):
        try:
            value = datetime.fromisoformat(candidate)
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)
        except ValueError:
            continue
    return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def check_freshness(max_age_days: float) -> Freshness:
    """How old is the current corpus, and does a refresh need to run?"""
    if not DASHBOARD.is_file():
        return Freshness("", float("inf"), True, 0, "dashboard_data.json is missing")

    try:
        data = json.loads(DASHBOARD.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return Freshness("", float("inf"), True, 0, "dashboard_data.json is unreadable")

    generated = data.get("generated_at", "")
    stamp = _parse_generated_at(generated) or _parse_generated_at(
        (data.get("meta") or {}).get("generated")
    )
    now = datetime.now(timezone.utc)
    source_count = int(data.get("source_count", 0))

    if stamp is None:
        return Freshness(generated, float("inf"), True, source_count,
                         "no parseable generated_at stamp in dashboard_data.json")

    age = max(0.0, (now - stamp).total_seconds() / 3600.0)
    stale = age > max_age_days * 24
    reason = (
        f"last generated {stamp.date().isoformat()} "
        f"({age:.1f}h ago; threshold {max_age_days:g}d)"
    )
    return Freshness(generated, age, stale, source_count, reason)


def run_pipeline() -> dict:
    """Run the full local pipeline; raises on failure (e.g. Play exit 3)."""
    if not PIPELINE.is_file():
        raise SchedulerError(f"Missing pipeline script: {PIPELINE.name}")

    print(f"RUNNING: bash {PIPELINE.relative_to(ROOT)}")
    completed = subprocess.run(
        ["bash", str(PIPELINE)],
        cwd=str(ROOT),
        text=True,
        capture_output=True,
    )
    if completed.returncode != 0:
        print(completed.stdout, file=sys.stdout)
        print(completed.stderr, file=sys.stderr)
        raise SchedulerError(
            f"pipeline exited {completed.returncode} (Play Store pulls stop "
            "and report rather than fabricate data)"
        )

    # A fresh run must have regenerated the dashboard.
    fresh = check_freshness(DEFAULT_MAX_AGE_DAYS)
    summary = {
        "refreshed_at": _now_iso(),
        "pipelines": ["1_appstore", "2_playstore", "3_combine", "4_verify",
                      "5_build", "6_export"],
        "generated_at": fresh.last_generated_at,
        "source_count": fresh.source_count,
    }
    REFRESH_STATUS.parent.mkdir(parents=True, exist_ok=True)
    REFRESH_STATUS.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(completed.stdout)
    print(f"REFRESHED: generated_at={fresh.last_generated_at} "
          f"source_count={fresh.source_count}")
    return summary


def run_once(force: bool, max_age_days: float, check_only: bool = False) -> int:
    fresh = check_freshness(max_age_days)
    status = "STALE" if fresh.stale else "FRESH"
    reason = fresh.reason or f"source_count={fresh.source_count}"
    print(f"[{status}] {reason}")

    if check_only:
        print("CHECK MODE: no pipeline was run and no files were written.")
        return 2 if fresh.stale else 0

    if not fresh.stale and not force:
        print("UP TO DATE: corpus is within the freshness window; skipping refresh.")
        return 0

    if force and not fresh.stale:
        print("FORCE: re-running the pipeline anyway.")
    if force and fresh.stale:
        print("FORCE: corpus is stale; re-running the pipeline.")

    try:
        run_pipeline()
    except SchedulerError as exc:
        print(f"REFRESH FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


def run_daemon(interval_days: float, force_first: bool, max_age_days: float) -> int:
    interval_seconds = max(60, int(interval_days * 24 * 3600))
    tiebreaker = 0
    print(f"DAEMON START: polling every {interval_days:g}d; "
          f"freshness window {max_age_days:g}d (first run force={force_first})")
    while True:
        tiebreaker += 1
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        print(f"[{stamp}] check #{tiebreaker}")
        force = force_first and tiebreaker == 1
        try:
            code = run_once(force=force, max_age_days=max_age_days)
        except SchedulerError as exc:
            code = 1
            print(f"[{stamp}] REFRESH FAILED: {exc}", file=sys.stderr)
        print(f"[{stamp}] tick {tiebreaker} finished with exit {code}; "
              f"sleeping {interval_seconds}s…")
        time.sleep(interval_seconds)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="scheduler",
        description="Weekly pulse scheduler (see file docstring).",
    )
    parser.add_argument(
        "--mode",
        choices=("once", "check", "daemon"),
        default="once",
        help="once=refresh if stale; check=report only; daemon=loop",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="run the pipeline even when the corpus is fresh",
    )
    parser.add_argument(
        "--max-age-days",
        type=float,
        default=DEFAULT_MAX_AGE_DAYS,
        help="staleness threshold for generated_at (default 8d)",
    )
    parser.add_argument(
        "--interval-days",
        type=float,
        default=7.0,
        help="polling interval for --mode daemon (default 7d)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.mode == "check":
        return run_once(force=False, max_age_days=args.max_age_days, check_only=True)
    if args.mode == "daemon":
        return run_daemon(args.interval_days, args.force, args.max_age_days)
    return run_once(force=args.force, max_age_days=args.max_age_days)


if __name__ == "__main__":
    raise SystemExit(main())