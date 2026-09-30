#!/usr/bin/env bash
# GROWW Weekly Review Pulse - run the full LOCAL pipeline in one command:
#   Import (App Store + Play Store)  ->  Group (themes)  ->  verify  ->  build dashboard
# Then click "Generate weekly note" and "Generate email draft" in the web UI.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data output

echo "== 1/5 Import: App Store RSS (public cache; ~2-week reach, we keep all of it) =="
python3 scripts/1_fetch_appstore.py --pages 10 --country in --out data/reviews_appstore.csv

echo
echo "== 2/5 Import: Play Store (public endpoint; keeps up to 12 weeks, stops & reports if rate-limited) =="
python3 scripts/2_fetch_playstore.py --count 200 --days 84 --country in --lang en --out data/reviews_playstore.csv

echo
echo "== 3/5 Group: combine + classify (themes) into reviews_all.csv =="
python3 scripts/3_combine_reviews.py

echo
echo "== 4/5 Build: web/dashboard_data.json =="
python3 scripts/5_build_dashboard.py

echo
echo "== 5/5 Verify: data / PII / legend / quotes + produced note =="
python3 scripts/4_local_verify.py

echo
echo "== 6/6 Export deliverables: output/weekly_note.md + email draft =="
python3 scripts/6_export_artifacts.py

echo
echo "DONE. Refresh http://localhost:8000 and use the Generate buttons."