// The Windows engine: Wine (Gcenx's macOS builds) plus two graphics add-ons.
//   wine        stock Wine. Graphics through wined3d (OpenGL). Works with old DX9 and older games.
//   wine-dxmt   an APFS copy-on-write clone of wine with DXMT built in (DirectX 10/11 straight to Metal).
//   dxvk        DXVK-macOS dlls (DirectX 10/11 to Vulkan, MoltenVK to Metal), dropped into a bottle when picked.
// Everything lives in ~/Library/Application Support/DropExe/engine. Nothing is installed system-wide.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

const SOURCES = {
  wine: { version: '11.21', url: 'https://github.com/Gcenx/macOS_Wine_builds/releases/download/11.21/wine-staging-11.21-osx64.tar.xz', size: 217 },
  dxmt: { version: '0.80', url: 'https://github.com/3Shain/dxmt/releases/download/v0.80/dxmt-v0.80-builtin.tar.gz', size: 17 },
  dxvk: { version: '1.10.3', url: 'https://github.com/Gcenx/DXVK-macOS/releases/download/v1.10.3-20230507-repack/dxvk-macOS-async-v1.10.3-20230507-repack.tar.gz', size: 2 },
};
const ENGINE_VERSION = `wine-${SOURCES.wine.version}+dxmt-${SOURCES.dxmt.version}+dxvk-${SOURCES.dxvk.version}`;

let ROOT = null;
const dirs = () => ({
  root: ROOT,
  engine: path.join(ROOT, 'engine'),
  wine: path.join(ROOT, 'engine', 'wine'),
  wineDxmt: path.join(ROOT, 'engine', 'wine-dxmt'),
  dxvk: path.join(ROOT, 'engine', 'dxvk'),
  bottles: path.join(ROOT, 'bottles'),
  downloads: path.join(ROOT, 'downloads'),
  logs: path.join(ROOT, 'logs'),
});
function init(root) {
  ROOT = root;
  for (const d of Object.values(dirs())) fs.mkdirSync(d, { recursive: true });
}

const exists = (p) => fs.promises.access(p).then(() => true, () => false);
const stampFile = () => path.join(dirs().engine, 'version.txt');

async function status() {
  const ok = (await exists(stampFile())) && (await fsp.readFile(stampFile(), 'utf8')).trim() === ENGINE_VERSION;
  const rosetta = await hasRosetta();
  return { installed: ok, version: ENGINE_VERSION, rosetta, sizeMB: SOURCES.wine.size + SOURCES.dxmt.size + SOURCES.dxvk.size };
}

async function hasRosetta() {
  if (process.arch !== 'arm64') return true;
  try { await run('/usr/bin/arch', ['-x86_64', '/usr/bin/true']); return true; } catch { return false; }
}
// Rosetta needs the user's admin OK, so we open Apple's own installer prompt.
function installRosetta() {
  return new Promise((resolve) => {
    const p = spawn('/usr/sbin/softwareupdate', ['--install-rosetta', '--agree-to-license']);
    p.on('exit', (c) => resolve(c === 0));
    p.on('error', () => resolve(false));
  });
}

const { download } = require('./net');

// Set up the whole engine. onStep({ step, progress }) drives the first-run screen.
async function install(onStep) {
  const d = dirs();
  if (!(await hasRosetta())) {
    onStep({ step: 'rosetta', progress: 0 });
    if (!(await installRosetta())) throw new Error('Rosetta 2 is needed. Open Terminal and run: softwareupdate --install-rosetta');
  }
  const parts = [['wine', 0.85], ['dxmt', 0.1], ['dxvk', 0.05]];
  let base = 0;
  for (const [k, w] of parts) {
    const file = path.join(d.downloads, path.basename(SOURCES[k].url));
    if (!(await exists(file))) await download(SOURCES[k].url, file, (f) => onStep({ step: 'download', part: k, progress: base + f * w }));
    base += w;
  }
  onStep({ step: 'unpack', progress: 1 });
  // Wine: the archive holds "Wine Staging.app"; we only need its Resources/wine folder.
  const tmp = path.join(d.engine, 'tmp');
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  await run('/usr/bin/tar', ['xf', path.join(d.downloads, path.basename(SOURCES.wine.url)), '-C', tmp]);
  const app = (await fsp.readdir(tmp)).find((n) => n.endsWith('.app'));
  await fsp.rm(d.wine, { recursive: true, force: true });
  await fsp.rename(path.join(tmp, app, 'Contents', 'Resources', 'wine'), d.wine);
  // DXMT variant: a copy-on-write clone (costs no disk space on APFS) with DXMT's builtin dlls swapped in.
  await fsp.rm(d.wineDxmt, { recursive: true, force: true });
  await run('/bin/cp', ['-c', '-R', d.wine, d.wineDxmt]).catch(() => run('/bin/cp', ['-R', d.wine, d.wineDxmt]));
  await run('/usr/bin/tar', ['xzf', path.join(d.downloads, path.basename(SOURCES.dxmt.url)), '-C', tmp]);
  const dx = path.join(tmp, `v${SOURCES.dxmt.version}`);
  for (const arch of ['x86_64-windows', 'i386-windows', 'x86_64-unix']) {
    const src = path.join(dx, arch);
    if (!(await exists(src))) continue;
    for (const f of await fsp.readdir(src)) await fsp.copyFile(path.join(src, f), path.join(d.wineDxmt, 'lib', 'wine', arch, f));
  }
  // DXVK: kept aside, copied into a bottle only when that bottle uses it.
  await fsp.rm(d.dxvk, { recursive: true, force: true });
  await run('/usr/bin/tar', ['xzf', path.join(d.downloads, path.basename(SOURCES.dxvk.url)), '-C', tmp]);
  const dv = (await fsp.readdir(tmp)).find((n) => n.startsWith('dxvk'));
  await fsp.rename(path.join(tmp, dv), d.dxvk);
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.writeFile(stampFile(), ENGINE_VERSION);
  // The downloads can go; a reinstall fetches them again.
  await fsp.rm(d.downloads, { recursive: true, force: true });
  await fsp.mkdir(d.downloads, { recursive: true });
  onStep({ step: 'done', progress: 1 });
}

// ------------------------------------------------------------------ bottles
// A bottle is one Windows "C: drive". Each store gets its own, so a fix for one never breaks another.
const bottlePath = (id) => path.join(dirs().bottles, id);

// Graphics modes the "Make it run" button can try, best first.
const GRAPHICS = ['dxmt', 'dxvk', 'wined3d'];

function envFor(bottleId, fix = {}) {
  const g = fix.graphics || 'dxmt';
  const env = {
    ...process.env,
    WINEPREFIX: bottlePath(bottleId),
    WINEDEBUG: fix.debug ? 'err+all,warn+module' : '-all',
    WINEESYNC: fix.noSync ? '0' : '1',
    WINEMSYNC: fix.noSync ? '0' : '1',
    MVK_CONFIG_LOG_LEVEL: '0',
    // DXMT/DXVK need these to pick up our dlls instead of Wine's.
    WINEDLLOVERRIDES: g === 'dxvk' ? 'd3d11,d3d10core,dxgi=n,b' : 'd3d11,d3d10core,dxgi=b',
  };
  if (g === 'dxmt') env.DXMT_LOG_LEVEL = 'none';
  if (g === 'dxvk') { env.DXVK_ASYNC = '1'; env.DXVK_LOG_LEVEL = 'none'; }
  if (fix.retina) env.WINE_RETINA = '1';
  return env;
}
const wineBin = (fix = {}) => path.join((fix.graphics || 'dxmt') === 'dxmt' ? dirs().wineDxmt : dirs().wine, 'bin', 'wine');
const wineserverBin = (fix = {}) => path.join((fix.graphics || 'dxmt') === 'dxmt' ? dirs().wineDxmt : dirs().wine, 'bin', 'wineserver');

async function prepareGraphics(bottleId, fix) {
  if ((fix.graphics || 'dxmt') !== 'dxvk') return;
  const sys = path.join(bottlePath(bottleId), 'drive_c', 'windows');
  for (const [from, to] of [['x64', 'system32'], ['x32', 'syswow64']]) {
    const src = path.join(dirs().dxvk, from);
    if (!(await exists(src))) continue;
    for (const f of await fsp.readdir(src)) await fsp.copyFile(path.join(src, f), path.join(sys, to, f)).catch(() => {});
  }
}

async function ensureBottle(id, onLog = () => {}) {
  const p = bottlePath(id);
  if (await exists(path.join(p, 'system.reg'))) return p;
  await fsp.mkdir(p, { recursive: true });
  await runWine(id, ['wineboot', '-i'], {}, onLog).done;
  // A Windows 10 look and the Mac's own fonts smoothing.
  await runWine(id, ['reg', 'add', 'HKCU\\Software\\Wine\\X11 Driver', '/v', 'UseTakeFocus', '/d', 'N', '/f'], {}, onLog).done;
  return p;
}

// Start a Windows program. Returns { proc, done: Promise<{code, ms}> }.
function runWine(bottleId, args, fix = {}, onLog = () => {}, opts = {}) {
  const started = Date.now();
  const proc = spawn(wineBin(fix), args, { env: envFor(bottleId, fix), cwd: opts.cwd || bottlePath(bottleId), detached: !!opts.detached });
  const log = (b) => onLog(b.toString());
  proc.stdout.on('data', log);
  proc.stderr.on('data', log);
  const done = new Promise((resolve) => {
    proc.on('exit', (code) => resolve({ code, ms: Date.now() - started }));
    proc.on('error', (e) => { onLog(String(e)); resolve({ code: -1, ms: Date.now() - started }); });
  });
  return { proc, done };
}

// Stop everything running in a bottle.
function killBottle(bottleId) {
  return new Promise((resolve) => {
    const env = envFor(bottleId);
    let n = 0;
    for (const bin of [wineserverBin({ graphics: 'dxmt' }), wineserverBin({ graphics: 'wined3d' })]) {
      const p = spawn(bin, ['-k'], { env });
      p.on('exit', () => { if (++n === 2) resolve(); });
      p.on('error', () => { if (++n === 2) resolve(); });
    }
  });
}

// "C:\Program Files\X\y.exe" <-> /…/drive_c/Program Files/X/y.exe
function toUnix(bottleId, winPath) {
  const m = /^([a-zA-Z]):\\(.*)$/.exec(winPath);
  if (!m) return winPath;
  return path.join(bottlePath(bottleId), 'drive_c', ...m[2].split('\\'));
}
function toWin(bottleId, unixPath) {
  const c = path.join(bottlePath(bottleId), 'drive_c');
  if (unixPath.startsWith(c)) return 'C:' + unixPath.slice(c.length).split(path.sep).join('\\');
  return 'Z:' + unixPath.split(path.sep).join('\\');
}

module.exports = { init, dirs, status, install, ensureBottle, runWine, killBottle, prepareGraphics, bottlePath, toUnix, toWin, GRAPHICS, exists, hasRosetta, ENGINE_VERSION };
