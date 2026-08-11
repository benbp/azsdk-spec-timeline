# Azure SDK Generation Timeline v2

This repository is the planning and research workspace for a static, Alpine.js-based dashboard that reconstructs Azure SDK generation and release timelines from Azure DevOps Release Plan work items and linked GitHub pull requests.

The v2 site is intentionally **not implemented yet**. The proposed architecture, research evidence, and data investment backlog are awaiting approval:

- [Research findings](docs/research-findings.md)
- [V2 architecture plan](docs/v2-architecture-plan.md)
- [Data gap investment backlog](docs/data-gap-backlog.md)

## Release Plan profiler

The zero-dependency profiler used for the initial Azure DevOps analysis can be rerun with an authenticated Azure CLI session:

```bash
node scripts/profile-release-plans.js \
  --days 365 \
  --revision-sample 30 \
  > /tmp/release-plan-profile.json
```

It emits aggregate coverage, correlation, quality, and revision-history statistics. It does not emit raw work item field values, identities, comments, or URLs.
