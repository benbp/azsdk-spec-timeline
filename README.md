# Azure SDK Generation Timeline v2

This repository contains a static, Alpine.js-based dashboard that reconstructs Azure SDK generation and release timelines from Azure DevOps Release Plan work items, exact linked GitHub pull requests, and exact linked Azure Pipeline runs.

The current V2 dataset looks back 180 days for management-plane Release Plans and publishes flows with the two stable correlation roots: an explicitly populated Release Plan ID and an exact spec PR link. A cheap Release Plan/API Spec preflight rejects records missing either root before revision, GitHub, or pipeline enrichment. Missing downstream SDK PRs, versions, pipeline links, or inaccessible sources remain visible as incomplete metric evidence instead of deleting the plan. This is a core-correlated tracked cohort, not a fleet-complete population.

Top-line scorecard percentiles use completed results from the rolling 30-day statistics period. Weekly trends retain 13 weeks, while monthly trends grow with available tracked history up to 12 months; both compare the current period with the available prior three-month rolling average. Each metric applies its own evidence contract: S1/S4 require exact GitHub boundaries, S2/S3 require an exact generation run, and observed S5/L1 release boundaries additionally require the Release Plan's released version. Release-pipeline URL coverage remains diagnostic and does not exclude an otherwise useful flow.

- [Research findings](docs/research-findings.md)
- [V2 architecture plan](docs/v2-architecture-plan.md)
- [Data gap investment backlog](docs/data-gap-backlog.md)
- [E2E metric display and investment assessment](docs/e2e-metrics-coverage.md)

## Run the site

Serve the repository over HTTP so the browser can load the versioned JSON:

```bash
python3 -m http.server 4173
```

Then open <http://localhost:4173/>.

The dashboard intentionally targets desktop browsers and uses a fixed-width
desktop canvas rather than mobile-specific layouts.

## Refresh the current cohort

The zero-dependency collection pipeline requires authenticated `az` and `gh` CLIs. It selects management-plane plans, preserves mutable PR link history, enriches exact public PRs and exact pipeline runs, builds static view data, and validates redaction and data integrity. Terminal PRs and pipeline runs are reused from the private cache. Individual inaccessible or unusually large artifacts are marked as skipped instead of blocking the cohort.

```bash
node scripts/refresh-v2-data.js \
  --days 180 \
  --limit 0 \
  --mode all-management \
  --build-id "$(date -u +%Y%m%dT%H)"
```

Private normalized inputs are written under ignored `cache/`. Public output is written under `data/builds/<build-id>/`, and `data/manifest.json` is updated last.

The preflight requires only an explicitly populated Release Plan ID and exact spec PR. Plans that fail either root check are not sent to the expensive revision, GitHub, or pipeline collectors. Exact downstream links are enriched when present, but missing evidence produces incomplete metrics and quality warnings. Pipeline names and timestamps are never used to guess missing relationships.

The intended initial production cadence is daily. Scheduling is intentionally left out of this proof until the deployment environment has an Azure identity with Release project access.

## Release Plan profiler

The zero-dependency profiler used for the initial Azure DevOps analysis can be rerun with an authenticated Azure CLI session:

```bash
node scripts/profile-release-plans.js \
  --days 365 \
  --revision-sample 30 \
  > /tmp/release-plan-profile.json
```

It emits aggregate coverage, correlation, quality, and revision-history statistics. It does not emit raw work item field values, identities, comments, or URLs.
