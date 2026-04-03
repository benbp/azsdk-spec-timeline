/**
 * timeline.js
 * Core timeline renderer — swim lanes, time axis, event markers, idle gaps, pipeline gap.
 */
const Timeline = (() => {
  let data = null;
  let timeRange = null;
  let contentWidth = 0;
  let padding = { left: 20, right: 20 };
  let hiddenEventTypes = new Set(['bot_comment', 'label_added', 'ci_status']);

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
      if (hiddenEventTypes.has(type)) {
        el.classList.add('hidden');
      } else {
        el.classList.remove('hidden');
      }
    });
    // Also toggle idle gap bars
    document.querySelectorAll('.idle-gap').forEach(el => {
      if (hiddenEventTypes.has('idle_gap')) {
        el.classList.add('hidden');
      } else {
        el.classList.remove('hidden');
      }
    });
  }

  function renderTimeline() {
    const lanesContainer = document.getElementById('lanes');
    lanesContainer.innerHTML = '';

    const allPRs = DataLoader.getAllPRs(data);
    // Measure available width
    const containerEl = document.getElementById('timeline-container');
    const availWidth = containerEl.clientWidth - 200; // minus label width
    contentWidth = Math.max(availWidth, 800);

    // Render time axis
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

    for (const pr of sdkPRs) {
      renderLane(lanesContainer, pr, false);
    }

    // Add gridlines
    addGridlines(lanesContainer);
  }

  function timeToX(timestamp) {
    const t = new Date(timestamp).getTime();
    const start = timeRange.start.getTime();
    const end = timeRange.end.getTime();
    const range = end - start;
    // Add 5% padding on each side
    const paddedStart = start - range * 0.03;
    const paddedEnd = end + range * 0.03;
    const paddedRange = paddedEnd - paddedStart;
    return padding.left + ((t - paddedStart) / paddedRange) * (contentWidth - padding.left - padding.right);
  }

  function renderTimeAxis(elementId) {
    const axis = document.getElementById(elementId);
    axis.innerHTML = '';
    axis.style.width = contentWidth + 'px';

    const start = timeRange.start.getTime();
    const end = timeRange.end.getTime();
    const rangeDays = (end - start) / (1000 * 60 * 60 * 24);

    // Determine tick interval
    let intervalDays;
    if (rangeDays <= 7) intervalDays = 1;
    else if (rangeDays <= 30) intervalDays = 2;
    else if (rangeDays <= 90) intervalDays = 7;
    else intervalDays = 14;

    const tickDate = new Date(timeRange.start);
    tickDate.setUTCHours(0, 0, 0, 0);

    while (tickDate <= timeRange.end) {
      const x = timeToX(tickDate.toISOString());
      if (x >= 0 && x <= contentWidth) {
        const tick = document.createElement('div');
        tick.className = 'time-tick';
        if (tickDate.getUTCDate() === 1 || intervalDays >= 7) {
          tick.classList.add('major');
        }
        tick.style.left = x + 'px';
        tick.textContent = DataLoader.formatDate(tickDate.toISOString());
        axis.appendChild(tick);
      }
      tickDate.setUTCDate(tickDate.getUTCDate() + intervalDays);
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
    const repoShort = pr.repo.split('/')[1];
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

    // Event markers (excluding idle_gap which is rendered as bars)
    const events = pr.events.filter(e => e.type !== 'idle_gap');
    for (const event of events) {
      const x = timeToX(event.timestamp);
      const info = DataLoader.getEventTypeInfo(event.type);
      const marker = document.createElement('div');
      marker.className = `event-marker ${event.type}`;
      if (hiddenEventTypes.has(event.type)) marker.classList.add('hidden');
      marker.style.left = x + 'px';
      marker.dataset.eventType = event.type;
      marker.title = '';

      // Store event data for tooltip/detail
      marker._eventData = event;
      marker._prData = pr;

      marker.addEventListener('mouseenter', (e) => UI.showTooltip(e, event, pr));
      marker.addEventListener('mouseleave', () => UI.hideTooltip());
      marker.addEventListener('click', () => UI.showDetail(event, pr));

      content.appendChild(marker);
    }

    lane.appendChild(content);
    container.appendChild(lane);
  }

  function renderPipelineGap(container) {
    if (!data.sdkPRs.length) return;

    const specMergedAt = data.specPR.mergedAt;
    if (!specMergedAt) return;

    const earliestSDK = data.sdkPRs.reduce((earliest, pr) => {
      return new Date(pr.createdAt) < new Date(earliest.createdAt) ? pr : earliest;
    });

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

    const label = document.createElement('div');
    label.className = 'pipeline-gap-label';
    label.textContent = `↕ Pipeline gap: ${gapDays}d`;
    label.style.left = `calc(var(--label-width) + ${x + 6}px)`;
    label.style.top = '4px';
    container.appendChild(label);
  }

  function addGridlines(container) {
    const start = timeRange.start.getTime();
    const end = timeRange.end.getTime();
    const rangeDays = (end - start) / (1000 * 60 * 60 * 24);

    let intervalDays;
    if (rangeDays <= 7) intervalDays = 1;
    else if (rangeDays <= 30) intervalDays = 2;
    else if (rangeDays <= 90) intervalDays = 7;
    else intervalDays = 14;

    const tickDate = new Date(timeRange.start);
    tickDate.setUTCHours(0, 0, 0, 0);

    while (tickDate <= timeRange.end) {
      const x = timeToX(tickDate.toISOString());
      if (x >= 0 && x <= contentWidth) {
        const gridline = document.createElement('div');
        gridline.className = 'gridline';
        gridline.style.left = `calc(var(--label-width) + ${x}px)`;
        container.appendChild(gridline);
      }
      tickDate.setUTCDate(tickDate.getUTCDate() + intervalDays);
    }
  }

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
