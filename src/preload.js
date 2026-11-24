const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (ch) => (fn) => ipcRenderer.on(ch, (_, d) => fn(d));
const call = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('dx', {
  pathFor: (file) => webUtils.getPathForFile(file),
  state: call('state'),
  setSettings: call('set-settings'),
  checkUpdates: call('check-updates'),
  openUpdate: call('open-update'),
  installEngine: call('install-engine'),
  addStore: call('add-store'),
  drop: call('drop'),
  chooseFiles: call('choose-files'),
  pick: call('pick'),
  play: call('play'),
  stop: call('stop'),
  fix: call('fix'),
  fixAnswer: call('fix-answer'),
  fixCancel: call('fix-cancel'),
  refresh: call('refresh'),
  remove: call('remove'),
  rename: call('rename'),
  macApp: call('mac-app'),
  showMacApp: call('show-mac-app'),
  openDrive: call('open-drive'),
  setGraphics: call('set-graphics'),
  log: call('log'),
  on: {
    update: on('update'), engine: on('engine-progress'), library: on('library'), job: on('job'),
    playing: on('playing'), fix: on('fix'), toast: on('toast'), openFiles: on('open-files'),
  },
});
