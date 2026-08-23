'use strict';

/* The dashboard deliberately uses no remote assets. Keeping the icon set
 * local means the control surface still works when the machine is offline. */
const ICONS = {
  'layers-3': '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  'shield-check': '<path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"/><path d="m9 12 2 2 4-4"/>',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/>',
  'rotate-cw': '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  play: '<path d="m6 3 14 9-14 9V3Z"/>',
  square: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
  activity: '<path d="M22 12h-4l-3 8-6-16-3 8H2"/>',
  sparkles: '<path d="m12 3-1.5 5.5L5 10l5.5 1.5L12 17l1.5-5.5L19 10l-5.5-1.5L12 3Z"/><path d="m19 16-.7 2.3L16 19l2.3.7L19 22l.7-2.3L22 19l-2.3-.7L19 16Z"/>',
  server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 7h.01M7 18h.01M11 7h6M11 18h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  'search-x': '<circle cx="11" cy="11" r="7"/><path d="M8.5 8.5 5 5m10.5 10.5L19 19M8.5 15.5 15.5 8.5" /><path d="m20 20-4-4"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
  'plug-zap': '<path d="m12 22 4-9h-3l1-11-6 11h3l-1 9Z"/><path d="M8 7H5a2 2 0 0 0-2 2v3M16 7h3a2 2 0 0 1 2 2v3"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>',
  'external-link': '<path d="M14 3h7v7M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  'check-circle-2': '<path d="M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10Z"/><path d="m8 12 2.5 2.5L16 9"/>',
  'alert-triangle': '<path d="m10.3 3.5-8 14A2 2 0 0 0 4 20.5h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  'loader-circle': '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
  'radio-tower': '<path d="M5 8.5a10 10 0 0 0 0 7M19 8.5a10 10 0 0 1 0 7M8.5 5a14 14 0 0 0 0 14M15.5 5a14 14 0 0 1 0 14"/><circle cx="12" cy="12" r="2"/>',
  monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  braces: '<path d="M8 3H6a2 2 0 0 0-2 2v4a3 3 0 0 1-3 3 3 3 0 0 1 3 3v4a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v4a3 3 0 0 0 3 3 3 3 0 0 0-3 3v4a2 2 0 0 1-2 2h-2"/>',
  orbit: '<circle cx="12" cy="12" r="2"/><path d="M19.1 15.5c2.2-1.5 3.5-3.3 3.1-4.8-.6-2.2-4.7-3.4-9.6-2.8-4.9.6-8.4 2.8-7.8 5 .4 1.5 2.2 2.5 4.8 2.8"/><path d="M8.5 5.1c-.2-2.6.5-4.5 2-5 2.2-.6 5.1 2.4 6.8 7 1.7 4.6 1.6 9-.6 9.7-1.5.5-3.3-.6-4.8-2.8"/>',
  'panel-top': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M8 6h.01M12 6h.01"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  'circle-dot': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/>',
  'clock-3': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/>',
  power: '<path d="M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10"/>',
};

const state = {
  meta: null,
  status: null,
  operations: null,
  section: 'services',
  filter: 'all',
  query: '',
  busy: false,
  statusRequest: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function icon(name, className = 'icon') {
  const body = ICONS[name] || ICONS['circle-dot'];
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

function hydrateIcons(root = document) {
  $$('[data-icon]', root).forEach((node) => {
    node.innerHTML = icon(node.dataset.icon);
  });
}

function addText(parent, tag, text, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text == null ? '' : String(text);
  parent.appendChild(node);
  return node;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function setConnection(kind, label) {
  const node = $('#connection-state');
  if (!node) return;
  node.classList.remove('is-loading', 'is-ready', 'is-error');
  node.classList.add(`is-${kind}`);
  node.lastChild.textContent = label;
}

function formatTime(value, fallback = '') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function hasCapability(service, capability) {
  return (service.capabilities || []).includes(capability);
}

function serviceState(service) {
  const source = (state.status && state.status.services) || {};
  const entry = source[service.id];
  if (entry && entry.state === 'disabled') return 'disabled';
  return entry && entry.state === 'ready' ? 'ready' : 'stopped';
}

function serviceStateLabel(value) {
  return ({
    ready: '运行中',
    stopped: '已停止',
    disabled: '未启用',
  })[value] || '未知';
}

function serviceMatches(service) {
  const value = `${service.name || ''} ${service.nameZh || ''} ${service.group || ''} ${service.description || ''}`.toLowerCase();
  if (state.query && !value.includes(state.query.toLowerCase())) return false;
  const current = serviceState(service);
  if (state.filter === 'running' && current !== 'ready') return false;
  return true;
}

function endpointRows(service, card) {
  const wrap = $('.service-endpoints', card);
  const endpoints = [];
  if (service.endpoint) endpoints.push({ label: 'API', value: service.endpoint, iconName: 'terminal' });
  if (service.url && service.url !== service.endpoint) endpoints.push({ label: 'UI', value: service.url, iconName: 'panel-top' });
  if (!endpoints.length && service.port) endpoints.push({ label: '端口', value: `127.0.0.1:${service.port}`, iconName: 'server' });
  if (!endpoints.length) {
    const note = hasCapability(service, 'start')
      ? '启动后在其自身窗口或终端中运行'
      : '状态展示型条目';
    addText(wrap, 'span', note, 'managed-note');
    return;
  }
  endpoints.forEach((endpoint) => {
    const row = document.createElement('div');
    row.className = 'endpoint-row';
    row.title = `${endpoint.label}: ${endpoint.value}`;
    row.innerHTML = icon(endpoint.iconName);
    addText(row, 'code', endpoint.value);
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'endpoint-action';
    copy.title = '复制地址';
    copy.innerHTML = icon('copy');
    copy.addEventListener('click', () => copyText(endpoint.value));
    row.appendChild(copy);
    if (/^https?:\/\//i.test(endpoint.value)) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'endpoint-action';
      open.title = '打开地址';
      open.innerHTML = icon('external-link');
      open.addEventListener('click', () => window.open(endpoint.value, '_blank', 'noopener,noreferrer'));
      row.appendChild(open);
    }
    wrap.appendChild(row);
  });
}

function renderServices() {
  const grid = $('#service-grid');
  const empty = $('#empty-state');
  if (!grid || !state.meta) return;
  grid.replaceChildren();
  const inSection = state.meta.services.filter((service) => (service.section || 'services') === state.section);
  const services = inSection.filter(serviceMatches);
  empty.classList.toggle('is-hidden', services.length > 0);
  services.forEach((service) => {
    const current = serviceState(service);
    const canStart = hasCapability(service, 'start');
    const canStop = hasCapability(service, 'stop');
    const canLogs = hasCapability(service, 'logs');

    const card = document.createElement('article');
    card.className = `service-card ${current === 'ready' ? 'is-running' : ''}`;
    card.style.setProperty('--accent', service.accent || '#5eead4');

    const top = document.createElement('div');
    top.className = 'service-card-top';
    const serviceIcon = document.createElement('div');
    serviceIcon.className = 'service-icon';
    serviceIcon.innerHTML = icon(service.icon);
    top.appendChild(serviceIcon);
    const heading = document.createElement('div');
    heading.className = 'service-card-heading';
    const tags = document.createElement('div');
    tags.className = 'service-tags';
    addText(tags, 'span', service.group || 'LOCAL', 'service-group');
    if (state.section === 'agents') {
      addText(tags, 'span', '仅展示与启动', 'service-kind');
    } else {
      addText(tags, 'span', service.common ? '常用' : '按需', 'service-kind');
    }
    heading.appendChild(tags);
    addText(heading, 'h3', service.nameZh || service.name || service.id, 'service-name');
    top.appendChild(heading);
    addText(top, 'span', serviceStateLabel(current), `service-status ${current === 'ready' ? 'ready' : ''}`);
    card.appendChild(top);
    addText(card, 'p', service.description || '', 'service-description');
    const endpoints = document.createElement('div');
    endpoints.className = 'service-endpoints';
    card.appendChild(endpoints);
    endpointRows(service, card);

    const bottom = document.createElement('div');
    bottom.className = 'service-card-bottom';
    const stateLabel = document.createElement('div');
    stateLabel.className = 'service-state-label';
    const dot = document.createElement('span');
    dot.className = 'state-dot';
    stateLabel.appendChild(dot);
    addText(stateLabel, 'span', current === 'ready' ? '就绪，可访问' : current === 'disabled' ? '清单中已停用' : '尚未启动', 'state-text');
    bottom.appendChild(stateLabel);

    const actions = document.createElement('div');
    actions.className = 'service-actions';
    if (canStop && current === 'ready') {
      const stopButton = document.createElement('button');
      stopButton.type = 'button';
      stopButton.className = 'mini-button stop';
      stopButton.title = '停止';
      stopButton.innerHTML = `${icon('square')}<span>停止</span>`;
      stopButton.disabled = state.busy;
      stopButton.addEventListener('click', () => runAction(`stop-${service.id}`));
      actions.appendChild(stopButton);
    }
    if (canStart && current !== 'ready' && current !== 'disabled') {
      const startButton = document.createElement('button');
      startButton.type = 'button';
      startButton.className = 'mini-button start';
      startButton.title = '启动';
      startButton.innerHTML = `${icon('play')}<span>启动</span>`;
      startButton.disabled = state.busy;
      startButton.addEventListener('click', () => runAction(`start-${service.id}`));
      actions.appendChild(startButton);
    }
    if (!canStart && !canStop) {
      addText(actions, 'span', '仅状态展示', 'managed-note');
    }
    if (canLogs) {
      const logs = document.createElement('button');
      logs.type = 'button';
      logs.className = 'mini-button icon-only';
      logs.title = '查看日志';
      logs.innerHTML = icon('terminal');
      logs.addEventListener('click', () => openLogs(service));
      actions.appendChild(logs);
    }
    bottom.appendChild(actions);
    card.appendChild(bottom);
    grid.appendChild(card);
  });
}

function renderSummary() {
  if (!state.meta || !state.status) return;
  const services = state.meta.services;
  const values = services.map(serviceState);
  const ready = values.filter((value) => value === 'ready').length;
  const agents = services.filter((service) => (service.section || 'services') === 'agents').length;
  const startable = services.filter((service) => hasCapability(service, 'start')).length;
  $('#hero-active-count').textContent = String(ready);
  $('#metric-online').textContent = String(ready);
  $('#metric-total').textContent = String(services.length);
  $('#metric-agents').textContent = String(agents);
  $('#metric-startable').textContent = String(startable);
  $('#last-updated').textContent = `同步于 ${formatTime(state.status.generatedAt)}`;
  $('#hero-health-label').textContent = ready === 0 ? '暂无在线条目' : `${ready} 项条目在线`;
  $('.health-line-dot').classList.toggle('is-good', ready > 0);
  const bars = $$('.signal-bars i');
  bars.forEach((bar, index) => bar.style.opacity = index < Math.max(1, Math.round((ready / Math.max(1, services.length)) * bars.length)) ? '1' : '.25');
  $$('[data-tab-count]').forEach((node) => {
    const section = node.dataset.tabCount;
    node.textContent = String(services.filter((service) => (service.section || 'services') === section).length);
  });
  const heroActions = $('#hero-actions');
  if (heroActions) {
    const ids = new Set((state.meta.actions || []).map((action) => action.id));
    $$('[data-global-action]', heroActions).forEach((button) => {
      button.classList.toggle('is-hidden', !ids.has(button.dataset.globalAction));
    });
  }
}

function operationIcon(status) {
  return status === 'succeeded' ? 'check-circle-2' : status === 'failed' ? 'alert-triangle' : 'loader-circle';
}

function renderActivity() {
  const list = $('#activity-list');
  if (!list || !state.operations) return;
  list.replaceChildren();
  const items = state.operations.recent || [];
  if (!items.length) {
    addText(list, 'div', '还没有操作记录', 'activity-empty');
    return;
  }
  items.slice(0, 8).forEach((operation) => {
    const item = document.createElement('div');
    item.className = `activity-item ${operation.status}`;
    const mark = document.createElement('span');
    mark.className = 'activity-icon';
    mark.innerHTML = icon(operationIcon(operation.status));
    item.appendChild(mark);
    const copy = document.createElement('div');
    copy.className = 'activity-copy';
    addText(copy, 'strong', operation.label || operation.action);
    addText(copy, 'small', `${formatTime(operation.startedAt)} · ${operation.status === 'running' ? '执行中' : operation.status === 'succeeded' ? '已完成' : '失败'}`);
    item.appendChild(copy);
    addText(item, 'span', operation.status === 'running' ? '…' : operation.code === 0 ? 'OK' : 'ERR', 'activity-result');
    list.appendChild(item);
  });
}

async function loadMeta() {
  state.meta = await fetchJson('/api/meta');
  document.title = state.meta.dashboard?.title || 'ServiceDeck';
  const brand = $('#brand-title');
  if (brand) brand.textContent = document.title;
}

async function loadStatus() {
  if (state.statusRequest) return state.statusRequest;
  state.statusRequest = fetchJson('/api/status').then((payload) => {
    state.status = payload;
    setConnection('ready', '已连接');
    renderSummary();
    renderServices();
    return payload;
  }).catch((error) => {
    setConnection('error', '状态读取失败');
    showToast('状态读取失败', error.message, true);
    throw error;
  }).finally(() => { state.statusRequest = null; });
  return state.statusRequest;
}

async function loadOperations() {
  state.operations = await fetchJson('/api/operations');
  renderActivity();
  return state.operations;
}

async function refreshAll({ quiet = false } = {}) {
  try {
    if (!state.meta) await loadMeta();
    await Promise.all([loadStatus(), loadOperations()]);
    if (!quiet) showToast('状态已刷新', '条目运行状态已经同步');
  } catch (error) {
    if (!quiet) showToast('控制台暂时不可用', error.message, true);
  }
}

function showToast(title, detail = '', error = false) {
  const stack = $('#toast-stack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = `toast ${error ? 'error' : ''}`;
  const mark = document.createElement('span');
  mark.className = 'toast-icon';
  mark.innerHTML = icon(error ? 'alert-triangle' : 'check-circle-2');
  toast.appendChild(mark);
  const copy = document.createElement('div');
  copy.className = 'toast-copy';
  addText(copy, 'strong', title);
  if (detail) addText(copy, 'small', detail);
  toast.appendChild(copy);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.title = '关闭提示';
  close.innerHTML = icon('x');
  close.addEventListener('click', () => toast.remove());
  toast.appendChild(close);
  stack.appendChild(toast);
  window.setTimeout(() => toast.remove(), error ? 7000 : 4200);
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  showToast('已复制地址', value);
}

async function runAction(actionId) {
  if (!actionId || state.busy) return;
  state.busy = true;
  renderServices();
  const action = (state.meta?.actions || []).find((item) => item.id === actionId);
  try {
    const operation = await fetchJson(`/api/actions/${encodeURIComponent(actionId)}`, { method: 'POST' });
    showToast('操作已开始', action?.label || actionId);
    await waitForOperation(operation.id);
  } catch (error) {
    if (error.status === 409 && error.payload?.details?.operationId) {
      showToast('已有操作正在执行', '请等待当前操作完成', true);
    } else {
      showToast('无法执行操作', error.message, true);
    }
  } finally {
    state.busy = false;
    renderServices();
    await refreshAll({ quiet: true });
  }
}

async function waitForOperation(operationId) {
  let latest = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    latest = await fetchJson(`/api/operations/${operationId}`);
    if (latest.status !== 'running') {
      if (latest.status === 'succeeded') showToast('操作完成', latest.label || '条目状态已更新');
      else showToast('操作失败', latest.error || '请查看最近操作或条目日志', true);
      return latest;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1500));
  }
  throw new Error('操作等待超时，请查看最近操作记录');
}

async function openLogs(service) {
  const dialog = $('#logs-dialog');
  const content = $('#logs-content');
  const title = $('#logs-title');
  if (!dialog || !content) return;
  title.textContent = `${service.nameZh || service.name || service.id} · 日志`;
  content.innerHTML = '<div class="log-loading">正在读取日志…</div>';
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  try {
    const payload = await fetchJson(`/api/logs/${encodeURIComponent(service.id)}`);
    content.replaceChildren();
    if (!payload.files?.length) {
      addText(content, 'div', '这个条目暂时没有登记日志文件。', 'log-loading');
      return;
    }
    payload.files.forEach((file) => {
      const block = document.createElement('section');
      block.className = 'log-block';
      block.style.setProperty('--accent', service.accent || '#5eead4');
      addText(block, 'div', file.name, 'log-file-name');
      addText(block, 'pre', file.content || '(暂无内容)');
      content.appendChild(block);
    });
  } catch (error) {
    content.replaceChildren();
    addText(content, 'div', `读取失败：${error.message}`, 'log-loading');
  }
}

function bindEvents() {
  hydrateIcons();
  $$('[data-section]').forEach((button) => button.addEventListener('click', () => {
    state.section = button.dataset.section;
    $$('[data-section]').forEach((item) => item.classList.toggle('is-selected', item === button));
    const heading = $('#toolbar-heading');
    if (heading) heading.textContent = state.section === 'agents' ? 'Agent 工具' : '服务总览';
    renderServices();
  }));
  $$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.filter;
    $$('[data-filter]').forEach((item) => item.classList.toggle('is-selected', item === button));
    renderServices();
  }));
  $('#service-search')?.addEventListener('input', (event) => {
    state.query = event.target.value.trim();
    renderServices();
  });
  $$('[data-global-action]').forEach((button) => button.addEventListener('click', () => runAction(button.dataset.globalAction)));
  $('[data-action="refresh"]')?.addEventListener('click', () => refreshAll());
  $('[data-action="refresh-activity"]')?.addEventListener('click', () => loadOperations().catch((error) => showToast('操作记录读取失败', error.message, true)));
  $('[data-action="close-dialog"]')?.addEventListener('click', () => $('#logs-dialog')?.close());
  $('#logs-dialog')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
}

async function boot() {
  bindEvents();
  try {
    await loadMeta();
    renderServices();
    await Promise.all([loadStatus(), loadOperations()]);
  } catch {
    // The connection toast already explains the failure; keep the shell usable.
  }
  window.setInterval(() => refreshAll({ quiet: true }), 10000);
}

window.addEventListener('DOMContentLoaded', boot);
