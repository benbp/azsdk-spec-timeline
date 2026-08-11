import Alpine from "./vendor/alpine.esm.js";
import { DataStore } from "./data-store.js";
import { createTimelineScale, median } from "./timeline-scale.js";

const store = new DataStore();
const REPORTED_METRIC_IDS = new Set(["L1", "S1", "S4", "S5"]);

Alpine.data("timelineApp", () => ({
  loading: true,
  error: "",
  view: "portfolio",
  manifest: null,
  portfolio: null,
  scorecard: null,
  definitions: [],
  plan: null,
  selectedEvent: null,
  search: "",
  stateFilter: "all",
  eventFilter: "milestones",
  trendsExpanded: false,

  async init() {
    window.addEventListener("popstate", () => this.loadRoute());
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.closeEvent();
    });
    try {
      this.manifest = await store.initialize();
      [this.portfolio, this.scorecard, this.definitions] = await Promise.all([
        store.portfolio(),
        store.scorecard(),
        store.metricDefinitions(),
      ]);
      await this.loadRoute();
    } catch (error) {
      this.error = error.message;
    } finally {
      this.loading = false;
    }
  },

  async loadRoute() {
    this.error = "";
    const params = new URLSearchParams(location.search);
    this.view = params.get("view") || "portfolio";
    this.selectedEvent = null;
    if (this.view === "plan" && params.get("plan")) {
      this.loading = true;
      try {
        this.plan = await store.plan(params.get("plan"));
        const eventId = params.get("event");
        if (eventId)
          this.selectedEvent =
            this.plan.events.find((event) => event.id === eventId) || null;
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading = false;
      }
    } else {
      this.plan = null;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  },

  async navigate(values) {
    history.pushState({}, "", this.routeUrl(values));
    await this.loadRoute();
  },

  routeUrl(values) {
    const params = new URLSearchParams(values);
    return `${location.pathname}?${params}`;
  },

  navigateLink(event, values) {
    if (
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    this.navigate(values);
  },

  get filteredPlans() {
    const query = this.search.trim().toLowerCase();
    return (this.portfolio?.plans || []).filter((plan) => {
      const matchesQuery =
        !query ||
        [
          plan.service,
          plan.title,
          plan.releasePlanId,
          plan.id,
          plan.releaseType,
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesState =
        this.stateFilter === "all" ||
        plan.state === this.stateFilter ||
        (this.stateFilter === "active" &&
          ["new", "in-progress"].includes(plan.state)) ||
        (this.stateFilter === "abandoned" &&
          ["abandoned", "duplicate"].includes(plan.state));
      return matchesQuery && matchesState;
    });
  },

  get scorecardMetrics() {
    return (this.scorecard?.metrics || [])
      .filter((metric) => REPORTED_METRIC_IDS.has(metric.metricId))
      .map((metric) => ({
        ...metric,
        ...this.definition(metric.metricId),
      }));
  },

  get scorecardStatisticsPeriodLabel() {
    const period = this.scorecard?.cohort?.statisticsPeriod;
    if (!period?.startAt || !period?.endAt) return "";
    const formatter = new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    return `P50/P90 · ${formatter.format(new Date(period.startAt))}–${formatter.format(new Date(period.endAt))}`;
  },

  completeTrendSeries(trend) {
    return trend.series.filter((bucket) => !bucket.partial);
  },

  miniColumnStyle(value, series) {
    if (value === null) return "height:0";
    const maximum = Math.max(
      ...series.map((bucket) => bucket.p50).filter((item) => item !== null),
      1,
    );
    const height = Math.sqrt(Math.max(0, value) / maximum) * 100;
    return `height:${Math.max(4, height).toFixed(1)}%`;
  },

  trendMaximum(metric, trend) {
    return Math.max(
      this.historicalStatistic(metric, "p90") || 0,
      ...trend.series.flatMap((bucket) =>
        [bucket.p50, bucket.p90].filter((value) => value !== null),
      ),
      1,
    );
  },

  columnHeight(value, metric, trend) {
    if (value === null) return 0;
    return (
      Math.sqrt(Math.max(0, value) / this.trendMaximum(metric, trend)) * 100
    );
  },

  columnStyle(value, metric, trend) {
    const height = this.columnHeight(value, metric, trend);
    return `height:${Math.max(value > 0 ? 2 : 0, height).toFixed(1)}%`;
  },

  benchmarkStyle(metric, trend) {
    const top =
      100 -
      this.columnHeight(
        this.historicalStatistic(metric, "p50"),
        metric,
        trend,
      );
    return `top:${((top / 100) * 192).toFixed(1)}px`;
  },

  historicalStatistic(metric, field) {
    return metric.historicalStatistics?.[field] ?? metric.statistics[field];
  },

  chartTicks(metric, trend) {
    const maximum = this.trendMaximum(metric, trend);
    return [0, 25, 50, 75, 100].map((position) => ({
      position,
      pixel: (position / 100) * 192,
      value: maximum * ((100 - position) / 100) ** 2,
    }));
  },

  columnTooltip(bucket, field) {
    if (bucket[field] === null)
      return `${bucket.label}: no completed-flow data`;
    return `${bucket.label}${bucket.partial ? " (partial)" : ""}: ${field.toUpperCase()} ${this.formatDuration(bucket[field])}, n=${bucket.count}`;
  },

  bucketAxisLabel(bucket, index, length, cadence) {
    if (cadence === "month")
      return `${bucket.label}${bucket.partial ? "*" : ""}`;
    if (index === 0 || index === length - 1 || index % 2 === 0)
      return `${bucket.label}${bucket.partial ? "*" : ""}`;
    return "";
  },

  formatTrendChange(change) {
    if (change?.outcome !== "complete" || change.percent === null) return "—";
    const sign = change.percent > 0 ? "+" : "";
    return `${sign}${change.percent.toFixed(1)}%`;
  },

  rollingTrendChange(trend, live = false) {
    if (
      trend.comparison ===
      "current-period-vs-prior-three-month-average"
    )
      return live ? trend.liveChange : trend.change;
    const currentIndex = trend.series.length + (live ? -1 : -2);
    const current = trend.series[currentIndex];
    if (!current)
      return {
        baselinePeriodCount: 0,
        baselineSampleCount: 0,
        currentSampleCount: 0,
        outcome: "insufficient-data",
        percent: null,
        direction: "unknown",
      };
    const baselineStart = new Date(current.start);
    baselineStart.setUTCMonth(baselineStart.getUTCMonth() - 3);
    const baseline = trend.series
      .slice(0, currentIndex)
      .filter(
        (bucket) =>
          new Date(bucket.start) >= baselineStart && bucket.p50 !== null,
      );
    const baselineValue = baseline.length
      ? baseline.reduce((sum, bucket) => sum + bucket.p50, 0) / baseline.length
      : null;
    const comparison = {
      baselinePeriodCount: baseline.length,
      baselineSampleCount: baseline.reduce(
        (sum, bucket) => sum + bucket.count,
        0,
      ),
      currentSampleCount: current.count,
    };
    if (baselineValue === null || current.p50 === null)
      return {
        ...comparison,
        outcome: "insufficient-data",
        percent: null,
        direction: "unknown",
      };
    const absolute = current.p50 - baselineValue;
    return {
      ...comparison,
      outcome: "complete",
      percent:
        baselineValue === 0
          ? null
          : Math.round((absolute / baselineValue) * 1000) / 10,
      direction:
        absolute < 0 ? "improving" : absolute > 0 ? "slowing" : "flat",
    };
  },

  trendSampleLabel(change) {
    return `n=${change.currentSampleCount} vs baseline n=${change.baselineSampleCount}`;
  },

  trendComparisonTitle(change) {
    const periods = change.baselinePeriodCount;
    if (!periods)
      return "No populated comparison periods are available in the prior 3 months";
    return `Compared with the average of ${periods} available period${periods === 1 ? "" : "s"} from the prior 3 months`;
  },

  trendAriaLabel(metric, cadence, live = false) {
    const trend = metric.trends[cadence];
    const period = cadence === "weekly" ? "week over week" : "month over month";
    const change = this.rollingTrendChange(trend, live);
    return `${metric.name} ${live ? "live " : "completed-period "}${period}: ${this.formatTrendChange(change)} in median duration against the prior three-month average`;
  },

  get workflowStages() {
    if (!this.plan) return [];
    const spec = this.completedMetricValues("S1");
    const sdk = this.completedMetricValues("S4");
    const release = this.completedMetricValues("S5");
    return [
      { name: "Plan intake", detail: this.formatDate(this.plan.createdAt) },
      { name: "Spec review", detail: this.formatDuration(median(spec)) },
      { name: "SDK review", detail: this.formatDuration(median(sdk)) },
      {
        name:
          this.plan.state === "finished"
            ? "Released"
            : this.formatState(this.plan.state),
        detail:
          release.length > 0
            ? this.formatDuration(median(release))
            : "No complete boundary",
      },
    ];
  },

  get scale() {
    return this.plan
      ? createTimelineScale(this.plan.range.start, this.plan.range.end)
      : createTimelineScale(new Date(), new Date());
  },

  get timelineTicks() {
    return this.scale.ticks(6).map((tick) => ({
      position: tick.position,
      label: new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
      }).format(tick.value),
    }));
  },

  get groupedPlanMetrics() {
    if (!this.plan) return [];
    return this.definitions
      .filter((definition) => REPORTED_METRIC_IDS.has(definition.id))
      .map((definition) => {
        const results = this.plan.metrics.filter(
          (metric) => metric.metricId === definition.id,
        );
        const complete = results.filter(
          (metric) => metric.outcome === "complete",
        );
        return {
          metricId: definition.id,
          name: definition.name,
          median: median(complete.map((metric) => metric.value)),
          complete: complete.length,
          total: results.length,
          confidence: complete.some(
            (metric) => metric.confidence === "observed",
          )
            ? "observed"
            : "authoritative",
        };
      });
  },

  definition(id) {
    return this.definitions.find((definition) => definition.id === id) || {};
  },

  completedMetricValues(id) {
    return (this.plan?.metrics || [])
      .filter(
        (metric) => metric.metricId === id && metric.outcome === "complete",
      )
      .map((metric) => metric.value);
  },

  planMetric(id) {
    const values = this.completedMetricValues(id);
    return values.length ? this.formatDuration(median(values)) : "Unavailable";
  },

  intervalsFor(trackId) {
    return (this.plan?.intervals || []).filter(
      (interval) =>
        interval.trackId === trackId && interval.phase !== "generation",
    );
  },

  eventsFor(trackId) {
    const events = (this.plan?.events || []).filter(
      (event) => event.trackId === trackId,
    );
    if (this.eventFilter === "all") return events;
    if (this.eventFilter === "human")
      return events.filter((event) => event.actor?.kind === "human");
    return events.filter((event) =>
      [
        "plan.created",
        "plan.state_changed",
        "spec.approval_changed",
        "pr.created",
        "pr.merged",
        "pr.closed",
        "release.status_changed",
        "package.version_observed",
      ].includes(event.type),
    );
  },

  get filteredEventFeed() {
    if (!this.plan) return [];
    return this.plan.events
      .filter((event) => {
        if (this.eventFilter === "all") return true;
        if (this.eventFilter === "human")
          return event.actor?.kind === "human";
        return false;
      })
      .slice()
      .reverse();
  },

  eventPosition(event) {
    return this.scale.position(event.occurredAt);
  },

  eventClass(event) {
    return [
      event.type.split(".")[0],
      event.confidence,
      this.selectedEvent?.id === event.id ? "selected" : "",
    ].join(" ");
  },

  eventStyle(event) {
    const horizontalStack = Math.floor((event.stack || 0) / 3);
    const verticalStack = (event.stack || 0) % 3;
    return `left:calc(${this.eventPosition(event)}% + ${horizontalStack * 11}px);bottom:${19 + verticalStack * 10}px`;
  },

  intervalStyle(interval) {
    const left = this.scale.position(interval.startAt);
    const right = this.scale.position(interval.endAt || this.plan.range.end);
    return `left:${left}%;width:${Math.max(0.6, right - left)}%`;
  },

  intervalWidth(interval) {
    return (
      this.scale.position(interval.endAt || this.plan.range.end) -
      this.scale.position(interval.startAt)
    );
  },

  selectEvent(event) {
    this.selectedEvent = event;
    const params = new URLSearchParams(location.search);
    params.set("event", event.id);
    history.replaceState({}, "", `${location.pathname}?${params}`);
  },

  selectEventLink(clickEvent, event) {
    if (
      clickEvent.button !== 0 ||
      clickEvent.ctrlKey ||
      clickEvent.metaKey ||
      clickEvent.shiftKey ||
      clickEvent.altKey
    )
      return;
    clickEvent.preventDefault();
    this.selectEvent(event);
  },

  closeEvent() {
    this.selectedEvent = null;
    const params = new URLSearchParams(location.search);
    params.delete("event");
    history.replaceState({}, "", `${location.pathname}?${params}`);
  },

  artifactUrl(id) {
    const match = id?.match(/^github:([^#]+)#(\d+)$/);
    return match ? `https://github.com/${match[1]}/pull/${match[2]}` : "#";
  },

  languageAbbreviation(language) {
    return (
      {
        ".NET": "N",
        JavaScript: "JS",
        Python: "PY",
        Java: "JV",
        Go: "GO",
      }[language] || language.slice(0, 2).toUpperCase()
    );
  },

  formatState(value) {
    return String(value || "unknown")
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  },

  formatDuration(hours) {
    if (hours === null || hours === undefined) return "Unavailable";
    if (hours === 0) return "0";
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
    if (hours < 48) return `${Math.round(hours)}h`;
    const days = hours / 24;
    return `${days >= 10 ? Math.round(days) : days.toFixed(1)}d`;
  },

  formatDate(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  },

  formatDateTime(value) {
    if (!value) return "";
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  },
}));

window.Alpine = Alpine;
Alpine.start();
