const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pathFor: (file) => webUtils.getPathForFile(file),
  pickFolder: (title) => ipcRenderer.invoke('pick-folder', title),
  scan: (p, kind) => ipcRenderer.invoke('scan', p, kind),
  scanSeparated: (p) => ipcRenderer.invoke('scan-separated', p),
  apply: (payload) => ipcRenderer.invoke('apply', payload),
  undoInfo: () => ipcRenderer.invoke('undo-info'),
  undo: () => ipcRenderer.invoke('undo'),
  saveReport: (payload) => ipcRenderer.invoke('save-report', payload),
  trash: (payload) => ipcRenderer.invoke('trash', payload),
  watch: (payload) => ipcRenderer.invoke('watch', payload),
  onFolderChanged: (cb) => ipcRenderer.on('folder-changed', () => cb()),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  getVersion: () => ipcRenderer.invoke('app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-updates'),
  openRelease: (url) => ipcRenderer.invoke('open-release', url),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
});
