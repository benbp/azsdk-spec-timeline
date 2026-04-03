/**
 * ui.js
 * UI interactions — tooltips, detail panel, drag-drop, file loading, theme toggle.
 */
const UI = (() => {
  const tooltip = () => document.getElementById('tooltip');
  const detailPanel = () => document.getElementById('detail-panel');

  const SAMPLES = [
    {
      file: 'data/sample-durabletask.json',
      name: 'DurableTask',
      meta: 'berndverst · 31d · 4 nags · 1 manual fix'
    },
    {
      file: 'data/sample-playwright.json',
      name: 'Playwright Testing',
      meta: 'mjmadhu · 57d · 49d pipeline gap'
    },
    {
      file: 'data/sample-containerservice.json',
      name: 'Container Service (AKS)',
      meta: 'FumingZhang · 42d · breaking changes'
    },
    {
      file: 'data/sample-appnetwork.json',
      name: 'AppNetwork (AppLink)',
      meta: 'deveshdama · 27d · new RP onboarding'
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
        if (window._timelineData) Timeline.render(window._timelineData);
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
    for (const sample of SAMPLES) {
      const btn = document.createElement('button');
      btn.className = 'sample-btn';
      btn.innerHTML = `
        <div class="sample-name">${sample.name}</div>
        <div class="sample-meta">${sample.meta}</div>
      `;
      btn.addEventListener('click', () => loadSample(sample.file));
      container.appendChild(btn);
    }
  }

  function showHome() {
    window._timelineData = null;
    for (const id of ['header-info', 'summary-cards', 'filters', 'timeline-container', 'insights-panel']) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    }
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
        Timeline.render(data);
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
      Timeline.render(data);
      document.getElementById('back-btn')?.classList.remove('hidden');
    } catch (err) {
      alert('Error loading sample data: ' + err.message);
    }
  }

  function showTooltip(mouseEvent, event, pr) {
    const tip = tooltip();
    const info = DataLoader.getEventTypeInfo(event.type);

    tip.innerHTML = `
      <div class="tooltip-type">${info.icon} ${info.label}</div>
      <div class="tooltip-desc">${Timeline.escapeHtml(event.description)}</div>
      <div class="tooltip-meta">
        <span>👤 ${Timeline.escapeHtml(event.actor)}</span>
        <span>🕐 ${DataLoader.formatDateTime(event.timestamp)}</span>
      </div>
      ${event.details?.durationHours ? `<div class="tooltip-meta"><span>⏱ Duration: ${DataLoader.formatDuration(event.details.durationHours)}</span></div>` : ''}
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

  function hideTooltip() {
    tooltip().classList.add('hidden');
  }

  function showDetail(event, pr) {
    const panel = detailPanel();
    const info = DataLoader.getEventTypeInfo(event.type);

    document.getElementById('detail-title').textContent = `${info.icon} ${info.label}`;

    const body = document.getElementById('detail-body');
    body.innerHTML = '';

    // Description
    addDetailField(body, 'Description', event.description);

    // Actor
    addDetailField(body, 'Actor', `${event.actor} (${event.actorRole || 'unknown'})`);

    // Timestamp
    addDetailField(body, 'Timestamp', DataLoader.formatDateTime(event.timestamp));

    // PR reference
    const repoShort = pr.repo.split('/')[1];
    addDetailField(body, 'Pull Request',
      `<a href="${pr.url}" target="_blank">${pr.repo}#${pr.number}</a> — ${pr.language || 'TypeSpec'}`);

    // Sentiment
    if (event.sentiment) {
      addDetailField(body, 'Sentiment',
        `<span class="sentiment-badge ${event.sentiment}">${event.sentiment}</span>`);
    }

    // Duration (for idle gaps)
    if (event.details?.durationHours) {
      addDetailField(body, 'Duration', DataLoader.formatDuration(event.details.durationHours));
    }

    // Target user
    if (event.details?.targetUser) {
      addDetailField(body, 'Target User', `@${event.details.targetUser}`);
    }

    // GitHub link
    if (event.details?.url) {
      addDetailField(body, 'GitHub Link',
        `<a href="${event.details.url}" target="_blank">View on GitHub ↗</a>`);
    }

    // Comment body
    if (event.details?.body) {
      const bodyField = document.createElement('div');
      bodyField.className = 'detail-field';
      bodyField.innerHTML = `
        <div class="detail-label">Comment Body</div>
        <div class="detail-comment">${Timeline.escapeHtml(event.details.body)}</div>
      `;
      body.appendChild(bodyField);
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

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { showTooltip, hideTooltip, showDetail, closeDetail };
})();
