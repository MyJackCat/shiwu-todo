const { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const WEB_DIST = process.env.SHIWU_WEB_DIST || path.join(__dirname, '..', 'web', 'dist');
const INDEX = path.join(WEB_DIST, 'index.html');
const ICON = path.join(__dirname, 'assets', 'icon.png');
const TRAY_ICON = path.join(__dirname, 'assets', 'tray.png');
const WIDGET_WIDTH = 348;
const WIDGET_HEIGHT = 486;
const PET_WIDTH = 176;
const PET_HEIGHT = 176;

app.setName('事务待办');
app.setAppUserModelId('com.shiwu.todo');


let mainWindow = null;
let widgetWindow = null;
let tray = null;
let quitting = false;
let reminderWindow = null;
let reminderReady = false;
let reminderPayload = null;
let reminderTimer = null;
let windowDrag = null;

let state = {
  widget: {
    x: null,
    y: null,
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    visible: true,
    onTop: true,
    collapsed: false,
  },
};

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    state = { ...state, ...saved, widget: { ...state.widget, ...(saved.widget || {}) } };
  } catch {
    // 首次启动
  }
  // 小组件在完整卡片和桌宠之间切换，尺寸固定，避免历史状态或拖拽事故把它拉得过大
  state.widget.collapsed = !!state.widget.collapsed;
  state.widget.width = state.widget.collapsed ? PET_WIDTH : WIDGET_WIDTH;
  state.widget.height = state.widget.collapsed ? PET_HEIGHT : WIDGET_HEIGHT;
}

function saveState() {
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
  } catch {
    // 忽略
  }
}

function widgetBoundsVisible(widgetState) {
  if (widgetState.x == null || widgetState.y == null) return false;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      widgetState.x < area.x + area.width &&
      widgetState.x + widgetState.width > area.x &&
      widgetState.y < area.y + area.height &&
      widgetState.y + widgetState.height > area.y
    );
  });
}

function ensureMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 380,
    minHeight: 520,
    title: '事务待办',
    backgroundColor: '#f3f2ee',
    show: false,
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(INDEX);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return mainWindow;
}

function saveWidgetBounds() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const bounds = widgetWindow.getBounds();
  state.widget = { ...state.widget, ...bounds };
  saveState();
}

function ensureWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) return widgetWindow;

  const saved = state.widget;
  const collapsed = !!saved.collapsed;
  const width = collapsed ? PET_WIDTH : WIDGET_WIDTH;
  const height = collapsed ? PET_HEIGHT : WIDGET_HEIGHT;
  const bounds = { width, height };
  if (widgetBoundsVisible(saved)) {
    bounds.x = saved.x;
    bounds.y = saved.y;
  }

  widgetWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: false,
    minWidth: width,
    minHeight: height,
    maxWidth: width,
    maxHeight: height,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: '事务待办',
    icon: ICON,
    alwaysOnTop: saved.onTop !== false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  widgetWindow.setResizable(false);
  widgetWindow.setMinimumSize(width, height);
  widgetWindow.setMaximumSize(width, height);
  widgetWindow.setAlwaysOnTop(saved.onTop !== false, 'floating');
  widgetWindow.loadFile(INDEX, { query: { widget: '1', collapsed: collapsed ? '1' : '0' } });
  widgetWindow.once('ready-to-show', () => {
    if (state.widget.visible !== false) widgetWindow.showInactive();
  });
  widgetWindow.on('move', saveWidgetBounds);
  widgetWindow.on('resize', saveWidgetBounds);
  widgetWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      setWidgetVisible(false);
    }
  });
  widgetWindow.on('closed', () => {
    widgetWindow = null;
  });

  return widgetWindow;
}

function setWidgetVisible(visible) {
  ensureWidgetWindow();
  state.widget.visible = !!visible;
  saveState();
  if (visible) widgetWindow.showInactive();
  else widgetWindow.hide();
  refreshTrayMenu();
}

function setWidgetOnTop(onTop) {
  state.widget.onTop = !!onTop;
  saveState();
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.setAlwaysOnTop(!!onTop, 'floating');
  }
  refreshTrayMenu();
}

function resizeWidgetWindow(width, height) {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const win = widgetWindow;
  const current = win.getBounds();
  const display = screen.getDisplayMatching(current);
  const area = display.workArea;
  const x = Math.max(area.x, Math.min(current.x, area.x + area.width - width));
  const y = Math.max(area.y, Math.min(current.y, area.y + area.height - height));

  // 先解除固定尺寸，再同时设置位置和尺寸，最后重新锁定，避免 DPI 取整导致尺寸漂移
  win.setResizable(true);
  win.setMinimumSize(1, 1);
  win.setMaximumSize(10000, 10000);
  win.setBounds({ x, y, width, height }, false);
  win.setResizable(false);
  win.setMinimumSize(width, height);
  win.setMaximumSize(width, height);

  state.widget.x = x;
  state.widget.y = y;
  state.widget.width = width;
  state.widget.height = height;
  saveState();
}

function setWidgetCollapsed(collapsed) {
  state.widget.collapsed = !!collapsed;
  saveState();
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const width = state.widget.collapsed ? PET_WIDTH : WIDGET_WIDTH;
  const height = state.widget.collapsed ? PET_HEIGHT : WIDGET_HEIGHT;
  const bounds = widgetWindow.getBounds();
  if (bounds.width === width && bounds.height === height) return;
  resizeWidgetWindow(width, height);
}

function showMain(taskId, newKind) {
  const win = ensureMainWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();

  if (newKind === 'task' || newKind === 'reminder') {
    const send = () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('new-task', newKind);
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
  } else if (taskId) {
    const send = () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('open-task', taskId);
    };
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
  }
}

function positionReminderWindow() {
  if (!reminderWindow || reminderWindow.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  const bounds = reminderWindow.getBounds();
  reminderWindow.setPosition(
    Math.round(area.x + area.width - bounds.width - 18),
    Math.round(area.y + area.height - bounds.height - 18),
    false,
  );
}

/** Windows 上未打包的 Electron 系统通知不可靠，使用自绘置顶提醒卡片保证可见 */
function showReminderPopup(payload = {}) {
  reminderPayload = payload;
  if (!reminderWindow || reminderWindow.isDestroyed()) {
    reminderReady = false;
    reminderWindow = new BrowserWindow({
      width: 384,
      height: 208,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      title: '待办提醒',
      icon: ICON,
      webPreferences: {
        preload: path.join(__dirname, 'reminder-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    reminderWindow.loadFile(path.join(__dirname, 'reminder.html'));
    reminderWindow.on('closed', () => {
      reminderWindow = null;
      reminderReady = false;
    });
    reminderWindow.webContents.on('did-finish-load', () => {
      if (!reminderWindow || reminderWindow.isDestroyed()) return;
      reminderReady = true;
      if (reminderPayload) reminderWindow.webContents.send('reminder-data', reminderPayload);
      positionReminderWindow();
      reminderWindow.showInactive();
    });
  } else if (reminderReady) {
    reminderWindow.webContents.send('reminder-data', payload);
  }

  if (reminderWindow && reminderReady) {
    positionReminderWindow();
    reminderWindow.setAlwaysOnTop(true, 'floating');
    reminderWindow.showInactive();
  }

  clearTimeout(reminderTimer);
  reminderTimer = setTimeout(() => {
    if (reminderWindow) reminderWindow.hide();
  }, 60_000);
}

function showNotification(payload = {}) {
  if (process.platform === 'win32') {
    try {
      showReminderPopup(payload);
      return;
    } catch (error) {
      console.warn('[提醒] 弹窗失败，回退系统通知:', error);
    }
  }
  if (!Notification.isSupported()) return;
  try {
    const notification = new Notification({
      title: payload.title || '事务待办',
      body: payload.body || '有一条待办提醒',
      icon: ICON,
      silent: false,
    });
    notification.on('click', () => showMain(payload.taskId));
    notification.show();
  } catch {
    // 界面内仍有提醒条
  }
}

function autoStartSettings(enabled) {
  return {
    openAtLogin: !!enabled,
    path: process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()],
  };
}

function refreshTrayMenu() {
  if (!tray) return;
  const menu = Menu.buildFromTemplate([
    { label: '打开事务待办', click: () => showMain() },
    { type: 'separator' },
    {
      label: '显示桌面小组件',
      type: 'checkbox',
      checked: state.widget.visible !== false,
      click: (item) => setWidgetVisible(item.checked),
    },
    {
      label: '小组件置顶',
      type: 'checkbox',
      checked: state.widget.onTop !== false,
      click: (item) => setWidgetOnTop(item.checked),
    },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings(autoStartSettings(item.checked)),
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true;
        saveState();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  let icon = nativeImage.createFromPath(TRAY_ICON);
  if (icon.isEmpty()) icon = nativeImage.createFromPath(ICON);
  tray = new Tray(icon);
  tray.setToolTip('事务待办');
  tray.on('click', () => showMain());
  refreshTrayMenu();
}

ipcMain.on('notify', (_event, payload) => showNotification(payload));
ipcMain.on('window:drag-begin', (event, x, y) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win !== widgetWindow || typeof x !== 'number' || typeof y !== 'number') return;
  const width = state.widget.collapsed ? PET_WIDTH : WIDGET_WIDTH;
  const height = state.widget.collapsed ? PET_HEIGHT : WIDGET_HEIGHT;
  windowDrag = { win, startX: x, startY: y, bounds: win.getBounds(), width, height };
});
ipcMain.on('window:drag-move', (event, x, y) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!windowDrag || windowDrag.win !== sender || sender.isDestroyed()) return;
  if (typeof x !== 'number' || typeof y !== 'number') return;
  const { bounds, startX, startY, width, height } = windowDrag;
  sender.setBounds(
    {
      x: Math.round(bounds.x + x - startX),
      y: Math.round(bounds.y + y - startY),
      width,
      height,
    },
    false,
  );
});
ipcMain.on('window:drag-end', (event) => {
  if (!windowDrag) return;
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (windowDrag.win !== sender) return;
  const { width, height } = windowDrag;
  if (!sender.isDestroyed()) {
    const bounds = sender.getBounds();
    sender.setBounds({ x: bounds.x, y: bounds.y, width, height }, false);
  }
  windowDrag = null;
  saveWidgetBounds();
});
ipcMain.on('reminder-action', (_event, action) => {
  const payload = reminderPayload || {};
  if (reminderWindow && !reminderWindow.isDestroyed()) reminderWindow.hide();
  clearTimeout(reminderTimer);

  if (action === 'complete' && payload.taskId) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const send = () => mainWindow.webContents.send('reminder-complete', payload.taskId);
      if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send);
      else send();
    }
  } else if (action === 'snooze') {
    const timer = setTimeout(
      () => showReminderPopup({ ...payload, body: `稍后提醒 · 原定 ${payload.body || ''}` }),
      10 * 60_000,
    );
    timer.unref?.();
  } else if (action === 'open') {
    showMain(payload.taskId);
  }
});
ipcMain.on('widget:toggle', (_event, show) => {
  setWidgetVisible(typeof show === 'boolean' ? show : !(widgetWindow && widgetWindow.isVisible()));
});
ipcMain.on('widget:collapsed', (_event, collapsed) => setWidgetCollapsed(collapsed));
ipcMain.on('widget:on-top', (_event, flag) => setWidgetOnTop(flag));
ipcMain.on('widget:close', () => setWidgetVisible(false));
ipcMain.on('app:open-main', (_event, taskId, newKind) => showMain(taskId, newKind));
ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('autostart:set', (_event, enabled) => {
  app.setLoginItemSettings(autoStartSettings(enabled));
  refreshTrayMenu();
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('app:info', () => ({ version: app.getVersion(), packaged: app.isPackaged }));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());

  app.whenReady().then(() => {
    loadState();
    ensureMainWindow();
    ensureWidgetWindow();
    createTray();

  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) ensureMainWindow();
    showMain();
  });

  app.on('before-quit', () => {
    quitting = true;
    saveState();
  });

  app.on('window-all-closed', () => {
    // 保留托盘与小组件，不随窗口关闭退出
  });
}
