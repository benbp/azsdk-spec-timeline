#!/usr/bin/env node

const {
  LANGUAGES,
  childIds,
  concurrentMap,
  displayLanguage,
  extractPrUrls,
  fetchRevisions,
  fetchWorkItems,
  isLanguageApplicable,
  lower,
  parseArgs,
  parsePrUrl,
  plainText,
  queryReleasePlanIds,
  writeJson,
} = require("./lib/v2-common");

const args = parseArgs(process.argv.slice(2), {
  days: 180,
  limit: 10,
  concurrency: 6,
  mode: "complete",
  output: "cache/v2/release-plans.json",
});

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

async function main() {
  if (!["complete", "all-management"].includes(args.mode))
    throw new Error("--mode must be complete or all-management");
  const ids = await queryReleasePlanIds(
    args.days,
    args.mode === "all-management" ? "created" : "changed",
  );
  const inventory = await fetchWorkItems(ids);
  const preliminaryCandidates = inventory
    .filter((item) =>
      args.mode === "all-management"
        ? item.fields?.["Custom.MgmtScope"] === "Yes"
        : isCompleteManagementPlan(item),
    )
    .sort(
      (left, right) =>
        new Date(right.fields["System.ChangedDate"]) -
        new Date(left.fields["System.ChangedDate"]),
    );
  const allChildIds = [...new Set(preliminaryCandidates.flatMap(childIds))];
  const children = new Map(
    (await fetchWorkItems(allChildIds))
      .filter((item) => item.fields?.["System.WorkItemType"] === "API Spec")
      .map((item) => [item.id, item]),
  );
  const eligibleCandidates =
    args.mode === "complete"
      ? preliminaryCandidates.filter((item) =>
          childIds(item)
            .map((id) => children.get(id))
            .filter(Boolean)
            .some(hasExactSpecPr),
        )
      : preliminaryCandidates;
  const candidates =
    args.limit > 0 ? eligibleCandidates.slice(0, args.limit) : eligibleCandidates;
  if (args.limit > 0 && candidates.length < args.limit) {
    throw new Error(
      `Only ${candidates.length} complete management-plane plans found in ${args.days} days`,
    );
  }

  const collected = await concurrentMap(
    candidates,
    args.concurrency,
    async (item) => {
      try {
        const specs = childIds(item)
          .map((id) => children.get(id))
          .filter(Boolean);
        const [revisions, specRevisions] = await Promise.all([
          fetchRevisions(item.id),
          concurrentMap(specs, 3, async (spec) => ({
            id: spec.id,
            revisions: await fetchRevisions(spec.id),
          })),
        ]);
        return {
          plan: sanitizePlan(item, specs, revisions, specRevisions),
          skipped: null,
        };
      } catch (error) {
        return {
          plan: null,
          skipped: {
            id: String(item.id),
            title: plainText(item.fields?.["System.Title"], 180),
            reason: error.message.slice(0, 300),
          },
        };
      }
    },
  );
  const plans = collected.map((result) => result.plan).filter(Boolean);
  const skippedPlans = collected
    .map((result) => result.skipped)
    .filter(Boolean);

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    selection: {
      days: args.days,
      mode: args.mode,
      requested: args.limit || "all",
      criteria:
        args.mode === "all-management"
          ? `all management-plane Release Plans created in the last ${args.days} days`
          : "recent Finished management-plane plans with a spec PR and every intended language released with an SDK PR",
      inventoryCount: inventory.length,
      candidateCount: eligibleCandidates.length,
      collectedCount: plans.length,
      skippedCount: skippedPlans.length,
    },
    skippedPlans,
    plans,
  };
  writeJson(args.output, output);
  console.log(
    `Collected ${plans.length} release plans (${skippedPlans.length} skipped) into ${args.output}`,
  );
}

function hasExactSpecPr(item) {
  if (parsePrUrl(item.fields?.["Custom.ActiveSpecPullRequestUrl"])) return true;
  return extractPrUrls(item.fields?.["Custom.RESTAPIReviews"]).some((url) =>
    parsePrUrl(url),
  );
}

function isCompleteManagementPlan(item) {
  const fields = item.fields || {};
  if (fields["System.State"] !== "Finished") return false;
  if (fields["Custom.MgmtScope"] !== "Yes") return false;
  if (lower(fields["Custom.ReleasePlanType"]).includes("private")) return false;
  const languages = LANGUAGES.filter((language) =>
    isLanguageApplicable(fields, language),
  );
  if (!languages.length) return false;
  if (
    !languages.every(
      (language) =>
        lower(fields[`Custom.ReleaseStatusFor${language}`]).includes(
          "released",
        ) && parsePrUrl(fields[`Custom.SDKPullRequestFor${language}`]),
    )
  )
    return false;
  return childIds(item).length > 0;
}

function sanitizePlan(item, specs, revisions, specRevisionGroups) {
  const fields = item.fields || {};
  const languages = LANGUAGES.filter((language) =>
    isLanguageApplicable(fields, language),
  ).map((language) => {
    const sdkPr = parsePrUrl(fields[`Custom.SDKPullRequestFor${language}`]);
    const history = new Map();
    for (const revision of revisions) {
      const linked = parsePrUrl(
        revision.fields?.[`Custom.SDKPullRequestFor${language}`],
      );
      if (linked) history.set(linked.id, linked);
    }
    if (sdkPr) history.set(sdkPr.id, sdkPr);
    return {
      id: displayLanguage(language),
      key: language,
      package: plainText(fields[`Custom.${language}PackageName`], 160),
      generationStatus: plainText(
        fields[`Custom.GenerationStatusFor${language}`],
        80,
      ),
      generationPipelineUrl:
        String(fields[`Custom.SDKGenerationPipelineFor${language}`] || "") ||
        null,
      sdkPr,
      sdkPrHistory: [...history.values()],
      sdkPrObservedStatus: plainText(
        fields[`Custom.SDKPullRequestStatusFor${language}`],
        80,
      ),
      releaseStatus: plainText(
        fields[`Custom.ReleaseStatusFor${language}`],
        80,
      ),
      releasePipelineUrl:
        String(fields[`Custom.ReleasePipelineFor${language}`] || "") || null,
      releasedVersion:
        plainText(fields[`Custom.ReleasedVersionFor${language}`], 100) || null,
    };
  });
  const specPrs = new Map();
  for (const spec of specs) {
    const active = parsePrUrl(spec.fields?.["Custom.ActiveSpecPullRequestUrl"]);
    if (active) specPrs.set(active.id, active);
    for (const url of extractPrUrls(spec.fields?.["Custom.RESTAPIReviews"])) {
      const pr = parsePrUrl(url);
      if (pr) specPrs.set(pr.id, pr);
    }
  }
  for (const group of specRevisionGroups) {
    for (const revision of group.revisions) {
      const pr = parsePrUrl(
        revision.fields?.["Custom.ActiveSpecPullRequestUrl"],
      );
      if (pr) specPrs.set(pr.id, pr);
    }
  }

  return {
    id: String(item.id),
    releasePlanId:
      plainText(fields["Custom.ReleasePlanID"], 100) || String(item.id),
    title: plainText(fields["System.Title"], 180),
    service: plainText(
      fields["Custom.ServiceName"] ||
        fields["Custom.ProductServiceTreeName"] ||
        fields["System.Title"],
      120,
    ),
    product: plainText(
      fields["Custom.ProductServiceTreeName"] || fields["System.AreaPath"],
      160,
    ),
    path: plainText(fields["Custom.ApiSpecProjectPath"], 220),
    state: fields["System.State"],
    plane: "management",
    releaseType: plainText(fields["Custom.ReleasePlanType"], 80),
    intendedMonth: plainText(fields["Custom.SDKReleasemonth"], 40) || null,
    createdAt: fields["System.CreatedDate"],
    changedAt: fields["System.ChangedDate"],
    adoUrl: `https://dev.azure.com/azure-sdk/Release/_workitems/edit/${item.id}`,
    specPrs: [...specPrs.values()],
    languages,
    revisionEvents: normalizeRevisions(item.id, revisions, languages),
    specRevisionEvents: specRevisionGroups.flatMap((group) =>
      normalizeSpecRevisions(group.id, group.revisions),
    ),
  };
}

function normalizeRevisions(planId, revisions, languages) {
  const events = [];
  let previous = {};
  for (const revision of revisions) {
    const fields = revision.fields || {};
    const occurredAt = fields["System.ChangedDate"];
    addChange(
      events,
      previous,
      fields,
      "System.State",
      "plan.state_changed",
      "plan",
      occurredAt,
      planId,
      revision.rev,
    );
    addChange(
      events,
      previous,
      fields,
      "Custom.APISpecApprovalStatus",
      "spec.approval_changed",
      "spec-review",
      occurredAt,
      planId,
      revision.rev,
    );
    for (const language of languages) {
      const track = `sdk:${language.id}:${language.package || language.id}`;
      for (const [suffix, type, phase] of [
        ["GenerationStatusFor", "generation.status_changed", "generation"],
        ["SDKPullRequestFor", "sdk.pr_linked", "generation"],
        ["ReleaseStatusFor", "release.status_changed", "release"],
        ["ReleasedVersionFor", "package.version_observed", "release"],
      ]) {
        addChange(
          events,
          previous,
          fields,
          `Custom.${suffix}${language.key}`,
          type,
          phase,
          occurredAt,
          planId,
          revision.rev,
          track,
        );
      }
    }
    previous = fields;
  }
  return events;
}

function normalizeSpecRevisions(specId, revisions) {
  const events = [];
  let previous = {};
  for (const revision of revisions) {
    addChange(
      events,
      previous,
      revision.fields || {},
      "Custom.ActiveSpecPullRequestUrl",
      "spec.pr_linked",
      "spec-review",
      revision.fields?.["System.ChangedDate"],
      specId,
      revision.rev,
      "spec",
    );
    previous = revision.fields || {};
  }
  return events;
}

function addChange(
  events,
  previous,
  current,
  field,
  type,
  phase,
  occurredAt,
  itemId,
  revision,
  trackId = "plan",
) {
  if (!occurredAt || previous[field] === current[field] || !current[field])
    return;
  const value =
    field.includes("PullRequest") || field.includes("PullRequestUrl")
      ? parsePrUrl(current[field])?.url
      : plainText(current[field], 160);
  if (!value) return;
  events.push({
    id: `ado:${itemId}:${revision}:${field}`,
    type,
    phase,
    occurredAt,
    observedAt: occurredAt,
    trackId,
    value,
    confidence: "observed",
    source: {
      system: "azure-devops",
      entity: `work-item:${itemId}`,
      url: `https://dev.azure.com/azure-sdk/Release/_workitems/edit/${itemId}`,
    },
  });
}
