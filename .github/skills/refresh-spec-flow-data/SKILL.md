---
name: refresh-spec-flow-data
description: Collect, enrich, build, validate, and smoke-test a new Azure SDK spec-flow timeline dataset.
---

# Refresh spec-flow data

Use this skill when asked to gather, refresh, backfill, or publish timeline data for the dashboard. The production path is `scripts/refresh-v2-data.js`; do not use `profile-release-plans.js` to build dashboard data.

## What the pipeline does

The refresh is a six-stage, zero-dependency pipeline:

1. `collect-release-plans.js` queries Azure DevOps Release Plan work items and API Spec children, reads their revisions, and writes sanitized normalized input to `cache/v2/release-plans.json`.
2. `collect-github-prs.js` follows only exact PR links found in those work items and revisions, enriches them from GitHub, and writes `cache/v2/github-prs.json`.
3. `collect-github-releases.js` uses package-specific tag conventions, monthly `Azure/azure-sdk/_data/releases` metadata, linked SDK PR version evidence, and GitHub Release `publishedAt` as a conservative fallback for missing historical release evidence.
4. `collect-pipeline-runs.js` follows only exact Azure Pipeline build URLs and writes `cache/v2/pipeline-runs.json`.
5. `build-view-data.js` derives events, intervals, metrics, aggregates, plan files, hashes, and `data/snapshot.json`.
6. `validate-data.js` checks referential and metric integrity and scans every published JSON file for email addresses and credential-like values.

`cache/` is private, ignored, and reusable. `data/builds/<build-id>/` is public and immutable. The dashboard switches datasets through `data/snapshot.json`.

## Preconditions

From the repository root:

```bash
node --version
az account show --output none
az account get-access-token \
  --resource 499b84ac-1321-427f-aa17-267ca6975798 \
  --query accessToken \
  --output tsv >/dev/null
gh auth status
```

Use Node.js 18 or newer so global `fetch` and `AbortSignal.timeout` are available. The Azure identity must be able to read the `azure-sdk/Release` project. The GitHub identity must be able to read every linked PR; public-repository access is normally sufficient.

Never print, persist, or pass either access token manually. The scripts acquire tokens from `az` and `gh`.

## Choose the cohort

For the dashboard's current production cohort, use:

- `--mode all-management`: core-correlated management-plane Release Plans changed in the bounded inventory window. Their full flow history may begin before that window.
- `--start-at 2026-03-01T00:00:00.000Z`: the earliest metric completion period. The ChangedDate query keeps discovery bounded while retaining older-starting flows that complete during or after March.
- `--limit 0`: collect every eligible plan. A positive value is for small development samples only.
- `--build-id`: a unique UTC identifier. Build directories are immutable and the builder refuses to overwrite one.

`--mode complete` is a diagnostic/sample cohort. It queries recently **changed** plans and keeps only finished, non-private management-plane plans that have an exact spec PR and released SDK PRs for every intended language. Do not substitute it for the production cohort.

## Run the full refresh

Create a unique build ID and run the orchestrator:

```bash
BUILD_ID="$(date -u +%Y%m%dT%H%M%SZ)"
node scripts/refresh-v2-data.js \
  --start-at 2026-03-01T00:00:00.000Z \
  --days 180 \
  --limit 0 \
  --mode all-management \
  --build-id "$BUILD_ID"
```

Keep the existing `cache/v2/` directory. Terminal GitHub PRs and finished pipeline runs are reused; active artifacts are refreshed.

The collectors intentionally keep the cohort moving when an individual plan, PR, or run is inaccessible or unusually large. They record the artifact under `skippedPlans`, `skippedPrs`, or `skippedRuns` instead of inventing data. Authentication and rate-limit failures stop the refresh.

## Resume after a collector failure

Each stage reads the previous stage's cached JSON, so rerun only the failed stage and everything after it:

```bash
node scripts/collect-release-plans.js \
  --start-at 2026-03-01T00:00:00.000Z --days 180 --limit 0 --mode all-management
node scripts/collect-github-prs.js
node scripts/collect-github-releases.js
node scripts/collect-pipeline-runs.js
node scripts/build-view-data.js --build-id "$BUILD_ID"
node scripts/validate-data.js
```

Do not run later stages if an earlier cache file is missing or stale. If `build-view-data.js` created any part of a build before failing, use a new build ID after correcting the problem; do not overwrite or hand-edit an immutable build.

## Review the result

Confirm that the final output reports successful validation, then inspect:

```bash
node -e '
const m = require("./data/snapshot.json");
console.log({
  buildId: m.snapshotId,
  generatedAt: m.generatedAt,
  cadence: m.cadence,
  counts: m.counts,
  sourceCoverage: m.sourceCoverage
});
'
```

Treat preflight skips as expected correlation filtering and flow-window skips as expected temporal filtering unless either count changes abruptly. Downstream PR and pipeline skips are data-quality findings that produce incomplete metrics rather than removing in-window plans. Investigate changes in candidate plans, published plans, event count, per-source coverage, and skipped artifacts. Do not publish if validation fails or if a cohort change is unexplained.

## Smoke-test the dashboard

Use the `playwright-cli` skill rather than raw Playwright APIs:

```bash
python3 -m http.server 4173
```

Verify that the portfolio loads the new build, summary counts render, and at least one plan opens with spec and SDK tracks. Also open an active/incomplete plan and a finished plan when both exist. Save any screenshots under `screenshots/`.

## Persist the refresh

Include the new `data/builds/<build-id>/` directory and updated `data/snapshot.json` together. Never commit `cache/`, tokens, or temporary diagnostics. Do not remove prior immutable builds unless the repository's retention policy explicitly requires it.

For design rationale and known source limitations, consult:

- `README.md` for the current cohort and quick command.
- `docs/v2-architecture-plan.md` for correlation and publication design.
- `docs/data-gap-backlog.md` for known collection gaps.
- `docs/e2e-metrics-coverage.md` for metric confidence and limitations.
