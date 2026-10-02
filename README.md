# 📊 GROWW Weekly Review Pulse

A weekly **review-intelligence pipeline** for the **GROWW** app that imports the
most recent App Store and Play Store reviews, groups them into a fixed
**5-theme legend**, prioritises the top themes, and drafts a **short weekly
email** — no login scraping, no third-party aggregators, no paid services, no
invented data.

Built as a Learn-in-Public (LIP) challenge for the
[NextLeap](https://www.nextleap.app/) Product Manager Fellowship, with a
live hosted prototype and a fully automated weekly scheduler.

> **Live prototype:** https://groww-weekly-pulse-seven.vercel.app
> **Code:** this repository

---

## Table of contents

1. [Why this product exists](#why-this-product-exists)
2. [What it does (features)](#what-it-does-features)
3. [Product decisions & constraints](#product-decisions--constraints)
4. [Pipeline & architecture](#pipeline--architecture)
5. [The fixed theme legend](#the-fixed-theme-legend)
6. [Repository layout](#repository-layout)
7. [Tech stack](#tech-stack)
8. [Quickstart](#quickstart)
9. [Web dashboard & generation buttons](#web-dashboard--generation-buttons)
10. [Hosted prototype (Vercel)](#hosted-prototype-vercel)
11. [Scheduler: the weekly pulse](#scheduler-the-weekly-pulse)
12. [Configuration](#configuration)
13. [Google Apps Script mirror](#google-apps-script-mirror)
14. [How constraints are enforced](#how-constraints-are-enforced)
15. [Data freshness & limitations](#data-freshness--limitations)
16. [Re-run steps (manual)](#re-run-steps-manual)
17. [Contributing](#contributing)

---

## Why this product exists

Product teams drown in app-store review data they never read. A tool that
automatically turns the newest reviews into a **scannable weekly one-pager** —
top themes, real user quotes, action ideas — and drafts it **as an email to
yourself** closes the loop between user feedback and product decisions.

The brief (NextLeap LIP-5) was deliberately demanding: *take real, public
reviews and produce a ≤250-word note with ≤5 themes, no PII, real quotes, and
action ideas — without scraping behind logins.* This repo implements that
honestly, and is disarmingly plain about what the data can and cannot cover
(see [Data freshness & limitations](#data-freshness--limitations)).

## What it does (features)

- **Imports** the newest App Store reviews (Apple's public **customer-reviews
  RSS**) and Play Store reviews (**google-play-scraper** public endpoint) with
  no logins.
- **Classifies** every review into a fixed, never-invented 5-theme legend
  (App Stability, Order Execution, Withdrawals & Funds, Customer Support,
  Account & Security); anything unmatched lands in an explicit `Unclassified`
  bucket, never a 6th theme.
- **Prioritises** themes by **`count × (6 − avg rating)`** so volume *and*
  severity both matter.
- **Generates** a ≤250-word weekly note **and** a separately authored email
  draft (deliberately not the note pasted into a "Hi Team" shell — tone and
  structure differ).
- **Cites real quotes** — every quote is mechanically verified to be a verbatim
  substring of a source review before it can appear in the note.
- **Scrubs PII** at import time (usernames, review IDs, emails, phones, long
  number runs) and re-scrubs inside Apps Script before anything reaches the
  LLM.
- **Discloses coverage** — the note/dashboard/email state *how many* of the
  reviews were classified into the 5 themes, so ranked themes are never
  mistaken for the whole window.
- **Automates end-to-end** — one command runs the whole pipeline, and a
  scheduler + GitHub Actions cron refresh the pulse weekly.

## Product decisions & constraints

| Decision | Why |
|---|---|
| **Only public, no-login sources** | The brief forbids scraping behind logins; public feeds are reproducible and honest |
| **Fixed 5-theme legend** | Stable taxonomy keeps the note comparable across weeks |
| **Prioritisation = count × (6 − avg rating)** | Volume and severity both matter, not just whichever theme has the most reviews |
| **Note ≤ 250 words, programmatically verified** | The brief's hard limit; enforcement, not aspiration |
| **Email draft ≠ note copy-paste** | A digest needs its own narrative (lead-in, per-theme quotes, next-step ask) |
| **Quotes must be verbatim substrings** | Verifiable grounding; no paraphrase-as-quote |
| **Coverage disclosed, never padded** | If only 152 of 887 reviews map to themes, say so — see Data freshness |
| **Keyless deterministic fallback** | The tool works with zero API key; Gemini only upgrades it |
| **Play failure = stop and report (exit 3)** | Refuse to fabricate data when Rate-Limit/geo-fencing blocks a pull |

## Pipeline & architecture

```
 1_fetch_appstore.py ─┐
                       ├─▶ data/reviews_all.csv ──▶ Google Sheet (RawReviews)
 2_fetch_playstore.py─┘                              │
                                                     ▼
                               Google Apps Script (menus → "Pulse")
   scrub PII ─▶ 5-theme classifier ─▶ prioritizer ─▶ note (≤250 words)
   ─▶ email (framing + note + next step) ─▶ GmailApp.createDraft() ─▶ RunLog / Verification
```

Local, everything is piped by one command:

```
0_fetch_all.sh
 ├─ 1  Import  App Store RSS (public cache; all it returns is kept)
 ├─ 2  Import  Play Store public endpoint (≤12 wks; stops & reports on failure)
 ├─ 3  Group   combine + classify into the 5 themes → data/reviews_all.csv
 ├─ 4  Build   regenerate web/dashboard_data.json
 ├─ 5  Verify  data / PII / legend / quotes / note-word-limit pass
 └─ 6  Export  output/weekly_note.md + email draft (.md/.txt/.html)
```

Both machines (local pipeline *and* the hosted app) reuse the **same canonical
modules** in `api/_lib/` (`pulse_shared.py`, `pulse_generate.py`); the local
`scripts/` shims re-export them so behaviour can never drift between local and
hosted.

## The fixed theme legend

1. **App Stability** — crashes, freezes, login/logout, performance
2. **Order Execution** — order placement, fills, slippage, transaction failures
3. **Withdrawals & Funds** — bank transfers, UPI/IMPS/NEFT, fund movement
4. **Customer Support** — ticket resolution, response, escalation, staff
5. **Account & Security** — KYC, PAN/bank linking, 2FA, unauthorised activity

Anything the classifier cannot confidently map is tagged **`Unclassified`**
(an explicit bucket, not a 6th theme) and counted in the coverage disclosure.

## Repository layout

```
.
├── scripts/
│   ├── 0_fetch_all.sh          # one-command full pipeline
│   ├── 1_fetch_appstore.py     # Apple public customer-reviews RSS
│   ├── 2_fetch_playstore.py    # google-play-scraper public endpoint
│   ├── 3_combine_reviews.py    # merge, validate columns/ratings/PII
│   ├── 4_local_verify.py       # verification pass → output/verification_report.txt
│   ├── 5_build_dashboard.py    # → web/dashboard_data.json
│   ├── 6_export_artifacts.py   # → output/weekly_note.md + email draft
│   ├── serve_dashboard.py      # local server + Generate note/email buttons
│   ├── scheduler.py            # weekly pulse scheduler (once/check/daemon)
│   └── pulse_*.py              # thin shims → api/_lib canonical modules
├── api/_lib/
│   ├── pulse_shared.py         # canonical: legend, priority, verify helpers
│   └── pulse_generate.py       # canonical: note + email generation (LLM/keyless)
├── web/                        # static dashboard (no build step)
│   ├── index.html / style.css / app.js
│   └── dashboard_data.json     # pipeline output the dashboard renders
├── appsscript/                 # Google Apps Script mirror (.gs files + manifest)
├── output/                     # generated note, email drafts, verification report
├── data/                       # review CSVs (git-ignored, regenerated)
├── app.py                      # FastAPI entrypoint (Vercel)
├── pyproject.toml              # Vercel Python entrypoint config
├── .github/workflows/refresh-reviews.yml  # weekly + manual cron refresh
└── README.md
```

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Import | `requests` + `certifi` (Apple RSS), `google-play-scraper` (Play) | Public endpoints only; no login/aggregator |
| Group | Rule-based 5-theme classifier (`api/_lib/pulse_shared.py`) | Deterministic, auditable, no LLM needed for the legend |
| Prioritisation | `count × (6 − avg rating)` | Volume + severity, not popularity alone |
| Note/email generation | Gemini API (`gemini-3.5-flash-lite`), keyless fallback | Highest free-tier volume, no card; deterministic preview without a key |
| Dashboard | Vanilla HTML/CSS/JS, CSS-drawn charts | Zero framework, no chart library, deploys anywhere |
| Hosted API | FastAPI + uvicorn on Vercel | Static dashboard + `/api/note` + `/api/email` in one deploy |
| Local server | Python stdlib `http.server` (serve_dashboard.py) | Zero pip deps for the dev loop |
| Automation | Bash pipeline + `scripts/scheduler.py` + GitHub Actions cron | One command locally, scheduled refresh in CI |
| Apps Script mirror | `appsscript/*.gs` | One-click Google Sheets menu → Gmail drafts |

## Quickstart

```bash
# 1. Install fetch dependencies (pipeline only; dashboard needs nothing)
pip3 install google-play-scraper certifi requests

# 2. Show the existing dashboard locally (data already shipped)
cd web && python3 -m http.server 8000 && open http://localhost:8000

# 3. Regenerate the corpus from the public feeds
bash scripts/0_fetch_all.sh        # full pipeline (import → verify → export)
#    If the Play Store pull fails, it prints "PLAY STORE PULL FAILED —
#    stopping per spec" and exits 3 instead of fabricating data.
```

## Web dashboard & generation buttons

The static dashboard (`web/index.html` + `app.js` + `style.css` +
`dashboard_data.json`) renders the pipeline results and deploys to Vercel as-is.
A tiny local server adds real-time **Generate weekly note** and **Generate
email draft** buttons:

```bash
# deterministic preview (no key needed)
python3 scripts/serve_dashboard.py 8000
open http://localhost:8000

# OR with Gemini for real generation
GEMINI_API_KEY=your_free_key_here python3 scripts/serve_dashboard.py 8000
open http://localhost:8000
```

- `POST /api/note` calls Gemini (if `GEMINI_API_KEY` is set), enforces ≤250
  words, and saves the generated note into `web/dashboard_data.json`.
- `POST /api/email` produces a **distinct digest artifact** — narrative
  lead-in, per-theme bullets with verbatim quotes and stats, next-step ask.
- **Download .eml** saves a ready preview (double-click to open in Mail/Outlook).
- **Open in mail app** builds a `mailto:` link (no credentials needed).
- With no `GEMINI_API_KEY`, both endpoints return the **deterministic preview**
  (identical to the Apps Script fallbacks) so the UI is fully usable keyless.

## Hosted prototype (Vercel)

**Live:** https://groww-weekly-pulse-seven.vercel.app

`app.py` is a FastAPI app (Vercel Python entrypoint declared in
`pyproject.toml`) that serves the static dashboard **and** the API endpoints,
reusing the canonical `api/_lib/` modules. Deploy with:

```bash
npx vercel@latest deploy --prod --yes
```

Without a `GEMINI_API_KEY` the hosted app runs the deterministic preview —
fully functional keyless. Add `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`)
under **Vercel → Project → Settings → Environment Variables** to enable live
LLM generation. Sending needs no credentials: **Open in mail app** (`mailto:`),
**Download .eml**, and the exported `output/email_draft.html/.txt` all work
with zero secrets. The optional **Send email** (SMTP) button needs
`SMTP_EMAIL` + `SMTP_APP_PASSWORD`.

## Scheduler: the weekly pulse

The whole point of a *weekly* pulse is that it keeps running. The scheduler
re-runs the pipeline on a cadence and treats the corpus as **stale** when the
dashboard's `generated_at` stamp is older than `--max-age-days` (default 8).

### CLI

```bash
# How old is the current pulse? (writes nothing; exit 2 if a refresh is due)
python3 scripts/scheduler.py --mode check

# Refresh now if stale; no-op when fresh
python3 scripts/scheduler.py --mode once

# Force a full re-run even if fresh
python3 scripts/scheduler.py --mode once --force

# Poll forever (default 7d) for self-hosted servers
python3 scripts/scheduler.py --mode daemon --interval-days 7 --max-age-days 8
```

Exit codes: `0` ok/fresh, `1` refresh failed, `2` check-mode with a stale pulse.

The refresh needs **no API key**: without `GEMINI_API_KEY` the note/email use
the deterministic fallback (same as the hosted app). On Play Store failures the
pipeline stops-and-reports (exit 3) instead of fabricating data.

### Automated weekly refresh (GitHub Actions)

`.github/workflows/refresh-reviews.yml` runs **every Monday 06:07 UTC** (and on
manual "Run workflow"): it installs the fetch deps, runs
`python3 scripts/scheduler.py --mode once --max-age-days 8`, and commits the
regenerated `web/dashboard_data.json` + `output/` artifacts back to `main`
**only if they changed**. A successful run also writes `output/refresh.json`
with the timestamp and source count.

## Configuration

All configuration is environment-based.

| Variable | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | No | Live LLM note/email generation (Vercel env or env on `serve_dashboard.py`). Keyless fallback otherwise |
| `GEMINI_MODEL` | No | Defaults to `gemini-3.5-flash-lite` |
| `SMTP_EMAIL`, `SMTP_APP_PASSWORD` | No | Optional **Send email** (SMTP) button only |

- **Local:** copy `.env.example` → `.env` if you want `secret-dotenv` loading.
- **Vercel:** set `GEMINI_API_KEY` under Project → Settings → Environment
  Variables.
- **Apps Script:** set the `GEMINI_API_KEY` / `PULSE_EMAIL` / optional
  `PULSE_MODEL` in *Script Properties*.

## Google Apps Script mirror

For a zero-setup Gmail draft, the repo ships a complete Apps Script mirror
(`appsscript/*.gs`) with the same scrub → classify → prioritise → generate →
verify chain and a **Pulse** sheet menu:

1. Create a Google Sheet → Extensions → Apps Script → paste the `.gs` files.
2. Authorize (Sheets + Gmail compose).
3. **Script Properties:** `GEMINI_API_KEY`, `PULSE_EMAIL`, optional `PULSE_MODEL`.
4. Legend menu **Pulse → 1. Import reviews CSV** → paste `data/reviews_all.csv`.
5. **Pulse → Run FULL pipeline** → scrubs, classifies, prioritises, generates,
   creates the Gmail draft, writes the verification report.

## How constraints are enforced

Verification is automated (`scripts/4_local_verify.py` locally; `verify.gs` in
Apps Script):

- **Note ≤ 250 words** — counted from the *actual rendered note*; over-budget
  output is trimmed and flagged `truncated`, never shipped.
- **Quotes are exact substrings** — every top-theme quote must appear verbatim
  inside a review's `text`/`title` (substring scan against source rows and the
  produced note).
- **Coverage disclosure** — the note/dashboard/email state how many reviews
  were classified (e.g. `Signal basis: themes drawn from 152 of 887 reviews`).
- **No double punctuation** — verifier fails on `..`/`...`.
- **Top-3 by `count × (6 − avg rating)`** — recomputed from raw rows.
- **Theme count ≤ 5** — anything outside the legend is downgraded to
  `Unclassified`.

## Data freshness & limitations

**Honesty over completeness.** Apple's public RSS feed only exposes the most
recent reviews — for a high-volume app like Groww that's ~2 weeks even when we
fetch and dedupe 10 pages. Google Play's public endpoints yield ~400 newest
reviews (~3–5 days at Groww's volume) and are frequently rate-limited;
`2_fetch_playstore.py` keeps everything within 12 weeks and **stops and
reports** (exit 3) rather than fabricating data if the first pull fails.

**Net effect:** neither no-login source can reach the 8–12 week ideal for an app
this active. The pipeline keeps everything the public feeds return (~2–3 weeks)
and the dashboard, note and email **state that openly**. Treat the coverage
window as a disclosed limitation, not a guarantee. All review data is public;
PII is scrubbed at import and before any LLM call.

## Re-run steps (manual)

1. **Fetch fresh data — fully automated:**
   ```bash
   bash scripts/0_fetch_all.sh
   ```
   Import (App Store RSS + Play Store) → Group (themes) → Verify → Build →
   Export → refresh the dashboard. Play failure ⇒ `PLAY STORE PULL FAILED —
   stopping per spec` (exit 3).
2. **Or step-by-step:**
   ```bash
   pip3 install google-play-scraper certifi requests
   python3 scripts/1_fetch_appstore.py --pages 10 --country in
   python3 scripts/2_fetch_playstore.py --count 200 --pages 2 --days 84 --country in --lang en
   python3 scripts/3_combine_reviews.py
   ```
3. **Load into Google Sheets** (mirror path) — see [Apps Script mirror](#google-apps-script-mirror).

## Contributing

1. **Stay in the fixed legend** — never add a 6th theme; use `Unclassified`.
2. **Never fabricate data** — public sources only; failures stop and report.
3. Keep quotes verbatim and the word limit enforced; keep `api/_lib/` canonical
   so local and hosted behaviour never drift.
4. Do not commit `.env` files, API keys, or review PII.

---

Built by [Sarthak Singh](https://github.com/sarthak0050) · NextLeap PM
Fellowship (LIP-5) · *"A weekly pulse tool is only useful if you can trust what
it's showing you."*

## Changelog Automation

`CHANGELOG.md` is regenerated weekly from the commit log by
`.github/workflows/weekly-changelog.yml` and committed **as the repo owner**
so this project's maintenance is credited to you rather than to
`github-actions[bot]`.

| | |
|---|---|
| Schedule | Wednesdays, 07:13 UTC |
| Source of truth | Commit messages on the default branch |
| Noise control | Only commits when the file actually changed |
| Credentials | Needs the `PAT_TOKEN` secret, otherwise it regenerates but does not commit |

**One-time setup**

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new)
   scoped to this repository only, with **Contents: Read and write**.
2. Add it as a repository secret named `PAT_TOKEN`:
   **Settings → Secrets and variables → Actions → New repository secret**.

Until that secret exists the job still regenerates `CHANGELOG.md` and prints
the diff, it just skips the commit, so no bot-authored noise lands in the
history.

