const { contextBridge, ipcRenderer } = require('electron');

let pendingOpenTask = null;
let pendingNewKind = null;
let openTaskHandler = null;
let newTaskHandler = null;

ipcRenderer.on('open-task', (_event, taskId) => {
  if (openTaskHandler) openTaskHandler(taskId);
  else pendingOpenTask = taskId;
});

ipcRenderer.on('new-task', (_event, kind) => {
  if (newTaskHandler) newTaskHandler(kind);
  else pendingNewKind = kind;
});

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  platform: process.platform,
  notify: (payload) => ipcRenderer.send('notify', payload),
  toggleWidget: (show) => ipcRenderer.send('widget:toggle', show),
  setWidgetOnTop: (flag) => ipcRenderer.send('widget:on-top', flag),
  openMain: (taskId, newKind) => ipcRenderer.send('app:open-main', taskId, newKind),
  beginWindowDrag: (x, y) => ipcRenderer.send('window:drag-begin', x, y),
  dragWindowTo: (x, y) => ipcRenderer.send('window:drag-move', x, y),
  endWindowDrag: () => ipcRenderer.send('window:drag-end'),
  setWidgetCollapsed: (collapsed) => ipcRenderer.send('widget:collapsed', collapsed),
  closeWidget: () => ipcRenderer.send('widget:close'),
  getAutoStart: () => ipcRenderer.invoke('autostart:get'),
  setAutoStart: (flag) => ipcRenderer.invoke('autostart:set', flag),
  onOpenTask: (handler) => {
    openTaskHandler = handler;
    if (pendingOpenTask) {
      const taskId = pendingOpenTask;
      pendingOpenTask = null;
      handler(taskId);
    }
    return () => {
      if (openTaskHandler === handler) openTaskHandler = null;
    };
  },
  onNewTask: (handler) => {
    newTaskHandler = handler;
    if (pendingNewKind) {
      const kind = pendingNewKind;
      pendingNewKind = null;
      handler(kind);
    }
    return () => {
      if (newTaskHandler === handler) newTaskHandler = null;
    };
  },
  onReminderComplete: (handler) => {
    const listener = (_event, taskId) => handler(taskId);
    ipcRenderer.on('reminder-complete', listener);
    return () => ipcRenderer.removeListener('reminder-complete', listener);
  },
});
