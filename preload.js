const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Dependency management (global / shared)
  checkDependencies: () => ipcRenderer.invoke('check-dependencies'),
  installMsys2: () => ipcRenderer.invoke('install-msys2'),
  installBonjour: () => ipcRenderer.invoke('install-bonjour'),
  installPackages: () => ipcRenderer.invoke('install-packages'),
  buildUxplay: () => ipcRenderer.invoke('build-uxplay'),
  uninstallMsys2: () => ipcRenderer.invoke('uninstall-msys2'),
  uninstallPackages: () => ipcRenderer.invoke('uninstall-packages'),
  uninstallUxplay: () => ipcRenderer.invoke('uninstall-uxplay'),
  uninstallAll: () => ipcRenderer.invoke('uninstall-all'),

  // Instance persistence
  loadInstances: () => ipcRenderer.invoke('load-instances'),
  saveInstances: (data) => ipcRenderer.invoke('save-instances', data),

  // UxPlay control (per-instance)
  startUxplay: (instanceId, args) => ipcRenderer.invoke('start-uxplay', instanceId, args),
  stopUxplay: (instanceId) => ipcRenderer.invoke('stop-uxplay', instanceId),
  stopAllUxplay: () => ipcRenderer.invoke('stop-all-uxplay'),
  startAllUxplay: (entries) => ipcRenderer.invoke('start-all-uxplay', entries),
  getUxplayStatus: (instanceId) => ipcRenderer.invoke('get-uxplay-status', instanceId),
  getAllUxplayStatuses: () => ipcRenderer.invoke('get-all-uxplay-statuses'),

  // Dialogs
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  selectFile: (options) => ipcRenderer.invoke('select-file', options),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  saveFileDialog: (options) => ipcRenderer.invoke('save-file-dialog', options),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  readFileContents: (filePath) => ipcRenderer.invoke('read-file-contents', filePath),

  // Event listeners
  onLog: (callback) => {
    const handler = (_, msg) => callback(msg);
    ipcRenderer.on('log', handler);
    return () => ipcRenderer.removeListener('log', handler);
  },
  onProgress: (callback) => {
    const handler = (_, data) => callback(data);
    ipcRenderer.on('progress', handler);
    return () => ipcRenderer.removeListener('progress', handler);
  },
  onUxplayStatus: (callback) => {
    const handler = (_, instanceId, status) => callback(instanceId, status);
    ipcRenderer.on('uxplay-status', handler);
    return () => ipcRenderer.removeListener('uxplay-status', handler);
  },
});
