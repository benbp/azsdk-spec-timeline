#!/usr/bin/env node

const { createHash } = require("node:crypto");
const {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} = require("node:fs");
const { join } = require("node:path");
const {
  parseArgs,
  readJson,
  writeJson,
} = require("./lib/v2-common");
const { POLICY_VERSION } = require("./lib/instrumentation-compliance");

const args = parseArgs(process.argv.slice(2), {
  plans: "cache/v2/release-plans.json",
  github: "cache/v2/github-prs.json",
  pipelines: "cache/v2/pipeline-runs.json",
  output: "data",
  buildId: new Date().toISOString().replace(/[-:]/g, "").slice(0, 13),
});

const METRIC_DEFINITIONS = [
  {
    id: "L1",
    version: 1,
    name: "Full time-to-SDK",
    description:
      "First linked spec PR creation to the final observed intended-language release.",
    unit: "hours",
    readiness: "provisional",
  },
  {
    id: "S1",
    version: 1,
    name: "Spec PR cycle time",
    description: "Spec PR creation to merge.",
    unit: "hours",
    readiness: "validated",
  },
  {
    id: "S2",
    version: 1,
    name: "Generation trigger latency",
    description:
      "Spec merge to the exact linked generation pipeline start.",
    unit: "hours",
    readiness: "provisional",
  },
  {
    id: "S3",
    version: 1,
    name: "Generation execution",
    description: "Exact linked generation pipeline start to SDK PR creation.",
    unit: "hours",
    readiness: "provisional",
  },
  {
    id: "S4",
    version: 1,
    name: "SDK PR cycle time",
    description: "SDK PR creation to merge.",
    unit: "hours",
    readiness: "validated",
  },
  {
    id: "S5",
    version: 1,
    name: "Release latency",
    description:
      "SDK PR merge to the Release Plan's observed released status.",
    unit: "hours",
    readiness: "provisional",
  },
];

main();

function main() {
  const source = readJson(args.plans);
  const github = readJson(args.github);
  const pipelineSource = readJson(args.pipelines);
  const prMap = new Map(github.prs.map((pr) => [pr.id, pr]));
  const pipelineRuns = pipelineSource.runs;
  const buildRoot = join(args.output, "builds", args.buildId);
  if (existsSync(buildRoot)) {
    throw new Error(
      `Build ${args.buildId} already exists. Use a new immutable build ID.`,
    );
  }
  mkdirSync(buildRoot, { recursive: true });

  const buildSource = {
    ...source,
    selection: {
      ...source.selection,
      publishedCount: source.plans.length,
    },
  };
  const plans = source.plans.map((plan) =>
    buildPlan(plan, prMap, pipelineRuns, source.generatedAt),
  );
  const portfolio = buildPortfolio(plans, buildSource, github, pipelineSource);
  const services = buildServices(plans);
  const scorecard = buildScorecard(plans, source.generatedAt);

  writeJson(join(buildRoot, "portfolio.json"), portfolio);
  writeJson(
    join(buildRoot, "aggregates", "metric-definitions.json"),
    METRIC_DEFINITIONS,
  );
  writeJson(join(buildRoot, "aggregates", "scorecard.json"), scorecard);
  writeJson(
    join(buildRoot, "indexes", "services.json"),
    services.map(({ slug, name, plans: servicePlans }) => ({
      slug,
      name,
      planCount: servicePlans.length,
    })),
  );
  for (const plan of plans) {
    writeJson(join(buildRoot, "plans", `${plan.id}.json`), plan);
  }
  for (const service of services) {
    writeJson(
      join(buildRoot, "services", `${service.slug}.json`),
      service,
    );
  }

  const manifest = {
    schemaVersion: 1,
    buildId: args.buildId,
    generatedAt: source.generatedAt,
    redactionPolicyVersion: 1,
    minimumUiVersion: 1,
    cadence: "daily",
    counts: {
      plans: plans.length,
      pullRequests: github.prCount,
      pipelineRuns: pipelineSource.runCount,
      events: plans.reduce((sum, plan) => sum + plan.events.length, 0),
      services: services.length,
      skippedPlans: buildSource.skippedPlans?.length || 0,
      skippedPullRequests: github.skippedPrCount || 0,
      skippedPipelineRuns: pipelineSource.skippedRunCount || 0,
    },
    sourceCoverage: portfolio.dataQuality,
    paths: {
      portfolio: `builds/${args.buildId}/portfolio.json`,
      metricDefinitions: `builds/${args.buildId}/aggregates/metric-definitions.json`,
      scorecard: `builds/${args.buildId}/aggregates/scorecard.json`,
      services: `builds/${args.buildId}/indexes/services.json`,
      plan: `builds/${args.buildId}/plans/{id}.json`,
      service: `builds/${args.buildId}/services/{slug}.json`,
    },
    hashes: hashFiles(buildRoot, buildRoot),
  };
  writeJson(join(args.output, "manifest.json"), manifest);
  console.log(
    `Built ${plans.length} plans with ${manifest.counts.events} events at ${buildRoot}`,
  );
}

function buildPlan(source, prMap, pipelineRuns, generatedAt) {
  const runs = pipelineRuns.filter((run) =>
    run.references.some((reference) => reference.planId === source.id),
  );
  const specPrIds = new Set(source.specPrs.map((pr) => pr.id));
  const tracks = [
    {
      id: "plan",
      kind: "plan",
      label: "Release Plan",
      detail: source.releaseType,
    },
    ...source.specPrs.map((linked, index) => {
      const pr = prMap.get(linked.id);
      return {
        id: `spec:${linked.id}`,
        kind: "spec",
        label: source.specPrs.length > 1 ? `Spec PR ${index + 1}` : "Spec PR",
        detail: pr ? `${pr.repo} #${pr.number}` : linked.id,
        artifactId: linked.id,
        state: pr?.state || "missing",
      };
    }),
    ...source.languages.map((language) => {
      const primary = selectSdkPr(language, prMap, source.state);
      return {
        id: trackId(language),
        kind: "sdk",
        label: language.id,
        detail: language.package || "Package not recorded",
        artifactId: primary?.id || null,
        state: primary?.state || "missing",
      };
    }),
  ];

  const events = [
    {
      id: `ado:${source.id}:created`,
      type: "plan.created",
      phase: "plan",
      occurredAt: source.createdAt,
      observedAt: source.createdAt,
      trackId: "plan",
      title: "Release Plan created",
      confidence: "authoritative",
      source: {
        system: "azure-devops",
        entity: `work-item:${source.id}`,
        url: source.adoUrl,
      },
    },
    ...source.revisionEvents.map((event) => ({
      ...event,
      title: eventTitle(event),
    })),
    ...source.specRevisionEvents.map((event) => ({
      ...event,
      trackId: findSpecTrack(event.value, source.specPrs),
      title: eventTitle(event),
    })),
  ];

  for (const linked of source.specPrs) {
    const pr = prMap.get(linked.id);
    if (pr)
      events.push(...githubEvents(pr, `spec:${linked.id}`, "spec-review"));
  }
  for (const language of source.languages) {
    for (const linked of language.sdkPrHistory || []) {
      const pr = prMap.get(linked.id);
      if (pr) events.push(...githubEvents(pr, trackId(language), "sdk-review"));
    }
  }
  for (const run of runs) events.push(...pipelineEvents(run, source));

  const uniqueEvents = assignEventStacks(
    dedupeEvents(events)
    .filter((event) => validDate(event.occurredAt))
    .sort((left, right) => new Date(left.occurredAt) - new Date(right.occurredAt)),
  );
  const intervals = buildIntervals(source, prMap, uniqueEvents, runs);
  const metrics = buildMetrics(source, prMap, uniqueEvents, runs);
  const quality = qualitySummary(source, prMap, metrics, runs);
  const eventTimes = uniqueEvents.map((event) => new Date(event.occurredAt));
  const state = normalizeState(source.state);
  const terminal = ["finished", "abandoned", "duplicate"].includes(state);
  const terminalStateEvent = [...source.revisionEvents]
    .reverse()
    .find(
      (event) =>
        event.type === "plan.state_changed" &&
        normalizeState(event.value) === state,
    );
  const effectiveEnd = terminal
    ? terminalStateEvent?.occurredAt || source.changedAt
    : generatedAt;

  return {
    schemaVersion: 1,
    id: source.id,
    correlation: {
      policyVersion: source.correlation?.policyVersion || POLICY_VERSION,
      preflight: source.correlation?.preflight || "passed",
    },
    releasePlanId: source.releasePlanId,
    title: source.title,
    service: serviceName(source),
    product: source.product,
    path: source.path || null,
    state,
    plane: source.plane,
    releaseType: source.releaseType,
    intendedMonth: source.intendedMonth,
    createdAt: source.createdAt,
    completedAt: terminal ? effectiveEnd : null,
    sourceUrl: source.adoUrl,
    range: {
      start: new Date(Math.min(...eventTimes)).toISOString(),
      end: new Date(
        Math.max(...eventTimes, new Date(effectiveEnd)),
      ).toISOString(),
    },
    intendedArtifacts: source.languages.map((language) => ({
      ...(() => {
        const primary = selectSdkPr(language, prMap, source.state);
        return { prId: primary?.id || null };
      })(),
      language: language.id,
      package: language.package || null,
      version: language.releasedVersion,
      outcome: releaseOutcome(language, state),
      generationPipelineUrl: language.generationPipelineUrl,
      releasePipelineUrl: language.releasePipelineUrl,
    })),
    links: [
      ...source.specPrs.map((pr, index) => ({
        artifactId: pr.id,
        role: index === source.specPrs.length - 1 ? "spec-pr" : "spec-pr-history",
        url: pr.url,
      })),
      ...source.languages.flatMap((language) => {
        const primary = selectSdkPr(language, prMap, source.state);
        return (language.sdkPrHistory || []).map((pr) => ({
          artifactId: pr.id,
          role: pr.id === primary?.id ? "sdk-pr" : "sdk-pr-history",
          language: language.id,
          url: pr.url,
        }));
      }),
    ].filter((link) => link.artifactId),
    tracks,
    events: uniqueEvents,
    intervals,
    metrics,
    quality,
    summary: {
      durationHours: hours(source.createdAt, effectiveEnd),
      pullRequestCount: new Set([
        ...specPrIds,
        ...source.languages.flatMap((language) =>
          (language.sdkPrHistory || []).map((pr) => pr.id),
        ),
      ]).size,
      humanReviewCount: uniqueEvents.filter(
        (event) =>
          event.type === "review.submitted" && event.actor?.kind === "human",
      ).length,
      humanCommentCount: uniqueEvents.filter(
        (event) =>
          event.type === "comment.created" && event.actor?.kind === "human",
      ).length,
    },
  };
}

function githubEvents(pr, track, phase) {
  if (pr.state === "unavailable") return [];
  const source = {
    system: "github",
    entity: `${pr.owner}/${pr.repo}#${pr.number}`,
    url: pr.url,
  };
  const values = [
    githubEvent(pr, track, phase, "pr.created", "PR opened", pr.createdAt, source),
  ];
  if (pr.mergedAt)
    values.push(
      githubEvent(pr, track, phase, "pr.merged", "PR merged", pr.mergedAt, source),
    );
  else if (pr.closedAt)
    values.push(
      githubEvent(pr, track, phase, "pr.closed", "PR closed", pr.closedAt, source),
    );
  for (const review of pr.reviews) {
    if (!review.submittedAt) continue;
    values.push({
      ...githubEvent(
        pr,
        track,
        phase,
        "review.submitted",
        review.state === "CHANGES_REQUESTED"
          ? "Changes requested"
          : review.state === "APPROVED"
            ? "Review approved"
            : "Review submitted",
        review.submittedAt,
        { ...source, url: review.url || pr.url },
        `review:${review.id}`,
      ),
      actor: review.actor,
      excerpt: redact(review.excerpt),
      reviewState: review.state.toLowerCase(),
    });
  }
  for (const comment of [...pr.issueComments, ...pr.reviewComments]) {
    values.push({
      ...githubEvent(
        pr,
        track,
        phase,
        "comment.created",
        "Comment",
        comment.createdAt,
        { ...source, url: comment.url || pr.url },
        `comment:${comment.id}`,
      ),
      actor: comment.actor,
      excerpt: redact(comment.excerpt),
    });
  }
  for (const commit of pr.commits) {
    if (!commit.createdAt) continue;
    values.push({
      ...githubEvent(
        pr,
        track,
        phase,
        "commit.pushed",
        "Commit pushed",
        commit.createdAt,
        { ...source, url: commit.url || pr.url },
        `commit:${commit.id.slice(0, 12)}`,
      ),
      actor: commit.actor,
    });
  }
  return values;
}

function pipelineEvents(run, plan) {
  return run.references
    .filter((reference) => reference.planId === plan.id)
    .flatMap((reference) => {
      const language = plan.languages.find(
        (item) => item.id === reference.language,
      );
      if (!language) return [];
      const track = trackId(language);
      const phase =
        reference.role === "generation" ? "generation" : "release";
      const prefix =
        reference.role === "generation" ? "generation" : "release";
      const source = {
        system: "azure-pipelines",
        entity: `${run.project} build ${run.buildId}`,
        url: run.url,
      };
      const values = [];
      if (run.queueAt)
        values.push(
          pipelineEvent(
            run,
            track,
            phase,
            `${prefix}.queued`,
            "Pipeline queued",
            run.queueAt,
            source,
          ),
        );
      if (run.startAt)
        values.push(
          pipelineEvent(
            run,
            track,
            phase,
            `${prefix}.started`,
            "Pipeline started",
            run.startAt,
            source,
          ),
        );
      if (run.finishAt) {
        const completed = ["succeeded", "partiallySucceeded"].includes(
          run.result,
        );
        values.push(
          pipelineEvent(
            run,
            track,
            phase,
            completed
              ? `${prefix}.completed`
              : `${prefix}.failed`,
            completed
              ? run.result === "partiallySucceeded"
                ? "Pipeline completed with issues"
                : "Pipeline completed"
              : "Pipeline failed",
            run.finishAt,
            source,
          ),
        );
      }
      for (const failure of run.failures) {
        if (!failure.finishAt && !failure.startAt) continue;
        values.push({
          ...pipelineEvent(
            run,
            track,
            phase,
            `${prefix}.stage_failed`,
            `${failure.type} failed: ${failure.name}`,
            failure.finishAt || failure.startAt,
            source,
            failure.id,
          ),
          value: failure.result,
        });
      }
      return values;
    });
}

function pipelineEvent(
  run,
  trackIdValue,
  phase,
  type,
  title,
  occurredAt,
  source,
  suffix = type,
) {
  return {
    id: `${run.id}:${suffix}:${trackIdValue}`,
    type,
    phase,
    occurredAt,
    observedAt: run.finishAt || occurredAt,
    trackId: trackIdValue,
    title,
    actor: { kind: "service", publicId: null },
    source,
    confidence: "authoritative",
  };
}

function githubEvent(
  pr,
  trackIdValue,
  phase,
  type,
  title,
  occurredAt,
  source,
  suffix = type,
) {
  return {
    id: `${pr.id}:${suffix}:${trackIdValue}`,
    type,
    phase,
    occurredAt,
    observedAt: occurredAt,
    trackId: trackIdValue,
    title,
    actor: type === "pr.created" ? pr.author : undefined,
    source,
    confidence: "authoritative",
  };
}

function buildIntervals(source, prMap, events, runs) {
  const intervals = [];
  for (const linked of source.specPrs) {
    const pr = prMap.get(linked.id);
    if (pr) intervals.push(prInterval(pr, `spec:${linked.id}`, "spec-review"));
  }
  const specMerged = latest(
    source.specPrs.map((linked) => prMap.get(linked.id)?.mergedAt).filter(Boolean),
  );
  for (const language of source.languages) {
    const pr = selectSdkPr(language, prMap, source.state);
    const generationRun = findRun(
      runs,
      source.id,
      language.id,
      "generation",
    );
    if (!pr) continue;
    intervals.push(prInterval(pr, trackId(language), "sdk-review"));
    if (generationRun?.startAt && pr.createdAt) {
      intervals.push({
        id: `interval:${source.id}:${language.key}:generation`,
        phase: "generation",
        trackId: trackId(language),
        label: "Generation execution",
        startAt: generationRun.startAt,
        endAt: pr.createdAt,
        durationHours: hours(generationRun.startAt, pr.createdAt),
        status: "complete",
        confidence: "authoritative",
      });
    }
    const released = language.releasedVersion
      ? firstReleaseEvent(events, trackId(language))
      : null;
    if (pr.mergedAt && released) {
      intervals.push({
        id: `interval:${source.id}:${language.key}:release`,
        phase: "release",
        trackId: trackId(language),
        label: "Release latency",
        startAt: pr.mergedAt,
        endAt: released.occurredAt,
        durationHours: hours(pr.mergedAt, released.occurredAt),
        status: "complete",
        confidence: "observed",
      });
    }
  }
  return intervals.filter((interval) => interval.durationHours >= 0);
}

function prInterval(pr, trackIdValue, phase) {
  const end = pr.mergedAt || pr.closedAt;
  return {
    id: `interval:${pr.id}:${trackIdValue}`,
    phase,
    trackId: trackIdValue,
    label: phase === "spec-review" ? "Spec PR cycle" : "SDK PR cycle",
    startAt: pr.createdAt,
    endAt: end,
    durationHours: end ? hours(pr.createdAt, end) : null,
    status: end ? "complete" : "censored",
    confidence: "authoritative",
  };
}

function buildMetrics(source, prMap, events, runs) {
  const metrics = [];
  for (const linked of source.specPrs) {
    const pr = prMap.get(linked.id);
    metrics.push(
      durationMetric(
        "S1",
        { planId: source.id, prId: linked.id, role: "spec-pr" },
        pr?.createdAt,
        pr?.mergedAt,
        "authoritative",
      ),
    );
  }
  const specCreated = earliest(
    source.specPrs.map((linked) => prMap.get(linked.id)?.createdAt).filter(Boolean),
  );
  const specMerged = latest(
    source.specPrs.map((linked) => prMap.get(linked.id)?.mergedAt).filter(Boolean),
  );
  const releases = [];
  for (const language of source.languages) {
    const pr = selectSdkPr(language, prMap, source.state);
    const generationRun = findRun(
      runs,
      source.id,
      language.id,
      "generation",
    );
    metrics.push(
      durationMetric(
        "S4",
        {
          planId: source.id,
          language: language.id,
          package: language.package,
          prId: pr?.id,
        },
        pr?.createdAt,
        pr?.mergedAt,
        "authoritative",
      ),
    );
    metrics.push(
      durationMetric(
        "S2",
        { planId: source.id, language: language.id },
        specMerged,
        generationRun?.startAt,
        "authoritative",
      ),
    );
    metrics.push(
      durationMetric(
        "S3",
        { planId: source.id, language: language.id },
        generationRun?.startAt,
        pr?.createdAt,
        "authoritative",
      ),
    );
    const released = language.releasedVersion
      ? firstReleaseEvent(events, trackId(language))
      : null;
    if (released) releases.push(released.occurredAt);
    metrics.push(
      durationMetric(
        "S5",
        { planId: source.id, language: language.id },
        pr?.mergedAt,
        released?.occurredAt,
        "observed",
      ),
    );
  }
  const allIntendedReleased =
    source.languages.length > 0 &&
    releases.length === source.languages.length;
  const l1 = durationMetric(
    "L1",
    { planId: source.id },
    specCreated,
    allIntendedReleased ? latest(releases) : null,
    "observed",
  );
  if (!source.languages.length) {
    l1.outcome = "ineligible";
    l1.missingBoundaryReason = "no-intended-artifacts";
  }
  metrics.push(l1);
  return metrics;
}

function durationMetric(metricId, scope, start, end, confidence) {
  const complete = Boolean(start && end && hours(start, end) >= 0);
  return {
    metricId,
    definitionVersion: 1,
    scope,
    outcome: complete ? "complete" : "incomplete",
    value: complete ? hours(start, end) : null,
    unit: "hours",
    confidence,
    evidence: { startAt: start || null, endAt: end || null },
    missingBoundaryReason: complete
      ? null
      : !start
        ? "missing-start-event"
        : "missing-end-event",
  };
}

function qualitySummary(source, prMap, metrics, runs) {
  const warnings = [];
  if (!source.path) warnings.push("API specification path is missing");
  if (!source.specPrs.length) warnings.push("No exact spec PR is recorded");
  if (source.specPrs.length > 1)
    warnings.push("Multiple spec PRs are retained in link history");
  const nonMerged = [
    ...source.specPrs,
    ...source.languages.flatMap((language) => language.sdkPrHistory || []),
  ].filter((linked) => prMap.get(linked.id)?.state !== "merged");
  if (nonMerged.length)
    warnings.push(`${nonMerged.length} historical linked PR(s) closed without merge`);
  const replacedSdkPrs = source.languages.reduce(
    (sum, language) => sum + Math.max(0, (language.sdkPrHistory || []).length - 1),
    0,
  );
  if (replacedSdkPrs)
    warnings.push(`${replacedSdkPrs} superseded SDK PR link(s) retained`);
  const unavailablePrs = [
    ...source.specPrs,
    ...source.languages.flatMap((language) => language.sdkPrHistory || []),
  ].filter((linked) => prMap.get(linked.id)?.state === "unavailable");
  if (unavailablePrs.length)
    warnings.push(`${unavailablePrs.length} PR enrichment(s) skipped`);
  const unavailableRuns = runs.filter((run) => run.status === "unavailable");
  if (unavailableRuns.length)
    warnings.push(`${unavailableRuns.length} pipeline run enrichment(s) skipped`);
  const observed = metrics.filter(
    (metric) => metric.confidence === "observed",
  ).length;
  const incomplete = metrics.filter(
    (metric) => metric.outcome !== "complete",
  ).length;
  return {
    status: incomplete ? "partial" : warnings.length ? "qualified" : "complete",
    warnings,
    metricResults: metrics.length,
    observedMetricResults: observed,
    incompleteMetricResults: incomplete,
  };
}

function buildPortfolio(plans, source, github, pipelineSource) {
  const completeMetrics = plans.flatMap((plan) =>
    plan.metrics.filter((metric) => metric.outcome === "complete"),
  );
  const cycle = completeMetrics
    .filter((metric) => metric.metricId === "L1")
    .map((metric) => metric.value);
  const warnings = plans.reduce(
    (sum, plan) => sum + plan.quality.warnings.length,
    0,
  );
  return {
    schemaVersion: 1,
    generatedAt: source.generatedAt,
    selection: source.selection,
    kpis: {
      total: plans.length,
      active: plans.filter((plan) =>
        ["new", "in-progress"].includes(plan.state),
      ).length,
      finished: plans.filter((plan) => plan.state === "finished").length,
      abandoned: plans.filter((plan) =>
        ["abandoned", "duplicate"].includes(plan.state),
      ).length,
      medianCycleHours: percentile(cycle, 0.5),
      p90CycleHours: percentile(cycle, 0.9),
      dataQualityPercent: Math.round(
        (completeMetrics.length /
          plans.reduce((sum, plan) => sum + plan.metrics.length, 0)) *
          100,
      ),
    },
    dataQuality: {
      releasePlans: plans.length,
      linkedPullRequests: github.prCount,
      enrichedPullRequests: github.prs.filter(
        (pr) => pr.state !== "unavailable",
      ).length,
      exactPipelineRuns: pipelineSource.runCount,
      exactPrCoveragePercent: github.prCount
        ? Math.round(
            (github.prs.filter((pr) => pr.state !== "unavailable").length /
              github.prCount) *
              100,
          )
        : 100,
      plansWithWarnings: plans.filter((plan) => plan.quality.warnings.length)
        .length,
      warningCount: warnings,
      releaseTimestamps:
        "Observed from Release Plan revision history; exact package timestamps are not yet available.",
      pipelineRuns:
        `${pipelineSource.runCount} exact linked runs are enriched; plans without exact links remain explicitly incomplete.`,
      collectionSkips: `${source.skippedPlans?.length || 0} plans, ${github.skippedPrCount || 0} PRs, and ${pipelineSource.skippedRunCount || 0} pipeline runs were marked and skipped during collection.`,
    },
    plans: plans.map((plan) => ({
      id: plan.id,
      releasePlanId: plan.releasePlanId,
      title: plan.title,
      service: plan.service,
      state: plan.state,
      plane: plan.plane,
      releaseType: plan.releaseType,
      intendedMonth: plan.intendedMonth,
      createdAt: plan.createdAt,
      completedAt: plan.completedAt,
      durationHours: plan.summary.durationHours,
      languageCount: plan.intendedArtifacts.length,
      releasedCount: plan.intendedArtifacts.filter(
        (artifact) => artifact.outcome === "released",
      ).length,
      prCount: plan.summary.pullRequestCount,
      reviewCount: plan.summary.humanReviewCount,
      quality: plan.quality.status,
      warnings: plan.quality.warnings.length,
    })),
  };
}

function buildServices(plans) {
  const grouped = new Map();
  for (const plan of plans) {
    const slug = slugify(plan.service);
    if (!grouped.has(slug))
      grouped.set(slug, { schemaVersion: 1, slug, name: plan.service, plans: [] });
    grouped.get(slug).plans.push({
      id: plan.id,
      title: plan.title,
      completedAt: plan.completedAt,
      releaseType: plan.releaseType,
      durationHours: plan.summary.durationHours,
      metrics: plan.metrics.filter((metric) => metric.outcome === "complete"),
    });
  }
  return [...grouped.values()];
}

function buildScorecard(plans, generatedAt) {
  const completedPlans = plans.filter((plan) => plan.state === "finished");
  const periodEnd = new Date(generatedAt);
  const periodStart = new Date(periodEnd);
  periodStart.setUTCDate(periodStart.getUTCDate() - 30);
  return {
    schemaVersion: 1,
    cohort: {
      kind: "core-correlated-finished-management-plane",
      planCount: completedPlans.length,
      totalPlanCount: plans.length,
      generatedAt,
      statisticsPeriod: {
        kind: "rolling-30-days",
        startAt: periodStart.toISOString(),
        endAt: periodEnd.toISOString(),
      },
    },
    metrics: METRIC_DEFINITIONS.map((definition) => {
      const results = completedPlans.flatMap((plan) =>
        plan.metrics.filter((metric) => metric.metricId === definition.id),
      );
      const completeResults = results.filter(
        (metric) => metric.outcome === "complete",
      );
      const periodCompleteResults = completeResults.filter((metric) => {
        const endAt = metric.evidence?.endAt;
        if (!endAt) return false;
        const date = new Date(endAt);
        return date >= periodStart && date <= periodEnd;
      });
      const eligibleResults = results.filter(
        (metric) => metric.outcome !== "ineligible",
      );
      const values = completeResults.map((metric) => metric.value);
      const periodValues = periodCompleteResults.map((metric) => metric.value);
      return {
        metricId: definition.id,
        definitionVersion: definition.version,
        statistics: {
          p50: percentile(periodValues, 0.5),
          p90: percentile(periodValues, 0.9),
        },
        statisticsPopulation: {
          included: periodValues.length,
        },
        historicalStatistics: {
          p50: percentile(values, 0.5),
          p90: percentile(values, 0.9),
        },
        population: {
          eligible: eligibleResults.length,
          included: values.length,
          incomplete: results.filter(
            (metric) => metric.outcome === "incomplete",
          ).length,
          censored: results.filter((metric) => metric.outcome === "censored")
            .length,
          excluded: results.filter((metric) => metric.outcome === "excluded")
            .length,
          ineligible: results.filter(
            (metric) => metric.outcome === "ineligible",
          ).length,
        },
        confidenceCounts: {
          authoritative: results.filter(
            (metric) =>
              metric.outcome === "complete" &&
              metric.confidence === "authoritative",
          ).length,
          observed: results.filter(
            (metric) =>
              metric.outcome === "complete" && metric.confidence === "observed",
          ).length,
          inferred: 0,
        },
        trends: {
          weekly: buildTrend(completeResults, "week", generatedAt, 13),
          monthly: buildTrend(
            completeResults,
            "month",
            generatedAt,
            monthlyBucketCount(completeResults, generatedAt),
          ),
        },
      };
    }),
  };
}

function buildTrend(results, cadence, generatedAt, bucketCount) {
  const currentStart =
    cadence === "week"
      ? startOfUtcWeek(generatedAt)
      : startOfUtcMonth(generatedAt);
  const starts = Array.from({ length: bucketCount }, (_, index) =>
    shiftBucket(currentStart, cadence, index - bucketCount + 1),
  );
  const series = starts.map((start, index) => {
    const end = shiftBucket(start, cadence, 1);
    const values = results
      .filter((result) => {
        const occurredAt = result.evidence?.endAt;
        return occurredAt && new Date(occurredAt) >= start && new Date(occurredAt) < end;
      })
      .map((result) => result.value);
    return {
      key: bucketKey(start, cadence),
      label: bucketLabel(start, cadence),
      start: start.toISOString(),
      end: end.toISOString(),
      partial: index === starts.length - 1,
      count: values.length,
      p50: percentile(values, 0.5),
      p90: percentile(values, 0.9),
    };
  });
  return {
    cadence,
    series,
    comparison: "current-period-vs-prior-three-month-average",
    change: rollingPeriodChange(series, -2),
    liveChange: rollingPeriodChange(series, -1),
  };
}

function monthlyBucketCount(results, generatedAt) {
  const currentStart = startOfUtcMonth(generatedAt);
  const earliestAllowed = shiftBucket(currentStart, "month", -11);
  const dates = results
    .map((result) => result.evidence?.endAt)
    .filter(Boolean)
    .map((value) => startOfUtcMonth(value))
    .filter(
      (value) =>
        !Number.isNaN(value.getTime()) &&
        value >= earliestAllowed &&
        value <= currentStart,
    );
  if (!dates.length) return 1;
  const earliest = new Date(Math.min(...dates));
  const difference =
    (currentStart.getUTCFullYear() - earliest.getUTCFullYear()) * 12 +
    currentStart.getUTCMonth() -
    earliest.getUTCMonth();
  return Math.min(12, Math.max(1, difference + 1));
}

function rollingPeriodChange(series, currentOffset) {
  const currentIndex =
    currentOffset < 0 ? series.length + currentOffset : currentOffset;
  const current = series[currentIndex];
  if (!current)
    return {
      baselineValue: null,
      baselinePeriodCount: 0,
      baselineSampleCount: 0,
      baselineKeys: [],
      currentKey: null,
      currentSampleCount: 0,
      outcome: "insufficient-data",
      absolute: null,
      percent: null,
      direction: "unknown",
    };
  const baselineStart = new Date(current.start);
  baselineStart.setUTCMonth(baselineStart.getUTCMonth() - 3);
  const baselineBuckets = series
    .slice(0, currentIndex)
    .filter(
      (bucket) =>
        new Date(bucket.start) >= baselineStart &&
        bucket.p50 !== null &&
        bucket.p50 !== undefined,
    );
  const baselineValue = baselineBuckets.length
    ? Math.round(
        (baselineBuckets.reduce((sum, bucket) => sum + bucket.p50, 0) /
          baselineBuckets.length) *
          10,
      ) / 10
    : null;
  const comparison = {
    baselineValue,
    baselinePeriodCount: baselineBuckets.length,
    baselineSampleCount: baselineBuckets.reduce(
      (sum, bucket) => sum + bucket.count,
      0,
    ),
    baselineKeys: baselineBuckets.map((bucket) => bucket.key),
    currentKey: current?.key || null,
    currentSampleCount: current?.count || 0,
  };
  if (
    baselineValue === null ||
    current?.p50 === null ||
    current?.p50 === undefined
  )
    return {
      ...comparison,
      outcome: "insufficient-data",
      absolute: null,
      percent: null,
      direction: "unknown",
    };
  const absolute = Math.round((current.p50 - baselineValue) * 10) / 10;
  const percent =
    baselineValue === 0
      ? null
      : Math.round((absolute / baselineValue) * 1000) / 10;
  return {
    ...comparison,
    outcome: "complete",
    absolute,
    percent,
    direction: absolute < 0 ? "improving" : absolute > 0 ? "slowing" : "flat",
  };
}

function startOfUtcWeek(value) {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return date;
}

function startOfUtcMonth(value) {
  const date = new Date(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function shiftBucket(value, cadence, amount) {
  const date = new Date(value);
  if (cadence === "week") date.setUTCDate(date.getUTCDate() + amount * 7);
  else date.setUTCMonth(date.getUTCMonth() + amount);
  return date;
}

function bucketKey(date, cadence) {
  return cadence === "week"
    ? date.toISOString().slice(0, 10)
    : date.toISOString().slice(0, 7);
}

function bucketLabel(date, cadence) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    ...(cadence === "week" ? { day: "numeric" } : {}),
    timeZone: "UTC",
  }).format(date);
}

function firstReleaseEvent(events, track) {
  return events.find(
    (event) =>
      event.trackId === track &&
      event.type === "release.status_changed" &&
      /released/i.test(event.value),
  );
}

function eventTitle(event) {
  const labels = {
    "plan.state_changed": "Plan state changed",
    "spec.approval_changed": "Spec approval changed",
    "spec.pr_linked": "Spec PR linked",
    "generation.status_changed": "Generation status changed",
    "sdk.pr_linked": "SDK PR linked",
    "release.status_changed": "Release status changed",
    "package.version_observed": "Package version observed",
  };
  return labels[event.type] || event.type;
}

function findSpecTrack(url, specPrs) {
  const match = specPrs.find(
    (pr) => pr.url.toLowerCase() === String(url).toLowerCase(),
  );
  return match ? `spec:${match.id}` : "plan";
}

function trackId(language) {
  return `sdk:${language.id}:${language.package || language.id}`;
}

function selectSdkPr(language, prMap, planState) {
  const values = (language.sdkPrHistory || [])
    .map((linked) => prMap.get(linked.id))
    .filter(Boolean);
  const current = prMap.get(language.sdkPr?.id);
  if (normalizeState(planState) !== "finished")
    return current || values.at(-1) || null;
  const merged = values
    .filter((pr) => pr.mergedAt)
    .sort((left, right) => new Date(right.mergedAt) - new Date(left.mergedAt));
  return merged[0] || current || values.at(-1) || null;
}

function findRun(runs, planId, language, role) {
  return runs.find((run) =>
    run.references.some(
      (reference) =>
        reference.planId === planId &&
        reference.language === language &&
        reference.role === role,
    ),
  );
}

function serviceName(source) {
  const titleName = source.title
    .replace(/^Release plan\s*-\s*\d+\s*-\s*(GA|Preview)\s*-\s*/i, "")
    .replace(/^(Public Preview|GA) release plan for /i, "")
    .trim();
  if (titleName !== source.title) return titleName;
  const pathParts = String(source.path || "").split("/").filter(Boolean);
  const pathName = pathParts.at(-1);
  if (pathName) return pathName.replace(/([a-z])([A-Z])/g, "$1 $2");
  return source.title;
}

function redact(value) {
  return String(value || "")
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[email redacted]",
    )
    .slice(0, 240);
}

function dedupeEvents(events) {
  const unique = new Map();
  for (const event of events) {
    if (!unique.has(event.id)) unique.set(event.id, event);
  }
  return [...unique.values()];
}

function assignEventStacks(events) {
  const times = events.map((event) => new Date(event.occurredAt).getTime());
  const threshold = (Math.max(...times) - Math.min(...times)) * 0.012;
  const trackSlots = new Map();
  return events.map((event) => {
    const time = new Date(event.occurredAt).getTime();
    const slots = trackSlots.get(event.trackId) || [];
    let stack = slots.findIndex((lastTime) => time - lastTime > threshold);
    if (stack === -1) {
      stack =
        slots.length < 6
          ? slots.length
          : slots.indexOf(Math.min(...slots));
    }
    slots[stack] = time;
    trackSlots.set(event.trackId, slots);
    return { ...event, stack };
  });
}

function validDate(value) {
  return value && !Number.isNaN(new Date(value).getTime());
}

function hours(start, end) {
  return Math.round(((new Date(end) - new Date(start)) / 3_600_000) * 10) / 10;
}

function earliest(values) {
  return values.length
    ? new Date(Math.min(...values.map((value) => new Date(value)))).toISOString()
    : null;
}

function latest(values) {
  return values.length
    ? new Date(Math.max(...values.map((value) => new Date(value)))).toISOString()
    : null;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const interpolated =
    sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  return Math.round(interpolated * 10) / 10;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeState(value) {
  return String(value || "unknown")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function releaseOutcome(language, planState) {
  const status = String(language.releaseStatus || "").toLowerCase();
  if (status.includes("released")) return "released";
  if (status.includes("failed")) return "failed";
  if (planState === "abandoned" || planState === "duplicate")
    return "not-released";
  return "pending";
}

function hashFiles(directory, root) {
  const hashes = {};
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      Object.assign(hashes, hashFiles(path, root));
    } else {
      const relative = path.slice(root.length + 1);
      hashes[relative] = createHash("sha256")
        .update(readFileSync(path))
        .digest("hex");
    }
  }
  return hashes;
}
