// ═══════════════════════════════════════════════════════════════════════════
// NodeUxPlay — Renderer Process (Multi-Instance)
// ═══════════════════════════════════════════════════════════════════════════

const MAX_INSTANCES = 12;
const RECOMMENDED_MAX = 1;

// ─── Instance Data Model ─────────────────────────────────────────────────────
let instances = [];
let nextId = 1;
let activeInstanceId = null; // currently viewed instance
let activeView = 'setup';    // 'setup' | 'dashboard' | 'instance'
let activeInnerTab = 'server';
let allDepsReady = false;
let instanceStatuses = {};   // id -> 'running' | 'stopped'

// Form field lists for save / load
const SETTING_INPUTS = [
  'opt-n', 'opt-auth-value', 'opt-allow', 'opt-block',
  'opt-sw', 'opt-sh', 'opt-sr', 'opt-vs-custom', 'opt-vd', 'opt-vc', 'opt-vp', 'opt-fps',
  'opt-vsync-custom', 'opt-as-custom', 'opt-al', 'opt-vol', 'opt-async-custom',
  'opt-db', 'opt-ca-file', 'opt-md', 'opt-p-value', 'opt-m-value', 'opt-key', 'opt-dacp',
  'opt-lang', 'opt-mp4-file', 'opt-vrtp', 'opt-artp', 'opt-reset', 'opt-t', 'opt-rc',
];
const SETTING_SELECTS = [
  'opt-auth-mode', 'opt-vs', 'opt-as', 'opt-vsync', 'opt-async',
  'opt-ca-mode', 'opt-p-mode', 'opt-m-mode', 'opt-hls', 'opt-d', 'opt-f', 'opt-r',
];
const SETTING_CHECKBOXES = [
  'opt-nh', 'opt-reg', 'opt-restrict', 'opt-fs', 'opt-o', 'opt-h265', 'opt-FPSdata',
  'opt-taper', 'opt-ble', 'opt-mp4-enable', 'opt-nc', 'opt-nohold', 'opt-nofreeze',
  'opt-avdec', 'opt-v4l2', 'opt-bt709', 'opt-vdmp', 'opt-admp',
  'opt-autostart',
];

function getDefaultSettings() {
  const s = {};
  SETTING_INPUTS.forEach(k => s[k] = '');
  SETTING_SELECTS.forEach(k => s[k] = '');
  SETTING_CHECKBOXES.forEach(k => s[k] = false);
  s['opt-auth-mode'] = 'none';
  return s;
}

function createInstance(name) {
  const id = String(nextId++);
  const inst = { id, name: name || `Instance ${id}`, settings: getDefaultSettings(), log: [] };
  instances.push(inst);
  instanceStatuses[id] = 'stopped';
  return inst;
}

function getInstanceById(id) {
  return instances.find(i => i.id === id);
}

// ─── Settings Save / Load (between form <-> instance object) ─────────────────
function saveCurrentFormToInstance() {
  if (!activeInstanceId) return;
  const inst = getInstanceById(activeInstanceId);
  if (!inst) return;
  SETTING_INPUTS.forEach(k => {
    const el = document.getElementById(k);
    if (el) inst.settings[k] = el.value;
  });
  SETTING_SELECTS.forEach(k => {
    const el = document.getElementById(k);
    if (el) inst.settings[k] = el.value;
  });
  SETTING_CHECKBOXES.forEach(k => {
    const el = document.getElementById(k);
    if (el) inst.settings[k] = el.checked;
  });
}

function loadInstanceToForm(inst) {
  if (!inst) return;
  SETTING_INPUTS.forEach(k => {
    const el = document.getElementById(k);
    if (el) el.value = inst.settings[k] || '';
  });
  SETTING_SELECTS.forEach(k => {
    const el = document.getElementById(k);
    if (el) el.value = inst.settings[k] || '';
  });
  SETTING_CHECKBOXES.forEach(k => {
    const el = document.getElementById(k);
    if (el) el.checked = !!inst.settings[k];
  });
  // Trigger conditional field visibility
  refreshConditionalFields();
  updateCommandPreview();
}

// ─── Persistence ─────────────────────────────────────────────────────────────
async function saveAllInstances() {
  saveCurrentFormToInstance();
  // Strip runtime-only log arrays from persisted data
  const cleanInstances = instances.map(i => ({ id: i.id, name: i.name, settings: i.settings }));
  const data = { nextId, instances: cleanInstances };
  await api.saveInstances(data);
}

async function loadAllInstances() {
  const data = await api.loadInstances();
  if (data && data.instances && data.instances.length > 0) {
    instances = data.instances;
    nextId = data.nextId || (Math.max(...instances.map(i => parseInt(i.id))) + 1);
    instances.forEach(i => {
      instanceStatuses[i.id] = 'stopped';
      i.log = i.log || [];
    });
  } else {
    instances = [];
    nextId = 1;
    createInstance('Instance 1');
  }
}

// ─── View Switching ──────────────────────────────────────────────────────────
function switchView(view, instanceId) {
  // Save current instance before switching away
  if (activeView === 'instance') {
    saveCurrentFormToInstance();
  }

  activeView = view;

  // Update sidebar highlights
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.nav-instance-btn').forEach(b => b.classList.remove('active'));

  if (view === 'setup' || view === 'dashboard' || view === 'settings') {
    const btn = document.querySelector(`.nav-btn[data-view="${view}"]`);
    if (btn) btn.classList.add('active');
    activeInstanceId = null;
  }

  // Tab content visibility
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

  // Action bar visibility
  const actionBar = document.getElementById('action-bar');

  if (view === 'setup') {
    document.getElementById('tab-setup').classList.add('active');
    actionBar.style.display = 'none';
  } else if (view === 'dashboard') {
    document.getElementById('tab-dashboard').classList.add('active');
    actionBar.style.display = 'none';
    refreshDashboard();
  } else if (view === 'settings') {
    document.getElementById('tab-settings').classList.add('active');
    actionBar.style.display = 'none';
  } else if (view === 'instance' && instanceId) {
    activeInstanceId = instanceId;
    const inst = getInstanceById(instanceId);
    if (!inst) return;

    // Highlight sidebar instance
    const instBtn = document.querySelector(`.nav-instance-btn[data-instance-id="${instanceId}"]`);
    if (instBtn) instBtn.classList.add('active');

    document.getElementById('tab-instance').classList.add('active');
    document.getElementById('instance-title').textContent = inst.name;
    updateInstanceBadge(instanceId);
    loadInstanceToForm(inst);
    actionBar.style.display = 'flex';
    updateRunButtons();
  }

  // Refresh output panel to show logs relevant to the current view
  refreshOutputPanel();
}

// ─── Inner Tab Navigation ────────────────────────────────────────────────────
document.querySelectorAll('.inner-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.itab;
    activeInnerTab = tab;
    document.querySelectorAll('.inner-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.inner-tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`itab-${tab}`).classList.add('active');
  });
});

// ─── Sidebar Navigation (Setup / Dashboard) ─────────────────────────────────
document.querySelectorAll('.nav-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    switchView(btn.dataset.view);
  });
});

// ─── Sidebar: Instance List (with drag-to-reorder) ───────────────────────────
let dragSrcIndex = null;

function refreshSidebar() {
  const container = document.getElementById('nav-instances');
  container.innerHTML = '';

  instances.forEach((inst, idx) => {
    const btn = document.createElement('button');
    btn.className = 'nav-instance-btn' + (inst.id === activeInstanceId ? ' active' : '');
    btn.dataset.instanceId = inst.id;
    btn.draggable = true;

    const status = instanceStatuses[inst.id] || 'stopped';
    const dotClass = status === 'running' ? 'running' : 'stopped';

    btn.innerHTML = `
      <svg class="drag-handle" viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>
      <div class="inst-dot ${dotClass}"></div>
      <span class="inst-name">${inst.name}</span>
    `;

    btn.addEventListener('click', () => switchView('instance', inst.id));

    // Drag events
    btn.addEventListener('dragstart', (e) => {
      dragSrcIndex = idx;
      btn.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    btn.addEventListener('dragend', () => {
      btn.classList.remove('dragging');
      container.querySelectorAll('.nav-instance-btn').forEach(b => b.classList.remove('drag-over-above', 'drag-over-below'));
      dragSrcIndex = null;
    });
    btn.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = btn.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      container.querySelectorAll('.nav-instance-btn').forEach(b => b.classList.remove('drag-over-above', 'drag-over-below'));
      if (e.clientY < mid) btn.classList.add('drag-over-above');
      else btn.classList.add('drag-over-below');
    });
    btn.addEventListener('dragleave', () => {
      btn.classList.remove('drag-over-above', 'drag-over-below');
    });
    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      const rect = btn.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      let targetIdx = e.clientY < mid ? idx : idx + 1;
      if (dragSrcIndex !== null && dragSrcIndex !== targetIdx && dragSrcIndex !== targetIdx - 1) {
        const [moved] = instances.splice(dragSrcIndex, 1);
        if (targetIdx > dragSrcIndex) targetIdx--;
        instances.splice(targetIdx, 0, moved);
        refreshSidebar();
        saveAllInstances();
        if (activeView === 'dashboard') refreshDashboard();
      }
      container.querySelectorAll('.nav-instance-btn').forEach(b => b.classList.remove('drag-over-above', 'drag-over-below'));
      dragSrcIndex = null;
    });

    container.appendChild(btn);
  });

  // Update add button state
  const addBtn = document.getElementById('btn-add-instance');
  addBtn.disabled = instances.length >= MAX_INSTANCES;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
function refreshDashboard() {
  const grid = document.getElementById('instance-grid');
  grid.innerHTML = '';

  document.getElementById('dashboard-count').textContent =
    `${instances.length} / ${MAX_INSTANCES} instances` +
    (instances.length > RECOMMENDED_MAX ? ` (recommended max: ${RECOMMENDED_MAX}). Currently UxPlay can only handle one client at a time, so multiple instances may cause issues.)` : '');

  const runningCount = Object.values(instanceStatuses).filter(s => s === 'running').length;
  document.getElementById('btn-start-all').disabled = !allDepsReady || runningCount === instances.length;
  document.getElementById('btn-stop-all').disabled = runningCount === 0;

  instances.forEach(inst => {
    const status = instanceStatuses[inst.id] || 'stopped';
    const isRunning = status === 'running';
    const card = document.createElement('div');
    card.className = 'instance-card';
    card.dataset.instanceId = inst.id;

    // Build cmd preview for this instance
    const args = buildArgsFromSettings(inst.settings);
    const cmd = 'uxplay' + (args.length ? ' ' + args.join(' ') : '');

    card.innerHTML = `
      <div class="instance-card-header">
        <div class="instance-card-status">
          <div class="status-dot ${isRunning ? 'running' : 'stopped'}"></div>
          <span class="instance-card-name">${inst.name}</span>
        </div>
        <span class="instance-card-state ${isRunning ? 'running' : ''}">${isRunning ? 'Running' : 'Stopped'}</span>
      </div>
      <div class="instance-card-cmd"><code>${cmd}</code></div>
      <div class="instance-card-actions">
        ${isRunning
          ? `<button class="btn btn-sm btn-danger" onclick="stopInstance('${inst.id}')">Stop</button>`
          : `<button class="btn btn-sm btn-success" onclick="startInstance('${inst.id}')" ${!allDepsReady ? 'disabled' : ''}>Start</button>`
        }
        <button class="btn btn-sm" onclick="switchView('instance', '${inst.id}')">Configure</button>
        <button class="btn btn-sm" onclick="cloneInstance('${inst.id}')">Clone</button>
        <button class="btn btn-sm btn-danger" onclick="removeInstance('${inst.id}')" ${isRunning ? 'disabled' : ''}>Remove</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ─── Instance Management ─────────────────────────────────────────────────────
function addInstance() {
  if (instances.length >= MAX_INSTANCES) {
    appendLog(`✗ Maximum of ${MAX_INSTANCES} instances reached.`);
    return;
  }
  if (instances.length >= RECOMMENDED_MAX) {
    appendLog(`⚠ You now have ${instances.length + 1} instances. Recommended max is ${RECOMMENDED_MAX}.`);
  }
  const inst = createInstance();
  refreshSidebar();
  saveAllInstances();
  switchView('instance', inst.id);
}

function cloneInstance(id) {
  if (instances.length >= MAX_INSTANCES) {
    appendLog(`✗ Maximum of ${MAX_INSTANCES} instances reached.`);
    return;
  }
  const source = getInstanceById(id);
  if (!source) return;

  // If cloning the currently viewed instance, save form first
  if (id === activeInstanceId) saveCurrentFormToInstance();

  const inst = createInstance(source.name + ' (copy)');
  inst.settings = JSON.parse(JSON.stringify(source.settings));
  refreshSidebar();
  saveAllInstances();
  switchView('instance', inst.id);
}

function cloneCurrentInstance() {
  if (activeInstanceId) cloneInstance(activeInstanceId);
}

async function removeInstance(id) {
  const inst = getInstanceById(id);
  if (!inst) return;
  if (instanceStatuses[id] === 'running') {
    appendLog('✗ Cannot remove a running instance. Stop it first.');
    return;
  }
  const prefs = loadPrefs();
  if (prefs.confirmRemove) {
    const ok = await showConfirmDialog('Remove Instance', `Remove "${inst.name}"? This cannot be undone.`, { confirmLabel: 'Remove', danger: true });
    if (!ok) return;
  }

  instances = instances.filter(i => i.id !== id);
  delete instanceStatuses[id];

  // Ensure at least one instance
  if (instances.length === 0) {
    createInstance('Instance 1');
  }

  refreshSidebar();
  saveAllInstances();

  // If we removed the active instance, switch to dashboard
  if (activeInstanceId === id) {
    switchView('dashboard');
  }
  if (activeView === 'dashboard') refreshDashboard();
}

function removeCurrentInstance() {
  if (activeInstanceId) removeInstance(activeInstanceId);
}

function renameCurrentInstance() {
  if (!activeInstanceId) return;
  const inst = getInstanceById(activeInstanceId);
  if (!inst) return;

  const titleEl = document.getElementById('instance-title');
  // Prevent double-activation
  if (titleEl.querySelector('.rename-input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'rename-input';
  input.value = inst.name;
  input.maxLength = 40;

  const commit = () => {
    const newName = input.value.trim();
    if (newName && newName !== inst.name) {
      inst.name = newName;
      refreshSidebar();
      saveAllInstances();
    }
    titleEl.textContent = inst.name;
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = inst.name; input.blur(); }
  });

  titleEl.textContent = '';
  titleEl.appendChild(input);
  input.focus();
  input.select();
}

// ─── Instance Status Badge ───────────────────────────────────────────────────
function updateInstanceBadge(id) {
  const badge = document.getElementById('instance-badge');
  if (!badge) return;
  const status = instanceStatuses[id] || 'stopped';
  badge.textContent = status === 'running' ? 'Running' : 'Stopped';
  badge.className = 'instance-badge ' + (status === 'running' ? 'running' : '');
}

// ─── Logging (per-view buffered output) ──────────────────────────────────────
const outputContent = document.getElementById('output-content');
const outputBody = document.getElementById('output-body');
let globalLog = []; // shared buffer for Setup & Dashboard views

// Returns the log buffer for the currently active view
function getActiveLogBuffer() {
  if (activeView === 'instance' && activeInstanceId) {
    const inst = getInstanceById(activeInstanceId);
    if (inst) return inst.log;
  }
  return globalLog;
}

// Create a styled DOM element for a log message
function createLogLineEl(msg) {
  const line = document.createElement('div');
  line.className = 'log-line';
  const text = String(msg).trimEnd();
  if (text.startsWith('✓')) line.classList.add('success');
  else if (text.startsWith('✗')) line.classList.add('error');
  else if (text.startsWith('⚠')) line.classList.add('warn');
  else if (text.includes('...') || text.startsWith('─')) line.classList.add('info');
  line.textContent = text;
  return line;
}

// Append a message to a specific buffer; render it only if that buffer is active
function appendToBuffer(buffer, msg) {
  buffer.push(msg);
  if (buffer === getActiveLogBuffer()) {
    outputContent.appendChild(createLogLineEl(msg));
    outputBody.scrollTop = outputBody.scrollHeight;
  }
}

// Append a log message to whichever view is currently active
function appendLog(msg) {
  appendToBuffer(getActiveLogBuffer(), msg);
}

// Re-render the output panel with the active view's log buffer
function refreshOutputPanel() {
  outputContent.innerHTML = '';
  const buffer = getActiveLogBuffer();
  buffer.forEach(msg => {
    outputContent.appendChild(createLogLineEl(msg));
  });
  outputBody.scrollTop = outputBody.scrollHeight;
}

// Clear only the active view's log buffer
function clearLog() {
  const buffer = getActiveLogBuffer();
  buffer.length = 0;
  outputContent.innerHTML = '';
}

function toggleOutput() { document.getElementById('output-panel').classList.toggle('collapsed'); }

// Route incoming logs from the main process:
// Messages prefixed with [#id] go to that instance's buffer;
// everything else goes to the global buffer (Setup / Dashboard).
api.onLog((msg) => {
  const str = String(msg);
  const match = str.match(/^\[#(\d+)\]\s*/);
  if (match) {
    const instanceId = match[1];
    const inst = getInstanceById(instanceId);
    if (inst) {
      // Strip the [#id] prefix for cleaner per-instance output
      const cleanMsg = str.replace(/^\[#\d+\]\s*/, '');
      appendToBuffer(inst.log, cleanMsg);
      return;
    }
  }
  // No instance prefix → global log
  appendToBuffer(globalLog, str);
});

api.onProgress(({ id, percent }) => {
  if (currentSetupStep > 0) setStepProgress(currentSetupStep, percent);
});

// ─── Setup Overlay ──────────────────────────────────────────────────────────
let currentSetupStep = 0;
let isInstalling = false;

function toggleOverlayMinimize() {
  const overlay = document.getElementById('setup-overlay');
  const isMinimized = overlay.classList.toggle('minimized');
  document.getElementById('overlay-toggle-icon-min').style.display = isMinimized ? 'none' : '';
  document.getElementById('overlay-toggle-icon-max').style.display = isMinimized ? '' : 'none';
  document.getElementById('overlay-toggle-label').textContent = isMinimized ? 'Expand' : 'Minimize';
  document.getElementById('overlay-toggle-btn').title = isMinimized ? 'Expand' : 'Minimize';
  const wrapper = document.querySelector('.main-wrapper');
  if (isMinimized) wrapper.classList.remove('app-installing');
  else wrapper.classList.add('app-installing');
}

function showSetupOverlay(title, desc) {
  isInstalling = true;
  currentSetupStep = 0;
  const overlay = document.getElementById('setup-overlay');
  overlay.classList.remove('minimized');
  document.getElementById('overlay-toggle-icon-min').style.display = '';
  document.getElementById('overlay-toggle-icon-max').style.display = 'none';
  document.getElementById('overlay-toggle-label').textContent = 'Minimize';
  document.getElementById('overlay-toggle-btn').title = 'Minimize';
  document.getElementById('setup-overlay-title').textContent = title || 'Installing Dependencies...';
  document.getElementById('setup-overlay-desc').textContent = desc || 'Please wait. Do not close the application.';
  for (let i = 1; i <= 4; i++) {
    const step = document.querySelector(`.setup-step[data-step="${i}"]`);
    step.className = 'setup-step';
    document.getElementById(`step-${i}-badge`).textContent = 'Pending';
    document.getElementById(`step-${i}-fill`).style.width = '0%';
    document.getElementById(`step-${i}-fill`).classList.remove('indeterminate');
  }
  overlay.classList.add('visible');
  document.querySelector('.main-wrapper').classList.add('app-installing');
}

function hideSetupOverlay() {
  isInstalling = false;
  currentSetupStep = 0;
  const overlay = document.getElementById('setup-overlay');
  overlay.classList.remove('visible', 'minimized');
  document.querySelector('.main-wrapper').classList.remove('app-installing');
}

function setStepState(stepNum, state, badgeText) {
  const step = document.querySelector(`.setup-step[data-step="${stepNum}"]`);
  step.className = 'setup-step ' + state;
  document.getElementById(`step-${stepNum}-badge`).textContent = badgeText || state;
  const fill = document.getElementById(`step-${stepNum}-fill`);
  if (state === 'active') { fill.classList.add('indeterminate'); currentSetupStep = stepNum; }
  else fill.classList.remove('indeterminate');
  if (state === 'completed') fill.style.width = '100%';
}

function setStepProgress(stepNum, percent) {
  const fill = document.getElementById(`step-${stepNum}-fill`);
  if (percent > 0 && percent <= 100) {
    fill.classList.remove('indeterminate');
    fill.style.width = percent + '%';
    document.getElementById(`step-${stepNum}-badge`).textContent = percent + '%';
  }
}

// ─── UxPlay Status ──────────────────────────────────────────────────────────
api.onUxplayStatus((instanceId, status) => {
  instanceStatuses[instanceId] = status;

  // Update sidebar dot
  const sidebarBtn = document.querySelector(`.nav-instance-btn[data-instance-id="${instanceId}"]`);
  if (sidebarBtn) {
    const dot = sidebarBtn.querySelector('.inst-dot');
    dot.className = 'inst-dot ' + (status === 'running' ? 'running' : 'stopped');
  }

  // Update instance view if active
  if (activeInstanceId === instanceId && activeView === 'instance') {
    updateInstanceBadge(instanceId);
    updateRunButtons();
  }

  // Update dashboard if visible
  if (activeView === 'dashboard') {
    refreshDashboard();
  }
});

function updateRunButtons() {
  if (!activeInstanceId) return;
  const status = instanceStatuses[activeInstanceId] || 'stopped';
  const isRunning = status === 'running';
  document.getElementById('btn-start').disabled = isRunning || !allDepsReady;
  document.getElementById('btn-stop').disabled = !isRunning;
}

// ─── Dependency Checks ──────────────────────────────────────────────────────
function setDepStatus(id, status, symbol) {
  const card = document.getElementById(id);
  if (!card) return;
  const statusEl = card.querySelector('.dep-status');
  statusEl.dataset.status = status;
  statusEl.textContent = symbol || (
    status === 'ok' ? '✓' : status === 'missing' ? '✗' :
    status === 'warn' ? '!' : status === 'loading' ? '⟳' : '?'
  );
}

async function checkDeps() {
  appendLog('Checking dependencies...');
  ['dep-msys2', 'dep-bonjour', 'dep-build', 'dep-uxplay'].forEach(id => setDepStatus(id, 'loading'));

  const deps = await api.checkDependencies();

  setDepStatus('dep-msys2', deps.msys2 ? 'ok' : 'missing');
  setDepStatus('dep-bonjour', deps.bonjourSdk ? 'ok' : 'missing');
  setDepStatus('dep-build',
    (deps.buildTools && deps.dependencies && deps.gstPlugins) ? 'ok' : 'missing'
  );

  if (deps.uxplay) {
    const outdated = deps.latestVersion && deps.installedVersion &&
      deps.installedVersion !== deps.latestVersion;
    setDepStatus('dep-uxplay', outdated ? 'warn' : 'ok');
    const vi = document.getElementById('uxplay-version-info');
    vi.textContent = outdated
      ? `Installed: ${deps.installedVersion} → Latest: ${deps.latestVersion}`
      : `Version ${deps.installedVersion || 'unknown'} (up to date)`;
  } else {
    setDepStatus('dep-uxplay', 'missing');
    const vi = document.getElementById('uxplay-version-info');
    vi.textContent = deps.latestVersion ? `Not installed (latest: ${deps.latestVersion})` : 'Not installed';
  }

  allDepsReady = deps.msys2 && deps.bonjourSdk && deps.buildTools &&
    deps.dependencies && deps.gstPlugins && deps.uxplay;
  updateRunButtons();

  return deps;
}

// ─── Install Actions ─────────────────────────────────────────────────────────
async function installMsys2() {
  showSetupOverlay('Installing MSYS2...', 'Downloading and setting up the build environment.');
  setStepState(1, 'active', 'Installing...');
  for (let i = 2; i <= 4; i++) setStepState(i, '', 'Pending');
  setDepStatus('dep-msys2', 'loading');
  appendLog('Starting MSYS2 installation...');
  const ok = await api.installMsys2();
  setDepStatus('dep-msys2', ok ? 'ok' : 'missing');
  setStepState(1, ok ? 'completed' : 'failed', ok ? 'Done' : 'Failed');
  hideSetupOverlay();
  if (ok) await checkDeps();
}

async function installBonjour() {
  setDepStatus('dep-bonjour', 'loading');
  await api.installBonjour();
  setTimeout(() => checkDeps(), 5000);
}

async function installPackages() {
  showSetupOverlay('Installing Packages...', 'Installing build tools and dependencies via pacman.');
  setStepState(1, 'completed', 'Done');
  setStepState(2, 'completed', 'Done');
  setStepState(3, 'active', 'Installing...');
  setStepState(4, '', 'Pending');
  setDepStatus('dep-build', 'loading');
  appendLog('Installing MSYS2 packages...');
  const ok = await api.installPackages();
  setDepStatus('dep-build', ok ? 'ok' : 'missing');
  setStepState(3, ok ? 'completed' : 'failed', ok ? 'Done' : 'Failed');
  hideSetupOverlay();
}

async function buildUxplay() {
  showSetupOverlay('Building UxPlay...', 'Compiling UxPlay from source code.');
  for (let i = 1; i <= 3; i++) setStepState(i, 'completed', 'Done');
  setStepState(4, 'active', 'Building...');
  setDepStatus('dep-uxplay', 'loading');
  appendLog('Building UxPlay from source...');
  const ok = await api.buildUxplay();
  setDepStatus('dep-uxplay', ok ? 'ok' : 'missing');
  setStepState(4, ok ? 'completed' : 'failed', ok ? 'Done' : 'Failed');
  hideSetupOverlay();
  if (ok) await checkDeps();
}

async function runFullSetup() {
  appendLog('═══ Starting Full Auto Setup ═══');
  showSetupOverlay('Full Auto Setup', 'Installing all dependencies and building UxPlay.');

  const deps = await checkDeps();

  if (!deps.msys2) {
    setStepState(1, 'active', 'Downloading...');
    appendLog('\n── Step 1/4: Installing MSYS2 ──');
    const ok = await api.installMsys2();
    if (!ok) { setStepState(1, 'failed', 'Failed'); appendLog('✗ Setup aborted.'); await checkDeps(); hideSetupOverlay(); return; }
    setStepState(1, 'completed', 'Done');
  } else {
    setStepState(1, 'completed', 'Installed');
    appendLog('── Step 1/4: MSYS2 ✓ ──');
  }

  if (!deps.bonjourSdk) {
    setStepState(2, 'skipped', 'Manual');
    appendLog('\n── Step 2/4: Bonjour SDK ──');
    appendLog('⚠ Bonjour SDK must be installed manually.');
    await api.installBonjour();
    appendLog('Please install, then click "Full Auto Setup" again.');
    await checkDeps(); hideSetupOverlay(); return;
  } else {
    setStepState(2, 'completed', 'Installed');
    appendLog('── Step 2/4: Bonjour SDK ✓ ──');
  }

  if (!deps.buildTools || !deps.dependencies || !deps.gstPlugins) {
    setStepState(3, 'active', 'Installing...');
    appendLog('\n── Step 3/4: Installing packages ──');
    const ok = await api.installPackages();
    if (!ok) { setStepState(3, 'failed', 'Failed'); appendLog('✗ Setup aborted.'); await checkDeps(); hideSetupOverlay(); return; }
    setStepState(3, 'completed', 'Done');
  } else {
    setStepState(3, 'completed', 'Installed');
    appendLog('── Step 3/4: Packages ✓ ──');
  }

  const needsBuild = !deps.uxplay || (deps.latestVersion && deps.installedVersion && deps.installedVersion !== deps.latestVersion);
  if (needsBuild) {
    setStepState(4, 'active', 'Building...');
    appendLog('\n── Step 4/4: Building UxPlay ──');
    const ok = await api.buildUxplay();
    if (!ok) { setStepState(4, 'failed', 'Failed'); appendLog('✗ Setup aborted.'); await checkDeps(); hideSetupOverlay(); return; }
    setStepState(4, 'completed', 'Done');
  } else {
    setStepState(4, 'completed', 'Up to date');
    appendLog('── Step 4/4: UxPlay ✓ ──');
  }

  appendLog('\n═══ Setup Complete! ═══');
  appendLog('Switch to Dashboard or an instance to start UxPlay.');
  await new Promise(r => setTimeout(r, 1500));
  hideSetupOverlay();
  await checkDeps();
}

// ─── Browse file helper ──────────────────────────────────────────────────────
async function browseFile(inputId) {
  const filepath = await api.selectFile();
  if (filepath) {
    document.getElementById(inputId).value = filepath;
    updateCommandPreview();
  }
}

// ─── Conditional field visibility ────────────────────────────────────────────
function setupConditionalFields() {
  const authMode = document.getElementById('opt-auth-mode');
  const authGroup = document.getElementById('auth-value-group');
  const authLabel = document.getElementById('auth-value-label');
  const authHint = document.getElementById('auth-value-hint');
  authMode.addEventListener('change', () => {
    const val = authMode.value;
    authGroup.style.display = val === 'none' ? 'none' : 'flex';
    if (val === 'pin') { authLabel.textContent = 'PIN Code'; authHint.textContent = 'Leave empty for random PIN (4 digits)'; document.getElementById('opt-auth-value').placeholder = 'e.g. 1234'; }
    else if (val === 'pw') { authLabel.textContent = 'Password'; authHint.textContent = 'Min 6 chars.'; document.getElementById('opt-auth-value').placeholder = 'Enter password'; }
    updateCommandPreview();
  });

  const vsSelect = document.getElementById('opt-vs');
  vsSelect.addEventListener('change', () => {
    document.getElementById('vs-custom-group').style.display = vsSelect.value === 'custom' ? 'flex' : 'none';
    updateCommandPreview();
  });

  const asSelect = document.getElementById('opt-as');
  asSelect.addEventListener('change', () => {
    document.getElementById('as-custom-group').style.display = asSelect.value === 'custom' ? 'flex' : 'none';
    updateCommandPreview();
  });

  const vsyncSelect = document.getElementById('opt-vsync');
  vsyncSelect.addEventListener('change', () => {
    document.getElementById('vsync-custom-group').style.display = vsyncSelect.value === 'custom' ? 'flex' : 'none';
    updateCommandPreview();
  });

  const asyncSelect = document.getElementById('opt-async');
  asyncSelect.addEventListener('change', () => {
    document.getElementById('async-custom-group').style.display = asyncSelect.value === 'custom' ? 'flex' : 'none';
    updateCommandPreview();
  });

  const caMode = document.getElementById('opt-ca-mode');
  caMode.addEventListener('change', () => {
    document.getElementById('ca-file-group').style.display = caMode.value === 'file' ? 'flex' : 'none';
    updateCommandPreview();
  });

  const pMode = document.getElementById('opt-p-mode');
  pMode.addEventListener('change', () => {
    document.getElementById('port-value-group').style.display = (pMode.value === 'single' || pMode.value === 'custom') ? 'flex' : 'none';
    updateCommandPreview();
  });

  const mMode = document.getElementById('opt-m-mode');
  mMode.addEventListener('change', () => {
    document.getElementById('mac-custom-group').style.display = mMode.value === 'custom' ? 'flex' : 'none';
    updateCommandPreview();
  });

  const mp4Enable = document.getElementById('opt-mp4-enable');
  mp4Enable.addEventListener('change', () => {
    document.getElementById('mp4-file-group').style.display = mp4Enable.checked ? 'flex' : 'none';
    updateCommandPreview();
  });

  document.getElementById('opt-d').addEventListener('change', () => updateCommandPreview());
  document.getElementById('opt-hls').addEventListener('change', () => updateCommandPreview());
  document.getElementById('opt-f').addEventListener('change', () => updateCommandPreview());
  document.getElementById('opt-r').addEventListener('change', () => updateCommandPreview());
}

function refreshConditionalFields() {
  const authMode = document.getElementById('opt-auth-mode').value;
  document.getElementById('auth-value-group').style.display = authMode === 'none' ? 'none' : 'flex';
  document.getElementById('vs-custom-group').style.display = document.getElementById('opt-vs').value === 'custom' ? 'flex' : 'none';
  document.getElementById('as-custom-group').style.display = document.getElementById('opt-as').value === 'custom' ? 'flex' : 'none';
  document.getElementById('vsync-custom-group').style.display = document.getElementById('opt-vsync').value === 'custom' ? 'flex' : 'none';
  document.getElementById('async-custom-group').style.display = document.getElementById('opt-async').value === 'custom' ? 'flex' : 'none';
  document.getElementById('ca-file-group').style.display = document.getElementById('opt-ca-mode').value === 'file' ? 'flex' : 'none';
  const pMode = document.getElementById('opt-p-mode').value;
  document.getElementById('port-value-group').style.display = (pMode === 'single' || pMode === 'custom') ? 'flex' : 'none';
  document.getElementById('mac-custom-group').style.display = document.getElementById('opt-m-mode').value === 'custom' ? 'flex' : 'none';
  document.getElementById('mp4-file-group').style.display = document.getElementById('opt-mp4-enable').checked ? 'flex' : 'none';
}

// ─── Build Command Args ──────────────────────────────────────────────────────
// Build args from the form (for the currently active instance)
function buildArgs() {
  return buildArgsFromForm();
}

function buildArgsFromForm() {
  const args = [];
  const v = (id) => document.getElementById(id)?.value?.trim() || '';
  const c = (id) => document.getElementById(id)?.checked || false;

  // Server
  if (v('opt-n')) args.push('-n', v('opt-n'));
  if (c('opt-nh')) args.push('-nh');
  const authMode = v('opt-auth-mode');
  if (authMode === 'pin') { args.push('-pin'); if (v('opt-auth-value')) args.push(v('opt-auth-value')); }
  else if (authMode === 'pw') { args.push('-pw'); if (v('opt-auth-value')) args.push(v('opt-auth-value')); }
  if (c('opt-reg')) args.push('-reg');
  if (c('opt-restrict')) args.push('-restrict');
  const allowIds = v('opt-allow');
  if (allowIds) allowIds.split(',').map(s => s.trim()).filter(Boolean).forEach(id => args.push('-allow', id));
  const blockIds = v('opt-block');
  if (blockIds) blockIds.split(',').map(s => s.trim()).filter(Boolean).forEach(id => args.push('-block', id));

  // Display
  const sw = v('opt-sw'), sh = v('opt-sh'), sr = v('opt-sr');
  if (sw && sh) { let r = `${sw}x${sh}`; if (sr) r += `@${sr}`; args.push('-s', r); }
  const vs = v('opt-vs');
  if (vs === 'custom') { if (v('opt-vs-custom')) args.push('-vs', v('opt-vs-custom')); }
  else if (vs) args.push('-vs', vs);
  if (v('opt-vd')) args.push('-vd', v('opt-vd'));
  if (v('opt-vc')) args.push('-vc', v('opt-vc'));
  if (v('opt-vp')) args.push('-vp', v('opt-vp'));
  if (v('opt-fps')) args.push('-fps', v('opt-fps'));
  if (c('opt-fs')) args.push('-fs');
  if (c('opt-o')) args.push('-o');
  if (c('opt-h265')) args.push('-h265');
  if (c('opt-FPSdata')) args.push('-FPSdata');
  if (v('opt-f')) args.push('-f', v('opt-f'));
  if (v('opt-r')) args.push('-r', v('opt-r'));
  const vsync = v('opt-vsync');
  if (vsync === 'no') args.push('-vsync', 'no');
  else if (vsync === 'custom' && v('opt-vsync-custom')) args.push('-vsync', v('opt-vsync-custom'));

  // Audio
  const as_ = v('opt-as');
  if (as_ === 'custom') { if (v('opt-as-custom')) args.push('-as', v('opt-as-custom')); }
  else if (as_) args.push('-as', as_);
  if (v('opt-al')) args.push('-al', v('opt-al'));
  if (v('opt-vol')) args.push('-vol', v('opt-vol'));
  const asyncMode = v('opt-async');
  if (asyncMode === 'on') args.push('-async');
  else if (asyncMode === 'no') args.push('-async', 'no');
  else if (asyncMode === 'custom' && v('opt-async-custom')) args.push('-async', v('opt-async-custom'));
  if (v('opt-db')) args.push('-db', v('opt-db'));
  if (c('opt-taper')) args.push('-taper');
  const caMode = v('opt-ca-mode');
  if (caMode === 'display') args.push('-ca');
  else if (caMode === 'file') { args.push('-ca'); if (v('opt-ca-file')) args.push(v('opt-ca-file')); }
  if (v('opt-md')) args.push('-md', v('opt-md'));

  // Network
  const pMode = v('opt-p-mode');
  if (pMode === 'legacy') args.push('-p');
  else if ((pMode === 'single' || pMode === 'custom') && v('opt-p-value')) args.push('-p', v('opt-p-value'));
  const mMode = v('opt-m-mode');
  if (mMode === 'random') args.push('-m');
  else if (mMode === 'custom') { if (v('opt-m-value')) args.push('-m', v('opt-m-value')); else args.push('-m'); }
  if (v('opt-key')) args.push('-key', v('opt-key'));
  if (v('opt-dacp')) args.push('-dacp', v('opt-dacp'));
  if (c('opt-ble')) args.push('-ble');

  // Streaming
  if (v('opt-hls')) args.push('-hls', v('opt-hls'));
  if (v('opt-lang')) args.push('-lang', v('opt-lang'));
  if (c('opt-mp4-enable')) { args.push('-mp4'); if (v('opt-mp4-file')) args.push(v('opt-mp4-file')); }
  if (v('opt-vrtp')) args.push('-vrtp', v('opt-vrtp'));
  if (v('opt-artp')) args.push('-artp', v('opt-artp'));

  // Advanced
  if (c('opt-nc')) args.push('-nc');
  if (c('opt-nohold')) args.push('-nohold');
  if (c('opt-nofreeze')) args.push('-nofreeze');
  if (v('opt-reset')) args.push('-reset', v('opt-reset'));
  if (v('opt-t')) args.push('-t', v('opt-t'));
  if (c('opt-avdec')) args.push('-avdec');
  if (c('opt-v4l2')) args.push('-v4l2');
  if (c('opt-bt709')) args.push('-bt709');
  const debug = v('opt-d');
  if (debug === 'full') args.push('-d');
  else if (debug === '1') args.push('-d', '1');
  if (v('opt-rc')) args.push('-rc', v('opt-rc'));
  if (c('opt-vdmp')) args.push('-vdmp');
  if (c('opt-admp')) args.push('-admp');

  return args;
}

// Build args from a settings object (for dashboard / startAll)
function buildArgsFromSettings(settings) {
  const args = [];
  const v = (k) => settings[k] || '';
  const c = (k) => !!settings[k];

  if (v('opt-n')) args.push('-n', v('opt-n'));
  if (c('opt-nh')) args.push('-nh');
  const authMode = v('opt-auth-mode');
  if (authMode === 'pin') { args.push('-pin'); if (v('opt-auth-value')) args.push(v('opt-auth-value')); }
  else if (authMode === 'pw') { args.push('-pw'); if (v('opt-auth-value')) args.push(v('opt-auth-value')); }
  if (c('opt-reg')) args.push('-reg');
  if (c('opt-restrict')) args.push('-restrict');
  const allowIds = v('opt-allow');
  if (allowIds) allowIds.split(',').map(s => s.trim()).filter(Boolean).forEach(id => args.push('-allow', id));
  const blockIds = v('opt-block');
  if (blockIds) blockIds.split(',').map(s => s.trim()).filter(Boolean).forEach(id => args.push('-block', id));

  const sw = v('opt-sw'), sh = v('opt-sh'), sr = v('opt-sr');
  if (sw && sh) { let r = `${sw}x${sh}`; if (sr) r += `@${sr}`; args.push('-s', r); }
  const vs = v('opt-vs');
  if (vs === 'custom') { if (v('opt-vs-custom')) args.push('-vs', v('opt-vs-custom')); }
  else if (vs) args.push('-vs', vs);
  if (v('opt-vd')) args.push('-vd', v('opt-vd'));
  if (v('opt-vc')) args.push('-vc', v('opt-vc'));
  if (v('opt-vp')) args.push('-vp', v('opt-vp'));
  if (v('opt-fps')) args.push('-fps', v('opt-fps'));
  if (c('opt-fs')) args.push('-fs');
  if (c('opt-o')) args.push('-o');
  if (c('opt-h265')) args.push('-h265');
  if (c('opt-FPSdata')) args.push('-FPSdata');
  if (v('opt-f')) args.push('-f', v('opt-f'));
  if (v('opt-r')) args.push('-r', v('opt-r'));
  const vsync = v('opt-vsync');
  if (vsync === 'no') args.push('-vsync', 'no');
  else if (vsync === 'custom' && v('opt-vsync-custom')) args.push('-vsync', v('opt-vsync-custom'));

  const as_ = v('opt-as');
  if (as_ === 'custom') { if (v('opt-as-custom')) args.push('-as', v('opt-as-custom')); }
  else if (as_) args.push('-as', as_);
  if (v('opt-al')) args.push('-al', v('opt-al'));
  if (v('opt-vol')) args.push('-vol', v('opt-vol'));
  const asyncMode = v('opt-async');
  if (asyncMode === 'on') args.push('-async');
  else if (asyncMode === 'no') args.push('-async', 'no');
  else if (asyncMode === 'custom' && v('opt-async-custom')) args.push('-async', v('opt-async-custom'));
  if (v('opt-db')) args.push('-db', v('opt-db'));
  if (c('opt-taper')) args.push('-taper');
  const caMode = v('opt-ca-mode');
  if (caMode === 'display') args.push('-ca');
  else if (caMode === 'file') { args.push('-ca'); if (v('opt-ca-file')) args.push(v('opt-ca-file')); }
  if (v('opt-md')) args.push('-md', v('opt-md'));

  const pMode = v('opt-p-mode');
  if (pMode === 'legacy') args.push('-p');
  else if ((pMode === 'single' || pMode === 'custom') && v('opt-p-value')) args.push('-p', v('opt-p-value'));
  const mMode = v('opt-m-mode');
  if (mMode === 'random') args.push('-m');
  else if (mMode === 'custom') { if (v('opt-m-value')) args.push('-m', v('opt-m-value')); else args.push('-m'); }
  if (v('opt-key')) args.push('-key', v('opt-key'));
  if (v('opt-dacp')) args.push('-dacp', v('opt-dacp'));
  if (c('opt-ble')) args.push('-ble');

  if (v('opt-hls')) args.push('-hls', v('opt-hls'));
  if (v('opt-lang')) args.push('-lang', v('opt-lang'));
  if (c('opt-mp4-enable')) { args.push('-mp4'); if (v('opt-mp4-file')) args.push(v('opt-mp4-file')); }
  if (v('opt-vrtp')) args.push('-vrtp', v('opt-vrtp'));
  if (v('opt-artp')) args.push('-artp', v('opt-artp'));

  if (c('opt-nc')) args.push('-nc');
  if (c('opt-nohold')) args.push('-nohold');
  if (c('opt-nofreeze')) args.push('-nofreeze');
  if (v('opt-reset')) args.push('-reset', v('opt-reset'));
  if (v('opt-t')) args.push('-t', v('opt-t'));
  if (c('opt-avdec')) args.push('-avdec');
  if (c('opt-v4l2')) args.push('-v4l2');
  if (c('opt-bt709')) args.push('-bt709');
  const debug = v('opt-d');
  if (debug === 'full') args.push('-d');
  else if (debug === '1') args.push('-d', '1');
  if (v('opt-rc')) args.push('-rc', v('opt-rc'));
  if (c('opt-vdmp')) args.push('-vdmp');
  if (c('opt-admp')) args.push('-admp');

  return args;
}

// ─── Command Preview ─────────────────────────────────────────────────────────
function updateCommandPreview() {
  const args = buildArgs();
  const cmd = 'uxplay' + (args.length ? ' ' + args.join(' ') : '');
  document.getElementById('cmd-text').textContent = cmd;
}

// ─── Start / Stop (per-instance) ─────────────────────────────────────────────
async function startCurrentInstance() {
  if (!activeInstanceId) return;
  saveCurrentFormToInstance();
  const args = buildArgs();
  appendLog('');
  await api.startUxplay(activeInstanceId, args);
  await saveAllInstances();
}

async function stopCurrentInstance() {
  if (!activeInstanceId) return;
  await api.stopUxplay(activeInstanceId);
}

async function startInstance(id) {
  const inst = getInstanceById(id);
  if (!inst) return;
  // If this is the active instance, save form first
  if (id === activeInstanceId && activeView === 'instance') saveCurrentFormToInstance();
  const args = buildArgsFromSettings(inst.settings);
  await api.startUxplay(id, args);
}

async function stopInstance(id) {
  await api.stopUxplay(id);
}

async function startAllInstances() {
  // Save current form if viewing an instance
  if (activeView === 'instance') saveCurrentFormToInstance();
  const entries = instances
    .filter(i => instanceStatuses[i.id] !== 'running')
    .map(i => ({ id: i.id, args: buildArgsFromSettings(i.settings) }));
  if (entries.length === 0) { appendLog('All instances are already running.'); return; }
  appendLog(`═══ Starting ${entries.length} instance(s) ═══`);
  await api.startAllUxplay(entries);
}

async function stopAllInstances() {
  appendLog('═══ Stopping all instances ═══');
  await api.stopAllUxplay();
}

// ─── Uninstall Functions ─────────────────────────────────────────────────────
async function uninstallMsys2() {
  const ok = await showConfirmDialog('Uninstall MSYS2', 'Remove MSYS2 and all its packages? This will also remove UxPlay.', { confirmLabel: 'Uninstall', danger: true });
  if (!ok) return;
  appendLog('Removing MSYS2...');
  setDepStatus('dep-msys2', 'loading');
  await api.uninstallMsys2();
  await checkDeps();
}

function uninstallBonjour() {
  appendLog('Opening Windows Settings to uninstall Bonjour SDK...');
  api.openExternal('ms-settings:appsfeatures');
  appendLog('⚠ Please search for "Bonjour" in the Apps list and uninstall it.');
}

async function uninstallPackages() {
  const ok = await showConfirmDialog('Uninstall Packages', 'Remove all installed MSYS2 packages?', { confirmLabel: 'Uninstall', danger: true });
  if (!ok) return;
  appendLog('Removing packages...');
  setDepStatus('dep-build', 'loading');
  await api.uninstallPackages();
  await checkDeps();
}

async function uninstallUxplayOnly() {
  const ok = await showConfirmDialog('Uninstall UxPlay', 'Remove UxPlay binary and source?', { confirmLabel: 'Uninstall', danger: true });
  if (!ok) return;
  appendLog('Removing UxPlay...');
  setDepStatus('dep-uxplay', 'loading');
  await api.uninstallUxplay();
  await checkDeps();
}

async function uninstallAll() {
  const confirmed = await showConfirmDialog('Uninstall Everything', 'This will remove MSYS2, all build tools, and UxPlay.\n\nBonjour SDK must be uninstalled separately.\n\nAre you sure?', { confirmLabel: 'Uninstall All', danger: true });
  if (!confirmed) return;
  showSetupOverlay('Uninstalling...', 'Removing all installed components.');
  for (let i = 1; i <= 4; i++) setStepState(i, 'active', 'Removing...');
  appendLog('═══ Uninstalling All ═══');
  const ok = await api.uninstallAll();
  for (let i = 1; i <= 4; i++) setStepState(i, ok ? 'completed' : 'failed', ok ? 'Removed' : 'Error');
  await new Promise(r => setTimeout(r, 1000));
  hideSetupOverlay();
  await checkDeps();
}

// ─── Info Dialogs ───────────────────────────────────────────────────────────
const infoTitles = {
  'dep-msys2': 'MSYS2',
  'dep-bonjour': 'Bonjour SDK',
  'dep-build': 'Build Tools & Dependencies',
  'dep-uxplay': 'UxPlay',
};

function showInfoDialog(title, text) {
  const backdrop = document.createElement('div');
  backdrop.className = 'info-dialog-backdrop';
  backdrop.innerHTML = `
    <div class="info-dialog">
      <div class="info-dialog-header">
        <h3>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
          ${title}
        </h3>
        <button class="info-dialog-close" id="info-dialog-close">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="info-dialog-body"></div>
    </div>
  `;
  backdrop.querySelector('.info-dialog-body').textContent = text;
  backdrop.querySelector('#info-dialog-close').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

function showConfirmDialog(title, message, { confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'info-dialog-backdrop';
    const btnClass = danger ? 'btn btn-danger' : 'btn btn-primary';
    backdrop.innerHTML = `
      <div class="info-dialog">
        <div class="info-dialog-header">
          <h3>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              ${danger
                ? '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
                : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
              }
            </svg>
            ${title}
          </h3>
          <button class="info-dialog-close" data-action="cancel">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="info-dialog-body confirm-body"></div>
        <div class="confirm-dialog-actions">
          <button class="btn" data-action="cancel">${cancelLabel}</button>
          <button class="${btnClass}" data-action="confirm">${confirmLabel}</button>
        </div>
      </div>
    `;
    backdrop.querySelector('.confirm-body').textContent = message;
    const close = (result) => { backdrop.remove(); resolve(result); };
    backdrop.querySelector('[data-action="confirm"]').addEventListener('click', () => close(true));
    backdrop.querySelectorAll('[data-action="cancel"]').forEach(b => b.addEventListener('click', () => close(false)));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-action="confirm"]').focus();
  });
}

function setupInfoTooltips() {
  document.querySelectorAll('.dep-info-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const text = btn.getAttribute('data-tooltip');
      if (!text) return;
      const card = btn.closest('.dep-card');
      const title = infoTitles[card?.id] || 'Info';
      showInfoDialog(title, text);
    });
  });
}

// ─── Setting Info Tags ───────────────────────────────────────────────────────
const settingInfoData = {
  // ── Server tab ──
  'opt-n': {
    tip: 'Name your AirPlay server as seen by iOS/macOS devices.',
    full: `-n server_name\n\nDefault: UxPlay. server_name@hostname will be the name that appears offering AirPlay services to your iPad, iPhone etc, where hostname is the name of the server running uxplay. This will also be the name shown above the mirror display window.\n\nInternationalized server names encoded as UTF-8 are accepted.`
  },
  'opt-nh': {
    tip: 'Omit the @hostname suffix from the server name.',
    full: `-nh\n\nDo not append "@hostname" at the end of the AirPlay server name. By default, the server name is displayed as "Name@hostname" to AirPlay clients.`
  },
  'opt-auth-mode': {
    tip: 'Choose how clients authenticate to connect.',
    full: `Authentication Modes:\n\n• None — Open access, any client can connect.\n\n• PIN (-pin [nnnn]) — Apple-style one-time pin authentication. A four-digit pin code is displayed on the terminal, and the client must enter it. When used without a number, a random pin is chosen each time. With a number (e.g. -pin 3939), the pin is fixed. Authenticated clients are added to a "trusted" list.\n\n• Password (-pw [pwd]) — Client access controlled with a password (at least 6 characters). All users must know the password. Uses HTTP md5 Digest authentication. If no password is specified, a random 4-digit pin is generated for each new connection.\n\nNote: -pin and -pw are alternatives; if both are specified, the earlier one is discarded.`
  },
  'opt-reg': {
    tip: 'Maintain a register of pin-authenticated trusted clients.',
    full: `-reg [filename]\n\nIf "-pin" is used, this option maintains a register of pin-authenticated "trusted clients" in $HOME/.uxplay.register (or optionally in filename).\n\nWithout this option, returning clients that skip pin-authentication are trusted and not checked. The register is text, one line per client, with client's public key (base-64), Device ID, and Device name.\n\nCommenting out (with "#") or deleting a line deregisters the corresponding client.`
  },
  'opt-restrict': {
    tip: 'Only allow explicitly-allowed device IDs to connect.',
    full: `-restrict\n\nRestrict clients allowed to connect to those specified by -allow <deviceID>.\n\nThe deviceID has the format XX:XX:XX:XX:XX:XX (like a MAC address) and appears to be immutable. Note that iOS clients expose different random "private Wi-Fi addresses" which do not correspond to the deviceID.\n\nUse "-restrict no" to remove restrictions.`
  },
  'opt-allow': {
    tip: 'Whitelist device IDs when restrictions are active.',
    full: `-allow id\n\nAdds the deviceID = id to the list of allowed clients when client restrictions are being enforced. Usually set in the uxplayrc startup file.\n\nThe deviceID format is XX:XX:XX:XX:XX:XX (6 hex octets), which is displayed by UxPlay when the client attempts to connect.`
  },
  'opt-block': {
    tip: 'Always block specific device IDs from connecting.',
    full: `-block id\n\nAlways block clients with deviceID = id, even when client restrictions are not being enforced generally. Usually set in the uxplayrc startup file.\n\nMultiple device IDs can be blocked by adding multiple -block entries.`
  },

  // ── Display tab ──
  'opt-sw': {
    tip: 'Width resolution requested from AirPlay client.',
    full: `-s wxh[@r]\n\nE.g. -s 1920x1080 (= "1080p"), the default width and height in pixels for h264 video. The default becomes 3840x2160 (="4K") when -h265 is used.\n\nThis is just a request to the AirPlay client, and may not be the final resolution you get. The height pixel size is the controlling one; width is dynamically adjusted to the image shape (portrait or landscape).\n\nWith @r you can also inform the client about screen refresh rate (default 60 Hz).`
  },
  'opt-sh': {
    tip: 'Height resolution — the controlling dimension for streaming.',
    full: `-s wxh[@r]\n\nE.g. -s 1920x1080 (= "1080p"), the default width and height in pixels for h264 video. The default becomes 3840x2160 (="4K") when -h265 is used.\n\nNote that the height pixel size is the controlling one used by the client for determining the streaming format; the width is dynamically adjusted to the shape of the image (portrait or landscape, depending on how an iPad is held).`
  },
  'opt-sr': {
    tip: 'Screen refresh rate reported to the AirPlay client.',
    full: `-s wxh@r\n\nInforms the AirPlay client about the screen refresh rate of the display. Default is r=60 (60 Hz); r must be a whole number less than 256.\n\nThis is advisory — the client may or may not honor it.`
  },
  'opt-vs': {
    tip: 'Choose the GStreamer video rendering backend.',
    full: `-vs videosink\n\nChooses the GStreamer videosink instead of "autovideosink" which chooses for you.\n\nWindows choices include: d3d12videosink, d3d11videosink, d3dvideosink, glimagesink, gtksink.\n\nIt is recommended that Windows users add -vs d3d12videosink to get the Alt-Enter fullscreen toggle.\n\nUsing quotes allows optional parameters: e.g. -vs "d3d11videosink fullscreen-toggle-mode=alt-enter"\n\n-vs 0 suppresses video display (audio-only, headless server).\n-vs fpsdisplaysink shows the streaming framerate.`
  },
  'opt-vd': {
    tip: 'Override the GStreamer h264 decoder element.',
    full: `-vd decoder\n\nChooses the GStreamer pipeline's h264 decoder element, instead of the default "decodebin" which auto-selects.\n\nSoftware decoding: avdec_h264\nHardware decoders: vah264dec (VA-API), nvh264dec / nvdec (NVIDIA), v4l2h264dec (Raspberry Pi).\n\nUsing quotes allows parameters to be included with the decoder name.`
  },
  'opt-vc': {
    tip: 'Override the GStreamer video converter element.',
    full: `-vc converter\n\nChooses the GStreamer pipeline's videoconverter element, instead of the default "videoconvert".\n\nWhen using Video4Linux2 hardware-decoding, -vc v4l2convert will also use the GPU for video conversion.\n\nUsing quotes allows parameters to be included with the converter name.`
  },
  'opt-vp': {
    tip: 'Override the GStreamer h264 parser element.',
    full: `-vp parser\n\nChooses the GStreamer pipeline's h264 parser element. Default is h264parse.\n\nUsing quotes allows options to be added to the parser.`
  },
  'opt-fps': {
    tip: 'Set the maximum framerate the client should stream.',
    full: `-fps n\n\nSets a maximum frame rate (in frames per second) for the AirPlay client to stream video. n must be a whole number less than 256.\n\nThe client may choose any rate lower than this; default is 30 fps.\n\n60 fps may give improved video. Below 30 fps might reduce latency when running multiple UxPlay instances.\n\nThis is only advisory — setting a high value won't force a high framerate. Use -vs fpsdisplaysink or -FPSdata to see actual framerate.`
  },
  'opt-fs': {
    tip: 'Start the video window in fullscreen mode.',
    full: `-fs\n\nUses fullscreen mode. Currently only works with X11, Wayland, VAAPI, KMS and D3D11 (Windows).\n\nOn Windows with Direct3D 11+, you can toggle fullscreen with Alt+Enter.`
  },
  'opt-o': {
    tip: 'Add an overscanned border frame to the display.',
    full: `-o\n\nTurns on an "overscanned" option for the display window. This reduces the image resolution by using some pixels for an empty boundary frame (which would be lost in a full-screen display that overscans).\n\nRecommendation: don't use this unless there is some special reason.`
  },
  'opt-h265': {
    tip: 'Enable h265/HEVC 4K video support.',
    full: `-h265\n\nActivate "ScreenMultiCodec" support (AirPlay "Features" bit 42) for accepting h265 (4K/HEVC) video in addition to h264 (1080p) in screen-mirror mode.\n\nTwo video pipelines (h264 and h265) are created. Default resolution changes from 1920x1080 to 3840x2160.\n\nA wired Client-Server ethernet connection is preferred for 4K video. Only recent Apple devices (M1/M2 Macs or iPads, some iPhones) can send h265 video.`
  },
  'opt-FPSdata': {
    tip: 'Show client video streaming performance reports.',
    full: `-FPSdata\n\nTurns on monitoring of regular reports about video streaming performance sent by the client. These are displayed in the terminal and updated at 1-second intervals.\n\nUseful for diagnosing streaming quality issues.`
  },
  'opt-f': {
    tip: 'Apply image flip transforms to the video.',
    full: `-f {H|V|I}\n\nImplements "videoflip" image transforms:\n• H = horizontal flip (mirror image)\n• V = vertical flip\n• I = 180° rotation (combination of H and V)\n\nThese transforms are applied before any -r rotation.`
  },
  'opt-r': {
    tip: 'Apply 90° rotation to the video output.',
    full: `-r {R|L}\n\n90 degree Right (clockwise) or Left (counter-clockwise) rotations.\n\nThese image transforms are carried out after any -f transforms.`
  },
  'opt-vsync': {
    tip: 'Timestamp-based audio-video sync in Mirror mode.',
    full: `-vsync [x]\n\n(Mirror mode) Uses timestamps to synchronize audio with video on the server. This is the default since UxPlay 1.64.\n\nOptional audio delay in decimal milliseconds (e.g. "20.5" = 0.0205s delay). Positive or negative delays less than a second are allowed.\n\nNeeded on low-power systems without hardware video decoding. Drops late video frames to maintain sync.\n\n-vsync no — switches off timestamp sync, restoring pre-1.64 behavior. Better for "live streaming" or using UxPlay as a second monitor (no frames dropped).`
  },

  // ── Audio tab ──
  'opt-as': {
    tip: 'Choose the GStreamer audio rendering backend.',
    full: `-as audiosink\n\nChooses the GStreamer audiosink instead of letting autoaudiosink pick for you.\n\nWindows choices: wasapisink (Windows Audio Session API), directsoundsink (DirectSound).\n\nwasapisink supports additional options, e.g.:\n-as 'wasapisink device="{GUID}"'\n\nwhere {GUID} specifies an audio device found via gst-device-monitor-1.0 Audio.\n\n-as 0 (or -a) suppresses audio playback, displays video only.`
  },
  'opt-al': {
    tip: 'Audio latency reported to the client (in seconds).',
    full: `-al x\n\nSpecifies audio latency x in decimal seconds in Audio-only (ALAC) mode, reported to the client. Values in [0.0, 10.0] seconds are allowed. Default: 0.25 sec.\n\nNote: the client appears to ignore this reported latency, so this option seems non-functional.`
  },
  'opt-vol': {
    tip: 'Set the initial audio streaming volume on the client.',
    full: `-vol v\n\nSets initial audio-streaming volume (on client): range is [0:1], with 0.0 = mute, 1.0 = full volume. v is a decimal number.`
  },
  'opt-async': {
    tip: 'Timestamp-based audio sync for Audio-only mode.',
    full: `-async [x]\n\n(Audio-Only ALAC mode) Uses timestamps to synchronize audio on the server with video on the client.\n\nOptional audio delay in decimal milliseconds. Because the client adds a video delay for latency, the server adds an equivalent audio delay.\n\nThis means pauses or track-changes won't take effect immediately.\n\n-async no — this is still the default; useful as a command-line option to override -async set in config file.`
  },
  'opt-db': {
    tip: 'Rescale the AirPlay volume attenuation range.',
    full: `-db low[:high]\n\nRescales AirPlay volume-control attenuation (gain) from -30dB:0dB to low:0dB or low:high.\n\n"low" must be negative (attenuation). "high" can be either sign. GStreamer clips audio gain above +20dB.\n\nRescaling is linear in decibels: for -db -50:10, a -7dB AirPlay change = -14dB actual change. Maximum volume (0dB AirPlay) = +10dB augmentation. AirPlay -30dB exactly = mute.`
  },
  'opt-taper': {
    tip: 'Use a tapered (logarithmic) volume control profile.',
    full: `-taper\n\nProvides a "tapered" AirPlay volume-control profile (matching "dasl-tapering" in shairport-sync).\n\nEach time the volume slider is reduced by 50%, the perceived volume is halved (10dB attenuation). Modified at low volumes to use "untapered" volume if louder.`
  },
  'opt-ca-mode': {
    tip: 'Display or export cover art from Apple Music.',
    full: `-ca [filename]\n\n-ca (without filename) displays cover art inside UxPlay when playing Apple Music in Audio-only ALAC mode.\n\n-ca filename exports cover art (JPEG) to a periodically-updated file. Use with an image viewer that auto-reloads (e.g. "feh -R 1 filename").\n\nCover art is discarded if this option is not used.`
  },
  'opt-md': {
    tip: 'Export audio metadata (artist, title, etc.) to file.',
    full: `-md filename\n\nLike -ca, but exports audio metadata text (Artist, Title, Genre, etc.) to a file for possible display by an external process.\n\nPrevious text is overwritten as new metadata arrives. The file is deleted when uxplay terminates.`
  },

  // ── Network tab ──
  'opt-p-mode': {
    tip: 'Configure network ports (must be open if behind a firewall).',
    full: `-p\n\nAllows selecting the network ports used by UxPlay. These need to be opened if behind a firewall.\n\n• -p (alone): "legacy" ports TCP 7100,7000,7001 and UDP 6000,6001,7011\n• -p n: sets TCP and UDP ports n, n+1, n+2\n• -p n1,n2,n3: sets each port separately\n• -p tcp n / -p udp n: sets just TCP or UDP ports\n\nPorts must be in range [1024-65535]. If -p is not used, ports are chosen randomly (won't work with a firewall).`
  },
  'opt-m-mode': {
    tip: 'Change the MAC address (Device ID) used by UxPlay.',
    full: `-m [mac]\n\nChanges the MAC address (Device ID) used by UxPlay. Default is the true hardware MAC address.\n\nDifferent server names, MAC addresses, and ports are needed for each running UxPlay instance on the same computer.\n\nIf [mac] (xx:xx:xx:xx:xx:xx) is not given, a random MAC is generated. A random MAC will be different each time UxPlay starts.\n\nIf UxPlay can't find the true MAC, a random one is used automatically.`
  },
  'opt-key': {
    tip: 'Store a persistent public key for -pin authentication.',
    full: `-key [filename]\n\nGenerates and stores a persistent public key (for -pin option) in $HOME/.uxplay.pem, or reads from it if the file exists.\n\nThe default method generates a key from the server's Device ID (MAC address) which is less secure since the Device ID is broadcast.\n\nThe -key method is more secure but still exposes the private key to anyone with file access. No longer recommended for most users.`
  },
  'opt-dacp': {
    tip: 'Export DACP-ID and Active-Remote key for remote control.',
    full: `-dacp [filename]\n\nExport current client DACP-ID and Active-Remote key to file (default: $HOME/.uxplay.dacp). Can be used by remote control applications.\n\nThe file is transient — only exists while a client is connected.`
  },
  'opt-ble': {
    tip: 'Use Bluetooth LE beacon for service discovery.',
    full: `-ble [filename]\n\nEnable Bluetooth beacon Service Discovery as an alternative to DNS-SD (Bonjour/Zeroconf).\n\nRequires Bluetooth 4.0+ hardware (a USB dongle can be used). The port, PID, and process name are recorded in ~/.uxplay.ble (or optional filename).\n\nA separate uxplay-beacon.py script must be run to manage the BLE advertisements. Only IPv4 is supported.\n\nUseful on networks that don't allow running a DNS-SD service.`
  },

  // ── Streaming tab ──
  'opt-hls': {
    tip: 'Enable HTTP Live Streaming (currently YouTube only).',
    full: `-hls [v]\n\nActivate HTTP Live Streaming support. YouTube videos can be streamed directly from YouTube servers to UxPlay by clicking the AirPlay icon in the YouTube app.\n\nOptional [v] selects GStreamer's "playbin" version (2 or 3, default: 3). Playbin v3 is recommended, but try v2 if some videos fail.\n\nWithout -hls, the AirPlay icon in YouTube only sends audio (ALAC) without video.`
  },
  'opt-lang': {
    tip: 'Set language preferences for dubbed HLS videos.',
    full: `-lang [list]\n\nSpecify language preferences for YouTube app HLS videos that offer dubbed audio (generated by AI dubbing).\n\nFormat: colon-separated list, e.g. "fr:es:en" (French first, then Spanish, then English).\n\nIf not used, preferences come from $LANGUAGE environment variable. "-lang" alone (no list) suppresses dubbed audio when $LANGUAGE is set.`
  },
  'opt-mp4-enable': {
    tip: 'Record mirrored/audio content to MP4 file.',
    full: `-mp4 [fn]\n\nRecord mirror-mode and audio-mode audio/video to a mp4 file while watching/listening.\n\nFile name format: fn.n.(format).mp4 (default fn = "recording"). The number n = 1,2,... increments with each new connection.\n\n"format" (e.g. "H264.AAC") indicates the video/audio codecs used.\n\nNote: HLS video recording is not supported.`
  },
  'opt-vrtp': {
    tip: 'Forward decrypted video via RTP to an external renderer.',
    full: `-vrtp pipeline\n\nForward RTP packets of decrypted video to an external renderer (e.g. OBS Studio) without rendering locally.\n\nUses rtph264pay or rtph265pay. Pipeline should specify a sending method, e.g.:\n"config-interval=1 ! udpsink host=127.0.0.1 port=XXXX"\n\nFor OBS Studio, install obs-gstreamer plugin and add a "GStreamer Source" with the appropriate receiver pipeline.\n\nCan be used with -artp to forward both video and audio.`
  },
  'opt-artp': {
    tip: 'Forward decoded audio via RTP (L16 PCM, 44100Hz stereo).',
    full: `-artp pipeline\n\nForward decoded audio as L16 RTP packets (PCM format S16BE, 44100Hz stereo) to an external application.\n\nUses rtpL16pay. Pipeline example:\n"pt=96 ! udpsink host=127.0.0.1 port=5002"\n\niOS volume control still works over RTP. Can be used with -vrtp to forward both audio and video concurrently.`
  },

  // ── Advanced tab ──
  'opt-nc': {
    tip: "Don't close the video window on Stop Mirroring.",
    full: `-nc\n\nMaintains previous UxPlay < 1.45 behavior that does not close the video window when the client sends "Stop Mirroring".\n\nCurrently used by default on macOS as a workaround for window-closing problems with GStreamer videosinks.\n\nCancel with "-nc no" if not needed.`
  },
  'opt-nohold': {
    tip: 'Drop the current client when a new one tries to connect.',
    full: `-nohold\n\nDrops the current connection when a new client attempts to connect.\n\nWithout this option, the current client maintains exclusive ownership of UxPlay until it disconnects.`
  },
  'opt-nofreeze': {
    tip: 'Close the video window after a client timeout.',
    full: `-nofreeze\n\nCloses the video window after a reset due to client going offline.\n\nDefault behavior leaves the frozen window open to allow smoother reconnection to the same client. This option may be useful in fullscreen mode.`
  },
  'opt-reset': {
    tip: 'Seconds of missed heartbeats before resetting the connection.',
    full: `-reset n\n\nSets a limit of n consecutive failures of the client to send feedback (heartbeat) requests. These are sent once per second.\n\nAfter n missing signals, the client is presumed offline and the connection resets. Default: 15 seconds. n = 0 means "no limit".`
  },
  'opt-t': {
    tip: 'Relaunch the server after N seconds with no connections.',
    full: `-t timeout\n\nRelaunches the server if no connections were active in previous timeout seconds. This renews the Bonjour/DNS-SD registration.\n\nUseful if the server becomes invisible to clients after prolonged idle periods.`
  },
  'opt-avdec': {
    tip: 'Force software h264 decoding instead of hardware.',
    full: `-avdec\n\nForces use of software h264 decoding using GStreamer element avdec_h264 (libav h264 decoder).\n\nThis prevents autovideosink from choosing a hardware-accelerated plugin like vaapisink.\n\nUseful if hardware acceleration is misconfigured or causing issues.`
  },
  'opt-v4l2': {
    tip: 'Use Video4Linux2 for GPU hardware h264 decoding.',
    full: `-v4l2\n\nVideo settings for hardware h264 video decoding in the GPU by Video4Linux2. Equivalent to -vd v4l2h264dec -vc v4l2convert.\n\nPrimarily for Raspberry Pi (Pi 4B and earlier). Requires the bcm2835_codec kernel module.`
  },
  'opt-bt709': {
    tip: 'Workaround for BT.709 full-range color issues.',
    full: `-bt709\n\nA workaround for the failure of the older Video4Linux2 plugin to recognize Apple's use of an uncommon "full-range color" variant of the bt709 color standard.\n\nNo longer needed by GStreamer-1.20.4 but appears to be required again in GStreamer-1.22 and later when using hardware h264 decoding on Raspberry Pi.`
  },
  'opt-d': {
    tip: 'Enable debug output for diagnostics.',
    full: `-d [n]\n\nEnable debug output. Optional argument n=1 suppresses audio/video packet data in debug output.\n\nNote: this does not show GStreamer error/debug messages. To see those, set GST_DEBUG environment variable:\n• GST_DEBUG=2 — warnings and errors\n• GST_DEBUG=4 — informational messages\n• GST_DEBUG=5 — debug messages`
  },
  'opt-rc': {
    tip: 'Specify a custom UxPlay startup configuration file.',
    full: `-rc file\n\nSpecify the startup file location. Overrides $UXPLAYRC, ~/.uxplayrc, etc.\n\nFormat: one option per line, without the initial "-". Lines beginning with "#" are comments.\n\nDefault search order: (1) $UXPLAYRC, (2) ~/.uxplayrc, (3) ~/.config/uxplayrc.`
  },
  'opt-vdmp': {
    tip: 'Dump h264 video stream to file for debugging.',
    full: `-vdmp [n] [filename]\n\nDumps h264 video to file videodump.h264. With n, dumps at most n NAL units to videodump.x.h264 (x increments with each SPS/PPS NAL unit).\n\nOptionally specify a different base filename.`
  },
  'opt-admp': {
    tip: 'Dump audio stream to file for debugging.',
    full: `-admp [n] [filename]\n\nDumps audio to file audiodump.x.aac (AAC-ELD), audiodump.x.alac (ALAC), or audiodump.x.aud (other format). x increments when audio format changes.\n\nWith n, restricts packets per file. Note: dumped audio is not containerized and not directly playable with standard players.`
  },
  'opt-autostart': {
    tip: 'Start this instance automatically when the app launches.',
    full: `Auto-start on application launch\n\nWhen enabled, this instance will be started automatically each time NodeUxPlay opens, provided all dependencies are installed.\n\nUseful for instances you always want running (e.g. your primary AirPlay receiver).\n\nInstances are started in order after dependency checks complete.`
  },
};

function setupSettingInfoTags() {
  for (const [id, data] of Object.entries(settingInfoData)) {
    const el = document.getElementById(id);
    if (!el) continue;
    // Find the associated label
    let label = document.querySelector(`label[for="${id}"]`);
    if (!label) {
      // For checkboxes/toggles, the input is inside the label
      label = el.closest('label');
    }
    if (!label) continue;
    const tag = document.createElement('span');
    tag.className = 'info-tag';
    tag.textContent = 'i';
    tag.setAttribute('data-tip', data.tip);
    tag.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Derive title from the label text
      const labelText = label.textContent.replace(/\s*i$/, '').trim();
      showInfoDialog(labelText, data.full);
    });
    label.appendChild(tag);
  }
}

// ─── Auto-save on input changes ──────────────────────────────────────────────
function setupInputListeners() {
  document.querySelectorAll('#tab-instance input, #tab-instance select').forEach(el => {
    el.addEventListener('input', () => { updateCommandPreview(); debouncedSave(); });
    el.addEventListener('change', () => { updateCommandPreview(); debouncedSave(); });
  });
}

let saveTimer = null;
function debouncedSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveAllInstances(), 500);
}

// ─── User Preferences ────────────────────────────────────────────────────────
const PREFS_KEY = 'nodeuxplay-prefs';
const defaultPrefs = {
  startView: 'dashboard',
  outputCollapsed: false,
  confirmRemove: true,
  autoCheck: true,
};

function loadPrefs() {
  try {
    const stored = localStorage.getItem(PREFS_KEY);
    return stored ? { ...defaultPrefs, ...JSON.parse(stored) } : { ...defaultPrefs };
  } catch { return { ...defaultPrefs }; }
}

function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function applyPrefsToForm() {
  const prefs = loadPrefs();
  document.getElementById('pref-start-view').value = prefs.startView;
  document.getElementById('pref-output-collapsed').checked = prefs.outputCollapsed;
  document.getElementById('pref-confirm-remove').checked = prefs.confirmRemove;
  document.getElementById('pref-auto-check').checked = prefs.autoCheck;
}

function setupPrefsListeners() {
  const ids = ['pref-start-view', 'pref-output-collapsed', 'pref-confirm-remove', 'pref-auto-check'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('change', () => {
      const prefs = loadPrefs();
      prefs.startView = document.getElementById('pref-start-view').value;
      prefs.outputCollapsed = document.getElementById('pref-output-collapsed').checked;
      prefs.confirmRemove = document.getElementById('pref-confirm-remove').checked;
      prefs.autoCheck = document.getElementById('pref-auto-check').checked;
      savePrefs(prefs);
    });
  });
}

// ─── Import / Export ─────────────────────────────────────────────────────────
async function exportFullBackup() {
  saveCurrentFormToInstance();
  const prefs = loadPrefs();
  const cleanInstances = instances.map(i => ({ id: i.id, name: i.name, settings: i.settings }));
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: 'NodeUxPlay',
    nextId,
    instances: cleanInstances,
    preferences: prefs,
  };
  const filePath = await api.saveFileDialog({
    defaultPath: `nodeuxplay-backup-${new Date().toISOString().slice(0,10)}.json`,
  });
  if (!filePath) return;
  const ok = await api.writeFile(filePath, JSON.stringify(backup, null, 2));
  if (ok) appendLog('✓ Full backup exported successfully.');
  else appendLog('✗ Failed to write backup file.');
}

async function importFullBackup() {
  const filePath = await api.selectFile({
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (!filePath) return;
  const content = await api.readFileContents(filePath);
  if (!content) { appendLog('✗ Could not read file.'); return; }
  let data;
  try { data = JSON.parse(content); } catch { appendLog('✗ Invalid JSON file.'); return; }
  if (!data.instances || !Array.isArray(data.instances)) { appendLog('✗ Invalid backup file format.'); return; }
  const ok = await showConfirmDialog('Import Backup', 'This will replace ALL current instances and preferences.\nAre you sure?', { confirmLabel: 'Import', danger: true });
  if (!ok) return;

  // Stop all running instances first
  await api.stopAllUxplay();

  instances = data.instances.map(i => ({ ...i, log: [] }));
  nextId = data.nextId || (Math.max(...instances.map(i => parseInt(i.id))) + 1);
  instances.forEach(i => instanceStatuses[i.id] = 'stopped');
  if (instances.length === 0) createInstance('Instance 1');

  if (data.preferences) {
    savePrefs({ ...defaultPrefs, ...data.preferences });
    applyPrefsToForm();
  }

  await saveAllInstances();
  refreshSidebar();
  appendLog(`✓ Restored ${instances.length} instance(s) from backup.`);
  switchView('dashboard');
}

function clearAllLogs() {
  globalLog.length = 0;
  instances.forEach(i => i.log.length = 0);
  refreshOutputPanel();
  appendLog('✓ All logs cleared.');
}

async function resetAllData() {
  const ok = await showConfirmDialog('Reset Everything', 'This will remove ALL instances, reset all preferences, and stop any running processes.\n\nThis cannot be undone. Continue?', { confirmLabel: 'Reset Everything', danger: true });
  if (!ok) return;
  await api.stopAllUxplay();
  instances = [];
  nextId = 1;
  instanceStatuses = {};
  globalLog = [];
  createInstance('Instance 1');
  savePrefs(defaultPrefs);
  applyPrefsToForm();
  await saveAllInstances();
  refreshSidebar();
  appendLog('✓ All data has been reset to defaults.');
  switchView('dashboard');
}

// ─── Initialize ──────────────────────────────────────────────────────────────
async function init() {
  setupConditionalFields();
  setupInfoTooltips();
  setupSettingInfoTags();
  applyPrefsToForm();
  setupPrefsListeners();

  // Load saved instances
  await loadAllInstances();
  refreshSidebar();

  // Restore statuses for running processes
  const statuses = await api.getAllUxplayStatuses();
  Object.entries(statuses).forEach(([id, status]) => {
    instanceStatuses[id] = status;
  });
  refreshSidebar();

  setupInputListeners();

  const prefs = loadPrefs();

  // Apply output collapsed pref
  if (prefs.outputCollapsed) {
    document.getElementById('output-panel').classList.add('collapsed');
  }

  // Start on preferred view
  switchView(prefs.startView || 'setup');

  // Auto-check dependencies
  if (prefs.autoCheck) await checkDeps();

  // Auto-start instances that have the autostart flag
  if (allDepsReady) {
    const autoStartInstances = instances.filter(i => i.settings['opt-autostart'] && instanceStatuses[i.id] !== 'running');
    for (const inst of autoStartInstances) {
      const args = buildArgsFromSettings(inst.settings);
      appendLog(`Auto-starting "${inst.name}"...`);
      await api.startUxplay(inst.id, args);
    }
  }
}

init();
