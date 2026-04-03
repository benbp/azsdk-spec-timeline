#!/usr/bin/env node
/**
 * fetch-timeline.js
 *
 * Fetches raw PR data for an Azure SDK generation timeline using the `gh` CLI.
 * Usage: node scripts/fetch-timeline.js <spec-pr-url> [--sdk-prs <url1> <url2> ...]
 *
 * If SDK PR URLs are not provided, the script will attempt to discover them
 * by searching SDK repos for references to the spec PR.
 */

const { execSync } = require('child_process');

const SDK_REPOS = [
  'Azure/azure-sdk-for-java',
  'Azure/azure-sdk-for-go',
  'Azure/azure-sdk-for-python',
  'Azure/azure-sdk-for-net',
  'Azure/azure-sdk-for-js'
];

const LANG_MAP = {
  'azure-sdk-for-java': 'Java',
  'azure-sdk-for-go': 'Go',
  'azure-sdk-for-python': 'Python',
  'azure-sdk-for-net': '.NET',
  'azure-sdk-for-js': 'JavaScript'
};

function gh(args) {
  try {
    const result = execSync(`gh ${args}`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000
    });
    return result.trim();
  } catch (e) {
    console.error(`gh command failed: gh ${args}`);
    console.error(e.stderr || e.message);
    return null;
  }
}

function ghJson(args) {
  const result = gh(args);
  if (!result) return null;
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

function parseGitHubPRUrl(url) {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!match) throw new Error(`Invalid PR URL: ${url}`);
  return { repo: match[1], number: parseInt(match[2]) };
}

function fetchPR(repo, number) {
  console.error(`Fetching PR: ${repo}#${number}`);
  return ghJson(`api repos/${repo}/pulls/${number}`);
}

function fetchComments(repo, number) {
  console.error(`  Fetching comments: ${repo}#${number}`);
  return ghJson(`api repos/${repo}/issues/${number}/comments --paginate`) || [];
}

function fetchReviews(repo, number) {
  console.error(`  Fetching reviews: ${repo}#${number}`);
  return ghJson(`api repos/${repo}/pulls/${number}/reviews --paginate`) || [];
}

function fetchReviewComments(repo, number) {
  console.error(`  Fetching review comments: ${repo}#${number}`);
  return ghJson(`api repos/${repo}/pulls/${number}/comments --paginate`) || [];
}

function fetchCommits(repo, number) {
  console.error(`  Fetching commits: ${repo}#${number}`);
  return ghJson(`api repos/${repo}/pulls/${number}/commits --paginate`) || [];
}

function fetchTimelineEvents(repo, number) {
  console.error(`  Fetching timeline events: ${repo}#${number}`);
  return ghJson(`api repos/${repo}/issues/${number}/timeline --paginate -H "Accept: application/vnd.github.mockingbird-preview+json"`) || [];
}

function discoverSDKPRs(specRepo, specNumber) {
  console.error(`Discovering SDK PRs linked to ${specRepo}#${specNumber}...`);
  const results = [];

  for (const repo of SDK_REPOS) {
    console.error(`  Searching ${repo}...`);
    const searchResult = ghJson(
      `api "search/issues?q=repo:${repo}+${specRepo}/pull/${specNumber}+is:pr&per_page=5"`
    );

    if (searchResult?.items?.length) {
      for (const item of searchResult.items) {
        results.push({
          repo,
          number: item.number,
          url: item.html_url
        });
      }
    }
  }

  return results;
}

function fetchFullPRData(repo, number) {
  const pr = fetchPR(repo, number);
  if (!pr) return null;

  const comments = fetchComments(repo, number);
  const reviews = fetchReviews(repo, number);
  const reviewComments = fetchReviewComments(repo, number);
  const commits = fetchCommits(repo, number);

  const repoShort = repo.split('/')[1];
  const language = LANG_MAP[repoShort] || null;

  return {
    repo,
    language,
    number,
    url: pr.html_url,
    title: pr.title,
    author: pr.user?.login,
    createdAt: pr.created_at,
    mergedAt: pr.merged_at,
    closedAt: pr.closed_at,
    mergedBy: pr.merged_by?.login,
    state: pr.merged ? 'merged' : pr.state,
    labels: (pr.labels || []).map(l => l.name),
    reviewers: [
      ...(pr.requested_reviewers || []).map(r => r.login),
      ...reviews.filter(r => r.state === 'APPROVED').map(r => r.user?.login)
    ].filter((v, i, a) => a.indexOf(v) === i),
    _raw: {
      pr,
      comments,
      reviews,
      reviewComments,
      commits
    }
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node fetch-timeline.js <spec-pr-url> [--sdk-prs <url1> <url2> ...]');
    process.exit(1);
  }

  const specUrl = args[0];
  const { repo: specRepo, number: specNumber } = parseGitHubPRUrl(specUrl);

  // Parse SDK PR URLs if provided
  let sdkPRUrls = [];
  const sdkIdx = args.indexOf('--sdk-prs');
  if (sdkIdx !== -1) {
    sdkPRUrls = args.slice(sdkIdx + 1);
  }

  // Fetch spec PR data
  const specData = fetchFullPRData(specRepo, specNumber);
  if (!specData) {
    console.error('Failed to fetch spec PR');
    process.exit(1);
  }

  // Discover or use provided SDK PRs
  let sdkPRs = [];
  if (sdkPRUrls.length > 0) {
    for (const url of sdkPRUrls) {
      const { repo, number } = parseGitHubPRUrl(url);
      const data = fetchFullPRData(repo, number);
      if (data) sdkPRs.push(data);
    }
  } else {
    const discovered = discoverSDKPRs(specRepo, specNumber);
    for (const { repo, number } of discovered) {
      const data = fetchFullPRData(repo, number);
      if (data) sdkPRs.push(data);
    }
  }

  // Output the raw data for agent processing
  const output = {
    _meta: {
      fetchedAt: new Date().toISOString(),
      specUrl,
      note: 'This is raw fetched data. It needs agent processing to produce the final timeline JSON.'
    },
    specPR: specData,
    sdkPRs
  };

  console.log(JSON.stringify(output, null, 2));
}

main();
