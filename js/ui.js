/**
 * ui.js
 * UI interactions — tooltips, detail panel, drag-drop, file loading, theme toggle.
 */
const UI = (() => {
  const tooltip = () => document.getElementById('tooltip');
  const detailPanel = () => document.getElementById('detail-panel');

  const SAMPLES = [
    {
      file: 'data/sample-netapp.json',
      name: 'NetApp',
      meta: 'Jan 26 – Mar 25 · audunn · 39d · 👤 manual .NET + 🤖 automated · all released',
      hasTooling: true
    },
    {
      file: 'data/sample-containerservice.json',
      name: 'ContainerService (AKS)',
      meta: 'Feb 19 – Apr 7 · FumingZhang · 47d · 33 tool calls · 12 SDK PRs · 2 nags',
      hasTooling: true
    },
    {
      file: 'data/sample-search.json',
      name: 'AzureSearch',
      meta: 'Feb 13 – Apr 6 · yangylu91 · 53d · 25 tool calls · 42d spec review',
      hasTooling: true
    },
    {
      file: 'data/sample-computeschedule.json',
      name: 'ComputeSchedule',
      meta: 'Mar 12 – ongoing · hardikginwala · 21 tool calls · 1/5 merged · 3 open PRs',
      hasTooling: true,
      inFlight: true
    },
    {
      file: 'data/sample-storage.json',
      name: 'Storage (AdvancedPlatformMetrics)',
      meta: 'Mar 16 – ongoing · jwfeshuk · 18 tool calls · spec merged · no SDK PRs yet',
      hasTooling: true,
      inFlight: true
    },
    {
      file: 'data/sample-durabletask.json',
      name: 'DurableTask',
      meta: 'Feb 10 – Mar 13 · berndverst · 31d · 4 nags · 1 manual fix',
      hasTooling: false
    },
    {
      file: 'data/sample-playwright.json',
      name: 'Playwright Testing',
      meta: 'Feb 4 – Apr 2 · mjmadhu · 57d · 49d pipeline gap',
      hasTooling: false
    },
    {
      file: 'data/sample-appnetwork.json',
      name: 'AppNetwork (AppLink)',
      meta: 'Feb 28 – Mar 27 · deveshdama · 27d · new RP onboarding',
      hasTooling: false
    },
    {
      file: 'data/sample-keyvault.json',
      name: 'Key Vault',
      meta: 'Feb 17 – Mar 30 · melissamserv · 30d · 22d pipeline gap · 3 nags',
      hasTooling: false
    },
    {
      file: 'data/sample-nginx.json',
      name: 'Nginx.NginxPlus',
      meta: 'Jan 26 – Mar 23 · briantkim93 · 52d · 31d pipeline gap · 3 nags',
      hasTooling: false
    },
    {
      file: 'data/sample-containerregistry.json',
      name: 'ContainerRegistry',
      meta: 'Mar 11 – Apr 7 · live1206 · 27d · 21d spec review · 2 PRs still open',
      hasTooling: false,
      inFlight: true
    },
    {
      file: 'data/sample-servicegroups.json',
      name: 'ServiceGroups',
      meta: 'Mar 27 – Apr 1 · Copilot · 4d · no .NET PR · 2 PRs still open',
      hasTooling: false,
      inFlight: true
    },
    {
      file: 'data/sample-batch.json',
      name: 'Batch',
      meta: 'Jan 6 – Mar 18 · wiboris · 70d · 35d spec review · JS still open · no .NET',
      hasTooling: false,
      inFlight: true
    },
    {
      file: 'data/sample-keyvault-secrets.json',
      name: 'KeyVault Secrets/Certs',
      meta: 'Mar 18 – Apr 2 · rohitsinghal4u · 15d · 4 PRs still open · no .NET',
      hasTooling: false,
      inFlight: true
    },
    {
      file: 'data/sample-kubernetes.json',
      name: 'Kubernetes',
      meta: 'Mar 8 – Apr 14 · prasannajsns · 37d · 7 SDK PRs · 5 merged · 2 open',
      hasTooling: false,
      inFlight: true
    },
    {
      file: 'data/sample-servicefabric.json',
      name: 'Service Fabric',
      meta: 'Feb 12 – Apr 14 · mcgallan · 62d · 4 open PRs · no .NET',
      hasTooling: false,
      inFlight: true
    },
    {
      file: 'data/sample-confluent.json',
      name: 'Liftr-Confluent',
      meta: 'Aug 18 – Mar 22 · Shekar2004 · 216d · 159d pipeline gap · 4 merged · .NET closed',
      hasTooling: false
    },
    {
      file: 'data/sample-cloudhealth.json',
      name: 'CloudHealth',
      meta: 'Mar 4 – Apr 14 · sebader · 41d · 4 open PRs · no JS',
      hasTooling: false,
      inFlight: true
    }
  ];

  const SERVICE_SAMPLES = [
    {
      file: 'data/service-durabletask.json',
      name: 'DurableTask',
      meta: '7 spec PRs · 15 SDK PRs · 5 languages · 2 release windows · 1yr lookback'
    },
    {
      file: 'data/service-netapp.json',
      name: 'NetApp',
      meta: '19 spec PRs · 29 SDK PRs · 4 languages · 2 release windows · 1yr lookback'
    },
    {
      file: 'data/service-containerregistry.json',
      name: 'ContainerRegistry',
      meta: '30 spec PRs · 20 SDK PRs · 5 languages · 3 release windows · 1yr lookback'
    },
    {
      file: 'data/service-cloudhealth.json',
      name: 'CloudHealth',
      meta: '7 spec PRs · 7 SDK PRs · 5 languages · 2 release windows · 1yr lookback'
    },
    {
      file: 'data/service-kubernetes.json',
      name: 'Kubernetes',
      meta: '6 spec PRs · 13 SDK PRs · 5 languages · 2 release windows · 1yr lookback'
    },
    {
      file: 'data/service-confluent.json',
      name: 'Liftr-Confluent',
      meta: '8 spec PRs · 6 SDK PRs · 5 languages · 3 release windows · 1yr lookback'
    },
    {
      file: 'data/service-keyvault.json',
      name: 'Key Vault',
      meta: '8 spec PRs · 7 SDK PRs · 5 languages · 1 release window · 1yr lookback'
    }
  ];

  function init() {
    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

    // File input
    document.getElementById('file-input').addEventListener('change', handleFileInput);

    // Build sample buttons
    buildSampleButtons();

    // Back button
    document.getElementById('back-btn').addEventListener('click', showHome);

    // Detail panel close
    document.getElementById('detail-close').addEventListener('click', closeDetail);

    // Click outside detail panel to close
    document.addEventListener('click', (e) => {
      const panel = detailPanel();
      if (panel.classList.contains('visible') &&
          !panel.contains(e.target) &&
          !e.target.classList.contains('event-marker')) {
        closeDetail();
      }
    });

    // Drag and drop
    document.body.addEventListener('dragover', (e) => {
      e.preventDefault();
      document.body.classList.add('drag-over');
    });
    document.body.addEventListener('dragleave', () => {
      document.body.classList.remove('drag-over');
    });
    document.body.addEventListener('drop', (e) => {
      e.preventDefault();
      document.body.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) loadFile(file);
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeDetail();
        hideTooltip();
      }
    });

    // Window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (window._timelineData) {
          if (DataLoader.isServiceTimeline(window._timelineData)) {
            ServiceTimeline.render(window._timelineData);
          } else {
            Timeline.render(window._timelineData);
          }
        }
      }, 250);
    });
  }

  function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    document.getElementById('theme-toggle').textContent = next === 'dark' ? '☀️' : '🌙';
  }

  function buildSampleButtons() {
    const container = document.getElementById('sample-buttons');
    if (!container) return;
    container.innerHTML = '';

    // Service timeline samples
    if (SERVICE_SAMPLES.length > 0) {
      const heading = document.createElement('div');
      heading.className = 'sample-section-heading';
      heading.innerHTML = '🔄 Full Service Timelines';
      container.appendChild(heading);
      const grid = document.createElement('div');
      grid.className = 'sample-grid';
      for (const sample of SERVICE_SAMPLES) {
        const btn = document.createElement('button');
        btn.className = 'sample-btn service-sample';
        btn.innerHTML = `
          <div class="sample-name">${sample.name}</div>
          <div class="sample-meta">${sample.meta}</div>
        `;
        btn.addEventListener('click', () => loadSample(sample.file));
        grid.appendChild(btn);
      }
      container.appendChild(grid);
    }

    const toolingSamples = SAMPLES.filter(s => s.hasTooling && !s.inFlight);
    const inFlightSamples = SAMPLES.filter(s => s.inFlight);
    const standardSamples = SAMPLES.filter(s => !s.hasTooling && !s.inFlight);

    const sections = [
      { items: toolingSamples, icon: '⚙️', label: 'With Agent Tooling' },
      { items: standardSamples, icon: '📋', label: 'Standard Flows' },
      { items: inFlightSamples, icon: '🚧', label: 'In Flight' }
    ];

    for (const section of sections) {
      if (section.items.length === 0) continue;
      const heading = document.createElement('div');
      heading.className = 'sample-section-heading';
      heading.innerHTML = `${section.icon} ${section.label}`;
      container.appendChild(heading);
      const grid = document.createElement('div');
      grid.className = 'sample-grid';
      for (const sample of section.items) {
        grid.appendChild(createSampleBtn(sample));
      }
      container.appendChild(grid);
    }
  }

  function createSampleBtn(sample) {
    const btn = document.createElement('button');
    btn.className = `sample-btn ${sample.hasTooling ? 'has-tooling' : ''} ${sample.inFlight ? 'in-flight' : ''}`;
    btn.innerHTML = `
      <div class="sample-name">${sample.name}</div>
      <div class="sample-meta">${sample.meta}</div>
    `;
    btn.addEventListener('click', () => loadSample(sample.file));
    return btn;
  }

  function showHome() {
    window._timelineData = null;
    for (const id of ['header-info', 'service-header', 'service-window-selector', 'summary-cards', 'filters', 'timeline-container', 'insights-panel', 'actor-filters', 'bar-legend']) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    }
    document.querySelectorAll('.focus-notice').forEach(el => el.remove());
    document.getElementById('empty-state')?.classList.remove('hidden');
    document.getElementById('back-btn')?.classList.add('hidden');
    closeDetail();
  }

  function handleFileInput(e) {
    const file = e.target.files[0];
    if (file) loadFile(file);
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = DataLoader.loadFromString(e.target.result);
        window._timelineData = data;
        if (DataLoader.isServiceTimeline(data)) {
          ServiceTimeline.render(data);
        } else {
          Timeline.render(data);
        }
        document.getElementById('back-btn')?.classList.remove('hidden');
      } catch (err) {
        alert('Error loading file: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  async function loadSample(file) {
    try {
      const data = await DataLoader.loadFromUrl(file || 'data/sample-durabletask.json');
      window._timelineData = data;
      if (DataLoader.isServiceTimeline(data)) {
        ServiceTimeline.render(data);
      } else {
        Timeline.render(data);
      }
      document.getElementById('back-btn')?.classList.remove('hidden');
    } catch (err) {
      alert('Error loading sample data: ' + err.message);
    }
  }

  function showTooltip(mouseEvent, event, pr) {
    const tip = tooltip();
    const info = DataLoader.getEventTypeInfo(event.type);

    const toolMeta = event.type === 'tool_call' && event.details
      ? `<div class="tooltip-meta">
          <span>${event.details.success === false ? '❌' : '✅'} ${event.details.clientType === 'agent' ? '🤖' : '👤'} ${Timeline.escapeHtml(event.details.clientName || '')}</span>
          ${event.details.durationMs != null ? `<span>⏱ ${event.details.durationMs >= 1000 ? (event.details.durationMs / 1000).toFixed(1) + 's' : event.details.durationMs + 'ms'}</span>` : ''}
        </div>`
      : '';

    const sentimentHtml = event.sentiment
      ? `<span class="sentiment-badge ${event.sentiment}" style="font-size:10px;padding:1px 6px;margin-left:6px">${event.sentiment}</span>`
      : '';

    // Show first ~100 chars of comment body for comment events
    let excerptHtml = '';
    if (event.details?.body) {
      const body = event.details.body.trim();
      const excerpt = body.length > 100 ? body.substring(0, 100) + '…' : body;
      excerptHtml = `<div class="tooltip-excerpt">${Timeline.escapeHtml(excerpt)}</div>`;
    }

    const linkHtml = event.details?.url
      ? `<div class="tooltip-link">🔗 click for details + GitHub link</div>`
      : '';

    tip.innerHTML = `
      <div class="tooltip-type">${info.icon} ${info.label}${sentimentHtml}</div>
      <div class="tooltip-desc">${Timeline.escapeHtml(event.description)}</div>
      <div class="tooltip-meta">
        <span>👤 ${Timeline.escapeHtml(event.actor)}</span>
        <span>🕐 ${DataLoader.formatDateTime(event.timestamp)}</span>
      </div>
      ${toolMeta}
      ${event.details?.durationHours ? `<div class="tooltip-meta"><span>⏱ Duration: ${DataLoader.formatDuration(event.details.durationHours)}</span></div>` : ''}
      ${excerptHtml}
      ${linkHtml}
    `;

    tip.classList.remove('hidden');

    // Position tooltip
    const rect = mouseEvent.target.getBoundingClientRect();
    let left = rect.right + 8;
    let top = rect.top - 10;

    // Keep tooltip on screen
    const tipRect = tip.getBoundingClientRect();
    if (left + tipRect.width > window.innerWidth - 16) {
      left = rect.left - tipRect.width - 8;
    }
    if (top + tipRect.height > window.innerHeight - 16) {
      top = window.innerHeight - tipRect.height - 16;
    }
    if (top < 8) top = 8;

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function showPRTooltip(mouseEvent, pr) {
    const tip = tooltip();
    const esc = (typeof ServiceTimeline !== 'undefined' ? ServiceTimeline : Timeline).escapeHtml;
    const stateIcons = { merged: '🟣 Merged', open: '🟢 Open', closed: '🔴 Closed' };
    const state = stateIcons[pr.state] || pr.state;
    const flowIcon = pr.generationFlow === 'automated' ? '🤖' : '👤';
    const dur = pr.createdAt && (pr.mergedAt || pr.closedAt)
      ? ((new Date(pr.mergedAt || pr.closedAt) - new Date(pr.createdAt)) / 86400000).toFixed(1) + 'd'
      : '';

    const releaseInfo = pr.release
      ? pr.release.status === 'released'
        ? `<div class="tooltip-meta"><span>📦 Released ${DataLoader.formatDate(pr.release.releasedAt)} (${pr.release.releaseGapDays || '<1'}d gap)</span></div>`
        : pr.release.status === 'pending'
          ? '<div class="tooltip-meta"><span>⏳ Release pending</span></div>'
          : '<div class="tooltip-meta"><span>❌ Release pipeline failed</span></div>'
      : '';

    tip.innerHTML = `
      <div class="tooltip-type">#${pr.number}: ${esc((pr.title || '').slice(0, 60))}${(pr.title || '').length > 60 ? '…' : ''}</div>
      <div class="tooltip-meta">
        <span>${state}</span>
        <span>${flowIcon} ${esc(pr.author || '')}</span>
        ${dur ? `<span>⏱ ${dur}</span>` : ''}
      </div>
      <div class="tooltip-meta">
        <span>📅 ${DataLoader.formatDate(pr.createdAt)}${pr.mergedAt ? ' → ' + DataLoader.formatDate(pr.mergedAt) : ''}</span>
      </div>
      ${pr.reviewers?.length ? `<div class="tooltip-meta"><span>👥 ${pr.reviewers.length} reviewer${pr.reviewers.length > 1 ? 's' : ''}</span></div>` : ''}
      ${releaseInfo}
      <div class="tooltip-link">Click for full details</div>
    `;

    tip.classList.remove('hidden');
    const rect = mouseEvent.target.getBoundingClientRect();
    let left = rect.right + 8;
    let top = rect.top - 10;
    const tipRect = tip.getBoundingClientRect();
    if (left + tipRect.width > window.innerWidth - 16) left = rect.left - tipRect.width - 8;
    if (top + tipRect.height > window.innerHeight - 16) top = window.innerHeight - tipRect.height - 16;
    if (top < 8) top = 8;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function hideTooltip() {
    tooltip().classList.add('hidden');
  }

  const BOT_ACTORS = new Set([
    'azure-sdk', 'copilot-agent', 'copilot', 'azure-pipelines', 'github-actions[bot]',
    'copilot-pull-request-reviewer[bot]', 'azure-pipelines[bot]', 'unknown', 'system', 'developer'
  ]);

  function isBot(actor) {
    if (!actor) return false;
    const lower = actor.toLowerCase();
    if (BOT_ACTORS.has(lower)) return true;
    if (lower.endsWith('[bot]')) return true;
    return false;
  }

  function githubUserLink(username) {
    const safe = Timeline.escapeHtml(username);
    if (isBot(username)) {
      return `<span class="bot-actor">🤖 ${safe}</span>`;
    }
    return `<a href="https://github.com/${safe}" target="_blank" class="github-user-link">@${safe}</a>`;
  }

  function linkifyUrls(text) {
    return text.replace(
      /(https?:\/\/[^\s<>"')\]]+)/g,
      '<a href="$1" target="_blank" class="auto-link">$1</a>'
    );
  }

  function showDetail(event, pr) {
    const panel = detailPanel();
    const info = DataLoader.getEventTypeInfo(event.type);

    document.getElementById('detail-title').textContent = `${info.icon} ${info.label}`;

    const body = document.getElementById('detail-body');
    body.innerHTML = '';

    // Description
    addDetailField(body, 'Description', event.description);

    // Actor — linked to GitHub profile
    const actorLink = githubUserLink(event.actor);
    addDetailField(body, 'Actor', `${actorLink} (${event.actorRole || 'unknown'})`);

    // Timestamp
    addDetailField(body, 'Timestamp', DataLoader.formatDateTime(event.timestamp));

    // PR reference
    const repoShort = pr.repo.split('/')[1];
    const flowLabel = pr.generationFlow === 'automated' ? ' 🤖 automated'
      : pr.generationFlow === 'manual' ? ' 👤 manual' : '';
    addDetailField(body, 'Pull Request',
      `<a href="${pr.url}" target="_blank">${pr.repo}#${pr.number}</a> — ${pr.language || 'TypeSpec'}${flowLabel}`);

    // Sentiment
    if (event.sentiment) {
      addDetailField(body, 'Sentiment',
        `<span class="sentiment-badge ${event.sentiment}">${event.sentiment}</span>`);
    }

    // Duration (for idle gaps)
    if (event.details?.durationHours) {
      addDetailField(body, 'Duration', DataLoader.formatDuration(event.details.durationHours));
    }

    // Target user — linked to GitHub profile
    if (event.details?.targetUser) {
      addDetailField(body, 'Target User', githubUserLink(event.details.targetUser));
    }

    // GitHub / pipeline link
    if (event.details?.url) {
      const isReleasePipeline = event.type.startsWith('release_pipeline');
      const linkLabel = isReleasePipeline ? 'Pipeline Run' : 'GitHub Link';
      const linkText = isReleasePipeline ? 'View pipeline run ↗' : 'View on GitHub ↗';
      addDetailField(body, linkLabel,
        `<a href="${event.details.url}" target="_blank">${linkText}</a>`);
    }

    // Release details (pull from PR's release object when viewing release events)
    if (event.type.startsWith('release_') && pr.release) {
      const rel = pr.release;
      if (rel.packageName) {
        const verStr = rel.packageVersion ? ` v${Timeline.escapeHtml(rel.packageVersion)}` : '';
        addDetailField(body, 'Package', `${Timeline.escapeHtml(rel.packageName)}${verStr}`);
      }
      // Show pipeline link from PR release object only if the event doesn't already have its own URL
      if (rel.pipelineUrl && !event.details?.url) {
        addDetailField(body, 'Release Pipeline',
          `<a href="${rel.pipelineUrl}" target="_blank">${Timeline.escapeHtml(rel.pipelineName || 'View pipeline')} ↗</a>`);
      }
      if (rel.packageManagerUrl) {
        addDetailField(body, 'Package Manager',
          `<a href="${rel.packageManagerUrl}" target="_blank">View on registry ↗</a>`);
      }
      if (rel.releaseGapDays != null) {
        addDetailField(body, 'Release Gap', `${rel.releaseGapDays}d from PR merge`);
      }
    }

    // Tool call details
    if (event.type === 'tool_call' && event.details) {
      const d = event.details;
      addDetailField(body, 'Tool', `<code>${Timeline.escapeHtml(d.toolName || '—')}</code>`);
      const statusIcon = d.success === false ? '❌ Failed' : '✅ Succeeded';
      addDetailField(body, 'Status', statusIcon);
      if (d.durationMs != null) {
        const dur = d.durationMs >= 1000 ? `${(d.durationMs / 1000).toFixed(1)}s` : `${d.durationMs}ms`;
        addDetailField(body, 'Duration', dur);
      }
      if (d.clientName) {
        const clientIcon = d.clientType === 'agent' ? '🤖' : '👤';
        addDetailField(body, 'Client', `${clientIcon} ${Timeline.escapeHtml(d.clientName)}`);
      }
      if (d.language) addDetailField(body, 'Language', d.language);
      if (d.packageType) addDetailField(body, 'Package Type', d.packageType);
    }

    // Comment body — expandable with linkified URLs
    if (event.details?.body) {
      const escapedBody = Timeline.escapeHtml(event.details.body);
      const linkedBody = linkifyUrls(escapedBody);
      const bodyField = document.createElement('div');
      bodyField.className = 'detail-field';
      bodyField.innerHTML = `
        <div class="detail-label">Comment Body</div>
        <div class="detail-comment" onclick="this.classList.toggle('collapsed')">
          ${linkedBody}
          <div class="comment-expand-hint">Click to expand ↓</div>
        </div>
      `;
      body.appendChild(bodyField);
      // Only collapse if content actually overflows
      requestAnimationFrame(() => {
        const commentEl = bodyField.querySelector('.detail-comment');
        if (commentEl && commentEl.scrollHeight > commentEl.offsetHeight + 4) {
          commentEl.classList.add('collapsed');
        }
      });
    }

    panel.classList.remove('hidden');
    // Trigger animation
    requestAnimationFrame(() => panel.classList.add('visible'));
  }

  function addDetailField(container, label, valueHtml) {
    const field = document.createElement('div');
    field.className = 'detail-field';
    field.innerHTML = `
      <div class="detail-label">${label}</div>
      <div class="detail-value">${valueHtml}</div>
    `;
    container.appendChild(field);
  }

  function closeDetail() {
    const panel = detailPanel();
    panel.classList.remove('visible');
    setTimeout(() => panel.classList.add('hidden'), 200);
  }

  function showPRDetail(pr) {
    const panel = detailPanel();
    const esc = (typeof ServiceTimeline !== 'undefined' ? ServiceTimeline : Timeline).escapeHtml;

    const stateIcons = { merged: '🟣 Merged', open: '🟢 Open', closed: '🔴 Closed' };
    const state = stateIcons[pr.state] || pr.state;
    const flowLabel = pr.generationFlow === 'automated' ? '🤖 Automated'
      : pr.generationFlow === 'manual' ? '👤 Manual' : '';

    document.getElementById('detail-title').textContent =
      `#${pr.number}: ${(pr.title || '').slice(0, 60)}${(pr.title || '').length > 60 ? '…' : ''}`;

    const body = document.getElementById('detail-body');
    body.innerHTML = '';

    // Full title
    addDetailField(body, 'Title', esc(pr.title || ''));

    // GitHub link
    const prUrl = pr.url || `https://github.com/${pr.repo || ''}/pull/${pr.number}`;
    addDetailField(body, 'GitHub', `<a href="${prUrl}" target="_blank" rel="noopener">View on GitHub ↗</a>`);

    // State
    addDetailField(body, 'Status', `${state}${pr.isDraft ? ' (Draft)' : ''}`);

    // Language / repo
    addDetailField(body, 'Language', esc(pr.language || 'Spec'));
    addDetailField(body, 'Repository', `<a href="https://github.com/${esc(pr.repo || '')}" target="_blank" rel="noopener">${esc(pr.repo || '')}</a>`);

    // Author
    addDetailField(body, 'Author', githubUserLink(pr.author || 'unknown'));

    // Flow
    if (flowLabel) addDetailField(body, 'Generation', flowLabel);

    // Dates
    if (pr.createdAt) addDetailField(body, 'Created', DataLoader.formatDateTime(pr.createdAt));
    if (pr.mergedAt) addDetailField(body, 'Merged', DataLoader.formatDateTime(pr.mergedAt));
    else if (pr.closedAt) addDetailField(body, 'Closed', DataLoader.formatDateTime(pr.closedAt));

    // Duration
    if (pr.createdAt && (pr.mergedAt || pr.closedAt)) {
      const days = (new Date(pr.mergedAt || pr.closedAt) - new Date(pr.createdAt)) / 86400000;
      addDetailField(body, 'Duration', `${days.toFixed(1)}d`);
    }

    // Review wait
    if (pr.reviewWaitDays != null) {
      addDetailField(body, 'Review Wait', `${pr.reviewWaitDays}d (${pr.reviewWaitCycles || 0} cycles)`);
    }

    // Reviewers
    if (pr.reviewers?.length > 0) {
      const reviewerLinks = pr.reviewers.map(r => githubUserLink(r)).join(', ');
      addDetailField(body, 'Reviewers', reviewerLinks);
    }

    // Merged by
    if (pr.mergedBy) addDetailField(body, 'Merged By', githubUserLink(pr.mergedBy));

    // Labels
    if (pr.labels?.length > 0) {
      const labelHtml = pr.labels.map(l => `<span class="pr-label-badge">${esc(l)}</span>`).join(' ');
      addDetailField(body, 'Labels', labelHtml);
    }

    // Event count
    if (pr.events?.length > 0) {
      addDetailField(body, 'Events', `${pr.events.length} timeline events`);
    }

    panel.classList.remove('hidden');
    requestAnimationFrame(() => panel.classList.add('visible'));
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { showTooltip, showPRTooltip, hideTooltip, showDetail, showPRDetail, closeDetail };
})();
