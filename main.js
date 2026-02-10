require('dotenv').config();
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, shell, globalShortcut } = require('electron');
/** Backend proxy URL - keeps Azure keys server-side. Set API_BASE_URL in env to override. */
const API_BASE = process.env.API_BASE_URL || 'https://us-central1-alphaviewai-d7f9d.cloudfunctions.net';
const AUTH_CALLBACK_URL = 'https://alphaviewai.com/auth-callback.html?desktop=1';
const BUY_CREDITS_URL = 'https://alphaviewai.com/buy-credits.html';
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

// Use a writable userData path to avoid "Access is denied" cache errors on Windows
// (e.g. when running from OneDrive, restricted, or elevated folders)
app.setPath('userData', path.join(app.getPath('appData'), 'AlphaViewAI'));
const https = require('https');

/** Auth token storage - links desktop app to web user */
const AUTH_FILE = path.join(app.getPath('userData'), 'auth.json');

function getAuthData() {
  try {
    const raw = fs.readFileSync(AUTH_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function setAuthData(data) {
  try {
    fs.writeFileSync(AUTH_FILE, JSON.stringify(data || {}), 'utf8');
  } catch (e) { console.error('Auth save error', e); }
}

async function saveSessionToApi() {
  const auth = getAuthData();
  const token = auth?.token;
  if (!token || !sessionConfig || !sessionTranscriptHistory?.length) return;
  const session = {
    id: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    durationSeconds: sessionTimerSeconds || 0,
    sessionType: sessionConfig.sessionType || 'unknown',
    company: sessionConfig.company || '',
    position: sessionConfig.position || '',
    transcriptHistory: [...sessionTranscriptHistory],
    conversationHistory: [...(sessionConversationHistory || [])],
    config: {
      language: sessionConfig.language,
      instructions: sessionConfig.instructions,
      resumeSnippet: sessionConfig.resume || sessionConfig.resumeSnippet
    }
  };
  try {
    const res = await fetch(`${API_BASE}/saveSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(session),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Save session failed', res.status, errText);
    }
  } catch (e) { console.error('Save session error', e); }
}

function parseProtocolUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'alphaviewai:') return null;
    const token = u.searchParams.get('token');
    const email = u.searchParams.get('email');
    if (token) return { token, email: email || '' };
  } catch (_) {}
  return null;
}

function handleAuthUrl(url) {
  const data = parseProtocolUrl(url);
  if (!data) return;
  setAuthData({ token: data.token, email: data.email });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth-token-received', data);
  }
}
const FormData = require('form-data');

let mainWindow; // Launcher (icon/menu only)
let barWindow = null;
let leftWindow = null;
let rightWindow = null;
let snakeBarWindow = null;
let positionOverlayWindow = null;

// Option B: shared state in main for session windows
const APP_WIDTH = 583; /* 10% less than 648 for less square aspect */
const APP_HEIGHT = 480;
const BAR_HEIGHT = 48;
const BAR_MANUAL_ROW = 36;
const GAP = 10;
const SESSION_ISLAND_MARGIN = 14; /* space from screen edge so session bar looks like a floating island */
const LEFT_PANEL_WIDTH = 152; /* ~session bar height less than 200, more space for answer */
const HISTORY_EXTEND_LEFT = 80; /* history panel extends this far left of session bar */
const SNAKE_BAR_HEIGHT = 28;

let barManualExpanded = false;
let historyPanelVisible = false;
let snakeBarVisible = false;

let sessionConversationHistory = [];
let sessionInterviewSummary = '';
let sessionTranscriptHistory = [];
let sessionLiveTranscript = { mic: '', system: '' };
let sessionTimerSeconds = 0;
let sessionTimerIntervalId = null;
let sessionActive = false;
let sessionMinimized = false;
/** Session context from launcher: { company, position, resume, language, instructions } */
let sessionConfig = {};
let pendingAskQuestion = null;

// Periodically ensure session windows are visible. On Windows, certain OS-level
// actions (like screenshot tools) can temporarily hide or blank always-on-top
// windows even without our code explicitly hiding them. This watchdog restores
// visibility if the session is active and not minimized.
const SESSION_VISIBILITY_CHECK_MS = 1000;
setInterval(() => {
  if (!sessionActive || sessionMinimized) return;
  if (!barWindow || barWindow.isDestroyed()) return;
  try {
    barWindow.show();
    try { barWindow.setOpacity(1); } catch (_) {}
  } catch (_) {}
  try {
    if (historyPanelVisible && leftWindow && !leftWindow.isDestroyed()) {
      leftWindow.show();
      try { leftWindow.setOpacity(1); } catch (_) {}
    }
  } catch (_) {}
  try {
    if (rightWindow && !rightWindow.isDestroyed()) {
      rightWindow.show();
      try { rightWindow.setOpacity(1); } catch (_) {}
    }
  } catch (_) {}
  try {
    if (snakeBarVisible && snakeBarWindow && !snakeBarWindow.isDestroyed()) {
      snakeBarWindow.show();
      try { snakeBarWindow.setOpacity(1); } catch (_) {}
    }
  } catch (_) {}
}, SESSION_VISIBILITY_CHECK_MS);

const SESSION_POSITIONS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
let sessionPosition = 'top';

// Electron's "Render frame was disposed" from webContents.send() cannot be caught by try/catch or uncaughtException.
// We rely on webContents.once('render-process-gone') and 'destroyed' to clear the session timer and barWindow.

const LAUNCHER_SIZE = 52;
const LAUNCHER_MARGIN = 10;
const ONBOARDING_WIDTH = 360;
const ONBOARDING_HEIGHT = 420;
const STEP0_WIDTH = 360;
const STEP0_HEIGHT = 360;
const STEP1_WIDTH = 360;
const STEP1_HEIGHT = 400;
const STEP2_WIDTH = 380;
const STEP2_HEIGHT = 520;
const STEP3_WIDTH = 380;
const STEP3_HEIGHT = 420;

function centerTopPosition(width, height) {
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.floor(workArea.x + (workArea.width - width) / 2);
  const y = workArea.y;
  return { x, y, width, height };
}

function getLauncherBoundsForPosition(position) {
  const { workArea } = screen.getPrimaryDisplay();
  const w = workArea.width;
  const h = workArea.height;
  const size = LAUNCHER_SIZE;
  const m = LAUNCHER_MARGIN;
  let x = workArea.x + (w - size) / 2;
  let y = workArea.y;
  switch (position) {
    case 'top-left': x = workArea.x + m; y = workArea.y + m; break;
    case 'top': x = workArea.x + (w - size) / 2; y = workArea.y + m; break;
    case 'top-right': x = workArea.x + w - size - m; y = workArea.y + m; break;
    case 'left': x = workArea.x + m; y = workArea.y + (h - size) / 2; break;
    case 'center': x = workArea.x + (w - size) / 2; y = workArea.y + (h - size) / 2; break;
    case 'right': x = workArea.x + w - size - m; y = workArea.y + (h - size) / 2; break;
    case 'bottom-left': x = workArea.x + m; y = workArea.y + h - size - m; break;
    case 'bottom': x = workArea.x + (w - size) / 2; y = workArea.y + h - size - m; break;
    case 'bottom-right': x = workArea.x + w - size - m; y = workArea.y + h - size - m; break;
    default: x = workArea.x + (w - size) / 2; y = workArea.y + m; break;
  }
  return { x: Math.round(x), y: Math.round(y), width: size, height: size };
}

function getBarOrigin(position) {
  const { workArea } = screen.getPrimaryDisplay();
  let barX = workArea.x;
  let barY = workArea.y;
  const m = SESSION_ISLAND_MARGIN;
  switch (position) {
    case 'top-left': barX = workArea.x + m; barY = workArea.y + m; break;
    case 'top': barX = workArea.x + (workArea.width - APP_WIDTH) / 2; barY = workArea.y + m; break;
    case 'top-right': barX = workArea.x + workArea.width - APP_WIDTH - m; barY = workArea.y + m; break;
    case 'left': barX = workArea.x + m; barY = workArea.y + (workArea.height - APP_HEIGHT) / 2; break;
    case 'center': barX = workArea.x + (workArea.width - APP_WIDTH) / 2; barY = workArea.y + (workArea.height - APP_HEIGHT) / 2; break;
    case 'right': barX = workArea.x + workArea.width - APP_WIDTH - m; barY = workArea.y + (workArea.height - APP_HEIGHT) / 2; break;
    case 'bottom-left': barX = workArea.x + m; barY = workArea.y + workArea.height - APP_HEIGHT - m; break;
    case 'bottom': barX = workArea.x + (workArea.width - APP_WIDTH) / 2; barY = workArea.y + workArea.height - APP_HEIGHT - m; break;
    case 'bottom-right': barX = workArea.x + workArea.width - APP_WIDTH - m; barY = workArea.y + workArea.height - APP_HEIGHT - m; break;
    default: barX = workArea.x + (workArea.width - APP_WIDTH) / 2; barY = workArea.y + m; break;
  }
  barX = Math.round(Math.max(workArea.x, Math.min(workArea.x + workArea.width - APP_WIDTH, barX)));
  barY = Math.round(Math.max(workArea.y, Math.min(workArea.y + workArea.height - APP_HEIGHT, barY)));
  return { x: barX, y: barY };
}

const BOTTOM_POSITIONS = ['bottom-left', 'bottom', 'bottom-right'];

const OFFSCREEN = { x: -10000, y: -10000, width: 1, height: 1 };

function getSessionLayout(manualExpanded = false, position = sessionPosition) {
  const { x, y } = getBarOrigin(position);
  const barHeight = BAR_HEIGHT + (manualExpanded ? BAR_MANUAL_ROW : 0);
  const snakeGap = snakeBarVisible ? SNAKE_BAR_HEIGHT + GAP : 0;
  const panelHeight = APP_HEIGHT - barHeight - GAP - snakeGap;
  const leftPanelHeight = Math.floor(panelHeight / 2);
  const rightWidthNormal = APP_WIDTH - LEFT_PANEL_WIDTH - GAP;
  const rightWidthFull = APP_WIDTH;

  const base = { bar: null, left: null, right: null, snake: null };
  if (snakeBarVisible) {
    if (BOTTOM_POSITIONS.includes(position)) {
      base.snake = { x, y: y + APP_HEIGHT - barHeight - GAP - SNAKE_BAR_HEIGHT, width: APP_WIDTH, height: SNAKE_BAR_HEIGHT };
    } else {
      base.snake = { x, y: y + barHeight + GAP, width: APP_WIDTH, height: SNAKE_BAR_HEIGHT };
    }
  }

  if (!historyPanelVisible) {
    if (BOTTOM_POSITIONS.includes(position)) {
      base.bar = { x, y: y + APP_HEIGHT - barHeight, width: APP_WIDTH, height: barHeight };
      base.left = OFFSCREEN;
      base.right = { x, y, width: rightWidthFull, height: panelHeight };
      return base;
    }
    base.bar = { x, y, width: APP_WIDTH, height: barHeight };
    base.left = OFFSCREEN;
    base.right = { x, y: y + barHeight + GAP + snakeGap, width: rightWidthFull, height: panelHeight };
    return base;
  }

  const leftX = x - HISTORY_EXTEND_LEFT;
  const leftWidth = LEFT_PANEL_WIDTH + HISTORY_EXTEND_LEFT;
  if (BOTTOM_POSITIONS.includes(position)) {
    base.bar = { x, y: y + APP_HEIGHT - barHeight, width: APP_WIDTH, height: barHeight };
    base.left = { x: leftX, y, width: leftWidth, height: leftPanelHeight };
    base.right = { x: x + LEFT_PANEL_WIDTH + GAP, y, width: rightWidthNormal, height: panelHeight };
    return base;
  }
  base.bar = { x, y, width: APP_WIDTH, height: barHeight };
  base.left = { x: leftX, y: y + barHeight + GAP + snakeGap, width: leftWidth, height: leftPanelHeight };
  base.right = { x: x + LEFT_PANEL_WIDTH + GAP, y: y + barHeight + GAP + snakeGap, width: rightWidthNormal, height: panelHeight };
  return base;
}

function applySessionLayout() {
  const layout = getSessionLayout(barManualExpanded);
  if (barWindow && !barWindow.isDestroyed()) barWindow.setBounds(layout.bar);
  if (snakeBarWindow && !snakeBarWindow.isDestroyed()) {
    if (snakeBarVisible && layout.snake) {
      snakeBarWindow.setBounds(layout.snake);
      snakeBarWindow.show();
    } else {
      snakeBarWindow.setBounds(OFFSCREEN);
      snakeBarWindow.hide();
    }
  }
  if (leftWindow && !leftWindow.isDestroyed()) {
    if (historyPanelVisible) {
      leftWindow.setBounds(layout.left);
      leftWindow.show();
    } else {
      leftWindow.setBounds(layout.left);
      leftWindow.hide();
    }
  }
  if (rightWindow && !rightWindow.isDestroyed()) {
    rightWindow.setBounds(layout.right);
  }
}

const ZONE_DISPLAY_WIDTH = 200;
const ZONE_DISPLAY_HEIGHT = 140;
const ZONE_MARGIN = 20;

function getPositionBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const w = workArea.width;
  const h = workArea.height;
  const zw = ZONE_DISPLAY_WIDTH;
  const zh = ZONE_DISPLAY_HEIGHT;
  const m = ZONE_MARGIN;
  const cx = (w - zw) / 2;
  const cy = (h - zh) / 2;
  const positions = {
    'top-left': { x: m, y: m },
    'top': { x: cx, y: m },
    'top-right': { x: w - m - zw, y: m },
    'left': { x: m, y: cy },
    'center': { x: cx, y: cy },
    'right': { x: w - m - zw, y: cy },
    'bottom-left': { x: m, y: h - m - zh },
    'bottom': { x: cx, y: h - m - zh },
    'bottom-right': { x: w - m - zw, y: h - m - zh },
  };
  return SESSION_POSITIONS.map((position) => ({
    position,
    x: Math.round(positions[position].x),
    y: Math.round(positions[position].y),
    width: zw,
    height: zh,
  }));
}

function createAndShowPositionOverlayWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const { workArea } = screen.getPrimaryDisplay();
  if (positionOverlayWindow && !positionOverlayWindow.isDestroyed()) {
    positionOverlayWindow.show();
    positionOverlayWindow.focus();
    return;
  }
  positionOverlayWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    backgroundColor: '#00000000',
  });
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try { positionOverlayWindow.setContentProtection(true); } catch (_) {}
  }
  positionOverlayWindow.setMenuBarVisibility(false);
  positionOverlayWindow.loadFile(path.join(__dirname, 'renderer', 'position-overlay.html'));
  positionOverlayWindow.on('closed', () => {
    // If the overlay is closed without going through our IPC handler,
    // make sure the session UI is restored so the app doesn't appear
    // to disappear after things like OS screenshot tools.
    restoreSessionAfterOverlayClosed();
    positionOverlayWindow = null;
  });
  positionOverlayWindow.once('ready-to-show', () => {
    if (positionOverlayWindow && !positionOverlayWindow.isDestroyed()) {
      positionOverlayWindow.show();
      positionOverlayWindow.focus();
    }
  });
  positionOverlayWindow.on('hide', () => {
    // If the OS or snipping tool hides our overlay, close it so the 'closed'
    // handler restores the session and the app does not appear to disappear.
    if (positionOverlayWindow && !positionOverlayWindow.isDestroyed()) {
      positionOverlayWindow.close();
    }
  });
}

function showPositionOverlayWindow() {
  if (!sessionActive || !barWindow || barWindow.isDestroyed()) return;
  if (sessionMinimized) {
    createAndShowPositionOverlayWindow();
    return;
  }
  sessionMinimized = true;
  if (leftWindow && !leftWindow.isDestroyed()) leftWindow.hide();
  if (rightWindow && !rightWindow.isDestroyed()) rightWindow.hide();
  if (snakeBarWindow && !snakeBarWindow.isDestroyed()) snakeBarWindow.hide();
  if (barWindow && !barWindow.isDestroyed()) {
    const doAfterFade = () => {
      if (barWindow && !barWindow.isDestroyed()) barWindow.setBounds(BAR_MINIMIZED_BOUNDS);
      if (barWindow && !barWindow.isDestroyed()) try { barWindow.setOpacity(1); } catch (_) {}
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setMinimumSize(52, 52);
        mainWindow.setResizable(false);
        mainWindow.setBounds(getLauncherBoundsForPosition(sessionPosition));
        try { mainWindow.setOpacity(0); } catch (_) {}
        mainWindow.show();
        mainWindow.webContents.send('session-minimized');
        try {
          fadeWindowOpacity(mainWindow, 1, 4);
        } catch (_) {
          try { mainWindow.setOpacity(1); } catch (_) {}
        }
      }
      createAndShowPositionOverlayWindow();
    };
    try {
      fadeWindowOpacity(barWindow, 0, 4, doAfterFade);
    } catch (_) {
      setTimeout(doAfterFade, TRANSITION_MS);
    }
  } else {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setMinimumSize(52, 52);
      mainWindow.setResizable(false);
      mainWindow.setBounds(getLauncherBoundsForPosition(sessionPosition));
      mainWindow.show();
      mainWindow.webContents.send('session-minimized');
    }
    createAndShowPositionOverlayWindow();
  }
}

function closePositionOverlayWindow() {
  if (positionOverlayWindow && !positionOverlayWindow.isDestroyed()) {
    positionOverlayWindow.close();
    positionOverlayWindow = null;
  }
}

function restoreSessionAfterOverlayClosed() {
  // If the session was minimized to show the position overlay and the overlay
  // window gets closed externally (for example by the OS or user), make sure
  // we restore the session UI instead of leaving everything hidden.
  if (!sessionMinimized || !sessionActive || !barWindow || barWindow.isDestroyed()) return;

  sessionMinimized = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBounds({ x: -10000, y: -10000, width: 52, height: 52 });
    mainWindow.hide();
    try { mainWindow.setOpacity(1); } catch (_) {}
  }
  if (barWindow && !barWindow.isDestroyed()) {
    try { barWindow.setOpacity(0); } catch (_) {}
  }
  expandPending = true;
  expandFallbackTimer = setTimeout(() => finishExpandSession(undefined), 150);
}

function setupSessionHandlers(win) {
  if (!win || !win.webContents) return;
  win.webContents.session.setPermissionRequestHandler((_w, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') callback(true);
    else callback(false);
  });
  win.webContents.session.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 150, height: 150 } });
      if (!sources || sources.length === 0) {
        callback({});
        return;
      }
      const opts = { video: sources[0] };
      if (request.audioRequested && process.platform === 'win32') {
        opts.audio = 'loopback';
      }
      callback(opts);
    } catch (e) {
      callback({});
    }
  });
}

function createSessionWindows() {
  const layout = getSessionLayout();
  const preloadPath = path.join(__dirname, 'preload.js');

  barWindow = new BrowserWindow({
    ...layout.bar,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: 'session-bar',
    },
    show: false,
    backgroundColor: '#00000000',
  });
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try { barWindow.setContentProtection(true); } catch (_) {}
  }
  barWindow.setMenuBarVisibility(false);
  barWindow.loadFile(path.join(__dirname, 'renderer', 'bar.html'));
  setupSessionHandlers(barWindow);
  barWindow.webContents.once('destroyed', () => {
    if (sessionTimerIntervalId) {
      clearInterval(sessionTimerIntervalId);
      sessionTimerIntervalId = null;
    }
    barWindow = null;
  });
  barWindow.webContents.once('render-process-gone', () => {
    if (sessionTimerIntervalId) {
      clearInterval(sessionTimerIntervalId);
      sessionTimerIntervalId = null;
    }
    barWindow = null;
  });

  leftWindow = new BrowserWindow({
    ...layout.left,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: 'session-left',
    },
    show: false,
    backgroundColor: '#00000000',
  });
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try { leftWindow.setContentProtection(true); } catch (_) {}
  }
  leftWindow.setMenuBarVisibility(false);
  leftWindow.loadFile(path.join(__dirname, 'renderer', 'left.html'));
  setupSessionHandlers(leftWindow);
  leftWindow.webContents.once('destroyed', () => { leftWindow = null; });
  leftWindow.webContents.once('render-process-gone', () => { leftWindow = null; });

  rightWindow = new BrowserWindow({
    ...layout.right,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    minWidth: 200,
    minHeight: 120,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: 'session-right',
    },
    show: false,
    backgroundColor: '#00000000',
  });
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try { rightWindow.setContentProtection(true); } catch (_) {}
  }
  rightWindow.setMenuBarVisibility(false);
  rightWindow.loadFile(path.join(__dirname, 'renderer', 'right.html'));
  setupSessionHandlers(rightWindow);
  rightWindow.webContents.once('destroyed', () => { rightWindow = null; });
  rightWindow.webContents.once('render-process-gone', () => { rightWindow = null; });

  snakeBarWindow = new BrowserWindow({
    ...OFFSCREEN,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      partition: 'session-snake',
    },
    show: false,
    backgroundColor: '#00000000',
  });
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try { snakeBarWindow.setContentProtection(true); } catch (_) {}
  }
  snakeBarWindow.setMenuBarVisibility(false);
  snakeBarWindow.loadFile(path.join(__dirname, 'renderer', 'snake-bar.html'));
  setupSessionHandlers(snakeBarWindow);
  snakeBarWindow.webContents.once('destroyed', () => { snakeBarWindow = null; });
  snakeBarWindow.webContents.once('render-process-gone', () => { snakeBarWindow = null; });

  barWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBounds({ x: -10000, y: -10000, width: 52, height: 52 });
      mainWindow.hide();
    }
    applySessionLayout();
    barWindow.show();
    if (historyPanelVisible && leftWindow && !leftWindow.isDestroyed()) leftWindow.show();
    rightWindow.show();
    if (snakeBarVisible && snakeBarWindow && !snakeBarWindow.isDestroyed()) snakeBarWindow.show();
    barWindow.focus();
  });

  barWindow.on('closed', async () => {
    // Full-session credits are deducted server-side in saveSession (cannot be bypassed by modified client)
    saveSessionToApi();
    barWindow = null;
    sessionMinimized = false;
    snakeBarVisible = false;
    closePositionOverlayWindow();
    if (sessionTimerIntervalId) {
      clearInterval(sessionTimerIntervalId);
      sessionTimerIntervalId = null;
    }
    sessionActive = false;
    if (snakeBarWindow && !snakeBarWindow.isDestroyed()) snakeBarWindow.close();
    snakeBarWindow = null;
    if (leftWindow && !leftWindow.isDestroyed()) leftWindow.close();
    if (rightWindow && !rightWindow.isDestroyed()) rightWindow.close();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setMinimumSize(STEP1_WIDTH, STEP1_HEIGHT);
      mainWindow.setResizable(false);
      mainWindow.show();
      mainWindow.setBounds(centerTopPosition(STEP1_WIDTH, STEP1_HEIGHT));
      mainWindow.webContents.send('session-ended');
      mainWindow.webContents.send('credits-changed');
    }
  });
  leftWindow.on('closed', () => { leftWindow = null; });
  rightWindow.on('closed', () => { rightWindow = null; });
  snakeBarWindow.on('closed', () => { snakeBarWindow = null; });
}

function destroySessionWindows() {
  sessionMinimized = false;
  closePositionOverlayWindow();
  if (sessionTimerIntervalId) {
    clearInterval(sessionTimerIntervalId);
    sessionTimerIntervalId = null;
  }
  sessionActive = false;
  snakeBarVisible = false;
  if (barWindow && !barWindow.isDestroyed()) {
    barWindow.close();
    barWindow = null;
  }
  if (snakeBarWindow && !snakeBarWindow.isDestroyed()) {
    snakeBarWindow.close();
    snakeBarWindow = null;
  }
  if (leftWindow && !leftWindow.isDestroyed()) {
    leftWindow.close();
    leftWindow = null;
  }
  if (rightWindow && !rightWindow.isDestroyed()) {
    rightWindow.close();
    rightWindow = null;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setMinimumSize(STEP1_WIDTH, STEP1_HEIGHT);
      mainWindow.setResizable(false);
      mainWindow.show();
      mainWindow.setBounds(centerTopPosition(STEP1_WIDTH, STEP1_HEIGHT));
    mainWindow.webContents.send('session-ended');
  }
}

function createWindow() {
  const { width, height, x, y } = centerTopPosition(STEP1_WIDTH, STEP1_HEIGHT);

  mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    thickFrame: false,
    alwaysOnTop: true,
    resizable: false,
    minWidth: STEP1_WIDTH,
    minHeight: STEP1_HEIGHT,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
    show: false,
    backgroundColor: '#00000000',
  });
  if (process.platform === 'win32' || process.platform === 'darwin') {
    try { mainWindow.setContentProtection(true); } catch (_) {}
  }
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'launcher.html'));

  mainWindow.webContents.session.setPermissionRequestHandler((_w, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') callback(true);
    else callback(false);
  });

  mainWindow.webContents.session.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 150, height: 150 } });
      if (!sources || sources.length === 0) {
        callback({});
        return;
      }
      const opts = { video: sources[0] };
      if (request.audioRequested && process.platform === 'win32') {
        opts.audio = 'loopback';
      }
      callback(opts);
    } catch (e) {
      callback({});
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Launcher only: resize for icon / menu
ipcMain.handle('set-floating-size', (_event, state) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const sizes = {
    icon: { width: 52, height: 52 },
    menu: { width: 140, height: 112 },
  };
  const { width, height } = sizes[state] || sizes.icon;
  const { x, y } = centerTopPosition(width, height);
  mainWindow.setBounds({ x, y, width, height });
});

ipcMain.handle('start-session', (_event, config) => {
  sessionConfig = config && typeof config === 'object' ? { ...config } : {};
  if (sessionActive && barWindow && !barWindow.isDestroyed()) {
    if (!barWindow.isVisible()) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
      applySessionLayout();
      barWindow.show();
      if (leftWindow && !leftWindow.isDestroyed()) leftWindow.show();
      if (rightWindow && !rightWindow.isDestroyed()) rightWindow.show();
    }
    return;
  }
  if (sessionActive) return;
  sessionActive = true;
  snakeBarVisible = true;
  sessionConversationHistory = [];
  sessionInterviewSummary = '';
  sessionTranscriptHistory = [];
  sessionLiveTranscript = { mic: '', system: '' };
  sessionTimerSeconds = 0;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBounds({ x: -10000, y: -10000, width: 52, height: 52 });
    mainWindow.hide();
  }
  createSessionWindows();
  sessionTimerIntervalId = setInterval(() => {
    sessionTimerSeconds++;
    // Do not send timer-tick to barWindow; bar polls getTimer() instead to avoid "Render frame was disposed" when bar's frame is gone
  }, 1000);
});

ipcMain.handle('end-session', () => {
  destroySessionWindows();
});

const BAR_MINIMIZED_BOUNDS = { x: -10000, y: -10000, width: 2, height: 2 };
const TRANSITION_MS = 80;

function fadeWindowOpacity(win, targetOpacity, steps = 4, done) {
  if (!win || win.isDestroyed()) { if (done) done(); return; }
  let current = 1;
  try {
    current = win.getOpacity();
  } catch (_) {
    if (done) done();
    return;
  }
  const step = (targetOpacity - current) / steps;
  let n = 0;
  const tick = () => {
    if (!win || win.isDestroyed()) { if (done) done(); return; }
    n++;
    try {
      const next = n >= steps ? targetOpacity : current + step * n;
      win.setOpacity(Math.max(0, Math.min(1, next)));
    } catch (_) {}
    if (n >= steps) { if (done) done(); return; }
    setTimeout(tick, TRANSITION_MS / steps);
  };
  tick();
}

ipcMain.handle('collapse-session', () => {
  sessionMinimized = true;
  if (leftWindow && !leftWindow.isDestroyed()) leftWindow.hide();
  if (rightWindow && !rightWindow.isDestroyed()) rightWindow.hide();
  if (snakeBarWindow && !snakeBarWindow.isDestroyed()) snakeBarWindow.hide();
  if (barWindow && !barWindow.isDestroyed()) {
    const doAfterFade = () => {
      if (barWindow && !barWindow.isDestroyed()) barWindow.setBounds(BAR_MINIMIZED_BOUNDS);
      if (barWindow && !barWindow.isDestroyed()) try { barWindow.setOpacity(1); } catch (_) {}
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setMinimumSize(52, 52);
        mainWindow.setResizable(false);
        mainWindow.setBounds(getLauncherBoundsForPosition(sessionPosition));
        try { mainWindow.setOpacity(0); } catch (_) {}
        mainWindow.show();
        mainWindow.webContents.send('session-minimized');
        try {
          fadeWindowOpacity(mainWindow, 1, 4);
        } catch (_) {
          try { mainWindow.setOpacity(1); } catch (_) {}
        }
      }
    };
    try {
      fadeWindowOpacity(barWindow, 0, 4, doAfterFade);
    } catch (_) {
      setTimeout(doAfterFade, TRANSITION_MS);
    }
  } else {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setMinimumSize(52, 52);
      mainWindow.setResizable(false);
      mainWindow.setBounds(getLauncherBoundsForPosition(sessionPosition));
      mainWindow.show();
      mainWindow.webContents.send('session-minimized');
    }
  }
});

let expandPending = false;
let expandFallbackTimer = null;

function finishExpandSession(manualExpanded) {
  if (expandFallbackTimer) {
    clearTimeout(expandFallbackTimer);
    expandFallbackTimer = null;
  }
  expandPending = false;
  if (typeof manualExpanded === 'boolean') barManualExpanded = manualExpanded;
  applySessionLayout();
  if (leftWindow && !leftWindow.isDestroyed()) leftWindow.show();
  if (rightWindow && !rightWindow.isDestroyed()) rightWindow.show();
  try {
    fadeWindowOpacity(barWindow, 1, 4, () => {
      if (barWindow && !barWindow.isDestroyed()) barWindow.focus();
    });
  } catch (_) {
    try { if (barWindow && !barWindow.isDestroyed()) barWindow.setOpacity(1); } catch (_) {}
    if (barWindow && !barWindow.isDestroyed()) barWindow.focus();
  }
}

ipcMain.on('manual-state', (_event, expanded) => {
  if (!expandPending) return;
  finishExpandSession(!!expanded);
});

ipcMain.handle('expand-session', () => {
  if (!sessionActive || !barWindow || barWindow.isDestroyed()) return;
  sessionMinimized = false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    expandPending = true;
    const doExpand = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBounds({ x: -10000, y: -10000, width: 52, height: 52 });
        mainWindow.hide();
        try { mainWindow.setOpacity(1); } catch (_) {}
      }
      if (barWindow && !barWindow.isDestroyed()) try { barWindow.setOpacity(0); } catch (_) {}
      expandFallbackTimer = setTimeout(() => finishExpandSession(undefined), 150);
    };
    try {
      fadeWindowOpacity(mainWindow, 0, 4, doExpand);
    } catch (_) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBounds({ x: -10000, y: -10000, width: 52, height: 52 });
        mainWindow.hide();
      }
      doExpand();
    }
  } else {
    expandPending = true;
    expandFallbackTimer = setTimeout(() => finishExpandSession(undefined), 150);
  }
});

ipcMain.on('wave-levels', (_event, levels) => {
  if (sessionMinimized && mainWindow && !mainWindow.isDestroyed() && Array.isArray(levels) && levels.length >= 5) {
    mainWindow.webContents.send('wave-levels', levels.slice(0, 5));
  }
});

ipcMain.handle('get-conversation-history', () => sessionConversationHistory);
ipcMain.handle('get-transcript-history', () => sessionTranscriptHistory);
ipcMain.handle('get-live-transcript', () => ({ ...sessionLiveTranscript }));
ipcMain.handle('get-timer', () => sessionTimerSeconds);

function safeSend(win, channel, ...args) {
  try {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  } catch (e) {
    if (win === barWindow) {
      if (sessionTimerIntervalId) {
        clearInterval(sessionTimerIntervalId);
        sessionTimerIntervalId = null;
      }
      barWindow = null;
    } else if (win === leftWindow) {
      leftWindow = null;
    } else if (win === rightWindow) {
      rightWindow = null;
    } else if (win === snakeBarWindow) {
      snakeBarWindow = null;
    }
  }
}

ipcMain.handle('set-live-transcript', (_event, { source, text, isFinal }) => {
  if (source !== 'mic' && source !== 'system') return;
  if (isFinal) {
    sessionLiveTranscript[source] = '';
  } else {
    sessionLiveTranscript[source] = typeof text === 'string' ? text : '';
  }
  // Do not push to left/snake (avoids "Render frame was disposed"); they poll getLiveTranscript() instead
});

ipcMain.handle('clear-history', () => {
  sessionConversationHistory = [];
  sessionInterviewSummary = '';
  sessionTranscriptHistory = [];
  sessionLiveTranscript = { mic: '', system: '' };
});

function isNoiseTranscript(text) {
  const t = (text || '').trim();
  if (!t) return true;
  if (t.length <= 2 && /^[=\-\.\s,;:]+$/.test(t)) return true;
  if (/^=+$/.test(t)) return true;
  return false;
}

const MAX_TRANSCRIPT_HISTORY = 200;

ipcMain.handle('append-transcript', (_event, item) => {
  if (!item || item.time === undefined) return;
  const text = (item.text || '').trim();
  if (isNoiseTranscript(text)) return;
  sessionTranscriptHistory.push({
    text,
    time: item.time ? new Date(item.time) : new Date(),
    source: item.source || 'mic',
  });
  if (sessionTranscriptHistory.length > MAX_TRANSCRIPT_HISTORY) {
    sessionTranscriptHistory = sessionTranscriptHistory.slice(-MAX_TRANSCRIPT_HISTORY);
  }
});

const MAX_CONVERSATION_PAIRS = 6;
const INTERVIEW_SUMMARY_MAX_CHARS = 320;

ipcMain.handle('append-conversation', (_event, userContent, assistantContent) => {
  const now = new Date();
  sessionConversationHistory.push({ role: 'user', content: userContent, time: now });
  sessionConversationHistory.push({ role: 'assistant', content: assistantContent, time: now });
  if (sessionConversationHistory.length > MAX_CONVERSATION_PAIRS * 2) {
    sessionConversationHistory = sessionConversationHistory.slice(-MAX_CONVERSATION_PAIRS * 2);
  }
  const pairs = [];
  for (let i = 0; i < sessionConversationHistory.length; i += 2) {
    const u = sessionConversationHistory[i];
    const a = sessionConversationHistory[i + 1];
    if (u?.content && a?.content) pairs.push({ q: u.content, a: a.content });
  }
  const last3 = pairs.slice(-3);
  sessionInterviewSummary = last3
    .map((p) => 'Q: ' + (p.q || '').trim().split(/\s+/).slice(0, 10).join(' ') + ' A: ' + (p.a || '').trim().split(/\s+/).slice(0, 8).join(' '))
    .join('; ');
  if (sessionInterviewSummary.length > INTERVIEW_SUMMARY_MAX_CHARS) {
    sessionInterviewSummary = sessionInterviewSummary.slice(-INTERVIEW_SUMMARY_MAX_CHARS);
  }
});

ipcMain.handle('get-interview-summary', () => sessionInterviewSummary);

ipcMain.handle('get-right-panel-bounds', (event) => {
  if (!rightWindow || rightWindow.isDestroyed()) return null;
  if (event.sender !== rightWindow.webContents) return null;
  return rightWindow.getBounds();
});

ipcMain.handle('get-layout-inverted', () => BOTTOM_POSITIONS.includes(sessionPosition));

ipcMain.handle('toggle-history-panel', () => {
  historyPanelVisible = !historyPanelVisible;
  applySessionLayout();
  return historyPanelVisible;
});

ipcMain.handle('get-history-visible', () => historyPanelVisible);

ipcMain.handle('getSessionMinimized', () => sessionMinimized);

ipcMain.handle('set-snake-bar-visible', (_event, visible) => {
  snakeBarVisible = !!visible;
  applySessionLayout();
  return snakeBarVisible;
});
ipcMain.handle('get-snake-bar-visible', () => snakeBarVisible);

ipcMain.handle('set-history-panel-visible', (_event, visible) => {
  historyPanelVisible = !!visible;
  applySessionLayout();
  return historyPanelVisible;
});

ipcMain.handle('set-right-panel-bounds', (_event, { x, y, width, height }) => {
  if (!rightWindow || rightWindow.isDestroyed()) return;
  const b = rightWindow.getBounds();
  const newX = x != null ? x : b.x;
  const newY = y != null ? y : b.y;
  const w = width != null ? Math.max(200, Math.min(800, width)) : b.width;
  const h = height != null ? Math.max(120, Math.min(600, height)) : b.height;
  rightWindow.setBounds({ x: newX, y: newY, width: w, height: h });
});

ipcMain.handle('take-screenshot', async () => {
  try {
    const primary = screen.getPrimaryDisplay();
    const { width, height } = primary.size;
    const scale = Math.min(1, 1280 / width, 720 / height);
    const thumbWidth = Math.round(width * scale);
    const thumbHeight = Math.round(height * scale);
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbWidth, height: thumbHeight },
    });
    const source = sources[0];
    if (!source?.thumbnail) return { error: 'No screen capture' };
    const png = source.thumbnail.toPNG();
    const imageBase64 = png.toString('base64');
    return { imageBase64 };
  } catch (e) {
    return { error: e?.message || 'Screenshot failed' };
  }
});

ipcMain.handle('show-analysis-in-right', (_event, { question, answer }) => {
  if (rightWindow && !rightWindow.isDestroyed() && question != null && answer != null) {
    rightWindow.webContents.send('show-analysis-result', {
      question: typeof question === 'string' ? question : 'Screen analysis',
      answer: typeof answer === 'string' ? answer : '',
    });
  }
});

ipcMain.handle('request-ai-question', (_event, q) => {
  if (!q || typeof q !== 'string') return;
  pendingAskQuestion = q;
});

ipcMain.handle('getPendingAskQuestion', () => {
  const q = pendingAskQuestion;
  pendingAskQuestion = null;
  return q;
});

ipcMain.handle('set-manual-mode', (_event, expanded) => {
  barManualExpanded = !!expanded;
  applySessionLayout();
});

ipcMain.handle('move-session-to-position', (_event, position) => {
  if (!SESSION_POSITIONS.includes(position)) return;
  sessionPosition = position;
  applySessionLayout();
  closePositionOverlayWindow();
  if (sessionMinimized && sessionActive && barWindow && !barWindow.isDestroyed()) {
    sessionMinimized = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBounds({ x: -10000, y: -10000, width: 52, height: 52 });
      mainWindow.hide();
      try { mainWindow.setOpacity(1); } catch (_) {}
    }
    if (barWindow && !barWindow.isDestroyed()) try { barWindow.setOpacity(0); } catch (_) {}
    expandPending = true;
    expandFallbackTimer = setTimeout(() => finishExpandSession(undefined), 150);
  }
});

ipcMain.handle('show-position-overlay', () => {
  showPositionOverlayWindow();
});

ipcMain.handle('get-position-bounds', () => {
  return getPositionBounds();
});

ipcMain.on('close-position-overlay', () => {
  closePositionOverlayWindow();
  if (sessionMinimized && sessionActive && barWindow && !barWindow.isDestroyed()) {
    sessionMinimized = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBounds({ x: -10000, y: -10000, width: 52, height: 52 });
      mainWindow.hide();
      try { mainWindow.setOpacity(1); } catch (_) {}
    }
    if (barWindow && !barWindow.isDestroyed()) try { barWindow.setOpacity(0); } catch (_) {}
    expandPending = true;
    expandFallbackTimer = setTimeout(() => finishExpandSession(undefined), 150);
  }
});

ipcMain.handle('get-screen-bounds', () => {
  const { workArea } = screen.getPrimaryDisplay();
  return workArea;
});

ipcMain.handle('get-azure-speech-config', async () => {
  const language = (sessionConfig.language || 'en-US').trim() || 'en-US';
  const sessionType = (sessionConfig.sessionType || '').toString().toLowerCase();
  const isPaidSession = sessionType === 'full' || sessionType === 'exam';
  let url = `${API_BASE}/speechToken?language=${encodeURIComponent(language)}`;
  if (isPaidSession) url += '&mode=full';
  const auth = getAuthData();
  const headers = auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
  // Try backend proxy first (returns { token, region, language }) - no keys in app
  try {
    const res = await fetch(url, { headers: Object.keys(headers).length ? headers : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token && data.region) {
      return { token: data.token, region: data.region, language: data.language || language };
    }
    if (res.status === 403 && data.code === 'FREE_SESSION_COOLDOWN') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('free-session-cooldown', {
          message: data.error || 'Please wait 5 minutes before starting another free session.',
          waitSeconds: data.waitSeconds || 300,
        });
      }
      return { error: data.error, code: 'FREE_SESSION_COOLDOWN', waitSeconds: data.waitSeconds || 300 };
    }
  } catch (_) {}
  // Fallback: local env (for dev only - keys in .env)
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION || 'eastus';
  if (key && region) return { key, region, language };
  return null;
});

ipcMain.handle('get-session-config', () => sessionConfig);
ipcMain.handle('is-session-active', () => sessionActive);

function getSpeechProvider() {
  const fromSession = sessionConfig?.speechProvider;
  if (fromSession === 'deepgram' || fromSession === 'azure') return fromSession;
  const fromEnv = (process.env.SPEECH_PROVIDER || '').toLowerCase();
  if (fromEnv === 'deepgram' || fromEnv === 'azure') return fromEnv;
  return 'deepgram';
}
ipcMain.handle('get-speech-provider', () => getSpeechProvider());

ipcMain.handle('get-deepgram-streaming-config', async () => {
  const language = (sessionConfig.language || 'en-US').trim() || 'en-US';
  const sessionType = (sessionConfig.sessionType || '').toString().toLowerCase();
  const isPaidSession = sessionType === 'full' || sessionType === 'exam';
  let url = `${API_BASE}/deepgramStreamingConfig?language=${encodeURIComponent(language)}`;
  if (isPaidSession) url += '&mode=full';
  const auth = getAuthData();
  const headers = auth?.token ? { Authorization: `Bearer ${auth.token}` } : {};
  try {
    const res = await fetch(url, { headers: Object.keys(headers).length ? headers : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.apiKey) {
      return { apiKey: data.apiKey, language: data.language || language };
    }
    if (res.status === 403 && data.code === 'FREE_SESSION_COOLDOWN') {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('free-session-cooldown', {
          message: data.error || 'Please wait 5 minutes before starting another free session.',
          waitSeconds: data.waitSeconds || 300,
        });
      }
      return { error: data.error, code: 'FREE_SESSION_COOLDOWN', waitSeconds: data.waitSeconds || 300 };
    }
    if (data.error) return { error: data.error };
  } catch (_) {}
  return null;
});

let authWindow = null;
ipcMain.handle('open-auth-url', () => {
  if (app.isPackaged) {
    shell.openExternal(AUTH_CALLBACK_URL);
    return;
  }
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus();
    return;
  }
  authWindow = new BrowserWindow({
    width: 480,
    height: 640,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  authWindow.setMenuBarVisibility(false);
  const handleAuthRedirect = (e, url) => {
    if (url.startsWith('alphaviewai:')) {
      e.preventDefault();
      handleAuthUrl(url);
      if (authWindow && !authWindow.isDestroyed()) authWindow.close();
      authWindow = null;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
    }
  };
  authWindow.webContents.on('will-navigate', handleAuthRedirect);
  authWindow.webContents.on('will-redirect', handleAuthRedirect);
  authWindow.on('closed', () => { authWindow = null; });
  authWindow.loadURL(AUTH_CALLBACK_URL);
});
ipcMain.handle('open-buy-credits-url', () => shell.openExternal(BUY_CREDITS_URL));
ipcMain.handle('get-auth-data', () => getAuthData());
ipcMain.handle('get-app-version', () => app.getVersion());
ipcMain.handle('sign-out-auth', () => { setAuthData(null); });

async function fetchUserCredits() {
  const auth = getAuthData();
  const token = auth?.token;
  if (!token) return { creditsMinutes: 0 };
  try {
    const res = await fetch(`${API_BASE}/userCredits`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { creditsMinutes: 0 };
    const data = await res.json();
    return { creditsMinutes: Math.max(0, Number(data?.creditsMinutes) || 0) };
  } catch (_) {
    return { creditsMinutes: 0 };
  }
}

async function deductUserCredits(minutesUsed) {
  const auth = getAuthData();
  const token = auth?.token;
  if (!token || minutesUsed <= 0) return;
  try {
    await fetch(`${API_BASE}/userCreditsDeduct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ minutesUsed }),
    });
  } catch (e) {
    console.error('Deduct credits failed', e);
  }
}

ipcMain.handle('get-user-credits', () => fetchUserCredits());

async function apiWithAuth(path, options = {}) {
  const auth = getAuthData();
  const token = auth?.token;
  if (!token) return { error: 'Not signed in' };
  const url = `${API_BASE}${path}`;
  const headers = { ...options.headers, Authorization: `Bearer ${token}` };
  try {
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || res.statusText };
    return data;
  } catch (e) {
    return { error: e.message || 'Request failed' };
  }
}

ipcMain.handle('list-resumes', async () => {
  const data = await apiWithAuth('/listResumes');
  if (data.error) return { resumes: [], error: data.error };
  return { resumes: data.resumes || [] };
});

ipcMain.handle('get-resume', async (_event, resumeId) => {
  if (!resumeId) return { error: 'resumeId required' };
  const data = await apiWithAuth(`/getResume?resumeId=${encodeURIComponent(resumeId)}`);
  if (data.error) return { error: data.error };
  return data;
});

ipcMain.handle('upload-resume', async (_event, { fileBase64, fileName, name, textSummary, mimeType }) => {
  if (!fileBase64) return { error: 'fileBase64 required' };
  const data = await apiWithAuth('/uploadResume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileBase64,
      fileName: fileName || 'resume.pdf',
      name: name || fileName || 'Resume',
      textSummary: textSummary || '',
      mimeType: mimeType || 'application/octet-stream',
    }),
  });
  if (data.error) return { error: data.error };
  return { id: data.id, name: data.name, createdAt: data.createdAt };
});

ipcMain.handle('check-for-updates', () => {
  if (process.platform === 'win32' && app.isPackaged) {
    return autoUpdater.checkForUpdates().catch((e) => { console.error('Update check failed', e); throw e; });
  }
  return Promise.resolve(null);
});

ipcMain.handle('quit-and-install', () => {
  if (process.platform === 'win32' && app.isPackaged) {
    autoUpdater.quitAndInstall(false, true);
  } else {
    app.quit();
  }
});

ipcMain.handle('get-window-bounds', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  return mainWindow.getBounds();
});

ipcMain.handle('set-window-bounds', (_event, { x, y, width, height }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const minW = 52, minH = 52, maxW = 400, maxH = 400;
  const b = mainWindow.getBounds();
  const w = width != null ? Math.min(maxW, Math.max(minW, width)) : b.width;
  const h = height != null ? Math.min(maxH, Math.max(minH, height)) : b.height;
  const newX = x != null ? x : b.x;
  const newY = y != null ? y : b.y;
  mainWindow.setBounds({ x: newX, y: newY, width: w, height: h });
});

ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.minimize();
});
ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle('launcher-minimize-to-icon', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setMinimumSize(52, 52);
  const bounds = getLauncherBoundsForPosition('top');
  mainWindow.setBounds(bounds);
  mainWindow.setResizable(false);
  mainWindow.webContents.send('launcher-minimized-to-icon');
});

ipcMain.handle('launcher-restore-from-icon', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setMinimumSize(STEP1_WIDTH, STEP1_HEIGHT);
  mainWindow.setResizable(false);
  mainWindow.setBounds(centerTopPosition(STEP1_WIDTH, STEP1_HEIGHT));
  mainWindow.webContents.send('launcher-restored-from-icon');
});

ipcMain.handle('launcher-set-step-size', (_event, step) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const sizes = { 0: [STEP0_WIDTH, STEP0_HEIGHT], 1: [STEP1_WIDTH, STEP1_HEIGHT], 2: [STEP2_WIDTH, STEP2_HEIGHT], 3: [STEP3_WIDTH, STEP3_HEIGHT] };
  const [w, h] = sizes[step] || sizes[1];
  mainWindow.setMinimumSize(w, h);
  mainWindow.setBounds(centerTopPosition(w, h));
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', (_event, argv) => {
  if (mainWindow) mainWindow.focus();
  const url = argv.find((a) => typeof a === 'string' && a.startsWith('alphaviewai://'));
  if (url) handleAuthUrl(url);
});

function forceShowAllWindows() {
  try {
    if (sessionActive && barWindow && !barWindow.isDestroyed()) {
      barWindow.show();
      try { barWindow.setOpacity(1); } catch (_) {}
      barWindow.focus();
      if (leftWindow && !leftWindow.isDestroyed()) {
        leftWindow.show();
        try { leftWindow.setOpacity(1); } catch (_) {}
      }
      if (rightWindow && !rightWindow.isDestroyed()) {
        rightWindow.show();
        try { rightWindow.setOpacity(1); } catch (_) {}
      }
      if (snakeBarVisible && snakeBarWindow && !snakeBarWindow.isDestroyed()) {
        snakeBarWindow.show();
        try { snakeBarWindow.setOpacity(1); } catch (_) {}
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      try { mainWindow.setOpacity(1); } catch (_) {}
      if (!sessionActive || !barWindow || barWindow.isDestroyed()) mainWindow.focus();
    }
  } catch (_) {}
}

app.whenReady().then(() => {
  // Only register protocol when packaged; in dev we use an in-app auth window to avoid "Unable to find Electron app" when OS launches electron with URL as argv
  if (app.isPackaged) app.setAsDefaultProtocolClient('alphaviewai');
  createWindow();

  globalShortcut.register('CommandOrControl+Shift+R', () => forceShowAllWindows());
  // Handle protocol URL when this instance was launched with alphaviewai:// (e.g. first launch from browser)
  const cmd = process.argv.find((a) => typeof a === 'string' && a.startsWith('alphaviewai://'));
  if (cmd) handleAuthUrl(cmd);
  if (process.platform === 'win32' && app.isPackaged) {
    autoUpdater.setFeedURL({ provider: 'generic', url: 'https://alphaviewai.com/releases/' });
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-available', (info) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-available', info?.version);
    });
    autoUpdater.on('update-downloaded', () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-downloaded');
      setTimeout(() => { autoUpdater.quitAndInstall(); }, 3000);
    });
    autoUpdater.on('error', (err) => {
      console.error('Updater error', err);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-error', err?.message || 'Check failed');
    });
    autoUpdater.checkForUpdates().catch((e) => console.error('Update check failed', e));
  }
});

app.on('open-url', (_event, url) => { handleAuthUrl(url); });

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', () => { globalShortcut.unregisterAll(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

function getAzureOpenAIConfig() {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o-mini';
  if (!apiKey || !endpoint) return null;
  return { apiKey, endpoint, deployment };
}

// AI: non-streaming (fallback)
ipcMain.handle('call-ai', async (_event, { transcript, systemPrompt }) => {
  const body = {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript },
    ],
    max_tokens: 512,
    temperature: 0.2,
    top_p: 1,
  };
  const auth = getAuthData();
  const headers = { 'Content-Type': 'application/json' };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  try {
    const res = await fetch(`${API_BASE}/openaiChat`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    if (data.choices?.[0]?.message?.content) return { text: data.choices[0].message.content };
  } catch (e) { /* fallback */ }
  // Fallback: local env
  const cfg = getAzureOpenAIConfig();
  if (!cfg) return { error: 'AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required.' };
  try {
    const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/chat/completions?api-version=2025-01-01-preview`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': cfg.apiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    return { text: data.choices?.[0]?.message?.content ?? '' };
  } catch (e) {
    return { error: e.message };
  }
});

// AI: streaming with full conversation context (Azure OpenAI)
ipcMain.handle('call-ai-stream', async (event, { messages }) => {
  const sender = event.sender;
  if (!Array.isArray(messages) || messages.length === 0) {
    sender.send('ai-stream-error', 'Messages required.');
    return;
  }
  const body = { messages, max_tokens: 512, temperature: 0.2, top_p: 1 };
  const auth = getAuthData();
  const headers = { 'Content-Type': 'application/json' };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  try {
    const res = await fetch(`${API_BASE}/openaiChatStream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') { sender.send('ai-stream-done'); return; }
            try {
              const obj = JSON.parse(data);
              const content = obj.choices?.[0]?.delta?.content;
              if (typeof content === 'string' && content) sender.send('ai-stream-chunk', content);
            } catch (_) {}
          }
        }
      }
      if (buffer.startsWith('data: ')) {
        const data = buffer.slice(6).trim();
        if (data !== '[DONE]') {
          try {
            const obj = JSON.parse(data);
            const content = obj.choices?.[0]?.delta?.content;
            if (typeof content === 'string' && content) sender.send('ai-stream-chunk', content);
          } catch (_) {}
        }
      }
      sender.send('ai-stream-done');
      return;
    }
  } catch (_) { /* fallback */ }
  // Fallback: local env
  const cfg = getAzureOpenAIConfig();
  if (!cfg) {
    sender.send('ai-stream-error', 'AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required.');
    return;
  }
  try {
    const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/chat/completions?api-version=2025-01-01-preview`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': cfg.apiKey },
      body: JSON.stringify({ ...body, stream: true }),
    });
    if (!res.ok) {
      const err = await res.text();
      sender.send('ai-stream-error', err || res.statusText);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            sender.send('ai-stream-done');
            return;
          }
          try {
            const obj = JSON.parse(data);
            const content = obj.choices?.[0]?.delta?.content;
            if (typeof content === 'string' && content) sender.send('ai-stream-chunk', content);
          } catch (_) {}
        }
      }
    }
    if (buffer.startsWith('data: ')) {
      const data = buffer.slice(6).trim();
      if (data !== '[DONE]') {
        try {
          const obj = JSON.parse(data);
          const content = obj.choices?.[0]?.delta?.content;
          if (typeof content === 'string' && content) sender.send('ai-stream-chunk', content);
        } catch (_) {}
      }
    }
    sender.send('ai-stream-done');
  } catch (e) {
    sender.send('ai-stream-error', e.message || 'Request failed');
  }
});

// Transcribe audio via Azure or Deepgram (Whisper fallback path)
ipcMain.handle('transcribe-audio', async (event, base64Audio, mimeType = 'audio/webm') => {
  if (!base64Audio || typeof base64Audio !== 'string') return { error: 'Audio data required.' };
  const buffer = Buffer.from(base64Audio, 'base64');
  if (buffer.length < 500) return { error: 'Empty audio.' };
  const language = (sessionConfig.language || 'en-US').trim() || 'en-US';
  const auth = getAuthData();
  const headers = { 'Content-Type': 'application/json' };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  const provider = getSpeechProvider();

  const tryDeepgram = async () => {
    const t0 = Date.now();
    const res = await fetch(`${API_BASE}/deepgramTranscribe`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ audio: base64Audio, language }),
    });
    const ms = Date.now() - t0;
    const data = await res.json();
    if (process.env.NODE_ENV !== 'production') console.log(`[transcribe] deepgram ${ms}ms`);
    if (data.text) return { text: data.text };
    if (data.error) return { error: data.error };
    return null;
  };

  const tryAzure = async () => {
    const t0 = Date.now();
    try {
      const res = await fetch(`${API_BASE}/speechTranscribe`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ audio: base64Audio, language }),
      });
      const data = await res.json();
      const ms = Date.now() - t0;
      if (process.env.NODE_ENV !== 'production') console.log(`[transcribe] azure ${ms}ms`);
      if (data.text) return { text: data.text };
      if (data.error) return { error: data.error };
    } catch (_) { /* fallback */ }
    const azureKey = process.env.AZURE_SPEECH_KEY;
    const azureRegion = process.env.AZURE_SPEECH_REGION || 'eastus';
    if (!azureKey || !azureRegion) return { error: 'AZURE_SPEECH_KEY and AZURE_SPEECH_REGION required.' };
    try {
      const url = `https://${azureRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Ocp-Apim-Subscription-Key': azureKey, 'Content-Type': 'audio/webm', Accept: 'application/json' },
        body: buffer,
      });
      const data = await res.json();
      if (data.RecognitionStatus === 'Success' && data.DisplayText) return { text: data.DisplayText };
      return { error: data.RecognitionStatus === 'NoMatch' ? 'No speech detected' : (data.RecognitionStatus || 'Failed') };
    } catch (e) {
      return { error: e.message };
    }
  };

  if (provider === 'deepgram') {
    const result = await tryDeepgram();
    if (result) return result;
    return await tryAzure();
  }
  return await tryAzure();
});

ipcMain.handle('analyze-image', async (_event, { imageBase64, prompt }) => {
  const payload = { imageBase64, prompt };
  const auth = getAuthData();
  const headers = { 'Content-Type': 'application/json' };
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  try {
    const res = await fetch(`${API_BASE}/analyzeImage`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.text) return { text: data.text };
    if (data.error) return { error: data.error.message };
  } catch (_) { /* fallback */ }
  // Fallback: local env
  const cfg = getAzureOpenAIConfig();
  if (!cfg) return { error: 'AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT required.' };
  try {
    const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment}/chat/completions?api-version=2025-01-01-preview`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': cfg.apiKey },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt || 'What is on this screen? Provide a concise answer or solution.' },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });
    const data = await res.json();
    if (data.error) return { error: data.error.message };
    return { text: data.choices?.[0]?.message?.content ?? '' };
  } catch (e) {
    return { error: e.message };
  }
});
