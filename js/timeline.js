/**
 * timeline.js
 * Core timeline renderer — swim lanes, time axis, event markers, idle gaps,
 * pipeline gap, gap compaction, collision resolution, zoom.
 */
const Timeline = (() => {
  let data = null;
  let timeRange = null;
  let contentWidth = 0;
  let zoomLevel = 1;
  const padding = { left: 20, right: 20 };
  let hiddenEventTypes = new Set(['bot_comment', 'label_added', 'ci_status']);

  // Gap compaction — compress dead periods > threshold into narrow breaks
  const GAP_THRESHOLD_MS = 2 * 86400000; // 2 days
  const COMPRESSED_GAP_PX = 44;
  const MIN_SEGMENT_PX = 150;
  let segments = []; // { type:'active'|'gap', startMs, endMs, startPx, endPx, durationDays? }

  /* ── Public ─────────────────────────────────────────────── */

  function render(timelineData) {
    data = timelineData;
    timeRange = DataLoader.getTimeRange(data);

    renderHeader();
    renderSummaryCards();
    renderFilters();
    renderTimeline();
    renderInsights();

    show('header-info');
    show('summary-cards');
    show('filters');
    show('timeline-container');
    show('insights-panel');
    hide('empty-state');
  }

  /* ── Header / Summary / Filters (unchanged) ────────────── */

  function renderHeader() {
    document.getElementById('timeline-title').textContent = data.title;
    document.getElementById('meta-owner').textContent = `👤 ${data.owner}`;
    const days = data.summary?.totalDurationDays ||
      DataLoader.computeDurationDays(data.startDate, data.endDate);
    document.getElementById('meta-duration').textContent = `⏱ ${days} days`;
    document.getElementById('meta-dates').textContent =
      `📅 ${DataLoader.formatDate(data.startDate)} → ${DataLoader.formatDate(data.endDate)}`;
  }

  function renderSummaryCards() {
    const container = document.getElementById('summary-cards');
    container.innerHTML = '';
    const s = data.summary || {};

    const cards = [
      { label: 'Spec PR', value: `${s.specPRDays || '—'}d`, sub: 'API review', cls: 'info' },
      { label: 'Pipeline Gap', value: `${s.pipelineGapDays || '—'}d`, sub: 'Merge → SDK PRs', cls: s.pipelineGapDays > 7 ? 'critical' : 'warning' },
      { label: 'Slowest SDK', value: `${s.slowestSDKPR?.days || '—'}d`, sub: s.slowestSDKPR?.language || '', cls: 'warning' },
      { label: 'Fastest SDK', value: `${s.fastestSDKPR?.days || '—'}d`, sub: s.fastestSDKPR?.language || '', cls: 'positive' },
      { label: 'Total', value: `${s.totalDurationDays || DataLoader.computeDurationDays(data.startDate, data.endDate) || '—'}d`, sub: 'End to end', cls: 'info' },
      { label: 'Nags', value: `${s.totalNags || 0}`, sub: 'Author nudges', cls: s.totalNags > 0 ? 'warning' : 'positive' },
      { label: 'Manual Fixes', value: `${s.totalManualFixes || 0}`, sub: 'On auto PRs', cls: s.totalManualFixes > 0 ? 'warning' : 'positive' },
      { label: 'Reviewers', value: `${s.totalUniqueReviewers || '—'}`, sub: 'Unique people', cls: 'info' }
    ];

    for (const card of cards) {
      const el = document.createElement('div');
      el.className = `summary-card ${card.cls}`;
      el.innerHTML = `
        <div class="card-label">${card.label}</div>
        <div class="card-value">${card.value}</div>
        <div class="card-sub">${card.sub}</div>
      `;
      container.appendChild(el);
    }
  }

  function renderFilters() {
    const container = document.getElementById('filter-buttons');
    container.innerHTML = '';

    const types = [
      'pr_created', 'pr_merged', 'review_approved', 'review_comment',
      'issue_comment', 'author_nag', 'manual_fix', 'commit_pushed',
      'bot_comment', 'label_added', 'idle_gap'
    ];

    for (const type of types) {
      const info = DataLoader.getEventTypeInfo(type);
      const btn = document.createElement('button');
      btn.className = `filter-btn ${hiddenEventTypes.has(type) ? '' : 'active'}`;
      btn.dataset.type = type;
      btn.innerHTML = `<span class="filter-icon">${info.icon}</span> ${info.label}`;
      btn.addEventListener('click', () => toggleFilter(type, btn));
      container.appendChild(btn);
    }
  }

  function toggleFilter(type, btn) {
    if (hiddenEventTypes.has(type)) {
      hiddenEventTypes.delete(type);
      btn.classList.add('active');
    } else {
      hiddenEventTypes.add(type);
      btn.classList.remove('active');
    }
    updateEventVisibility();
  }

  function updateEventVisibility() {
    document.querySelectorAll('.event-marker').forEach(el => {
      const type = el.dataset.eventType;
      if (hiddenEventTypes.has(type)) el.classList.add('hidden');
      else el.classList.remove('hidden');
    });
    document.querySelectorAll('.idle-gap').forEach(el => {
      if (hiddenEventTypes.has('idle_gap')) el.classList.add('hidden');
      else el.classList.remove('hidden');
    });
  }

  /* ── Gap Compaction ─────────────────────────────────────── */

  function buildSegments() {
    const allPRs = DataLoader.getAllPRs(data);
    const ts = new Set();

    for (const pr of allPRs) {
      ts.add(new Date(pr.createdAt).getTime());
      if (pr.mergedAt) ts.add(new Date(pr.mergedAt).getTime());
      if (pr.closedAt) ts.add(new Date(pr.closedAt).getTime());
      for (const ev of pr.events) {
        ts.add(new Date(ev.timestamp).getTime());
        if (ev.endTimestamp) ts.add(new Date(ev.endTimestamp).getTime());
      }
    }

    const sorted = [...ts].sort((a, b) => a - b);
    segments = [];

    if (sorted.length < 2) {
      segments = [{ type: 'active', startMs: timeRange.start.getTime(), endMs: timeRange.end.getTime() }];
      assignPixelRanges();
      return;
    }

    // Cluster timestamps into active segments separated by gaps > threshold
    let cStart = sorted[0], cEnd = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - cEnd > GAP_THRESHOLD_MS) {
        segments.push({ type: 'active', startMs: cStart, endMs: cEnd });
        segments.push({
          type: 'gap', startMs: cEnd, endMs: sorted[i],
          durationDays: Math.round((sorted[i] - cEnd) / 86400000 * 10) / 10
        });
        cStart = sorted[i];
      }
      cEnd = sorted[i];
    }
    segments.push({ type: 'active', startMs: cStart, endMs: cEnd });

    // Pad active segments (8% of duration, capped 2h–12h each side)
    for (const seg of segments) {
      if (seg.type === 'active') {
        const dur = Math.max(seg.endMs - seg.startMs, 3600000);
        const pad = Math.max(2 * 3600000, Math.min(dur * 0.08, 12 * 3600000));
        seg.startMs -= pad;
        seg.endMs += pad;
      }
    }

    // Clamp gap boundaries to padded active segments
    for (let i = 1; i < segments.length - 1; i++) {
      if (segments[i].type === 'gap') {
        segments[i].startMs = segments[i - 1].endMs;
        segments[i].endMs = segments[i + 1].startMs;
      }
    }

    assignPixelRanges();
  }

  function assignPixelRanges() {
    const activeSegs = segments.filter(s => s.type === 'active');
    const gapCount = segments.filter(s => s.type === 'gap').length;

    // Ensure contentWidth can fit all segments
    const minNeeded = padding.left + padding.right +
      activeSegs.length * MIN_SEGMENT_PX + gapCount * COMPRESSED_GAP_PX;
    if (contentWidth < minNeeded) contentWidth = minNeeded;

    const usable = contentWidth - padding.left - padding.right;
    const activePixels = usable - gapCount * COMPRESSED_GAP_PX;

    let totalDuration = 0;
    for (const s of activeSegs) totalDuration += Math.max(s.endMs - s.startMs, 1);

    let px = padding.left;
    for (const seg of segments) {
      seg.startPx = px;
      if (seg.type === 'active') {
        const frac = Math.max(seg.endMs - seg.startMs, 1) / totalDuration;
        seg.endPx = px + Math.max(frac * activePixels, MIN_SEGMENT_PX);
      } else {
        seg.endPx = px + COMPRESSED_GAP_PX;
      }
      px = seg.endPx;
    }

    // Update contentWidth to actual rendered width
    contentWidth = segments[segments.length - 1].endPx + padding.right;
  }

  function timeToX(timestamp) {
    const t = new Date(timestamp).getTime();
    for (const seg of segments) {
      if (t >= seg.startMs && t <= seg.endMs) {
        const range = seg.endMs - seg.startMs;
        const frac = range === 0 ? 0.5 : (t - seg.startMs) / range;
        return seg.startPx + frac * (seg.endPx - seg.startPx);
      }
    }
    // Clamp to edges
    if (t < segments[0].startMs) return segments[0].startPx;
    return segments[segments.length - 1].endPx;
  }

  /* ── Zoom Controls ──────────────────────────────────────── */

  function renderZoomControls() {
    const spacer = document.querySelector('.timeline-header .lane-label-spacer');
    if (!spacer) return;
    let controls = document.getElementById('zoom-controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'zoom-controls';
      controls.className = 'zoom-controls';
      spacer.appendChild(controls);
    }
    controls.innerHTML = `
      <button class="zoom-btn" data-action="out" title="Zoom out">−</button>
      <span class="zoom-level">${Math.round(zoomLevel * 100)}%</span>
      <button class="zoom-btn" data-action="in" title="Zoom in">+</button>
      <button class="zoom-btn" data-action="reset" title="Reset">↺</button>
    `;
    controls.querySelectorAll('.zoom-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === 'reset') { zoomLevel = 1; renderTimeline(); }
        else adjustZoom(action === 'in' ? 1 : -1);
      });
    });
  }

  function adjustZoom(direction) {
    const steps = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
    let idx = steps.findIndex(s => Math.abs(s - zoomLevel) < 0.01);
    if (idx === -1) idx = 2;
    idx = Math.max(0, Math.min(steps.length - 1, idx + direction));
    zoomLevel = steps[idx];
    renderTimeline();
  }

  /* ── Timeline Rendering ─────────────────────────────────── */

  function renderTimeline() {
    const lanesContainer = document.getElementById('lanes');
    lanesContainer.innerHTML = '';

    const containerEl = document.getElementById('timeline-container');
    const availWidth = containerEl.clientWidth - 200; // minus label width
    contentWidth = Math.max(availWidth * zoomLevel, 600);

    // Build segments for gap compaction
    buildSegments();

    // Zoom controls
    renderZoomControls();

    // Time axes
    renderTimeAxis('time-axis');
    renderTimeAxis('time-axis-bottom');

    // Spec PR lane
    renderLane(lanesContainer, data.specPR, true);

    // Pipeline gap connector
    renderPipelineGap(lanesContainer);

    // SDK PR lanes sorted by merge date
    const sdkPRs = [...data.sdkPRs].sort((a, b) => {
      const aDate = a.mergedAt || a.closedAt || a.createdAt;
      const bDate = b.mergedAt || b.closedAt || b.createdAt;
      return new Date(aDate) - new Date(bDate);
    });
    for (const pr of sdkPRs) renderLane(lanesContainer, pr, false);

    // Gridlines
    addGridlines(lanesContainer);
  }

  function renderTimeAxis(elementId) {
    const axis = document.getElementById(elementId);
    axis.innerHTML = '';
    axis.style.width = contentWidth + 'px';

    for (const seg of segments) {
      if (seg.type === 'active') {
        // Add date ticks within this active segment
        const segDays = (seg.endMs - seg.startMs) / 86400000;
        let intervalDays;
        if (segDays <= 3) intervalDays = 1;
        else if (segDays <= 14) intervalDays = 2;
        else if (segDays <= 45) intervalDays = 7;
        else intervalDays = 14;

        const tickDate = new Date(seg.startMs);
        tickDate.setUTCHours(0, 0, 0, 0);
        // Advance to first tick within segment
        while (tickDate.getTime() < seg.startMs) {
          tickDate.setUTCDate(tickDate.getUTCDate() + intervalDays);
        }
        while (tickDate.getTime() <= seg.endMs) {
          const x = timeToX(tickDate.toISOString());
          const tick = document.createElement('div');
          tick.className = 'time-tick';
          if (tickDate.getUTCDate() === 1 || intervalDays >= 7) tick.classList.add('major');
          tick.style.left = x + 'px';
          tick.textContent = DataLoader.formatDate(tickDate.toISOString());
          axis.appendChild(tick);
          tickDate.setUTCDate(tickDate.getUTCDate() + intervalDays);
        }
      } else {
        // Gap break indicator
        const midPx = (seg.startPx + seg.endPx) / 2;
        const breakEl = document.createElement('div');
        breakEl.className = 'time-break';
        breakEl.style.left = midPx + 'px';
        breakEl.textContent = `⋯ ${seg.durationDays}d`;
        breakEl.title = `${seg.durationDays} day gap (compressed)`;
        axis.appendChild(breakEl);
      }
    }
  }

  function renderLane(container, pr, isSpec) {
    const lane = document.createElement('div');
    lane.className = `lane ${isSpec ? 'spec-lane' : ''}`;

    // Label
    const label = document.createElement('div');
    label.className = 'lane-label';
    const langClass = pr.language ? pr.language.toLowerCase().replace('.', '') : 'spec';
    const langText = pr.language || 'TypeSpec';
    const prDays = pr.mergedAt
      ? DataLoader.computeDurationDays(pr.createdAt, pr.mergedAt)
      : '—';
    label.innerHTML = `
      <div class="lane-repo">
        <a href="${pr.url}" target="_blank" title="${pr.repo}#${pr.number}">#${pr.number}</a>
      </div>
      <div class="lane-meta">
        <span class="lane-language ${langClass}">${langText}</span>
        <span>${prDays}d</span>
      </div>
    `;
    lane.appendChild(label);

    // Content area
    const content = document.createElement('div');
    content.className = 'lane-content';
    content.style.width = contentWidth + 'px';

    // Gap break indicators in lane
    for (const seg of segments) {
      if (seg.type === 'gap') {
        const breakEl = document.createElement('div');
        breakEl.className = 'lane-break';
        breakEl.style.left = seg.startPx + 'px';
        breakEl.style.width = (seg.endPx - seg.startPx) + 'px';
        content.appendChild(breakEl);
      }
    }

    // PR duration bar
    const barStart = timeToX(pr.createdAt);
    const barEnd = timeToX(pr.mergedAt || pr.closedAt || data.endDate);
    const bar = document.createElement('div');
    bar.className = `pr-bar ${pr.state === 'merged' ? 'merged' : ''}`;
    bar.style.left = barStart + 'px';
    bar.style.width = Math.max(barEnd - barStart, 4) + 'px';
    content.appendChild(bar);

    // Idle gaps
    const idleEvents = pr.events.filter(e => e.type === 'idle_gap');
    for (const gap of idleEvents) {
      const gapStart = timeToX(gap.timestamp);
      const gapEnd = timeToX(gap.endTimestamp);
      const hours = gap.details?.durationHours || 0;
      const gapEl = document.createElement('div');
      gapEl.className = `idle-gap ${hours > 72 ? 'critical' : 'warning'}`;
      gapEl.style.left = gapStart + 'px';
      gapEl.style.width = Math.max(gapEnd - gapStart, 4) + 'px';
      gapEl.dataset.eventType = 'idle_gap';
      gapEl.title = `${DataLoader.formatDuration(hours)} idle`;
      if (hiddenEventTypes.has('idle_gap')) gapEl.classList.add('hidden');
      content.appendChild(gapEl);
    }

    // Event markers
    const events = pr.events.filter(e => e.type !== 'idle_gap');
    const markers = [];
    for (const event of events) {
      const x = timeToX(event.timestamp);
      const marker = document.createElement('div');
      marker.className = `event-marker ${event.type}`;
      if (hiddenEventTypes.has(event.type)) marker.classList.add('hidden');
      marker.style.left = x + 'px';
      marker.dataset.eventType = event.type;
      marker.title = '';
      marker._eventData = event;
      marker._prData = pr;
      marker._x = x;

      marker.addEventListener('mouseenter', (e) => UI.showTooltip(e, event, pr));
      marker.addEventListener('mouseleave', () => UI.hideTooltip());
      marker.addEventListener('click', () => UI.showDetail(event, pr));

      content.appendChild(marker);
      markers.push(marker);
    }

    // Resolve overlapping markers
    resolveCollisions(markers);

    lane.appendChild(content);
    container.appendChild(lane);
  }

  /* ── Collision Resolution ───────────────────────────────── */

  function resolveCollisions(markers) {
    if (markers.length < 2) return;

    const MIN_SPACING = 14; // markers closer than this (px) are a cluster

    // Sort by x position
    const sorted = [...markers].sort((a, b) => a._x - b._x);

    // Group into clusters of overlapping markers
    const clusters = [];
    let cluster = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i]._x - sorted[i - 1]._x < MIN_SPACING) {
        cluster.push(sorted[i]);
      } else {
        if (cluster.length > 1) clusters.push(cluster);
        cluster = [sorted[i]];
      }
    }
    if (cluster.length > 1) clusters.push(cluster);

    // Stagger each cluster vertically
    for (const group of clusters) {
      const n = group.length;
      const maxSpread = 24; // ±12px from center
      const totalSpread = Math.min((n - 1) * 10, maxSpread);
      const startOffset = -totalSpread / 2;
      const step = n > 1 ? totalSpread / (n - 1) : 0;

      for (let i = 0; i < n; i++) {
        const offset = startOffset + i * step;
        group[i].style.top = `calc(50% + ${offset}px)`;
      }
    }
  }

  /* ── Pipeline Gap / Gridlines ───────────────────────────── */

  function renderPipelineGap(container) {
    if (!data.sdkPRs.length) return;
    const specMergedAt = data.specPR.mergedAt;
    if (!specMergedAt) return;

    const earliestSDK = data.sdkPRs.reduce((earliest, pr) =>
      new Date(pr.createdAt) < new Date(earliest.createdAt) ? pr : earliest
    );

    const gapDays = DataLoader.computeDurationDays(specMergedAt, earliestSDK.createdAt);
    if (gapDays < 0.5) return;

    const x = timeToX(specMergedAt);
    const gapLine = document.createElement('div');
    gapLine.className = 'pipeline-gap';
    gapLine.style.left = `calc(var(--label-width) + ${x}px)`;
    gapLine.style.top = '0';
    gapLine.style.height = '100%';
    container.style.position = 'relative';
    container.appendChild(gapLine);

    // Only show label if the gap is NOT compressed (< threshold)
    const hasCompressedGap = segments.some(s => s.type === 'gap');
    if (!hasCompressedGap) {
      const label = document.createElement('div');
      label.className = 'pipeline-gap-label';
      label.textContent = `↕ Pipeline gap: ${gapDays}d`;
      label.style.left = `calc(var(--label-width) + ${x + 6}px)`;
      label.style.top = '4px';
      container.appendChild(label);
    }
  }

  function addGridlines(container) {
    // Only add gridlines within active segments
    for (const seg of segments) {
      if (seg.type !== 'active') continue;

      const segDays = (seg.endMs - seg.startMs) / 86400000;
      let intervalDays;
      if (segDays <= 3) intervalDays = 1;
      else if (segDays <= 14) intervalDays = 2;
      else if (segDays <= 45) intervalDays = 7;
      else intervalDays = 14;

      const tickDate = new Date(seg.startMs);
      tickDate.setUTCHours(0, 0, 0, 0);
      while (tickDate.getTime() < seg.startMs)
        tickDate.setUTCDate(tickDate.getUTCDate() + intervalDays);

      while (tickDate.getTime() <= seg.endMs) {
        const x = timeToX(tickDate.toISOString());
        const gridline = document.createElement('div');
        gridline.className = 'gridline';
        gridline.style.left = `calc(var(--label-width) + ${x}px)`;
        container.appendChild(gridline);
        tickDate.setUTCDate(tickDate.getUTCDate() + intervalDays);
      }
    }
  }

  /* ── Insights ───────────────────────────────────────────── */

  function renderInsights() {
    const list = document.getElementById('insights-list');
    list.innerHTML = '';

    if (!data.insights || !data.insights.length) {
      hide('insights-panel');
      return;
    }

    const iconMap = {
      bottleneck: '🔴',
      nag: '⏰',
      manual_fix: '🔧',
      idle: '⏳',
      positive: '✅',
      summary: '📊'
    };

    for (const insight of data.insights) {
      const item = document.createElement('div');
      item.className = `insight-item ${insight.severity || 'info'}`;
      item.innerHTML = `
        <span class="insight-icon">${iconMap[insight.type] || '💡'}</span>
        <div>
          <div class="insight-text">${escapeHtml(insight.description)}</div>
          ${insight.prRef ? `<div class="insight-pr-ref">${escapeHtml(insight.prRef)}${insight.durationDays ? ` · ${insight.durationDays}d` : ''}</div>` : ''}
        </div>
      `;
      list.appendChild(item);
    }
  }

  /* ── Utilities ──────────────────────────────────────────── */

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function show(id) {
    document.getElementById(id)?.classList.remove('hidden');
  }

  function hide(id) {
    document.getElementById(id)?.classList.add('hidden');
  }

  return { render, escapeHtml };
})();
