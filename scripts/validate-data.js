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
const scorecard = readJson(join(root, "aggregates", "scorecard.json"));

if (plans.length !== manifest.counts.plans)
  errors.push(
    `Manifest says ${manifest.counts.plans} plans but ${plans.length} exist`,
  );

for (const plan of plans) validatePlan(plan);
validateScorecard(scorecard);
scanPublishedFiles(args.data);

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Validated ${plans.length} plans and ${plans.reduce((sum, plan) => sum + plan.events.length, 0)} events`,
  );
}

function validateScorecard(value) {
  for (const metric of value.metrics || []) {
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
      const expectedLength = cadence === "weekly" ? 13 : 4;
      if (!trend || trend.series.length !== expectedLength) {
        errors.push(`${metric.metricId}: invalid ${cadence} trend length`);
        continue;
      }
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
        "current-period-vs-prior-three-month-average"
      )
        errors.push(`${metric.metricId}: ${cadence} comparison is outdated`);
      validateTrendChange(metric.metricId, cadence, trend, "change", -2);
      validateTrendChange(metric.metricId, cadence, trend, "liveChange", -1);
    }
  }
}

function validateTrendChange(metricId, cadence, trend, field, currentOffset) {
  const currentIndex = trend.series.length + currentOffset;
  const current = trend.series[currentIndex];
  const baselineStart = new Date(current.start);
  baselineStart.setUTCMonth(baselineStart.getUTCMonth() - 3);
  const baseline = trend.series
    .slice(0, currentIndex)
    .filter(
      (bucket) =>
        new Date(bucket.start) >= baselineStart && bucket.p50 !== null,
    );
  const change = trend[field];
  const expectedKeys = baseline.map((bucket) => bucket.key);
  if (
    change.currentKey !== current.key ||
    change.baselinePeriodCount !== expectedKeys.length ||
    JSON.stringify(change.baselineKeys) !== JSON.stringify(expectedKeys)
  )
    errors.push(`${metricId}: ${cadence} ${field} baseline drifted`);
  const expectedSamples = baseline.reduce(
    (sum, bucket) => sum + bucket.count,
    0,
  );
  if (change.baselineSampleCount !== expectedSamples)
    errors.push(`${metricId}: ${cadence} ${field} sample count drifted`);
}

function validatePlan(plan) {
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
