# Copilot Instructions — Azure SDK Generation Timeline Visualizer

## Project Overview

This repo is a waterfall timeline visualization for the Azure SDK generation process. It shows how a spec PR in `Azure/azure-rest-api-specs` (TypeSpec API definition) flows into downstream SDK code generation PRs across 5 languages (Java, Go, Python, .NET, JavaScript), through reviews, and finally to package releases.

**Goal**: Identify bottlenecks, review delays, nag patterns, idle gaps, and friction in the end-to-end SDK generation process.

## Architecture

**Tech stack**: Vanilla HTML, CSS, JavaScript. No frameworks, no bundler, no build step.

**Entry point**: `index.html` — single-page app with a homepage (sample list) and timeline view.

### JavaScript modules (IIFE pattern)

| File | Module | Role |
|---|---|---|
| `js/timeline.js` | `Timeline` | Core renderer: swim lanes, time axis, event markers, idle gaps, gap compaction, zoom, collision resolution |
| `js/ui.js` | `UI` | Tooltips, detail panel, file loading, theme toggle, actor/event type filters, homepage sample list |
| `js/data-loader.js` | `DataLoader` | JSON validation and loading |

### Styles

`css/styles.css` — all CSS in one file. Dark/light theme via `html[data-theme]`.

### Data

`data/sample-*.json` — pre-generated timeline datasets. Each file is a self-contained timeline.

### Scripts (Node.js, run via CLI)

| Script | Purpose |
|---|---|
| `scripts/fetch-timeline.js` | Fetches raw PR data via `gh` CLI (GitHub API + Azure DevOps pipelines) |
| `scripts/process-timeline.js` | Classifies events, detects patterns (nags, manual fixes, idle gaps), generates final timeline JSON |

### Skills (`.github/skills/`)

| Skill | When to use |
|---|---|
| `generate-timeline-data` | Orchestrates full data generation: spec PR discovery → SDK PR fetch → event classification → JSON output. Invoke when asked to generate timeline data for a spec PR. |
| `playwright-cli` | Browser automation for testing. Always use this skill instead of raw Playwright APIs. |
| `refresh-spec-flow-data` | Gathering, refreshing, validating, or publishing spec-flow timeline data. |

## Data Pipeline

Two-step process to generate a timeline dataset:

```bash
# Step 1: Fetch raw data (uses gh CLI, takes 2-5 minutes)
node scripts/fetch-timeline.js <spec-pr-url> --sdk-prs <url1> <url2> ... [--skip-releases] > raw.json

# Step 2: Process into final timeline JSON
node scripts/process-timeline.js raw.json data/sample-<name>.json "<Title>"
```

After generating, add an entry to the `SAMPLES` array in `js/ui.js`.

To run the full pipeline with AI-assisted analysis, invoke the `generate-timeline-data` skill.

## Running Locally

```bash
npx http-server . -p 8765
# Open http://localhost:8765
```

No build step needed — edit files and reload.

## Operational Rules

- **Never git push** — you may commit freely, but the user handles pushing.
- **Testing**: Always use the `playwright-cli` skill for browser testing. Do not use raw Playwright APIs or install Playwright separately.
  - Save screenshots from playwright testing to the `screenshots/` directory, so they get ignored by git
- **No new dependencies** — this is a zero-dependency frontend. Scripts use Node.js built-ins and `gh` CLI.

## Approach to Making Changes

- Edit files directly and reload — no compilation or transpilation.
- CSS is in one file (`css/styles.css`). JS uses the IIFE module pattern (`Timeline`, `UI`, `DataLoader`).
- When adding new timeline datasets: generate data via the pipeline, add to SAMPLES in `js/ui.js`, test with `playwright-cli`.
- When changing rendering: test across multiple datasets (different sizes, in-flight vs complete, with/without releases).
- File naming for data: `data/sample-<lowercase-name>.json`.

## Key Data Model Concepts

Each timeline JSON contains:
- `specPR` — the azure-rest-api-specs PR (source of truth)
- `sdkPRs[]` — per-language SDK PRs (Java, Go, Python, .NET, JS)
- `insights[]` — AI-generated observations (bottlenecks, nags, patterns)
- `summary` — aggregate stats (duration, reviewer count, nag count, etc.)

**Event types**: `pr_created`, `pr_merged`, `pr_closed`, `commit_pushed`, `review_approved`, `review_changes_requested`, `review_comment`, `issue_comment`, `bot_comment`, `author_nag`, `manual_fix`, `idle_gap`, `tool_call`, `release_pipeline_started`, `release_pipeline_completed`, `release_pipeline_failed`, `release_pending`.

**PR states**: `merged`, `open`, `closed` (without merge), `missing` (no SDK PR generated for that language). Open PRs may also have `isDraft: true`.

**Swim lanes**: one per PR (spec PR + each SDK language). Each lane has a meta section (PR state, draft badge, links) and a timeline section (event markers along time axis).
