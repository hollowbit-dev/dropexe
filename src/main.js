const { app, BrowserWindow, ipcMain, shell, nativeTheme, dialog } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');
const { setupUpdates } = require('./update-check');

if (process.env.DROPEXE_USERDATA) app.setPath('userData', process.env.DROPEXE_USERDATA);
const DEMO = process.env.DROPEXE_DEMO === '1';
const ROOT = app.getPath('userData');
const engine = require('./engine');
const library = require('./library');
const stores = require('./stores');
const fixer = require('./fixer');
const macapp = require('./macapp');
const { download } = require('./net');
const exeicon = require('./exeicon');
const settings = () => require('./settings');
engine.init(ROOT);
library.init(ROOT);

let win;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

// ---------------------------------------------------------------- single window, dropexe:// links
if (!app.requestSingleInstanceLock()) app.quit();
let pendingUrl = null;
app.on('open-url', (e, url) => { e.preventDefault(); handleUrl(url); });
// Double-clicking an .exe in Finder (when DropExe is its app) adds it.
const pendingFiles = [];
app.on('open-file', (e, file) => {
  e.preventDefault();
  if (win && !win.webContents.isLoading()) send('open-files', [file]); else pendingFiles.push(file);
});
app.on('second-instance', (e, argv) => { const u = argv.find((a) => a.startsWith('dropexe://')); if (u) handleUrl(u); if (win) { if (win.isMinimized()) win.restore(); win.show(); } });
function handleUrl(url) {
  const m = /^dropexe:\/\/play\/(.+)$/.exec(url);
  if (!m) return;
  const id = decodeURIComponent(m[1]);
  if (!app.isReady() || !win) { pendingUrl = id; return; }
  play(id).catch((e) => send('toast', { kind: 'error', text: e.message }));
}

function create() {
  nativeTheme.themeSource = 'dark';
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 980, minHeight: 640,
    backgroundColor: '#07070a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'renderer/index.html'));
}

app.whenReady().then(() => {
  if (!process.defaultApp) app.setAsDefaultProtocolClient('dropexe');
  create();
  const u = process.argv.find((a) => a.startsWith('dropexe://'));
  if (u) handleUrl(u);
  win.webContents.once('did-finish-load', () => { if (pendingFiles.length) setTimeout(() => send('open-files', pendingFiles.splice(0)), 800); if (pendingUrl) { const id = pendingUrl; pendingUrl = null; play(id).catch(() => {}); } });
  startWatcher();
});
app.on('window-all-closed', () => app.quit());

const updates = setupUpdates({
  app, repo: 'hollowbit-dev/dropexe',
  getSettings: () => settings().get(), setSettings: (p) => settings().set(p),
  send: (st) => send('update', st),
});

// ---------------------------------------------------------------- state
function view() {
  if (DEMO) return require('./demo').view(ROOT);
  return library.all().map((i) => ({
    ...i,
    running: running.has(i.id),
    macApp: macapp.has(i),
  }));
}
ipcMain.handle('state', async () => ({
  engine: DEMO ? { installed: true, version: engine.ENGINE_VERSION, rosetta: true } : await engine.status(),
  items: view(),
  stores: stores.map(({ id, name, color, works, broken }) => ({ id, name, color, works, broken, added: DEMO ? ['steam', 'epic'].includes(id) : !!library.get(`store-${id}`) })),
  steps: fixer.STEPS.map(({ id, label, detail }) => ({ id, label, detail })),
  version: app.getVersion(),
  settings: settings().get(),
  demo: DEMO,
}));
const pushLibrary = () => send('library', view());
ipcMain.handle('set-settings', (e, patch) => settings().set({ autoUpdate: patch.autoUpdate !== false }));
ipcMain.handle('check-updates', () => updates.check({ manual: true }));
ipcMain.handle('open-update', (e, url) => /^https:\/\/github\.com\/hollowbit-dev\/dropexe\//.test(url) && shell.openExternal(url));

// ---------------------------------------------------------------- first run: the engine
let installing = null;
ipcMain.handle('install-engine', () => {
  if (!installing) {
    installing = engine.install((s) => send('engine-progress', s))
      .then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }))
      .finally(() => { installing = null; });
  }
  return installing;
});

// ---------------------------------------------------------------- logs
const logs = new Map(); // item id -> recent text
function logger(id) {
  return (t) => {
    const prev = logs.get(id) || '';
    logs.set(id, (prev + t).slice(-200000));
  };
}
ipcMain.handle('log', (e, id) => logs.get(id) || '');

// ---------------------------------------------------------------- stores
const jobs = new Map(); // id -> label, for the "working" pill
function job(id, text, progress) { jobs.set(id, { text, progress }); send('job', { id, text, progress }); }
function jobDone(id) { jobs.delete(id); send('job', { id, done: true }); }

ipcMain.handle('add-store', async (e, storeId) => {
  const s = stores.find((x) => x.id === storeId);
  if (!s || s.broken) return { ok: false, error: s?.broken };
  const id = `store-${s.id}`;
  const log = logger(id);
  try {
    job(id, 'Making a Windows drive', 0.05);
    await engine.ensureBottle(s.id, log);
    const exe = engine.toUnix(s.id, s.exe);
    if (!(await engine.exists(exe))) {
      const file = path.join(engine.dirs().downloads, s.installer.file);
      job(id, `Downloading ${s.name}`, 0.15);
      await download(s.installer.url, file, (f) => job(id, `Downloading ${s.name}`, 0.15 + f * 0.35));
      job(id, s.installer.args?.includes('/S') || s.installer.msi ? `Installing ${s.name}` : `Finish the ${s.name} installer`, 0.6);
      const args = s.installer.msi ? ['msiexec', '/i', file, '/qn'] : [file, ...(s.installer.args || [])];
      await engine.runWine(s.id, args, { graphics: 'wined3d', overrides: s.installer.overrides }, log).done;
      await fsp.rm(file, { force: true });
    }
    // Some installers start the store and return early; give them a moment to finish writing files.
    for (let i = 0; i < 30 && !(await engine.exists(exe)); i++) await new Promise((r) => setTimeout(r, 1000));
    if (!(await engine.exists(exe))) throw new Error(`${s.name} didn't finish installing. Try again, and if its installer opens, click through it.`);
    library.upsert({ id, kind: 'store', storeId: s.id, name: s.name, bottle: s.id, exe: s.exe, args: s.args, fix: s.fix, color: s.color });
    await iconFor(library.get(id)).catch(() => {});
    jobDone(id);
    pushLibrary();
    play(id).catch(() => {});
    return { ok: true, id };
  } catch (err) {
    jobDone(id);
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------- dropping .exe / .msi files
// An installer runs in the shared "apps" drive, then we look at what it added and let the user pick.
// A plain program is added as it is, run from where it sits.
ipcMain.handle('drop', async (e, files) => {
  const results = [];
  for (const f of files) {
    if (!/\.(exe|msi|bat|lnk)$/i.test(f)) { results.push({ file: f, ok: false, error: 'Only Windows .exe and .msi files can be added.' }); continue; }
    if (library.looksLikeInstaller(f)) results.push(await runInstaller(f));
    else results.push(await addProgram(f, 'apps'));
  }
  pushLibrary();
  return results;
});
ipcMain.handle('choose-files', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Windows programs', extensions: ['exe', 'msi'] }] });
  return r.canceled ? [] : r.filePaths;
});

async function addProgram(file, bottle, nameHint) {
  await engine.ensureBottle(bottle, () => {});
  const name = nameHint || library.nameFor(file);
  const winPath = engine.toWin(bottle, file);
  const existing = library.all().find((i) => i.exe === winPath);
  if (existing) return { file, ok: true, id: existing.id, existed: true };
  const item = library.upsert({ id: library.newId('app'), kind: 'game', source: 'drop', name, bottle, exe: winPath, args: [], fix: { graphics: 'dxmt' } });
  art(item);
  return { file, ok: true, id: item.id };
}

async function runInstaller(file) {
  const bottle = 'apps';
  const id = 'installer';
  const log = logger(id);
  try {
    job(id, 'Getting the Windows drive ready', 0.1);
    await engine.ensureBottle(bottle, log);
    const before = await library.listExes(bottle);
    job(id, `Running ${path.basename(file)}. Click through its installer.`, 0.4);
    // DROPEXE_TEST_SILENT=1 (tests only) runs installers without their windows.
    const silent = process.env.DROPEXE_TEST_SILENT === '1';
    const args = /\.msi$/i.test(file) ? ['msiexec', '/i', file, ...(silent ? ['/qn'] : [])] : [file, ...(silent ? ['/S'] : [])];
    await engine.runWine(bottle, args, { graphics: 'wined3d' }, log).done;
    // Wait for child processes (many installers hand off to a second exe) to finish.
    await waitIdle(bottle, path.basename(file));
    const after = await library.listExes(bottle);
    const added = [...after.entries()].filter(([p]) => !before.has(p)).sort((a, b) => b[1] - a[1]).slice(0, 12);
    jobDone(id);
    if (!added.length) return { file, ok: false, error: 'The installer finished but nothing new turned up. If it installed somewhere else, drop that program here.' };
    // One obvious pick: add it straight away. Several: let the user choose.
    const choices = added.map(([p, size]) => ({ path: p, name: library.nameFor(p), exe: path.basename(p), size }));
    if (choices.length === 1) return addProgram(choices[0].path, bottle, choices[0].name);
    return { file, ok: true, choose: choices, bottle };
  } catch (err) {
    jobDone(id);
    return { file, ok: false, error: err.message };
  }
}
ipcMain.handle('pick', async (e, picks) => {
  const out = [];
  for (const p of picks) out.push(await addProgram(p.path, 'apps', p.name));
  pushLibrary();
  return out;
});

function waitIdle(bottle, token) {
  return new Promise((resolve) => {
    let calm = 0;
    const t = setInterval(async () => {
      const busy = (await wineProcs()).some((c) => /setup|install|unins|msiexec/i.test(c) || c.includes(token));
      calm = busy ? 0 : calm + 1;
      if (calm >= 2) { clearInterval(t); resolve(); }
    }, 1500);
    setTimeout(() => { clearInterval(t); resolve(); }, 30 * 60 * 1000);
  });
}

// ---------------------------------------------------------------- art
// The program's own icon, taken from its .exe. Used for stores and anything without game art.
async function iconFor(item) {
  if (item.art?.icon && fs.existsSync(item.art.icon)) return;
  const exe = engine.toUnix(item.bottle, item.exe);
  if (!fs.existsSync(exe)) return;
  const out = await exeicon.extract(exe, path.join(ROOT, 'art', `${item.id}-icon`));
  if (out) { library.upsert({ id: item.id, art: { ...(library.get(item.id).art || {}), icon: out } }); pushLibrary(); }
}
async function art(item) {
  iconFor(item).catch(() => {});
  try {
    if (!item.steamAppId && !item.artUrls) {
      const urls = await library.findArtByName(item.name);
      if (urls) library.upsert({ id: item.id, artUrls: urls });
    }
    await library.cacheArt(library.get(item.id));
    pushLibrary();
  } catch { /* plain tile */ }
}

// ---------------------------------------------------------------- playing
const running = new Map(); // id -> { token, startedAt, seen, bottle }
function wineProcs() {
  return new Promise((resolve) => execFile('/bin/ps', ['-axo', 'command='], { maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
    // Only Windows processes (their command starts with a drive letter); never our own Mac-side wine launcher.
    resolve(err ? [] : out.split('\n').filter((l) => /^[A-Z]:\\/.test(l)));
  }));
}
// What to look for in the process list to know a game is still open.
function tokenFor(item) {
  if (item.source === 'steam' && item.installdir) return `steamapps\\common\\${item.installdir}\\`.toLowerCase();
  return item.exe.split('\\').pop().toLowerCase();
}

async function launch(item, fix) {
  const log = logger(item.id);
  await engine.ensureBottle(item.bottle, log);
  await fixer.applyFix(item.bottle, fix, log);
  let args = [item.exe, ...(item.args || [])];
  if (fix.desktop) args = ['explorer', `/desktop=DropExe,${fix.desktop}`, ...args];
  const m = /^([A-Z]:\\.*)\\[^\\]+$/i.exec(item.exe);
  const cwd = m ? engine.toUnix(item.bottle, m[1]) : undefined;
  log(`\n--- ${new Date().toISOString()} launching with ${JSON.stringify(fix)}\n`);
  const r = engine.runWine(item.bottle, args, fix, log, { cwd: cwd && fs.existsSync(cwd) ? cwd : undefined });
  running.set(item.id, { token: tokenFor(item), startedAt: Date.now(), seen: false, bottle: item.bottle, proc: r.proc });
  library.upsert({ id: item.id, lastPlayed: Date.now() });
  pushLibrary();
  return r;
}

async function play(id) {
  if (DEMO) return { ok: true };
  const item = library.get(id);
  if (!item) throw new Error('That game is no longer in DropExe.');
  if (running.has(id)) return { ok: true, already: true };
  // Steam games need Steam's own files in place.
  await launch(item, item.fix || { graphics: 'dxmt' });
  return { ok: true };
}
ipcMain.handle('play', (e, id) => play(id).catch((err) => ({ ok: false, error: err.message })));
ipcMain.handle('stop', async (e, id) => {
  const item = library.get(id);
  if (!item) return;
  await engine.killBottle(item.bottle);
  for (const [rid, r] of running) if (r.bottle === item.bottle) finish(rid);
});

function finish(id) {
  const r = running.get(id);
  if (!r) return;
  running.delete(id);
  const item = library.get(id);
  if (item && r.seen) library.upsert({ id, playMs: (item.playMs || 0) + (Date.now() - r.startedAt) });
  pushLibrary();
}

// Every 2 seconds: which games are actually open? Feeds the "Playing" state, play time and the fixer.
function startWatcher() {
  setInterval(async () => {
    if (!running.size) return;
    const procs = (await wineProcs()).map((c) => c.toLowerCase());
    // The program's own path is the first thing on its command line.
    const exeOf = (c) => { const i = c.indexOf('.exe'); return i < 0 ? c : c.slice(0, i + 4); };
    for (const [id, r] of running) {
      const alive = procs.some((c) => (r.token.endsWith('.exe') ? exeOf(c).endsWith('\\' + r.token) : c.includes(r.token)));
      if (alive && !r.seen) { r.seen = true; r.seenAt = Date.now(); send('playing', { id }); }
      const exited = r.proc.exitCode !== null;
      if (r.seen && !alive) { finish(id); continue; }
      // Never showed up: gone after 90 s, or the starter exited and nothing is left.
      // A starter that failed (non-zero exit) is done after a few seconds; one that exited cleanly may have handed off to a child.
      const age = Date.now() - r.startedAt;
      if (!r.seen && (age > 90000 || (exited && age > (r.proc.exitCode !== 0 ? 4000 : 20000)))) finish(id);
    }
  }, 2000);
}

// ---------------------------------------------------------------- Make it run
let fixing = null;
let answer = null;
ipcMain.handle('fix-answer', (e, ok) => { if (answer) answer(ok); });
ipcMain.handle('fix-cancel', () => { if (fixing) fixing.cancelled = true; if (answer) answer(false); });
ipcMain.handle('fix', async (e, id) => {
  const item = library.get(id);
  if (!item || fixing) return { ok: false };
  fixing = { id, cancelled: false };
  const steps = fixer.STEPS;
  try {
    for (let i = 0; i < steps.length; i++) {
      if (fixing.cancelled) break;
      const step = steps[i];
      send('fix', { id, i, n: steps.length, step: step.id, state: 'trying' });
      await engine.killBottle(item.bottle);
      for (const [rid, r] of running) if (r.bottle === item.bottle) finish(rid);
      if (step.prep) { send('fix', { id, i, n: steps.length, step: step.id, state: 'prep' }); await fixer.prep(step, item.bottle, logger(id)); }
      await launch(item, step.fix);
      const result = await observe(id);
      if (fixing.cancelled) break;
      if (result === 'stayed') {
        send('fix', { id, i, n: steps.length, step: step.id, state: 'ask' });
        const ok = await new Promise((r) => { answer = r; });
        answer = null;
        if (ok) {
          library.upsert({ id, fix: step.fix, fixedWith: step.id });
          send('fix', { id, i, n: steps.length, step: step.id, state: 'fixed' });
          pushLibrary();
          return { ok: true, step: step.id };
        }
      } else send('fix', { id, i, n: steps.length, step: step.id, state: result });
    }
    await engine.killBottle(item.bottle);
    send('fix', { id, state: fixing.cancelled ? 'cancelled' : 'failed' });
    return { ok: false };
  } finally { fixing = null; pushLibrary(); }
});

// Watch one launch: 'stayed' (open 15 s), 'crashed' (opened then closed), 'nothing' (never opened).
function observe(id) {
  return new Promise((resolve) => {
    const t = setInterval(() => {
      const r = running.get(id);
      if (fixing?.cancelled) { clearInterval(t); return resolve('cancelled'); }
      if (!r) { clearInterval(t); return resolve(lastSeen.has(id) ? 'crashed' : 'nothing'); }
      if (r.seen) lastSeen.add(id);
      if (r.seen && Date.now() - r.seenAt > 15000) { clearInterval(t); lastSeen.delete(id); resolve('stayed'); }
    }, 1000);
  }).finally(() => lastSeen.delete(id));
}
const lastSeen = new Set();

// ---------------------------------------------------------------- library actions
ipcMain.handle('refresh', async () => {
  if (DEMO) return view();
  const found = [...(await library.scanSteam()), ...(await library.scanEpic())];
  for (const it of found) if (!it.art?.cover) art(it);
  for (const it of library.all()) if (it.source !== 'steam' && !it.art?.icon) iconFor(it).catch(() => {});
  return view();
});
ipcMain.handle('remove', async (e, id) => {
  const item = library.get(id);
  if (!item) return;
  if (macapp.has(item)) await macapp.removeApp(item);
  library.remove(id);
  pushLibrary();
});
ipcMain.handle('rename', (e, id, name) => { if (name && name.trim()) library.upsert({ id, name: name.trim().slice(0, 80) }); pushLibrary(); });
ipcMain.handle('mac-app', async (e, id) => {
  const item = library.get(id);
  if (!item) return { ok: false };
  const p = await macapp.create(item);
  pushLibrary();
  return { ok: true, path: p };
});
ipcMain.handle('show-mac-app', (e, id) => { const i = library.get(id); if (i) shell.showItemInFolder(macapp.appPath(i)); });
ipcMain.handle('open-drive', (e, id) => {
  const i = library.get(id);
  const bottle = i ? i.bottle : 'apps';
  shell.openPath(path.join(engine.bottlePath(bottle), 'drive_c'));
});
ipcMain.handle('reset-fix', (e, id) => { library.upsert({ id, fix: { graphics: 'dxmt' }, fixedWith: null }); pushLibrary(); });
ipcMain.handle('set-graphics', (e, id, graphics) => {
  const i = library.get(id);
  if (i && engine.GRAPHICS.includes(graphics)) library.upsert({ id, fix: { ...(i.fix || {}), graphics } });
  pushLibrary();
});
