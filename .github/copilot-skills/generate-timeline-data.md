# Generate Azure SDK Timeline Data

## Description
This skill fetches PR data from the Azure SDK generation process and produces a structured timeline JSON that can be visualized with the timeline-viz website. Given a spec PR URL from `azure-rest-api-specs`, it discovers downstream SDK PRs, fetches all events, and analyzes them to identify bottlenecks, nags, manual fixes, and idle gaps.

## Instructions

You are an expert at analyzing Azure SDK generation timelines. The user will provide a PR link from the `Azure/azure-rest-api-specs` repository. Your job is to:

1. **Fetch raw data** using the fetch script or `gh` CLI commands
2. **Discover downstream SDK PRs** linked to the spec PR
3. **Classify all events** into timeline event types
4. **Analyze interactions** to detect nags, manual fixes, blocking comments, and idle gaps
5. **Generate insights** about bottlenecks and friction points
6. **Output** a complete timeline JSON matching the schema

### Step 1: Identify the Spec PR

Parse the user's input to extract the spec PR URL. Expected format:
`https://github.com/Azure/azure-rest-api-specs/pull/{number}`

### Step 2: Fetch Data

Use the fetch script if available:
```bash
node scripts/fetch-timeline.js <spec-pr-url> [--sdk-prs <url1> <url2> ...]
```

Or fetch manually with `gh` CLI:
```bash
# Spec PR metadata
gh api repos/Azure/azure-rest-api-specs/pulls/{number}

# Spec PR comments
gh api repos/Azure/azure-rest-api-specs/issues/{number}/comments --paginate

# Spec PR reviews
gh api repos/Azure/azure-rest-api-specs/pulls/{number}/reviews --paginate

# Spec PR review comments (inline threads)
gh api repos/Azure/azure-rest-api-specs/pulls/{number}/comments --paginate

# Spec PR commits
gh api repos/Azure/azure-rest-api-specs/pulls/{number}/commits --paginate
```

### Step 3: Discover SDK PRs

SDK PRs can be found by:

1. **Search SDK repos** for references to the spec PR:
```bash
gh api "search/issues?q=repo:Azure/azure-sdk-for-java+azure-rest-api-specs/pull/{number}+is:pr&per_page=5"
gh api "search/issues?q=repo:Azure/azure-sdk-for-go+azure-rest-api-specs/pull/{number}+is:pr&per_page=5"
gh api "search/issues?q=repo:Azure/azure-sdk-for-python+azure-rest-api-specs/pull/{number}+is:pr&per_page=5"
gh api "search/issues?q=repo:Azure/azure-sdk-for-net+azure-rest-api-specs/pull/{number}+is:pr&per_page=5"
gh api "search/issues?q=repo:Azure/azure-sdk-for-js+azure-rest-api-specs/pull/{number}+is:pr&per_page=5"
```

2. **Check SDK PR bodies** — they typically contain:
   `Spec Pull Request: https://github.com/Azure/azure-rest-api-specs/pull/{number}`

3. **The user may also provide SDK PR URLs directly** — use those if given.

For each discovered SDK PR, fetch the same data (metadata, comments, reviews, review comments, commits).

### Step 4: Classify Events

For each PR, create timeline events from the raw data. Map each raw data item to one of these event types:

| Raw Data | Event Type | How to Detect |
|---|---|---|
| PR metadata `created_at` | `pr_created` | Always the first event |
| PR metadata `merged_at` | `pr_merged` | If PR is merged |
| PR metadata `closed_at` | `pr_closed` | If PR is closed without merge |
| Commits | `commit_pushed` | Each commit after PR creation |
| Review with state=APPROVED | `review_approved` | Review state is APPROVED |
| Review with state=CHANGES_REQUESTED | `review_changes_requested` | Review state is CHANGES_REQUESTED |
| Review with state=COMMENTED | `review_comment` | Review state is COMMENTED with body |
| Inline review comment | `review_comment` | From review comments/threads |
| Issue comment by human | `issue_comment` | Comment by non-bot user |
| Issue comment by bot | `bot_comment` | Comment by user with `[bot]` suffix or known bots |
| *See analysis below* | `author_nag` | AI-detected from comment text |
| *See analysis below* | `manual_fix` | AI-detected from comment text |
| *Computed* | `idle_gap` | Time gaps >24h between consecutive events |

### Step 5: AI Analysis

#### Detecting Author Nags (`author_nag`)

Look for comments by the spec PR author (the "owner") that:
- @ mention another user AND ask them to review, approve, merge, or take action
- Contain phrases like: "could you check", "can you merge", "please review", "can you approve", "could you approve", "please merge", "can you take a look"
- The `targetUser` should be the @ mentioned user

#### Detecting Manual Fixes (`manual_fix`)

Look for comments where the owner mentions doing manual work on an auto-generated PR:
- "manually edited", "manually ran", "manual intervention", "had to manually", "not passing without manual"
- These indicate the SDK code generation pipeline produced incomplete output

#### Determining Sentiment

- `positive`: approvals, LGTM, merge events, unblocking comments
- `negative`: nags, manual fixes needed
- `blocking`: review comments that ask for changes, questions that must be answered before merge
- `neutral`: informational comments, bot output, status updates

#### Computing Idle Gaps

1. Sort all events for each PR by timestamp
2. Find consecutive events where the gap is > 24 hours
3. Create `idle_gap` events with:
   - `timestamp`: end of previous event
   - `endTimestamp`: start of next event
   - `durationHours`: gap duration in hours
   - `sentiment`: "blocking" if > 72h, "neutral" if 24-72h

### Step 6: Generate Insights

Analyze the complete timeline and generate insights:

1. **Pipeline gap**: Time between spec PR merge and first SDK PR creation
2. **Spec PR review wait**: Time from spec PR creation to first human review
3. **Author nag count**: How many times the owner had to nudge reviewers
4. **Manual fixes**: How many SDK PRs needed manual intervention
5. **Slowest/fastest SDK PR**: Which language took longest/shortest
6. **Reviewer bottlenecks**: Which reviewers were slow to respond
7. **Positive patterns**: What went well (e.g., fast approvals)

### Step 7: Output JSON

Produce a JSON file matching this schema:

```json
{
  "title": "<spec PR title>",
  "owner": "<spec PR author>",
  "startDate": "<earliest event timestamp>",
  "endDate": "<latest event timestamp>",
  "specPR": {
    "repo": "Azure/azure-rest-api-specs",
    "number": <number>,
    "url": "<url>",
    "title": "<title>",
    "author": "<author>",
    "createdAt": "<iso8601>",
    "mergedAt": "<iso8601 or null>",
    "mergedBy": "<username or null>",
    "state": "merged|closed|open",
    "labels": ["..."],
    "reviewers": ["..."],
    "events": [
      {
        "type": "<event_type>",
        "timestamp": "<iso8601>",
        "actor": "<username>",
        "actorRole": "author|reviewer|bot|copilot",
        "description": "<short description>",
        "sentiment": "neutral|positive|negative|blocking",
        "details": {
          "body": "<full comment text if applicable>",
          "url": "<github link>",
          "targetUser": "<@ mentioned user if applicable>",
          "durationHours": <number if idle_gap>
        }
      }
    ]
  },
  "sdkPRs": [ /* same structure per SDK PR, with added "language" field */ ],
  "insights": [
    {
      "type": "bottleneck|nag|manual_fix|idle|positive|summary",
      "severity": "info|warning|critical",
      "description": "<human-readable insight>",
      "durationDays": <number if applicable>,
      "prRef": "<repo#number if applicable>"
    }
  ],
  "summary": {
    "totalDurationDays": <number>,
    "specPRDays": <number>,
    "pipelineGapDays": <number>,
    "sdkPRMaxDays": <number>,
    "fastestSDKPR": { "language": "<lang>", "days": <number> },
    "slowestSDKPR": { "language": "<lang>", "days": <number> },
    "totalUniqueReviewers": <number>,
    "totalNags": <number>,
    "totalManualFixes": <number>
  }
}
```

Save the output to a file (e.g., `data/timeline-<name>.json`) and tell the user they can open `index.html` and load the file, or place it as `data/sample-durabletask.json` to make it the default.

### Actor Role Classification

- `author`: The spec PR owner (the human driving the process) — even on SDK PRs
- `reviewer`: Human reviewers who are NOT the spec PR owner
- `bot`: Users with `[bot]` suffix, or known bot accounts like `azure-sdk`, `github-actions[bot]`
- `copilot`: `copilot-pull-request-reviewer[bot]` or `Copilot`

### Known Bot Accounts
- `azure-sdk`
- `github-actions[bot]`
- `azure-pipelines[bot]`
- `copilot-pull-request-reviewer[bot]`
- `Copilot`
- `msftbot[bot]`
