const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn, execFile } = require('child_process');

// ─── Constants ───────────────────────────────────────────────────────────────
const MSYS2_ROOT = 'C:\\msys64';
const MSYS2_BASH = path.join(MSYS2_ROOT, 'usr', 'bin', 'bash.exe');
const UCRT64_BIN = path.join(MSYS2_ROOT, 'ucrt64', 'bin');
const UXPLAY_EXE = path.join(UCRT64_BIN, 'uxplay.exe');
const BONJOUR_SDK = 'C:\\Program Files\\Bonjour SDK';
const UXPLAY_SRC = path.join(app.getPath('userData'), 'UxPlay');
const UXPLAY_BUILD = path.join(UXPLAY_SRC, 'build');
const UXPLAY_VERSION_FILE = path.join(app.getPath('userData'), '.uxplay-version');
const INSTANCES_FILE = path.join(app.getPath('userData'), 'instances.json');
const GITHUB_API = 'https://api.github.com/repos/FDH2/UxPlay/releases/latest';
const MSYS2_INSTALLER_API = 'https://api.github.com/repos/msys2/msys2-installer/releases/latest';

let mainWindow = null;
const uxplayProcesses = new Map(); // instanceId -> child process
let setupAbort = null;

// Helper: kill all running UxPlay instances
function killAllUxplay() {
  for (const [id, proc] of uxplayProcesses) {
    try {
      spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t'], { windowsHide: true });
    } catch {}
  }
  uxplayProcesses.clear();
}

// ─── Window Creation ─────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'src', 'icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('closed', () => {
    killAllUxplay();
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ─── Window controls ─────────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ─── Utility: HTTPS GET with redirects ───────────────────────────────────────
function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, {
      headers: { 'User-Agent': 'NodeUxPlay/1.0', ...options.headers },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, options).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function downloadFile(url, destPath, progressCb) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, {
      headers: { 'User-Agent': 'NodeUxPlay/1.0' },
      timeout: 600000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, destPath, progressCb).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      const file = fs.createWriteStream(destPath);
      file.on('finish', () => resolve());
      file.on('error', (e) => { file.destroy(); reject(e); });
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        file.write(chunk);
        if (progressCb && total > 0) progressCb(downloaded, total);
      });
      res.on('end', () => file.end());
      res.on('error', (e) => { file.destroy(); reject(e); });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

// ─── MSYS2 command execution ─────────────────────────────────────────────────
function runMsys2(command, opts = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      MSYSTEM: 'UCRT64',
      CHERE_INVOKING: '1',
      HOME: process.env.USERPROFILE,
    };

    const proc = spawn(MSYS2_BASH, ['-lc', command], {
      env,
      cwd: opts.cwd || MSYS2_ROOT,
      windowsHide: true,
    });

    // Auto-confirm any interactive prompts (e.g. pacman [Y/n])
    proc.stdin.write('y\n');
    proc.stdin.end();

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const str = data.toString();
      stdout += str;
      if (opts.onOutput) opts.onOutput(str);
    });

    proc.stderr.on('data', (data) => {
      const str = data.toString();
      stderr += str;
      if (opts.onOutput) opts.onOutput(str);
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Exit code ${code}: ${stderr || stdout}`));
    });

    proc.on('error', reject);
  });
}

// ─── Dependency Checks ──────────────────────────────────────────────────────
function checkMsys2() {
  return fs.existsSync(MSYS2_BASH);
}

function checkBonjourSDK() {
  return fs.existsSync(path.join(BONJOUR_SDK, 'Include', 'dns_sd.h'));
}

async function checkMsys2Package(pkg) {
  try {
    await runMsys2(`pacman -Q ${pkg} 2>/dev/null`);
    return true;
  } catch { return false; }
}

function checkUxplayBuilt() {
  return fs.existsSync(UXPLAY_EXE);
}

async function getInstalledUxplayVersion() {
  if (!checkUxplayBuilt()) return null;
  try {
    if (fs.existsSync(UXPLAY_VERSION_FILE)) {
      return fs.readFileSync(UXPLAY_VERSION_FILE, 'utf-8').trim();
    }
    if (fs.existsSync(path.join(UXPLAY_SRC, '.git'))) {
      try {
        const tag = await runMsys2(`cd "${UXPLAY_SRC.replace(/\\/g, '/')}" && git describe --tags --abbrev=0 2>/dev/null`);
        const version = tag.trim().replace(/^v/, '');
        if (version) {
          fs.writeFileSync(UXPLAY_VERSION_FILE, version, 'utf-8');
          return version;
        }
      } catch {}
    }
    try {
      const result = await runMsys2('uxplay -h 2>&1 | head -1');
      const match = result.match(/UxPlay\s+([\d.]+)/i);
      if (match) {
        fs.writeFileSync(UXPLAY_VERSION_FILE, match[1], 'utf-8');
        return match[1];
      }
    } catch {}
    return null;
  } catch { return null; }
}

async function getLatestGithubVersion() {
  try {
    const data = await httpsGet(GITHUB_API);
    const json = JSON.parse(data.toString());
    const tag = json.tag_name || '';
    return tag.replace(/^v/, '');
  } catch { return null; }
}

// ─── IPC: Check Dependencies ─────────────────────────────────────────────────
ipcMain.handle('check-dependencies', async () => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);
  const results = {};

  results.msys2 = checkMsys2();
  send(results.msys2 ? '✓ MSYS2 found' : '✗ MSYS2 not found');

  results.bonjourSdk = checkBonjourSDK();
  send(results.bonjourSdk ? '✓ Bonjour SDK found' : '✗ Bonjour SDK not found');

  if (!results.msys2) {
    results.buildTools = false;
    results.dependencies = false;
    results.gstPlugins = false;
    results.uxplay = false;
    results.installedVersion = null;
    results.latestVersion = await getLatestGithubVersion();
    return results;
  }

  const buildPkgs = ['mingw-w64-ucrt-x86_64-gcc', 'mingw-w64-ucrt-x86_64-cmake'];
  const buildChecks = await Promise.all(buildPkgs.map(p => checkMsys2Package(p)));
  results.buildTools = buildChecks.every(Boolean);
  send(results.buildTools ? '✓ Build tools installed' : '✗ Build tools missing');

  const depPkgs = [
    'mingw-w64-ucrt-x86_64-libplist',
    'mingw-w64-ucrt-x86_64-gstreamer',
    'mingw-w64-ucrt-x86_64-gst-plugins-base',
  ];
  const depChecks = await Promise.all(depPkgs.map(p => checkMsys2Package(p)));
  results.dependencies = depChecks.every(Boolean);
  send(results.dependencies ? '✓ Dependencies installed' : '✗ Dependencies missing');

  const pluginPkgs = [
    'mingw-w64-ucrt-x86_64-gst-libav',
    'mingw-w64-ucrt-x86_64-gst-plugins-good',
    'mingw-w64-ucrt-x86_64-gst-plugins-bad',
  ];
  const pluginChecks = await Promise.all(pluginPkgs.map(p => checkMsys2Package(p)));
  results.gstPlugins = pluginChecks.every(Boolean);
  send(results.gstPlugins ? '✓ GStreamer plugins installed' : '✗ GStreamer plugins missing');

  results.git = await checkMsys2Package('git');

  results.uxplay = checkUxplayBuilt();
  results.installedVersion = await getInstalledUxplayVersion();
  results.latestVersion = await getLatestGithubVersion();

  if (results.uxplay) {
    const outdated = results.latestVersion && results.installedVersion &&
      results.installedVersion !== results.latestVersion;
    send(outdated
      ? `⚠ UxPlay ${results.installedVersion} installed (latest: ${results.latestVersion})`
      : `✓ UxPlay ${results.installedVersion || 'installed'} (up to date)`);
  } else {
    send('✗ UxPlay not built');
  }

  return results;
});

// ─── IPC: Install MSYS2 ─────────────────────────────────────────────────────
ipcMain.handle('install-msys2', async () => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);

  if (checkMsys2()) {
    send('MSYS2 is already installed.');
    return true;
  }

  try {
    send('Fetching latest MSYS2 installer info...');
    const data = await httpsGet(MSYS2_INSTALLER_API);
    const release = JSON.parse(data.toString());
    const asset = release.assets.find(a =>
      a.name.match(/msys2-x86_64-.*\.exe$/i) && !a.name.includes('sfx')
    );
    if (!asset) throw new Error('Could not find MSYS2 installer');

    const installerPath = path.join(app.getPath('temp'), asset.name);
    send(`Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)...`);

    await downloadFile(asset.browser_download_url, installerPath, (dl, total) => {
      const pct = Math.round(dl / total * 100);
      mainWindow?.webContents.send('progress', { id: 'msys2', percent: pct });
    });

    send('Running MSYS2 installer (this may take a few minutes)...');
    await new Promise(r => setTimeout(r, 1000));

    await new Promise((resolve, reject) => {
      execFile(installerPath, [
        'install', '--root', MSYS2_ROOT, '--confirm-command',
      ], { windowsHide: true, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (stdout) send(stdout);
        if (stderr) send(stderr);
        if (err) reject(err);
        else resolve();
      });
    });

    send('Updating MSYS2 packages...');
    try {
      await runMsys2('pacman -Syu --noconfirm', { onOutput: send });
    } catch (e) {
      send('Running second update pass...');
      await runMsys2('pacman -Syu --noconfirm', { onOutput: send });
    }

    send('✓ MSYS2 installed successfully!');
    return true;
  } catch (err) {
    send(`✗ Failed to install MSYS2: ${err.message}`);
    return false;
  }
});

// ─── IPC: Install Bonjour SDK ────────────────────────────────────────────────
ipcMain.handle('install-bonjour', async () => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);
  if (checkBonjourSDK()) {
    send('Bonjour SDK is already installed.');
    return true;
  }
  send('Opening Bonjour SDK download page...');
  send('Please download and install the Bonjour SDK for Windows v3.0');
  send('It should install to: C:\\Program Files\\Bonjour SDK');
  shell.openExternal('https://www.softpedia.com/get/Programming/SDK-DDK/Bonjour-SDK.shtml');
  return false;
});

// ─── IPC: Install MSYS2 Packages ────────────────────────────────────────────
ipcMain.handle('install-packages', async () => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);

  if (!checkMsys2()) {
    send('✗ MSYS2 must be installed first.');
    return false;
  }

  const packages = [
    'git',
    'mingw-w64-ucrt-x86_64-gcc',
    'mingw-w64-ucrt-x86_64-cmake',
    'mingw-w64-ucrt-x86_64-libplist',
    'mingw-w64-ucrt-x86_64-gstreamer',
    'mingw-w64-ucrt-x86_64-gst-plugins-base',
    'mingw-w64-ucrt-x86_64-gst-libav',
    'mingw-w64-ucrt-x86_64-gst-plugins-good',
    'mingw-w64-ucrt-x86_64-gst-plugins-bad',
    'mingw-w64-ucrt-x86_64-openssl',
  ];

  try {
    send(`Installing ${packages.length} packages via pacman...`);
    const cmd = `pacman -S --noconfirm --needed ${packages.join(' ')}`;
    await runMsys2(cmd, { onOutput: send });
    send('✓ All packages installed successfully!');
    return true;
  } catch (err) {
    send(`✗ Package installation failed: ${err.message}`);
    return false;
  }
});

// ─── IPC: Build UxPlay ──────────────────────────────────────────────────────
ipcMain.handle('build-uxplay', async () => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);

  if (!checkMsys2()) { send('✗ MSYS2 must be installed first.'); return false; }
  if (!checkBonjourSDK()) { send('✗ Bonjour SDK must be installed first.'); return false; }

  try {
    const srcDir = UXPLAY_SRC.replace(/\\/g, '/');

    send('Fetching latest UxPlay release tag...');
    let latestTag = '';
    try {
      const releaseData = await httpsGet(GITHUB_API);
      const releaseJson = JSON.parse(releaseData.toString());
      latestTag = releaseJson.tag_name || '';
    } catch (e) {
      send('⚠ Could not fetch latest release tag, using master branch.');
    }

    if (fs.existsSync(path.join(UXPLAY_SRC, '.git'))) {
      send('Updating UxPlay source...');
      await runMsys2(`cd "${srcDir}" && git fetch origin --tags`, { onOutput: send });
    } else {
      send('Cloning UxPlay repository...');
      if (fs.existsSync(UXPLAY_SRC)) fs.rmSync(UXPLAY_SRC, { recursive: true, force: true });
      const parentDir = path.dirname(UXPLAY_SRC).replace(/\\/g, '/');
      await runMsys2(`cd "${parentDir}" && git clone https://github.com/FDH2/UxPlay.git`, { onOutput: send });
    }

    if (latestTag) {
      send(`Checking out release ${latestTag}...`);
      await runMsys2(`cd "${srcDir}" && git checkout ${latestTag}`, { onOutput: send });
    } else {
      await runMsys2(`cd "${srcDir}" && git checkout master && git reset --hard origin/master`, { onOutput: send });
    }

    if (fs.existsSync(UXPLAY_BUILD)) fs.rmSync(UXPLAY_BUILD, { recursive: true, force: true });
    fs.mkdirSync(UXPLAY_BUILD, { recursive: true });

    const buildDir = UXPLAY_BUILD.replace(/\\/g, '/');
    send('Configuring UxPlay build...');
    await runMsys2(`cd "${buildDir}" && cmake ..`, { onOutput: send });

    send('Building UxPlay...');
    await runMsys2(`cd "${buildDir}" && ninja`, { onOutput: send });

    send('Installing UxPlay to MSYS2 UCRT64...');
    await runMsys2(`cd "${buildDir}" && cmake --install . --prefix /ucrt64`, { onOutput: send });

    const builtVersion = latestTag ? latestTag.replace(/^v/, '') : 'unknown';
    fs.writeFileSync(UXPLAY_VERSION_FILE, builtVersion, 'utf-8');

    send(`✓ UxPlay ${builtVersion} built and installed successfully!`);
    return true;
  } catch (err) {
    send(`✗ Build failed: ${err.message}`);
    return false;
  }
});

// ─── IPC: Instance Persistence ───────────────────────────────────────────────
ipcMain.handle('load-instances', async () => {
  try {
    if (fs.existsSync(INSTANCES_FILE)) {
      return JSON.parse(fs.readFileSync(INSTANCES_FILE, 'utf-8'));
    }
  } catch {}
  return null;
});

ipcMain.handle('save-instances', async (_, data) => {
  try {
    fs.writeFileSync(INSTANCES_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch { return false; }
});

// ─── IPC: Start UxPlay (per-instance) ────────────────────────────────────────
ipcMain.handle('start-uxplay', async (_, instanceId, args) => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);
  const tag = `[#${instanceId}]`;

  if (uxplayProcesses.has(instanceId)) {
    send(`${tag} UxPlay is already running.`);
    return false;
  }

  if (!checkUxplayBuilt()) {
    send(`${tag} ✗ UxPlay is not installed. Please build it first.`);
    return false;
  }

  try {
    const cmdParts = ['uxplay'];
    if (args && Array.isArray(args)) cmdParts.push(...args);
    const cmd = cmdParts.join(' ');

    send(`${tag} Starting: ${cmd}`);
    send('─'.repeat(60));

    const env = {
      ...process.env,
      MSYSTEM: 'UCRT64',
      CHERE_INVOKING: '1',
      HOME: process.env.USERPROFILE,
      PATH: `${UCRT64_BIN};${process.env.PATH}`,
    };

    const proc = spawn(MSYS2_BASH, ['-lc', cmd], { env, windowsHide: true });

    proc.stdout.on('data', (data) => send(`${tag} ${data.toString()}`));
    proc.stderr.on('data', (data) => send(`${tag} ${data.toString()}`));

    proc.on('close', (code) => {
      send(`${tag} UxPlay exited with code ${code}`);
      uxplayProcesses.delete(instanceId);
      mainWindow?.webContents.send('uxplay-status', instanceId, 'stopped');
    });

    proc.on('error', (err) => {
      send(`${tag} ✗ Failed to start: ${err.message}`);
      uxplayProcesses.delete(instanceId);
      mainWindow?.webContents.send('uxplay-status', instanceId, 'stopped');
    });

    uxplayProcesses.set(instanceId, proc);
    mainWindow?.webContents.send('uxplay-status', instanceId, 'running');
    return true;
  } catch (err) {
    send(`${tag} ✗ Failed to start UxPlay: ${err.message}`);
    return false;
  }
});

// ─── IPC: Stop UxPlay (per-instance) ─────────────────────────────────────────
ipcMain.handle('stop-uxplay', async (_, instanceId) => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);
  const tag = `[#${instanceId}]`;
  const proc = uxplayProcesses.get(instanceId);

  if (!proc) {
    send(`${tag} UxPlay is not running.`);
    return false;
  }

  send(`${tag} Stopping UxPlay...`);
  try {
    spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t'], { windowsHide: true });
    uxplayProcesses.delete(instanceId);
    mainWindow?.webContents.send('uxplay-status', instanceId, 'stopped');
    send(`${tag} ✓ UxPlay stopped.`);
    return true;
  } catch (err) {
    send(`${tag} ✗ Error stopping UxPlay: ${err.message}`);
    return false;
  }
});

// ─── IPC: Stop All UxPlay instances ──────────────────────────────────────────
ipcMain.handle('stop-all-uxplay', async () => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);
  const ids = [...uxplayProcesses.keys()];
  if (ids.length === 0) {
    send('No instances are running.');
    return true;
  }
  for (const id of ids) {
    const proc = uxplayProcesses.get(id);
    if (proc) {
      try {
        spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t'], { windowsHide: true });
      } catch {}
      uxplayProcesses.delete(id);
      mainWindow?.webContents.send('uxplay-status', id, 'stopped');
      send(`[#${id}] ✓ Stopped.`);
    }
  }
  send('✓ All instances stopped.');
  return true;
});

// ─── IPC: Start All UxPlay instances ─────────────────────────────────────────
ipcMain.handle('start-all-uxplay', async (_, entries) => {
  // entries = [{id, args}, ...]
  const send = (msg) => mainWindow?.webContents.send('log', msg);

  if (!checkUxplayBuilt()) {
    send('✗ UxPlay is not installed. Please build it first.');
    return false;
  }

  const env = {
    ...process.env,
    MSYSTEM: 'UCRT64',
    CHERE_INVOKING: '1',
    HOME: process.env.USERPROFILE,
    PATH: `${UCRT64_BIN};${process.env.PATH}`,
  };

  for (const entry of entries) {
    const { id, args } = entry;
    const tag = `[#${id}]`;

    if (uxplayProcesses.has(id)) {
      send(`${tag} Already running, skipping.`);
      continue;
    }

    const cmdParts = ['uxplay'];
    if (args && Array.isArray(args)) cmdParts.push(...args);
    const cmd = cmdParts.join(' ');
    send(`${tag} Starting: ${cmd}`);

    const proc = spawn(MSYS2_BASH, ['-lc', cmd], { env, windowsHide: true });

    proc.stdout.on('data', (data) => send(`${tag} ${data.toString()}`));
    proc.stderr.on('data', (data) => send(`${tag} ${data.toString()}`));

    proc.on('close', (code) => {
      send(`${tag} UxPlay exited with code ${code}`);
      uxplayProcesses.delete(id);
      mainWindow?.webContents.send('uxplay-status', id, 'stopped');
    });

    proc.on('error', (err) => {
      send(`${tag} ✗ Failed: ${err.message}`);
      uxplayProcesses.delete(id);
      mainWindow?.webContents.send('uxplay-status', id, 'stopped');
    });

    uxplayProcesses.set(id, proc);
    mainWindow?.webContents.send('uxplay-status', id, 'running');
  }

  send('─'.repeat(60));
  return true;
});

// ─── IPC: Get UxPlay Status ─────────────────────────────────────────────────
ipcMain.handle('get-uxplay-status', (_, instanceId) => {
  return uxplayProcesses.has(instanceId) ? 'running' : 'stopped';
});

ipcMain.handle('get-all-uxplay-statuses', () => {
  const statuses = {};
  for (const [id] of uxplayProcesses) {
    statuses[id] = 'running';
  }
  return statuses;
});

// ─── IPC: Uninstall Individual Components ───────────────────────────────────
ipcMain.handle('uninstall-msys2', async () => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);
  try {
    killAllUxplay();
    if (fs.existsSync(UXPLAY_SRC)) {
      send('Removing UxPlay source...');
      fs.rmSync(UXPLAY_SRC, { recursive: true, force: true });
    }
    if (fs.existsSync(MSYS2_ROOT)) {
      send('Removing MSYS2 (this may take a moment)...');
      fs.rmSync(MSYS2_ROOT, { recursive: true, force: true });
      send('✓ MSYS2 removed.');
    } else {
      send('MSYS2 is not installed.');
    }
    if (fs.existsSync(UXPLAY_VERSION_FILE)) fs.unlinkSync(UXPLAY_VERSION_FILE);
    return true;
  } catch (err) {
    send(`✗ Uninstall error: ${err.message}`);
    return false;
  }
});

ipcMain.handle('uninstall-packages', async () => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);
  if (!checkMsys2()) { send('MSYS2 is not installed.'); return false; }
  try {
    const packages = [
      'mingw-w64-ucrt-x86_64-gcc', 'mingw-w64-ucrt-x86_64-cmake',
      'mingw-w64-ucrt-x86_64-libplist', 'mingw-w64-ucrt-x86_64-gstreamer',
      'mingw-w64-ucrt-x86_64-gst-plugins-base', 'mingw-w64-ucrt-x86_64-gst-libav',
      'mingw-w64-ucrt-x86_64-gst-plugins-good', 'mingw-w64-ucrt-x86_64-gst-plugins-bad',
      'mingw-w64-ucrt-x86_64-openssl',
    ];
    send('Removing MSYS2 packages...');
    await runMsys2(`pacman -Rns --noconfirm ${packages.join(' ')} 2>/dev/null || true`, { onOutput: send });
    send('✓ Packages removed.');
    return true;
  } catch (err) {
    send(`✗ Package removal error: ${err.message}`);
    return false;
  }
});

ipcMain.handle('uninstall-uxplay', async () => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);
  try {
    killAllUxplay();
    if (fs.existsSync(UXPLAY_EXE)) {
      fs.unlinkSync(UXPLAY_EXE);
      send('✓ UxPlay binary removed.');
    }
    if (fs.existsSync(UXPLAY_SRC)) {
      fs.rmSync(UXPLAY_SRC, { recursive: true, force: true });
      send('✓ UxPlay source removed.');
    }
    if (!fs.existsSync(UXPLAY_EXE) && !fs.existsSync(UXPLAY_SRC)) {
      send('UxPlay is not installed.');
    }
    if (fs.existsSync(UXPLAY_VERSION_FILE)) fs.unlinkSync(UXPLAY_VERSION_FILE);
    return true;
  } catch (err) {
    send(`✗ Uninstall error: ${err.message}`);
    return false;
  }
});

// ─── IPC: Uninstall All ─────────────────────────────────────────────────────
ipcMain.handle('uninstall-all', async () => {
  const send = (msg) => mainWindow?.webContents.send('log', msg);
  try {
    killAllUxplay();
    if (fs.existsSync(UXPLAY_SRC)) {
      send('Removing UxPlay source...');
      fs.rmSync(UXPLAY_SRC, { recursive: true, force: true });
      send('✓ UxPlay source removed.');
    }
    if (fs.existsSync(MSYS2_ROOT)) {
      send('Removing MSYS2 (this may take a moment)...');
      fs.rmSync(MSYS2_ROOT, { recursive: true, force: true });
      send('✓ MSYS2 removed.');
    }
    send('✓ Uninstall complete. Bonjour SDK must be removed manually via Windows Settings > Apps.');
    if (fs.existsSync(UXPLAY_VERSION_FILE)) fs.unlinkSync(UXPLAY_VERSION_FILE);
    return true;
  } catch (err) {
    send(`✗ Uninstall error: ${err.message}`);
    return false;
  }
});

// ─── IPC: Open external link ─────────────────────────────────────────────────
ipcMain.handle('open-external', (_, url) => {
  shell.openExternal(url);
});

// ─── IPC: Select file ───────────────────────────────────────────────────────
ipcMain.handle('select-file', async (_, options) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    ...options,
  });
  return result.canceled ? null : result.filePaths[0];
});

// ─── IPC: Select folder ─────────────────────────────────────────────────────
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

// ─── IPC: Save file dialog ──────────────────────────────────────────────────
ipcMain.handle('save-file-dialog', async (_, options) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: options?.defaultPath || 'backup.json',
    filters: options?.filters || [{ name: 'JSON Files', extensions: ['json'] }],
  });
  return result.canceled ? null : result.filePath;
});

// ─── IPC: Write file ────────────────────────────────────────────────────────
ipcMain.handle('write-file', async (_, filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch { return false; }
});

// ─── IPC: Read file contents ────────────────────────────────────────────────
ipcMain.handle('read-file-contents', async (_, filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch { return null; }
});
