const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Renderer → Main
  sendTranscriptChunk: (text) => ipcRenderer.send('transcript-chunk', text),
  sendTranscriptUpdate: (text) => ipcRenderer.send('transcript-update', text),
  sendCaptureStatus: (status) => ipcRenderer.send('capture-status', status),
  clearTips: () => ipcRenderer.send('clear-tips'),

  // Main → Renderer (listeners)
  onCoachingTip: (cb) => ipcRenderer.on('coaching-tip', (_, tip) => cb(tip)),
  onTranscriptUpdate: (cb) => ipcRenderer.on('transcript-update', (_, text) => cb(text)),
  onCaptureStatus: (cb) => ipcRenderer.on('capture-status', (_, status) => cb(status)),
  onClearTips: (cb) => ipcRenderer.on('clear-tips', () => cb()),

  // Queries
  getEnv: () => ipcRenderer.invoke('get-env'),
});
