/**
 * data-loader.js
 * Loads and validates timeline JSON data.
 */
const DataLoader = (() => {
  const REQUIRED_FIELDS = ['title', 'owner', 'startDate', 'endDate', 'specPR', 'sdkPRs'];
  const VALID_EVENT_TYPES = [
    'pr_created', 'pr_merged', 'pr_closed', 'commit_pushed',
    'review_approved', 'review_changes_requested', 'review_comment',
    'issue_comment', 'bot_comment', 'author_nag', 'reviewer_responds',
    'label_added', 'manual_fix', 'idle_gap', 'ci_status'
  ];

  function validate(data) {
    const errors = [];
    for (const field of REQUIRED_FIELDS) {
      if (!(field in data)) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    if (data.specPR && !data.specPR.events) {
      errors.push('specPR must have an events array');
    }
    if (data.sdkPRs && !Array.isArray(data.sdkPRs)) {
      errors.push('sdkPRs must be an array');
    }
    return errors;
  }

  function getAllPRs(data) {
    return [data.specPR, ...data.sdkPRs];
  }

  function getAllEvents(data) {
    const prs = getAllPRs(data);
    const events = [];
    for (const pr of prs) {
      for (const event of pr.events) {
        events.push({ ...event, pr });
      }
    }
    return events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  function getTimeRange(data) {
    return {
      start: new Date(data.startDate),
      end: new Date(data.endDate)
    };
  }

  function getEventTypeInfo(type) {
    const info = {
      pr_created:                { icon: '🟢', label: 'PR Created',            color: 'green' },
      pr_merged:                 { icon: '🟣', label: 'PR Merged',             color: 'purple' },
      pr_closed:                 { icon: '⚫', label: 'PR Closed',             color: 'gray' },
      commit_pushed:             { icon: '🔵', label: 'Commit Pushed',         color: 'blue' },
      review_approved:           { icon: '✅', label: 'Approved',              color: 'green' },
      review_changes_requested:  { icon: '🔴', label: 'Changes Requested',    color: 'red' },
      review_comment:            { icon: '💬', label: 'Review Comment',        color: 'yellow' },
      issue_comment:             { icon: '💬', label: 'Comment',               color: 'gray' },
      bot_comment:               { icon: '🤖', label: 'Bot Comment',           color: 'gray' },
      author_nag:                { icon: '⏰', label: 'Author Nudge',          color: 'orange' },
      reviewer_responds:         { icon: '💬', label: 'Reviewer Response',     color: 'blue' },
      label_added:               { icon: '🏷️', label: 'Label Added',           color: 'teal' },
      manual_fix:                { icon: '🔧', label: 'Manual Fix',            color: 'orange' },
      idle_gap:                  { icon: '⏳', label: 'Idle Gap',              color: 'red' },
      ci_status:                 { icon: '⚙️', label: 'CI Status',             color: 'gray' }
    };
    return info[type] || { icon: '❓', label: type, color: 'gray' };
  }

  function computeDurationDays(startDate, endDate) {
    const ms = new Date(endDate) - new Date(startDate);
    return Math.round((ms / (1000 * 60 * 60 * 24)) * 10) / 10;
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function formatDateTime(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  }

  function formatDuration(hours) {
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    if (hours < 24) return `${Math.round(hours)}h`;
    const days = Math.round(hours / 24 * 10) / 10;
    return `${days}d`;
  }

  async function loadFromUrl(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`);
    const data = await response.json();
    const errors = validate(data);
    if (errors.length) throw new Error(`Validation errors:\n${errors.join('\n')}`);
    return data;
  }

  function loadFromString(jsonStr) {
    const data = JSON.parse(jsonStr);
    const errors = validate(data);
    if (errors.length) throw new Error(`Validation errors:\n${errors.join('\n')}`);
    return data;
  }

  return {
    validate,
    getAllPRs,
    getAllEvents,
    getTimeRange,
    getEventTypeInfo,
    computeDurationDays,
    formatDate,
    formatDateTime,
    formatDuration,
    loadFromUrl,
    loadFromString,
    VALID_EVENT_TYPES
  };
})();
