# Copilot Instructions — Azure SDK Generation Timeline Visualizer

## Project Overview

This repo is a waterfall timeline visualization for the Azure SDK generation process. It shows how a spec PR in `Azure/azure-rest-api-specs` (TypeSpec API definition) flows into downstream SDK code generation PRs across 5 languages (Java, Go, Python, .NET, JavaScript), through reviews, and finally to package releases.

**Goal**: Identify bottlenecks, review delays, nag patterns, idle gaps, and friction in the end-to-end SDK generation process.

### Skills (`.github/skills/`)

| Skill | When to use |
|---|---|
| `playwright-cli` | Browser automation for testing. Always use this skill instead of raw Playwright APIs. |
| `refresh-spec-flow-data` | Gathering, refreshing, validating, or publishing spec-flow timeline data. |

## Operational Rules

- **Never git push** — you may commit freely, but the user handles pushing.
- **Testing**: Always use the `playwright-cli` skill for browser testing. Do not use raw Playwright APIs or install Playwright separately.
  - Save screenshots from playwright testing to the `screenshots/` directory, so they get ignored by git
- **No new dependencies** — this is a zero-dependency frontend except for alpine.js. Scripts use Node.js built-ins and `gh` CLI.

## Approach to Making Changes

- Edit files directly and reload — no compilation or transpilation.
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
