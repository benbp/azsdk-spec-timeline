export class DataStore {
  constructor(baseUrl = "data") {
    this.baseUrl = baseUrl;
    this.manifest = null;
    this.cache = new Map();
  }

  async initialize() {
    this.manifest = await this.fetchJson("manifest.json", false);
    return this.manifest;
  }

  portfolio() {
    return this.fetchJson(this.manifest.paths.portfolio);
  }

  scorecard() {
    return this.fetchJson(this.manifest.paths.scorecard);
  }

  metricDefinitions() {
    return this.fetchJson(this.manifest.paths.metricDefinitions);
  }

  plan(id) {
    return this.fetchJson(this.manifest.paths.plan.replace("{id}", id));
  }

  async fetchJson(path, immutable = true) {
    const url = `${this.baseUrl}/${path}`;
    if (immutable && this.cache.has(url)) return this.cache.get(url);
    const request = fetch(url).then(async (response) => {
      if (!response.ok)
        throw new Error(`${response.status} while loading ${path}`);
      return response.json();
    });
    if (immutable) this.cache.set(url, request);
    return request;
  }
}
