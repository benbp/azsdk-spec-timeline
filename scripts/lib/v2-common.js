const { execFileSync } = require("node:child_process");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");

const ORG = "https://dev.azure.com/azure-sdk";
const PROJECT = "Release";
const API_VERSION = "7.1";
const DEVOPS_SCOPE = "499b84ac-1321-427f-aa17-267ca6975798";
const LANGUAGES = ["Dotnet", "JavaScript", "Python", "Java", "Go"];
const LANGUAGE_NAMES = { Dotnet: ".NET", JavaScript: "JavaScript" };
const WORK_ITEM_ID = /\/workItems\/(\d+)$/;
const GITHUB_PR =
  /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i;

let adoToken;

function getAdoToken() {
  if (adoToken) return adoToken;
  try {
    adoToken = execFileSync(
      "az",
      [
        "account",
        "get-access-token",
        "--resource",
        DEVOPS_SCOPE,
        "--query",
        "accessToken",
        "-o",
        "tsv",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
    ).trim();
    return adoToken;
  } catch {
    throw new Error(
      "Unable to acquire an Azure DevOps token. Run `az login` with an account that can read the Release project.",
    );
  }
}

async function adoRequest(path, options = {}, retried = false) {
  const url = path.startsWith("http") ? path : `${ORG}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${getAdoToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (response.status === 401 && !retried) {
    adoToken = null;
    return adoRequest(path, options, true);
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Azure DevOps ${response.status} for ${url}: ${body.slice(0, 300)}`,
    );
  }
  return response.json();
}

async function queryReleasePlanIds(
  days,
  dateField = "changed",
  window = releasePlanQueryWindow(days),
) {
  const field =
    dateField === "created" ? "System.CreatedDate" : "System.ChangedDate";
  const start = new Date(window.startAt);
  const end = new Date(window.endAt);
  const ids = new Set();
  let cursor = start;
  while (cursor < end) {
    const next = new Date(cursor);
    next.setUTCDate(next.getUTCDate() + 30);
    if (next > end) next.setTime(end.getTime());
    const query = `SELECT [System.Id] FROM WorkItems
      WHERE [System.TeamProject] = '${PROJECT}'
        AND [System.WorkItemType] = 'Release Plan'
        AND [${field}] >= '${formatDate(cursor)}'
        AND [${field}] < '${formatDate(next)}'
      ORDER BY [${field}] DESC`;
    const result = await adoRequest(
      `/${PROJECT}/_apis/wit/wiql?api-version=${API_VERSION}`,
      { method: "POST", body: JSON.stringify({ query }) },
    );
    if ((result.workItems || []).length >= 1000) {
      throw new Error(`WIQL window starting ${formatDate(cursor)} hit the cap`);
    }
    for (const item of result.workItems || []) ids.add(item.id);
    cursor = next;
  }
  return [...ids];
}

function releasePlanQueryWindow(days, now = new Date()) {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

async function fetchWorkItems(ids) {
  const items = [];
  for (let index = 0; index < ids.length; index += 200) {
    const batch = ids.slice(index, index + 200);
    const result = await adoRequest(
      `/_apis/wit/workitems?ids=${batch.join(",")}&$expand=all&api-version=${API_VERSION}`,
    );
    items.push(...(result.value || []));
  }
  return items;
}

async function fetchRevisions(id) {
  const result = await adoRequest(
    `/${PROJECT}/_apis/wit/workitems/${id}/revisions?$expand=all&api-version=${API_VERSION}`,
  );
  return result.value || [];
}

function childIds(item) {
  return (item.relations || []).flatMap((relation) => {
    if (relation.rel !== "System.LinkTypes.Hierarchy-Forward") return [];
    const match = relation.url?.match(WORK_ITEM_ID);
    return match ? [Number(match[1])] : [];
  });
}

function displayLanguage(language) {
  return LANGUAGE_NAMES[language] || language;
}

function isLanguageApplicable(fields, language) {
  if (lower(fields["Custom.ReleasePlanType"]).includes("private")) return false;
  if (
    ["approved", "missingemitterconfig"].includes(
      lower(fields[`Custom.ReleaseExclusionStatusFor${language}`]),
    )
  )
    return false;
  const configured = String(fields["Custom.SDKLanguages"] || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length)
    return configured.includes(displayLanguage(language).toLowerCase());
  return [
    `Custom.${language}PackageName`,
    `Custom.SDKGenerationPipelineFor${language}`,
    `Custom.SDKPullRequestFor${language}`,
    `Custom.GenerationStatusFor${language}`,
    `Custom.ReleaseStatusFor${language}`,
  ].some((field) => fields[field]);
}

function parsePrUrl(value) {
  const match = String(value || "").match(GITHUB_PR);
  if (!match) return null;
  return {
    id: `github:${match[1]}/${match[2]}#${match[3]}`,
    owner: match[1],
    repo: match[2],
    number: Number(match[3]),
    url: `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
  };
}

function parsePipelineUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const rawBuildId = url.searchParams.get("buildId");
    if (!rawBuildId || !/^\d+$/.test(rawBuildId)) return null;
    const buildId = Number(rawBuildId);
    const segments = url.pathname.split("/").filter(Boolean);
    const project = segments[0] === "azure-sdk" ? segments[1] : segments[0];
    if (!project || !Number.isInteger(buildId) || buildId <= 0) return null;
    return {
      id: `ado-build:${project}:${buildId}`,
      project,
      buildId,
      url: rawUrl,
    };
  } catch {
    return null;
  }
}

function extractPrUrls(value) {
  const pattern = new RegExp(GITHUB_PR.source, "gi");
  return [...String(value || "").matchAll(pattern)].map(
    (match) =>
      `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`,
  );
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function plainText(value, limit = 240) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function lower(value) {
  return String(value || "").toLowerCase();
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function parseArgs(argv, defaults) {
  const result = { ...defaults };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unknown argument: ${key}`);
    if (key === "--help") return { ...result, help: true };
    const name = key.slice(2).replace(/-([a-z])/g, (_, letter) =>
      letter.toUpperCase(),
    );
    if (!(name in result)) throw new Error(`Unknown argument: ${key}`);
    const current = result[name];
    const raw = argv[index + 1];
    result[name] = typeof current === "number" ? Number(raw) : raw;
  }
  return result;
}

async function concurrentMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

module.exports = {
  API_VERSION,
  LANGUAGES,
  PROJECT,
  adoRequest,
  childIds,
  concurrentMap,
  displayLanguage,
  extractPrUrls,
  fetchRevisions,
  fetchWorkItems,
  isLanguageApplicable,
  lower,
  parseArgs,
  parsePipelineUrl,
  parsePrUrl,
  plainText,
  queryReleasePlanIds,
  readJson,
  releasePlanQueryWindow,
  writeJson,
};
