import Alpine from "./vendor/alpine.esm.js";
import { DataStore } from "./data-store.js";
import { createTimelineScale, median } from "./timeline-scale.js";

const store = new DataStore();

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
    const params = new URLSearchParams(values);
    history.pushState({}, "", `${location.pathname}?${params}`);
    await this.loadRoute();
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
    return (this.scorecard?.metrics || []).map((metric) => ({
      ...metric,
      ...this.definition(metric.metricId),
    }));
  },

  get workflowStages() {
    if (!this.plan) return [];
    const spec = this.completedMetricValues("S1");
    const generation = this.completedMetricValues("S3");
    const sdk = this.completedMetricValues("S4");
    const release = this.completedMetricValues("S5");
    return [
      { name: "Plan intake", detail: this.formatDate(this.plan.createdAt) },
      { name: "Spec review", detail: this.formatDuration(median(spec)) },
      { name: "Generation", detail: this.formatDuration(median(generation)) },
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
    return this.definitions.map((definition) => {
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
      (interval) => interval.trackId === trackId,
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
