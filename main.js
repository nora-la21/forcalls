require('dotenv').config();
const { app, BrowserWindow, ipcMain, screen, globalShortcut, desktopCapturer, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const CoachingEngine = require('./src/coaching-engine');

let overlayWindow = null;
let controlWindow = null;
const coachingEngine = new CoachingEngine();

function createOverlayWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  overlayWindow = new BrowserWindow({
    width: 400,
    height: 600,
    x: width - 420,
    y: height - 620,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  // When renderer signals mouse is over draggable area, enable mouse events
  ipcMain.on('overlay-set-interactive', (event, interactive) => {
    if (overlayWindow) overlayWindow.setIgnoreMouseEvents(!interactive, { forward: true });
  });

  // Make invisible to screen sharing (Mac: setContentProtection, Windows: handled via CSS trick)
  overlayWindow.setContentProtection(true);
}

function createControlWindow() {
  controlWindow = new BrowserWindow({
    width: 420,
    height: 440,
    resizable: false,
    title: 'ForCalls — Sales Coach',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  controlWindow.loadFile(path.join(__dirname, 'renderer', 'control.html'));
  controlWindow.on('closed', () => {
    app.quit();
  });
}

app.whenReady().then(() => {
  createOverlayWindow();
  createControlWindow();

  // Grant mic + screen capture permissions without prompting
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') return callback(true);
    callback(false);
  });
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    });
  });

  // Toggle overlay visibility: Ctrl+Shift+H
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    if (overlayWindow) {
      if (overlayWindow.isVisible()) {
        overlayWindow.hide();
      } else {
        overlayWindow.show();
      }
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC: receive transcript from renderer, send to Claude, push tip back
ipcMain.on('transcript-chunk', async (event, text) => {
  const tip = await coachingEngine.analyze(text);
  if (tip && tip.type !== 'none') {
    if (overlayWindow) overlayWindow.webContents.send('coaching-tip', tip);
    if (controlWindow) controlWindow.webContents.send('coaching-tip', tip);
  }
});

ipcMain.on('transcript-update', (event, fullTranscript) => {
  if (overlayWindow) overlayWindow.webContents.send('transcript-update', fullTranscript);
});

ipcMain.on('capture-status', (event, status) => {
  if (overlayWindow) overlayWindow.webContents.send('capture-status', status);
  // Don't echo back to controlWindow — it already updated its own UI
});

ipcMain.on('clear-tips', () => {
  if (overlayWindow) overlayWindow.webContents.send('clear-tips');
});

ipcMain.handle('get-overlay-position', () => {
  const [x, y] = overlayWindow.getPosition();
  return [x, y];
});

ipcMain.on('move-overlay', (event, x, y) => {
  if (overlayWindow) overlayWindow.setPosition(Math.round(x), Math.round(y));
});

ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] });
  return sources.map((s) => ({ id: s.id, name: s.name }));
});

ipcMain.handle('get-env', () => ({
  hasDeepgramKey: !!process.env.DEEPGRAM_API_KEY,
  deepgramKey: process.env.DEEPGRAM_API_KEY || '',
  providers: coachingEngine.getProviders(),
}));

ipcMain.on('set-provider', (event, providerKey) => {
  coachingEngine.setProvider(providerKey);
});

ipcMain.on('set-mode', (event, mode) => {
  coachingEngine.setMode(mode);
});

ipcMain.on('set-context', (event, text) => {
  coachingEngine.setContext(text);
});

ipcMain.on('set-tactics', (event, text) => {
  coachingEngine.setTactics(text);
});

ipcMain.handle('open-battlecard', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(controlWindow, {
    title: 'Open Battlecard',
    filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'txt'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return null;

  const filePath = filePaths[0];
  const ext = filePath.split('.').pop().toLowerCase();

  if (ext === 'txt') {
    return fs.readFileSync(filePath, 'utf8');
  }
  if (ext === 'pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (ext === 'docx' || ext === 'doc') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  return null;
});

ipcMain.handle('generate-report', async (event, { transcript, tips }) => {
  return coachingEngine.generateReport(transcript, tips);
});
