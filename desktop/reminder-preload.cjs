const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('reminder', {
  onData: (handler) => {
    ipcRenderer.on('reminder-data', (_event, data) => handler(data));
  },
  action: (kind) => ipcRenderer.send('reminder-action', kind),
});
