# GROWW Weekly Review Pulse

A weekly review-intelligence pipeline for the **GROWW** app that imports the most recent
App Store and Play Store reviews, groups them by a fixed 5-theme legend, prioritises the
top themes, and drafts a short weekly email — no login scraping, no third-party
aggregators, no paid services.

## Deliverables

| Path | What it is |
| --- | --- |
| `scripts/1_fetch_appstore.py` | Imports iOS reviews from Apple's public customer-reviews RSS feed |
| `scripts/2_fetch_playstore.py` | Imports Play Store reviews via `google-play-scraper` (public endpoint, no login) |
| `scripts/3_combine_reviews.py` | Merges both CSVs and validates columns / ratings / PII absence |
| `scripts/4_local_verify.py` | Local verification pass (writes `output/verification_report.txt`) |
| `scripts/5_build_dashboard.py` | Builds `web/dashboard_data.json` for the web dashboard |
| `scripts/6_export_artifacts.py` | Exports `output/weekly_note.md` + `output/email_draft.{txt,html}` |
| `api/_lib/` | Canonical `pulse_shared.py` + `pulse_generate.py` (used by the app AND the local pipeline via thin `scripts/` shims) |
| `app.py` | FastAPI entrypoint for the hosted app (static dashboard + `/api/note` + `/api/email`) |
| `web/` | Static dashboard (`index.html` + `app.js` + `style.css`) hosting the results |
| `data/reviews_all.csv` | Combined rows: `rating,title,text,date,platform` (PII stripped) |
| `output/weekly_note.md` | Latest one-page weekly note (deliverable) |
| `output/email_draft.html` | Latest email draft (deliverable, mail-client ready) |
| `output/verification_report.txt` | Verification-pass results (regenerate with the Script) |

> **Data-source honesty.** The App Store public RSS feed only exposes the most recent
> reviews — for a high-volume app like Groww that's ~2 weeks even when we fetch and dedupe
> 10 pages. Google Play's public endpoints yield ~400 newest reviews (~3-5 days at Groww's
> volume) and are frequently rate-limited; `2_fetch_playstore.py` keeps everything within
> 12 weeks, **stops and reports** (exit 3) instead of fabricating data if the first pull
> fails. Net effect: **neither no-login source can reach 8-12 weeks for an app this
> active — the pipeline keeps everything the public feeds return (~2-3 weeks) and the
> dashboard, note and email state that openly.** Treat the coverage window as a disclosed
> limitation, not a guarantee.

## Fixed theme legend (never invent a 6th)

1. App Stability
2. Order Execution
3. Withdrawals & Funds
4. Customer Support
5. Account & Security

## Architecture

```
1_fetch_appstore.py ─┐
                      ├─▶ data/reviews_all.csv ──▶ Google Sheet (RawReviews)
2_fetch_playstore.py─┘                              │
                                                    ▼
                              Google Apps Script (menus → "Pulse")
   scrub PII ─▶ 5-theme classifier ─▶ prioritizer ─▶ note (≤250 words)
   ─▶ email (framing + note + next step) ─▶ GmailApp.createDraft() ─▶ RunLog / Verification
```

- [x] No n8n, no login/session scraping, no aggregator APIs.
- [x] All review data is **public** (Apple RSS, Google Play public endpoints).
- [x] PII (usernames, review IDs, emails, phones, long number runs) removed at import time
      and re-scrubbed inside Apps Script **before** anything reaches the LLM.

## Web dashboard (local → Vercel-ready)

A static dashboard renders the pipeline results:

```bash
python3 scripts/5_build_dashboard.py     # regenerate web/dashboard_data.json from the latest CSV
cd web && python3 -m http.server 8000    # or: npx serve web
open http://localhost:8000
```

Because the dashboard is a static folder (`web/index.html` + `app.js` + `style.css` +
`dashboard_data.json`), it deploys to Vercel as-is later. The note shown is a deterministic
**preview** borrowed from the same logic as the Apps Script; the real LLM note + email draft
are produced by the Apps Script pipeline.

## Web dashboard with generation buttons

The static dashboard (`web/`) is extended by a tiny local server that adds the real-time
**Generate weekly note** and **Generate email draft** buttons.

```bash
# deterministic preview (no key needed)
python3 scripts/serve_dashboard.py 8000
open http://localhost:8000

# OR with Gemini for real generation
GEMINI_API_KEY=your_free_key_here python3 scripts/serve_dashboard.py 8000
open http://localhost:8000
```

`POST /api/note` calls Gemini (if `GEMINI_API_KEY` is set), enforces ≤250 words, and
saves the generated note into `web/dashboard_data.json`. `POST /api/email` produces a
**distinct digest artifact** — a narrative lead-in, per-theme bullets with verbatim
quotes and stats, and a next-step ask — it does not paste the note into a greeting shell.
A **Download .eml** button saves a ready-to-preview RFC822 file you can double-click to
open in macOS Mail / Outlook.

When `GEMINI_API_KEY` is absent, both endpoints return a deterministic preview
(exactly matching the Apps Script fallbacks) so the UI is still fully usable.

For a real Gmail draft via Apps Script use the spreadsheet menu instead:
`Pulse → 6. Create email draft` (which calls `GmailApp.createDraft`).

### Hosted prototype (Vercel)

**Live:** https://groww-weekly-pulse-seven.vercel.app

`app.py` is a FastAPI app (Vercel Python entrypoint, declared in `pyproject.toml`). It
serves the static `web/` dashboard AND the `/api/note` + `/api/email` endpoints, reusing
the canonical modules in `api/_lib/`. Deploy with:

```bash
npx vercel@latest deploy --prod --yes
```

Without a `GEMINI_API_KEY`, `/api/note` and `/api/email` run the **deterministic
preview** path (no LLM) — the app is fully functional keyless. Add `GEMINI_API_KEY`
(+ optional `GEMINI_MODEL`) under **Vercel → Project → Settings → Environment Variables**
to enable live LLM generation on the hosted app. The local dashboard serves identical
endpoints so the two behave the same.

> Sending drafts needs no credentials: the dashboard's **Open in mail app** button builds a
> `mailto:` link with the subject + body pre-filled (works via your browser mail client),
> **Download .eml** saves a draft file, and the pipeline also writes
> `output/email_draft.html` / `email_draft.txt`. The **Send email** button (SMTP) is
> optional and requires `SMTP_EMAIL` + `SMTP_APP_PASSWORD`.

## Re-run steps

### 1. Fetch fresh data (local) — FULLY AUTOMATED

```bash
bash scripts/0_fetch_all.sh
```

That single command runs the whole local pipeline end-to-end:
**Import** (App Store RSS + Play Store) → **Group** (combine + classify into the 5 themes) →
**Verify** (data/PII/legend/quotes) → **Build** (`web/dashboard_data.json`) → **Export**
(`output/weekly_note.md` + email draft) → refresh the dashboard. If the Play Store pull
fails it prints `PLAY STORE PULL FAILED — stopping per spec` (exit 3) rather than
fabricating data.

Or step-by-step:

```bash
pip3 install google-play-scraper certifi requests
python3 scripts/1_fetch_appstore.py --pages 10 --country in
python3 scripts/2_fetch_playstore.py --count 200 --pages 2 --days 84 --country in --lang en
python3 scripts/3_combine_reviews.py
```

If the Play Store pull fails you will see `PLAY STORE PULL FAILED — stopping per spec`
and you pipe the pipeline on with App Store data only (the script deliberately refuses to
substitute fake data).

### 2. Load into Google Sheets

1. Create a Google Sheet (e.g. **GROWW-WeeklyPulse**).
2. Extensions → Apps Script → paste the `appsscript/*.gs` files (keep the manifest).
3. Authorize (Sheets + Gmail compose).
4. **Script Properties** → set `GEMINI_API_KEY` (free key from aistudio.google.com) and
   `PULSE_EMAIL` (draft recipient). Optionally `PULSE_MODEL` (default `gemini-3.5-flash-lite`).
5. Refresh the sheet → menu **Pulse → 1. Import reviews CSV** → paste the contents of
   `data/reviews_all.csv` into the dialog.
6. **Pulse → Run FULL pipeline** — scrubs, classifies, prioritises, generates the note,
   creates the Gmail draft, and writes the verification report.

## Script Properties

| Key | Value |
| --- | --- |
| `GEMINI_API_KEY` | Free Gemini API key (aistudio.google.com). No card needed. |
| `PULSE_EMAIL` | Email address the draft should be addressed to. |
| `GEMINI_MODEL` (optional) | Defaults to `gemini-3.5-flash-lite`. |

## Why Gemini?

Highest free-tier volume of the mainstream no-card providers (≈1.5M tokens/day, no
expiry, no credit card) vs Groq (≈200K tokens/day ceilings) and Cerebras (30-day,
card-gated trial). Reviews are PII-scrubbed before the LLM, so Google's "free tier may
train on prompts" caveat is a non-issue. The script retries on 429s with backoff.

## How constraints are enforced (verification pass)

The Apps Script `Verification` tab (menu → **Run verification**) re-runs the file `verify.gs`:

- **Note ≤ 250 words** — enforced programmatically after generation (trims and flags
  `truncated` in the RunLog rather than shipping an over-budget note). The local verifier
  counts words from the **actual rendered note** in `web/dashboard_data.json`.
- **Quotes are exact substrings** — every top-theme quote must appear **verbatim** inside a
  review's `text`/`title` in RawReviews; checked by substring scan against both the source
  rows and the produced note text.
- **Coverage disclosure** — the note, dashboard and email state *how many* of the total
  reviews were classified into the 5 themes (e.g. `Signal basis: themes drawn from 152 of
  887 reviews`) so a reader never mistakes ranked themes for the whole window.
- **No double punctuation** — generated sentences are normalised to a single trailing
  period; the verifier fails on `..`/`...` in the produced note.
- **Top-3 by `count × (6 − avg rating)`** — recomputed from RawReviews, not taken on trust.
- **Theme count ≤ 5** — classifier output is validated against the fixed legend; anything
  else is downgraded to `Unclassified`.
- **PII sweep** — every RawReviews text/title plus the generated note and email are scanned
  with the same regexes used by the scrubber; any hit fails the run.

Run this locally for a quick check:

```bash
python3 scripts/3_combine_reviews.py   # validates columns, ratings, PII probes
```

## Project status / tests

- Import scripts: **tested** against live data (487 App Store + 400 Play reviews in the
  current window, `data/reviews_all.csv`).
- Local verification: **15 pass / 0 fail** — including the produced note (word count, PII,
  quotes, disclosure line, punctuation).
- Apps Script pipeline: **written and syntax-checked** (node --check on every `.gs`); the
  LLM + Gmail steps are **documented but not executed** — they require a real Google Sheet,
  script authorization, and your `GEMINI_API_KEY`/`PULSE_EMAIL` properties.

## Send email for real (opt-in)

The dashboard is draft-only until you configure sending. Two options:

**Option A — local dashboard → Gmail (SMTP).** Generate a Gmail App Password
(Google Account → Security → 2-Step Verification → App passwords, 16-char password, not
your normal password), then start the server with it (never paste it into code — `.gitignore`
covers `.env`):

```bash
SMTP_EMAIL=yourgmail@gmail.com \
SMTP_APP_PASSWORD=xxxxxxxxxxxxxxxx \
GEMINI_API_KEY=your_free_key_here \
python3 scripts/serve_dashboard.py 8000
```

Click **Send email** in the dashboard — it delivers via smtp.gmail.com (STARTTLS) to the
recipient you entered.

**Option B — Apps Script → Gmail.** In the bound Apps Script project set `PULSE_EMAIL`, then
menu **Pulse → 7. Send email now (Gmail)** which calls `GmailApp.sendEmail()` from your own
logged-in account.

`GmailApp.createDraft` / **Download .eml** still exist for the review-then-send workflow.

## Flow & automation status

`Import → Group → Generate Note → Draft Email`:

| Stage | How it runs | Automated? |
| --- | --- | --- |
| Import | `bash scripts/0_fetch_all.sh` (step 1) | ✅ 1 command |
| Group (themes) | same script → `reviews_all.csv` + dashboard data | ✅ automatic |
| Generate note | button **Generate weekly note** → `POST /api/note` (Gemini) | ✅ click |
| Draft email | button **Generate email draft** → subject + greeting + body (`.eml`/copy) | ✅ click |
| Real Gmail draft | Apps Script `Pulse → Run FULL pipeline` | ✅ menu (in your Google account) |

The email produced by the web dashboard includes a **subject line** shown at the top of a
message-header block (From/To/**Subject**/Date) and inside the downloadable `.eml`.

## Honest limitations

- Apple RSS shows only the freshest reviews (~2 weeks for Groww even at `--pages 10`).
- Google Play public endpoints are flaky and rate-limited; the importer **stops and reports**
  rather than quietly shipping partial/noisy data. Reaching 8-12 weeks would mean pulling
  tens of thousands of reviews for this app's volume — not available without a login or a
  paid aggregator, which this project deliberately avoids.
- Free Gemini has no SLA and lower RPM than paid tiers; retries/backoff are built in.
- This pipeline reads **public review data only** — it cannot see reviews that require login.