---
name: generate-service-timeline
description: >
  Generates a full service timeline covering all spec PRs, SDK PRs, and releases
  for a TypeSpec project over a lookback period. Use when asked to generate a service
  timeline, full history, or multi-release view for a TypeSpec project path.
---

# Generate Full Service Timeline Data

This skill generates a comprehensive timeline covering **all** spec PRs, SDK PRs, and releases for a given TypeSpec project/service over a configurable lookback period (default: 1 year). Unlike the per-release `generate-timeline-data` skill which focuses on a single spec PR, this produces a multi-release timeline showing the full history of a service's SDK generation lifecycle.

## When to Use

- User asks for a "full service timeline", "full history", or "all releases" for a service
- User provides a TypeSpec project path (e.g., `specification/durabletask/DurableTask.Management`)
- User wants to see trends across multiple release cycles

## Instructions

### Step 1: Identify the TypeSpec Project Path

The user provides a TypeSpec project path. This can be:
- A relative spec path: `specification/durabletask/DurableTask.Management`
- A full local path: `/home/ben/azs/azure-rest-api-specs/specification/durabletask/DurableTask.Management`
- A GitHub-style path: `Azure/azure-rest-api-specs/specification/durabletask/DurableTask.Management`

The key requirement is the path under `specification/` in the `azure-rest-api-specs` repo. It should contain a `tspconfig.yaml` file.

### Step 2: Verify TypeSpec Metadata

Before fetching, verify the project exists and has the expected structure:

```bash
# Check tspconfig.yaml exists (via GitHub API)
gh api repos/Azure/azure-rest-api-specs/contents/specification/<service>/<ProjectName>/tspconfig.yaml --jq '.name'
```

The fetch script will automatically discover package metadata from `tspconfig.yaml`.

### Step 3: Fetch Raw Data

Run the service timeline fetch script:

```bash
node scripts/fetch-service-timeline.js <tsp-project-path> \
  [--lookback <days>] \
  [--tool-calls-csv queries/query3-tool-calls.csv] \
  [--skip-releases] \
  > /tmp/raw-service.json
```

**Parameters:**
- `<tsp-project-path>`: The TypeSpec project path (required)
- `--lookback <days>`: Lookback period in days (default: 365)
- `--tool-calls-csv <path>`: Path to tool calls CSV from Kusto query3 (optional)
- `--skip-releases`: Skip Azure DevOps release pipeline lookups (optional, faster)

**Example:**
```bash
node scripts/fetch-service-timeline.js specification/durabletask/DurableTask.Management \
  --tool-calls-csv queries/query3-tool-calls.csv \
  --skip-releases \
  > /tmp/raw-service-durabletask.json
```

**What the script does:**
1. Resolves TypeSpec metadata (package names, service dirs per language) from `tspconfig.yaml`
2. Discovers all spec PRs touching the project path within the lookback period
3. For each spec PR, discovers downstream SDK PRs using:
   - Search by spec PR URL in SDK PR bodies (primary, most precise)
   - Search by merge commit SHA (for newer AutoPR bot format)
   - Search by service directory path commits (fallback for unlinked PRs)
4. Fetches full PR data for every discovered PR (metadata, comments, reviews, commits)
5. Optionally parses tool call telemetry from the CSV
6. Optionally looks up release pipeline data from Azure DevOps

**API budget:** For a typical service with 5-15 spec PRs and 25-125 SDK PRs:
- Discovery: ~50-150 API calls
- Full fetch: ~150-750 API calls (6 calls per PR)
- Total: ~200-900 calls (within GitHub's 5000/hr limit)
- Wall clock: ~5-15 minutes

**Monitor progress:** The script outputs progress to stderr. Watch for:
- `Resolved TypeSpec metadata for: <service>` — metadata discovery succeeded
- `Found N spec PRs in lookback window` — spec PR discovery completed
- `Discovering SDK PRs for <language>...` — SDK PR discovery per language
- `Fetching full data for N PRs...` — full PR fetch phase
- API errors (503s) are logged but non-fatal — individual PRs may have incomplete data

### Step 4: Process into Timeline JSON

```bash
node scripts/process-service-timeline.js /tmp/raw-service.json data/service-<name>.json "<Service Name>"
```

**Example:**
```bash
node scripts/process-service-timeline.js /tmp/raw-service-durabletask.json data/service-durabletask.json "DurableTask"
```

**What the processing script does:**
1. Classifies all PR events (comments, reviews, commits) into timeline event types
2. Detects author nags, manual fixes, idle gaps, review wait times
3. Groups PRs into release windows (spec PR → downstream SDK PRs)
4. Computes per-window metrics (duration, pipeline gap, nag count, reviewer count, etc.)
5. Computes all-up metrics (averages, totals, language breakdown, tool call stats)
6. Generates service-level insights (recurring bottlenecks, trends, automation rate)

### Step 5: Audit the Output

After processing, verify the output:

```bash
# Quick summary
node -e "const d=require('./data/service-<name>.json'); console.log(d.service, ':', d.specPRs.length, 'spec PRs,', Object.values(d.sdkPRs).flat().length, 'SDK PRs,', d.releaseWindows.length, 'windows')"

# Check date range
node -e "const d=require('./data/service-<name>.json'); console.log('Range:', d.startDate, '→', d.endDate)"

# Check per-language counts
node -e "const d=require('./data/service-<name>.json'); Object.entries(d.sdkPRs).forEach(([l,prs]) => console.log(l+':', prs.length, 'PRs'))"
```

Verify:
- Spec PR count matches expectations for the lookback period
- SDK PR count is reasonable (typically 2-6x the spec PR count)
- Release windows make sense (each should have 1 spec PR + downstream SDK PRs)
- Date range covers the expected lookback period
- No obvious gaps in the timeline (missing languages, unexpected zero counts)

### Step 6: Preserve the Generated Artifact

The current portfolio SPA does not maintain a hardcoded sample registry.
Keep the generated service timeline as a standalone data artifact unless the
user explicitly requests migration into the normalized snapshot pipeline.

### Step 7: Verify in Browser

Start the local server:

```bash
python3 -m http.server 4173
# Open http://localhost:4173
```

Use the `playwright-cli` skill to automate browser verification after an
artifact has been integrated into the active SPA.

## Data Model Reference

The service timeline JSON has `"type": "service-timeline"` as a discriminator. Key structure:

```json
{
  "type": "service-timeline",
  "service": "DurableTask",
  "specPath": "specification/durabletask/DurableTask.Management",
  "packages": { "Python": { "name": "...", "serviceDir": "...", "repo": "..." }, ... },
  "specPRs": [ { /* PR objects with events */ } ],
  "sdkPRs": { "Python": [...], "Java": [...], "Go": [...], ".NET": [...], "JavaScript": [...] },
  "releaseWindows": [ { "id": "rw-0", "label": "...", "specPRNumbers": [...], "sdkPRNumbers": {...}, "summary": {...} } ],
  "summary": { "totalSpecPRs": 15, "totalSDKPRs": 125, "avgCycleTimeDays": 20.27, ... },
  "insights": [ { "type": "...", "severity": "...", "description": "..." } ]
}
```

## File Naming Convention

- Raw data: `/tmp/raw-service-<name>.json` (temporary)
- Final output: `data/service-<name>.json` (committed)
- Name should be lowercase, e.g., `service-durabletask.json`, `service-netapp.json`

## Troubleshooting

### "No spec PRs found"
- Verify the TypeSpec project path is correct and contains `tspconfig.yaml`
- Check the lookback period — the service may not have had spec changes recently
- Try increasing `--lookback` to cover more history

### High API usage / rate limiting
- The script respects GitHub's 5000 requests/hour rate limit
- For large services (100+ SDK PRs), the fetch may take 15-20 minutes
- If rate-limited, wait and re-run — the script will resume where it left off
- Use `--skip-releases` to reduce API calls if release data isn't needed

### Missing SDK PRs
- Some SDK PRs may not reference the spec PR in their body (older format)
- The path-based fallback (`commits?path=`) catches most of these
- Check if the language is configured in `tspconfig.yaml` — unconfigured languages won't be discovered

### TypeSpec metadata resolution failure
- The script falls back to `tspconfig.yaml` parsing if the metadata emitter isn't available
- Ensure `tspconfig.yaml` has `options` entries for each language emitter
- The emitter key mapping is: `@azure-tools/typespec-python` → Python, `@azure-tools/typespec-java` → Java, `@azure-tools/typespec-go` → Go, `@azure-typespec/http-client-csharp-mgmt` → .NET, `@azure-tools/typespec-ts` → JavaScript
