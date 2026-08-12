#!/usr/bin/env node

const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { parseArgs, readJson } = require("./lib/v2-common");

const args = parseArgs(process.argv.slice(2), { data: "data" });
const manifest = readJson(join(args.data, "manifest.json"));
const root = join(args.data, "builds", manifest.buildId);
const errors = [];
const planDirectory = join(root, "plans");

if (!existsSync(planDirectory)) errors.push("Plan directory is missing");
const plans = existsSync(planDirectory)
  ? readdirSync(planDirectory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => readJson(join(planDirectory, name)))
  : [];
const portfolio = readJson(join(root, "portfolio.json"));
const scorecard = readJson(join(root, "aggregates", "scorecard.json"));
const selection = portfolio.selection;

if (plans.length !== manifest.counts.plans)
  errors.push(
    `Manifest says ${manifest.counts.plans} plans but ${plans.length} exist`,
  );
if (manifest.minimumUiVersion !== 3)
  errors.push("Manifest minimum UI version is outdated");

validateSelection(selection);
for (const plan of plans) validatePlan(plan, selection);
validateScorecard(scorecard, plans, selection);
scanPublishedFiles(args.data);

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${plans.length} plans and ${plans.reduce((sum, plan) => sum + plan.events.length, 0)} events`,
  );
}

function validateSelection(selection) {
  const start = new Date(selection?.startAt);
  const end = new Date(selection?.endAt);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start >= end
  )
    errors.push("Portfolio selection window is invalid");
}

function validateScorecard(value, sourcePlans, selection) {
  const cohortMonth = new Date(selection.startAt);
  cohortMonth.setUTCDate(1);
  cohortMonth.setUTCHours(0, 0, 0, 0);
  const eligiblePlans = sourcePlans.filter(
    (plan) => ["new", "in-progress", "finished"].includes(plan.state),
  );
  if (value.schemaVersion !== 3)
    errors.push("Scorecard schema version is outdated");
  if (
    value.cohort?.kind !==
      "core-correlated-active-or-finished-management-plane" ||
    value.cohort?.eligiblePlanCount !== eligiblePlans.length ||
    value.cohort?.totalPlanCount !== sourcePlans.length
  )
    errors.push("Scorecard eligible-flow cohort does not reconcile");
  for (const state of ["abandoned", "duplicate"]) {
    const expected = sourcePlans.filter((plan) => plan.state === state).length;
    if (value.cohort?.excludedStateCounts?.[state] !== expected)
      errors.push(`Scorecard excluded ${state} count does not reconcile`);
  }
  if (value.cohort?.statisticsPeriod)
    errors.push("Scorecard still publishes a rolling statistics period");

  for (const metric of value.metrics || []) {
    const results = eligiblePlans.flatMap((plan) =>
      plan.metrics
        .filter((result) => result.metricId === metric.metricId)
        .map((result) => ({
          ...result,
          cohortPlan: {
            id: plan.id,
            releasePlanId: plan.releasePlanId,
            title: plan.title,
            service: plan.service,
            state: plan.state,
          },
        })),
    );
    const completeResults = results.filter(
      (result) => result.outcome === "complete",
    );
    const eligibleResults = results.filter(
      (result) => result.outcome !== "ineligible",
    );
    if ("statistics" in metric || "statisticsPopulation" in metric)
      errors.push(`${metric.metricId}: obsolete rolling statistics remain`);
    const population = metric.population;
    if (
      population.eligible !== eligibleResults.length ||
      population.included !== completeResults.length ||
      population.incomplete !==
        results.filter((result) => result.outcome === "incomplete").length ||
      population.censored !==
        results.filter((result) => result.outcome === "censored").length ||
      population.excluded !==
        results.filter((result) => result.outcome === "excluded").length ||
      population.ineligible !==
        results.filter((result) => result.outcome === "ineligible").length
    )
      errors.push(`${metric.metricId}: aggregate population does not reconcile`);
    const confidenceTotal = Object.values(metric.confidenceCounts).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (confidenceTotal !== population.included)
      errors.push(`${metric.metricId}: confidence counts do not reconcile`);
    for (const cadence of ["weekly", "monthly"]) {
      const trend = metric.trends?.[cadence];
      const validLength =
        cadence === "weekly"
          ? trend?.series.length === 13
          : trend?.series.length >= 2 && trend.series.length <= 12;
      if (!trend || !validLength) {
        errors.push(`${metric.metricId}: invalid ${cadence} trend length`);
        continue;
      }
      if (
        cadence === "monthly" &&
        new Date(trend.series[0].start) < cohortMonth &&
        trend.series[0].count > 0
      )
        errors.push(`${metric.metricId}: monthly trend predates cohort`);

      for (const bucket of trend.series) {
        if (bucket.count === 0 && (bucket.p50 !== null || bucket.p90 !== null))
          errors.push(
            `${metric.metricId}: empty ${cadence} bucket ${bucket.key} has statistics`,
          );
        if (bucket.count > 0 && (bucket.p50 === null || bucket.p90 === null))
          errors.push(
            `${metric.metricId}: populated ${cadence} bucket ${bucket.key} lacks statistics`,
          );
        const bucketResults = resultsForPeriod(
          completeResults,
          bucket.start,
          bucket.end,
        );
        if (
          !cohortsEqual(bucket.plans, expectedCohortPlans(bucketResults))
        )
          errors.push(
            `${metric.metricId}: ${cadence} bucket ${bucket.key} plan cohort drifted`,
          );
      }
      if (
        trend.comparison !==
        "current-period-p50-vs-prior-three-month-p50"
      )
        errors.push(`${metric.metricId}: ${cadence} comparison is outdated`);
      validatePeriodStatistics(
        metric.metricId,
        cadence,
        metric.periodStatistics?.[cadence],
        trend,
        completeResults,
      );
      validateTrendChange(
        metric.metricId,
        cadence,
        trend,
        "change",
        -2,
        completeResults,
      );
      validateTrendChange(
        metric.metricId,
        cadence,
        trend,
        "liveChange",
        -1,
        completeResults,
      );
    }
    const rollingEnd = new Date(value.cohort.generatedAt);
    const rollingWeekStart = new Date(
      rollingEnd.getTime() - 7 * 86_400_000,
    );
    const rollingMonthStart = shiftUtcMonthClamped(rollingEnd, -1);
    validateRollingPeriod(
      metric.metricId,
      metric.periodStatistics?.rollingWeek,
      "rolling-week",
      rollingWeekStart,
      rollingEnd,
      completeResults,
    );
    validateRollingPeriod(
      metric.metricId,
      metric.periodStatistics?.rollingMonth,
      "rolling-month",
      rollingMonthStart,
      rollingEnd,
      completeResults,
    );
  }

  function validatePeriodStatistics(metricId, cadence, summary, trend, results) {
    const bucket = trend.series.at(-2);
    if (!bucket || !summary) {
      errors.push(`${metricId}: ${cadence} completed-period summary is missing`);
      return;
    }
    for (const field of ["key", "start", "end", "count", "p50", "p90"]) {
      if (summary[field] !== bucket[field])
        errors.push(
          `${metricId}: ${cadence} completed-period ${field} does not match trend`,
        );
    }
    if (summary.rolling !== false)
      errors.push(`${metricId}: ${cadence} completed period is marked rolling`);
    const periodResults = resultsForPeriod(
      results,
      summary.start,
      summary.end,
    );
    const values = periodResults.map((result) => result.value);
    if (
      summary.count !== values.length ||
      summary.p50 !== percentile(values, 0.5) ||
      summary.p90 !== percentile(values, 0.9) ||
      !cohortsEqual(summary.plans, expectedCohortPlans(periodResults))
    )
      errors.push(
        `${metricId}: ${cadence} completed-period population does not reconcile`,
      );
  }

  function validateRollingPeriod(
    metricId,
    summary,
    key,
    start,
    end,
    results,
  ) {
    if (
      !summary ||
      summary.key !== key ||
      summary.start !== start.toISOString() ||
      summary.end !== end.toISOString() ||
      summary.rolling !== true
    ) {
      errors.push(`${metricId}: ${key} boundary drifted`);
      return;
    }
    const periodResults = resultsForPeriod(results, start, end);
    const values = periodResults.map((result) => result.value);
    if (
      summary.count !== values.length ||
      summary.p50 !== percentile(values, 0.5) ||
      summary.p90 !== percentile(values, 0.9) ||
      !cohortsEqual(summary.plans, expectedCohortPlans(periodResults))
    )
      errors.push(`${metricId}: ${key} population does not reconcile`);
  }

  function resultsForPeriod(results, start, end) {
    return results.filter(
      (result) =>
        result.evidence?.endAt &&
        new Date(result.evidence.endAt) >= new Date(start) &&
        new Date(result.evidence.endAt) < new Date(end),
    );
  }

  function expectedCohortPlans(results) {
    const grouped = new Map();
    for (const result of results) {
      const plan = result.cohortPlan;
      if (!grouped.has(plan.id)) grouped.set(plan.id, { ...plan, values: [] });
      grouped.get(plan.id).values.push(result.value);
    }
    return [...grouped.values()]
      .map(({ values, ...plan }) => ({
        ...plan,
        observationCount: values.length,
        p50: percentile(values, 0.5),
        p90: percentile(values, 0.9),
      }))
      .sort(
        (left, right) =>
          right.p50 - left.p50 ||
          left.service.localeCompare(right.service) ||
          String(left.id).localeCompare(String(right.id)),
      );
  }

  function cohortsEqual(actual, expected) {
    const normalize = (plans) =>
      [...(plans || [])]
        .map((plan) => ({
          id: plan.id,
          releasePlanId: plan.releasePlanId,
          title: plan.title,
          service: plan.service,
          state: plan.state,
          observationCount: plan.observationCount,
          p50: plan.p50,
          p90: plan.p90,
        }))
        .sort((left, right) =>
          String(left.id).localeCompare(String(right.id)),
        );
    return (
      JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
    );
  }
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const interpolated =
    sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  return Math.round(interpolated * 10) / 10;
}

function shiftUtcMonthClamped(value, amount) {
  const date = new Date(value);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + amount);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date;
}

function validateTrendChange(
  metricId,
  cadence,
  trend,
  field,
  currentOffset,
  results,
) {
  const currentIndex = trend.series.length + currentOffset;
  const current = trend.series[currentIndex];
  const change = trend[field];
  if (!current) {
    if (
      change.currentKey !== null ||
      change.outcome !== "insufficient-data" ||
      change.baselinePeriodCount !== 0 ||
      change.baselineSampleCount !== 0
    )
      errors.push(`${metricId}: ${cadence} ${field} empty baseline drifted`);
    return;
  }
  const baselineStart = new Date(current.start);
  baselineStart.setUTCMonth(baselineStart.getUTCMonth() - 3);
  const baseline = trend.series
    .slice(0, currentIndex)
    .filter(
      (bucket) =>
        new Date(bucket.start) >= baselineStart && bucket.p50 !== null,
    );
  const expectedKeys = baseline.map((bucket) => bucket.key);
  if (
    change.currentKey !== current.key ||
    change.baselinePeriodCount !== expectedKeys.length ||
    JSON.stringify(change.baselineKeys) !== JSON.stringify(expectedKeys)
  )
    errors.push(`${metricId}: ${cadence} ${field} baseline drifted`);
  const baselineValues = results
    .filter(
      (result) =>
        result.evidence?.endAt &&
        new Date(result.evidence.endAt) >= baselineStart &&
        new Date(result.evidence.endAt) < new Date(current.start),
    )
    .map((result) => result.value);
  const expectedSamples = baselineValues.length;
  if (change.baselineSampleCount !== expectedSamples)
    errors.push(`${metricId}: ${cadence} ${field} sample count drifted`);
  if (change.baselineValue !== percentile(baselineValues, 0.5))
    errors.push(`${metricId}: ${cadence} ${field} baseline P50 drifted`);
}

function validatePlan(plan, selection) {
  const cohortStart = new Date(selection.startAt);
  const cohortEnd = new Date(selection.endAt);
  if (
    new Date(plan.range.start) < cohortStart ||
    new Date(plan.range.end) > cohortEnd
  )
    errors.push(`${plan.id}: plan range falls outside cohort`);
  if (
    plan.correlation?.policyVersion !== 1 ||
    plan.correlation?.preflight !== "passed"
  )
    errors.push(`${plan.id}: core correlation is missing`);
  const eventIds = new Set();
  for (const event of plan.events) {
    if (eventIds.has(event.id))
      errors.push(`${plan.id}: duplicate event ${event.id}`);
    eventIds.add(event.id);
    if (Number.isNaN(new Date(event.occurredAt).getTime()))
      errors.push(`${plan.id}: invalid event timestamp ${event.id}`);
    if (!["authoritative", "observed", "inferred"].includes(event.confidence))
      errors.push(`${plan.id}: invalid confidence on ${event.id}`);
  }
  const planIds = new Set([String(plan.id), String(plan.releasePlanId)]);
  for (const link of plan.links) {
    if (link.role === "spec-pr" || link.role === "spec-pr-history") continue;
    const releasePlanIds = link.releasePlanIds;
    if (
      releasePlanIds?.length &&
      !releasePlanIds.some((id) => planIds.has(String(id)))
    )
      errors.push(`${plan.id}: PR ${link.artifactId} names another release plan`);
  }
  for (const interval of plan.intervals) {
    if (
      interval.endAt &&
      new Date(interval.endAt).getTime() < new Date(interval.startAt).getTime()
    )
      errors.push(`${plan.id}: negative interval ${interval.id}`);
  }
  for (const metric of plan.metrics) {
    if (metric.outcome !== "complete" && metric.value !== null)
      errors.push(`${plan.id}: non-complete metric ${metric.metricId} has value`);
    if (metric.outcome === "complete" && metric.value < 0)
      errors.push(`${plan.id}: negative metric ${metric.metricId}`);
    for (const boundary of [
      metric.evidence?.startAt,
      metric.evidence?.endAt,
    ].filter(Boolean)) {
      if (new Date(boundary) < cohortStart || new Date(boundary) > cohortEnd)
        errors.push(
          `${plan.id}: metric ${metric.metricId} falls outside cohort`,
        );
    }
  }
}

function scanPublishedFiles(directory) {
  for (const name of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, name.name);
    if (name.isDirectory()) scanPublishedFiles(path);
    else if (name.name.endsWith(".json")) {
      const text = readFileSync(path, "utf8");
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text))
        errors.push(`${path}: contains an email address`);
      if (/gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}/.test(text))
        errors.push(`${path}: contains a credential-like value`);
    }
  }
}
