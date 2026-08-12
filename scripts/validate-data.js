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
  const statisticsPeriod = value.cohort?.statisticsPeriod;
  if (
    statisticsPeriod?.kind !== "rolling-30-days" ||
    !statisticsPeriod.startAt ||
    !statisticsPeriod.endAt
  )
    errors.push("Scorecard statistics period is missing");
  for (const metric of value.metrics || []) {
    const completeResults = sourcePlans
      .filter((plan) => plan.state === "finished")
      .flatMap((plan) =>
        plan.metrics.filter(
          (result) =>
            result.metricId === metric.metricId &&
            result.outcome === "complete",
        ),
      );
    const periodValues = completeResults
      .filter(
        (result) =>
            result.evidence?.endAt &&
            new Date(result.evidence.endAt) >=
              new Date(statisticsPeriod.startAt) &&
            new Date(result.evidence.endAt) <=
              new Date(statisticsPeriod.endAt),
      )
      .map((result) => result.value);
    if (metric.statisticsPopulation?.included !== periodValues.length)
      errors.push(
        `${metric.metricId}: statistics-period population does not reconcile`,
      );
    for (const [field, quantile] of [
      ["p50", 0.5],
      ["p90", 0.9],
    ]) {
      if (metric.statistics[field] !== percentile(periodValues, quantile))
        errors.push(
          `${metric.metricId}: statistics-period ${field} does not reconcile`,
        );
    }
    const population = metric.population;
    const eligibleNotIncluded =
      population.incomplete +
      population.censored +
      population.excluded;
    if (
      population.included + eligibleNotIncluded !==
      population.eligible
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
          : trend?.series.length >= 1 && trend.series.length <= 12;
      if (!trend || !validLength) {
        errors.push(`${metric.metricId}: invalid ${cadence} trend length`);
        continue;
      }
      if (
        cadence === "monthly" &&
        new Date(trend.series[0].start) < cohortMonth
      )
        errors.push(`${metric.metricId}: monthly trend predates cohort`);
      if (
        cadence === "monthly" &&
        trend.series.length > 1 &&
        trend.series[0].count === 0
      )
        errors.push(`${metric.metricId}: monthly trend has a leading empty bucket`);

      for (const bucket of trend.series) {
        if (bucket.count === 0 && (bucket.p50 !== null || bucket.p90 !== null))
          errors.push(
            `${metric.metricId}: empty ${cadence} bucket ${bucket.key} has statistics`,
          );
        if (bucket.count > 0 && (bucket.p50 === null || bucket.p90 === null))
          errors.push(
            `${metric.metricId}: populated ${cadence} bucket ${bucket.key} lacks statistics`,
          );
      }
      if (
        trend.comparison !==
        "current-period-p50-vs-prior-three-month-p50"
      )
        errors.push(`${metric.metricId}: ${cadence} comparison is outdated`);
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
  }
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return Math.round(sorted[lower] * 10) / 10;
  const weight = index - lower;
  return (
    Math.round(
      (sorted[lower] * (1 - weight) + sorted[upper] * weight) * 10,
    ) / 10
  );
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
