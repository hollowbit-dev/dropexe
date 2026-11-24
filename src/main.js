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
const importer = require('./importer');
const { spawn } = require('child_process');
const settings = () => require('./settings');
engine.init(ROOT);
library.init(ROOT);
importer.init(ROOT);

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
  stores: stores.map(({ id, name, color, works, broken }) => ({ id, name, color, works, broken, added: DEMO ? ['steam', 'epic'].includes(id) : !!library.get(`store-${id}`) && (stores.find((x) => x.id === id).engine || 'wine11') === engine.engineOf(id) })),
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
    if (s.engine === 'wine10') await engine.ensureWine10((f) => job(id, `Getting the engine ${s.name} needs`, f * 0.3));
    job(id, 'Making a Windows drive', 0.32);
    await engine.ensureBottle(s.id, log, s.engine || 'wine11');
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
    library.upsert({ id, kind: 'store', storeId: s.id, name: s.name, bottle: s.id, exe: s.exe, args: s.args, fix: s.fix, color: s.color, engine: s.engine || 'wine11' });
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
function allProcs() {
  return new Promise((resolve) => execFile('/bin/ps', ['-axo', 'command='], { maxBuffer: 8 * 1024 * 1024 }, (err, out) => resolve(err ? [] : out.split('\n'))));
}
// Only Windows processes (their command starts with a drive letter); never our own Mac-side wine launcher.
const wineProcs = async () => (await allProcs()).filter((l) => /^[A-Z]:\\/.test(l));
// What to look for in the process list to know a game is still open.
function tokenFor(item) {
  if (item.mac) return (item.installdir || item.appPath || '').toLowerCase();
  if (item.source === 'steam' && item.installdir) return `steamapps\\common\\${item.installdir}\\`.toLowerCase();
  return item.exe.split('\\').pop().toLowerCase();
}

async function launch(item, fix) {
  const log = logger(item.id);
  const want = stores.find((x) => x.id === item.bottle)?.engine || 'wine11';
  if (want !== engine.engineOf(item.bottle) && fs.existsSync(engine.bottlePath(item.bottle))) {
    // An older Steam drive made on Wine 11: its window is black. Rebuild it on Wine 10.
    throw new Error(`${stores.find((x) => x.id === item.bottle)?.name || 'This store'} needs a quick reinstall to fix its window. Open Stores and press Get again.`);
  }
  await engine.ensureBottle(item.bottle, log, want);
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
  if (item.mac) return playMac(item);
  if (item.source === 'steam' && item.notInstalled) {
    if (!library.get('store-steam')) throw new Error('This is a Windows game. Get Steam in Stores first, sign in, then press Install.');
    if (engine.engineOf('steam') !== 'wine10') throw new Error('Steam needs a quick reinstall to fix its window. Open Stores and press Get Steam.');
    const steamItem = library.get('store-steam');
    engine.runWine('steam', [steamItem.exe, ...steamItem.args, `steam://install/${item.steamAppId}`], steamItem.fix || {}, logger(id));
    return { ok: true, installing: true };
  }
  // Steam games need Steam's own files in place.
  await launch(item, item.fix || { graphics: 'dxmt' });
  return { ok: true };
}
ipcMain.handle('play', (e, id) => play(id).catch((err) => ({ ok: false, error: err.message })));
ipcMain.handle('stop', async (e, id) => {
  const item = library.get(id);
  if (!item) return;
  if (item.mac) {
    // Ask the game to quit like Cmd-Q would.
    const r = running.get(id);
    if (item.appPath) spawn('/usr/bin/osascript', ['-e', `tell application ${JSON.stringify(item.appPath)} to quit`]);
    else if (r?.token) spawn('/usr/bin/pkill', ['-f', r.token]);
    finish(id);
    return;
  }
  await engine.killBottle(item.bottle);
  for (const [rid, r] of running) if (r.bottle === item.bottle) finish(rid);
});

function finish(id) {
  const r = running.get(id);
  if (!r) return;
  running.delete(id);
  if (id.startsWith('store-')) rescanStores();
  const item = library.get(id);
  if (item && r.seen) library.upsert({ id, playMs: (item.playMs || 0) + (Date.now() - r.startedAt) });
  pushLibrary();
}

// Mac games: Mac Steam opens its own games; other Mac games are plain apps.
function playMac(item) {
  const url = item.notInstalled ? `steam://install/${item.steamAppId}` : item.steamAppId ? `steam://rungameid/${item.steamAppId}` : null;
  spawn('/usr/bin/open', url ? [url] : [item.appPath], { detached: true, stdio: 'ignore' }).unref();
  if (!item.notInstalled) {
    running.set(item.id, { token: tokenFor(item), startedAt: Date.now(), seen: false, mac: true });
    library.upsert({ id: item.id, lastPlayed: Date.now() });
    pushLibrary();
  }
  return { ok: true, installing: !!item.notInstalled };
}

// Every 2 seconds: which games are actually open? Feeds the "Playing" state, play time and the fixer.
let ticks = 0;
async function rescanStores() {
  try {
    const before = JSON.stringify(library.all().map((i) => [i.id, i.notInstalled, i.installing]));
    await library.scanSteam(); await library.scanEpic();
    if (JSON.stringify(library.all().map((i) => [i.id, i.notInstalled, i.installing])) !== before) pushLibrary();
  } catch { /* store folder busy */ }
}
function startWatcher() {
  setInterval(async () => {
    // While a store is open, games installed or removed inside it show up here within 30 seconds.
    if (++ticks % 15 === 0 && [...running.keys()].some((id) => id.startsWith('store-'))) rescanStores();
    if (!running.size) return;
    const every = (await allProcs()).map((c) => c.toLowerCase());
    const procs = every.filter((l) => /^[a-z]:\\/.test(l));
    // The program's own path is the first thing on its command line.
    const exeOf = (c) => { const i = c.indexOf('.exe'); return i < 0 ? c : c.slice(0, i + 4); };
    for (const [id, r] of running) {
      const alive = r.mac ? (r.token && every.some((c) => c.startsWith(r.token)))
        : procs.some((c) => (r.token.endsWith('.exe') ? exeOf(c).endsWith('\\' + r.token) : c.includes(r.token)));
      if (alive && !r.seen) { r.seen = true; r.seenAt = Date.now(); send('playing', { id }); }
      const exited = r.proc ? r.proc.exitCode !== null : true;
      if (r.seen && !alive) { finish(id); continue; }
      // Never showed up: gone after 90 s, or the starter exited and nothing is left.
      // A starter that failed (non-zero exit) is done after a few seconds; one that exited cleanly may have handed off to a child.
      const age = Date.now() - r.startedAt;
      if (!r.seen && (age > (r.mac ? 180000 : 90000) || (!r.mac && exited && age > (r.proc.exitCode !== 0 ? 4000 : 20000)))) finish(id);
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

// ---------------------------------------------------------------- Find my games
ipcMain.handle('scan-games', async () => {
  const items = library.all().map((i) => ({ ...i, unixExe: i.exe && i.bottle ? engine.toUnix(i.bottle, i.exe) : null }));
  const r = await importer.scanAll(items);
  const have = new Set(library.all().map((i) => i.id));
  const macId = (p) => 'mac-' + require('crypto').createHash('sha1').update(p).digest('hex').slice(0, 10);
  return {
    steam: r.steam.map((g) => ({ ...g, id: g.mac ? `msteam-${g.appid}` : `steam-${g.appid}`, have: have.has(g.mac ? `msteam-${g.appid}` : `steam-${g.appid}`) })),
    exes: r.exes.filter((x) => !library.all().some((i) => i.bottle && i.exe && engine.toUnix(i.bottle, i.exe) === x.path)),
    macGames: r.macGames.map((g) => ({ ...g, id: macId(g.path), have: have.has(macId(g.path)) })),
  };
});

async function icnsToPng(icns, id) {
  const out = path.join(ROOT, 'art', `${id}-icon.png`);
  await new Promise((res) => execFile('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '512', icns, '--out', out], () => res()));
  return fs.existsSync(out) ? out : null;
}

ipcMain.handle('import-games', async (e, pick) => {
  const added = [];
  for (const g of pick.steam || []) {
    const local = importer.localSteamArt(g.appid);
    const art = { cover: local.cover, hero: local.hero, logo: local.logo };
    if (!art.cover && local.header) { art.cover = local.header; art.coverIsWide = true; }
    if (g.mac) {
      library.upsert({ id: `msteam-${g.appid}`, kind: 'game', source: 'steam-mac', mac: true, name: g.name, steamAppId: g.appid, installdir: g.installdir, notInstalled: !g.installed, art, imported: true });
      added.push(`msteam-${g.appid}`);
    } else {
      // A Windows-only game: it runs through DropExe's own Windows Steam.
      const prev = library.get(`steam-${g.appid}`);
      library.upsert({ id: `steam-${g.appid}`, kind: 'game', source: 'steam', name: g.name, bottle: 'steam', steamAppId: g.appid, exe: 'C:\\Program Files (x86)\\Steam\\steam.exe', args: ['-cef-disable-gpu-compositing', '-silent', '-applaunch', g.appid], notInstalled: prev ? prev.notInstalled : true, art: prev?.art?.cover ? prev.art : art, fix: prev?.fix || { graphics: 'dxmt' }, imported: true });
      added.push(`steam-${g.appid}`);
    }
    const it = library.get(added[added.length - 1]);
    if (!it.art?.cover || !it.art?.logo) library.cacheArt({ ...it, art: { ...it.art } }).then(pushLibrary).catch(() => {});
  }
  for (const x of pick.exes || []) { const r = await addProgram(x.path, 'apps', x.name); if (r.id) added.push(r.id); }
  for (const g of pick.macGames || []) {
    const icon = g.icon ? await icnsToPng(g.icon, g.id) : null;
    library.upsert({ id: g.id, kind: 'game', source: 'mac', mac: true, name: g.name, appPath: g.path, art: { icon } });
    art(library.get(g.id));
    added.push(g.id);
  }
  pushLibrary();
  return { added };
});

// ---------------------------------------------------------------- library actions
ipcMain.handle('refresh', async () => {
  if (DEMO) return view();
  const found = [...(await library.scanSteam()), ...(await library.scanEpic())];
  if (library.all().some((i) => i.source === 'steam-mac')) {
    try {
      for (const g of await importer.scanMacSteam()) {
        const it = library.get(`msteam-${g.appid}`);
        if (it) library.upsert({ id: it.id, notInstalled: !g.installed, installdir: g.installdir || it.installdir });
      }
    } catch { /* Steam folder moved */ }
  }
  for (const it of found) if (!it.art?.cover) art(it);
  for (const it of library.all()) if (it.source !== 'steam' && !it.art?.icon) iconFor(it).catch(() => {});
  return view();
});
// What removing an item could also delete. Files go to the Trash (never deleted outright), and only files DropExe made.
function filesOf(item) {
  if (!item || item.mac) return null;
  if (item.kind === 'store') return { path: engine.bottlePath(item.bottle), what: `${item.name} and every game installed in it` };
  if (item.source === 'steam' || item.source === 'epic') return null; // uninstall those inside their store
  const m = /^C:\\(Program Files(?: \(x86\))?|users\\[^\\]+\\AppData\\(?:Local|Roaming))\\([^\\]+)\\/i.exec(item.exe || '');
  if (!m) return null; // a program the user dropped from their own folders: never touch it
  const dir = engine.toUnix(item.bottle, `C:\\${m[1]}\\${m[2]}`);
  // Only if no other item lives in the same folder.
  if (library.all().some((i) => i.id !== item.id && i.bottle === item.bottle && (i.exe || '').toLowerCase().startsWith(`c:\\${m[1]}\\${m[2]}\\`.toLowerCase()))) return null;
  return { path: dir, what: `the ${m[2]} folder it was installed to` };
}
const sizeOf = (p) => new Promise((res) => execFile('/usr/bin/du', ['-sk', p], (e, out) => res(e ? 0 : Number(String(out).split('\t')[0]) * 1024)));
ipcMain.handle('remove-info', async (e, id) => {
  const f = filesOf(library.get(id));
  if (!f || !fs.existsSync(f.path)) return { canDelete: false };
  return { canDelete: true, what: f.what, bytes: await sizeOf(f.path) };
});
ipcMain.handle('remove', async (e, id, alsoFiles) => {
  const item = library.get(id);
  if (!item) return { ok: false };
  if (running.has(id) || item.kind === 'store') await engine.killBottle(item.bottle).catch(() => {});
  const f = alsoFiles ? filesOf(item) : null;
  if (f && fs.existsSync(f.path)) {
    try { await shell.trashItem(f.path); } catch (err) { return { ok: false, error: `Couldn't move the files to the Trash: ${err.message}` }; }
  }
  const gone = item.kind === 'store' && f ? library.all().filter((i) => i.bottle === item.bottle) : [item];
  for (const it of gone) { if (macapp.has(it)) await macapp.removeApp(it); library.remove(it.id); }
  pushLibrary();
  return { ok: true, trashed: !!f };
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
ipcMain.handle('set-retina', (e, id, on) => {
  const i = library.get(id);
  if (i) library.upsert({ id, fix: { ...(i.fix || {}), retina: !!on } });
  pushLibrary();
});
ipcMain.handle('set-graphics', (e, id, graphics) => {
  const i = library.get(id);
  if (i && engine.GRAPHICS.includes(graphics)) library.upsert({ id, fix: { ...(i.fix || {}), graphics } });
  pushLibrary();
});
