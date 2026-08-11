# Azure SDK Generation Timeline v2

This repository contains a static, Alpine.js-based dashboard that reconstructs Azure SDK generation and release timelines from Azure DevOps Release Plan work items, exact linked GitHub pull requests, and exact linked Azure Pipeline runs.

The current V2 dataset covers all management-plane Release Plans created in the last 90 days. The published cohort includes active, finished, new, and abandoned plans with portfolio metrics, plan timelines, intended-language releases, metric evidence, and event/PR drill-downs. Missing boundaries are retained as incomplete results rather than inferred.

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

## Refresh the current cohort

The zero-dependency collection pipeline requires authenticated `az` and `gh` CLIs. It selects management-plane plans, preserves mutable PR link history, enriches exact public PRs and exact pipeline runs, builds static view data, and validates redaction and data integrity. Terminal PRs and pipeline runs are reused from the private cache. Individual inaccessible or unusually large artifacts are marked as skipped instead of blocking the cohort.

```bash
node scripts/refresh-v2-data.js \
  --days 90 \
  --limit 0 \
  --mode all-management \
  --build-id "$(date -u +%Y%m%dT%H)"
```

Private normalized inputs are written under ignored `cache/`. Public output is written under `data/builds/<build-id>/`, and `data/manifest.json` is updated last.

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
