// "Find my games": pulls in games the user already has.
//   1. Mac Steam: every game on the account (from Steam's local config), with Steam's own cached art.
//      Mac versions launch through Mac Steam; Windows-only ones run through DropExe's Windows Steam.
//   2. Windows games sitting in Downloads, Desktop, Documents or ~/Games (like FNAF Plus from Game Jolt).
//   3. Mac games in /Applications (apps marked as games), so everything lives in one library.
// Only app IDs go to Steam's public store API (to learn names and which have Mac versions). Nothing personal is sent.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const HOME = os.homedir();
const MAC_STEAM = path.join(HOME, 'Library', 'Application Support', 'Steam');
let CACHE = null;
function init(root) { CACHE = path.join(root, 'steam-apps.json'); }
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// ------------------------------------------------------------------ Mac Steam
// Valve's text KeyValues, parsed into nested objects.
function parseVdf(text) {
  const root = {}; const stack = [root]; let key = null;
  const re = /"((?:[^"\\]|\\.)*)"|([{}])/g; let m;
  while ((m = re.exec(text))) {
    if (m[2] === '{') { const o = {}; stack[stack.length - 1][key] = o; stack.push(o); key = null; }
    else if (m[2] === '}') { stack.pop(); key = null; }
    else if (key === null) key = m[1];
    else { stack[stack.length - 1][key] = m[1]; key = null; }
  }
  return root;
}
const find = (o, k) => { if (!o || typeof o !== 'object') return null; for (const [kk, v] of Object.entries(o)) { if (kk.toLowerCase() === k.toLowerCase()) return v; } return null; };

async function steamAppInfo(ids) {
  const cache = readJson(CACHE, {});
  const { net } = require('electron');
  const todo = ids.filter((id) => !cache[id]);
  // One at a time, politely; results are cached so this only happens once per game.
  for (const id of todo) {
    try {
      const r = await net.fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic,platforms`);
      const j = (await r.json())[id];
      cache[id] = j?.success ? { name: j.data.name, type: j.data.type, mac: !!j.data.platforms?.mac, windows: !!j.data.platforms?.windows } : { missing: true };
    } catch { /* offline: try next time */ }
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  return cache;
}

async function scanMacSteam() {
  if (!fs.existsSync(MAC_STEAM)) return [];
  const ids = new Set();
  const installed = new Map(); // appid -> { name, installdir }
  // Installed games, in every library folder.
  const lf = parseVdf(await fsp.readFile(path.join(MAC_STEAM, 'steamapps', 'libraryfolders.vdf'), 'utf8').catch(() => ''));
  const libs = [path.join(MAC_STEAM, 'steamapps')];
  for (const v of Object.values(find(lf, 'libraryfolders') || {})) if (v && v.path) libs.push(path.join(v.path, 'steamapps'));
  for (const lib of [...new Set(libs)]) {
    let files = []; try { files = (await fsp.readdir(lib)).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      const st = find(parseVdf(await fsp.readFile(path.join(lib, f), 'utf8')), 'AppState') || {};
      if (!st.appid) continue;
      ids.add(st.appid);
      installed.set(st.appid, { name: st.name, installdir: path.join(lib, 'common', st.installdir || '') });
    }
  }
  // Everything the account has played or owns shows up in each user's localconfig.
  try {
    for (const u of await fsp.readdir(path.join(MAC_STEAM, 'userdata'))) {
      const lc = parseVdf(await fsp.readFile(path.join(MAC_STEAM, 'userdata', u, 'config', 'localconfig.vdf'), 'utf8').catch(() => ''));
      const apps = find(find(find(find(find(lc, 'UserLocalConfigStore'), 'Software'), 'Valve'), 'Steam'), 'apps') || {};
      for (const [id, v] of Object.entries(apps)) if (/^\d+$/.test(id) && Number(id) > 10) ids.add(id);
    }
  } catch { /* not signed in */ }
  const info = await steamAppInfo([...ids]);
  const out = [];
  for (const id of ids) {
    const i = info[id] || {};
    if (i.missing || (i.type && i.type !== 'game')) continue;
    const inst = installed.get(id);
    const name = i.name || inst?.name;
    if (!name || /redistributable|soundtrack|dedicated server|sdk/i.test(name)) continue;
    out.push({ appid: id, name, mac: i.mac !== false && (i.mac || !!inst), installed: !!inst, installdir: inst?.installdir, art: localSteamArt(id) });
  }
  return out;
}

// Steam's own cached art on this Mac (no download needed).
function localSteamArt(id) {
  const d = path.join(MAC_STEAM, 'appcache', 'librarycache', String(id));
  const pick = (...names) => { for (const n of names) { const p = path.join(d, n); if (fs.existsSync(p)) return p; } return null; };
  return { cover: pick('library_600x900_2x.jpg', 'library_600x900.jpg'), hero: pick('library_hero.jpg'), logo: pick('logo.png'), header: pick('header.jpg') };
}

// ------------------------------------------------------------------ Windows games in the usual folders
const SEARCH = ['Downloads', 'Desktop', 'Documents', 'Games'].map((d) => path.join(HOME, d));
const NOT_GAMES = /^(unins|uninstall|setup|install|vc_?redist|dxsetup|directx|dotnet|crash|report|update|updater|helper|launcherpatcher|ue4prereq|7z|config|doconfig|orgview|unitycrashhandler|notification_helper|dxwebsetup|oalinst|physx)/i;
async function scanExes(exclude) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > 6) return;
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    // A software project (code, builds, bundled tools) isn't a game folder.
    if (depth > 0 && ents.some((e) => ['package.json', '.git', 'Cargo.toml', 'project.godot', 'go.mod', 'pyproject.toml'].includes(e.name))) return;
    const exes = [];
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (/^(node_modules|\.git|Library|Applications|bottles|drive_c|dist|build|out|vendor|win-unpacked|resources|\.Trash|Photos Library\.photoslibrary)$/i.test(e.name) || e.name.endsWith('.app')) continue;
        await walk(p, depth + 1);
      } else if (/\.exe$/i.test(e.name) && !NOT_GAMES.test(e.name) && require('./exeicon').subsystem(p) === 2) exes.push(p);
    }
    if (!exes.length) return;
    // One game per folder: the exe named like the folder, else the biggest.
    const sized = await Promise.all(exes.map(async (p) => ({ p, size: (await fsp.stat(p)).size })));
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const folder = norm(path.basename(dir));
    sized.sort((a, b) => (norm(path.basename(b.p, '.exe')).includes(folder.slice(0, 5)) - norm(path.basename(a.p, '.exe')).includes(folder.slice(0, 5))) || b.size - a.size);
    const best = sized[0];
    if (exclude.has(best.p)) return;
    // A lone .exe straight in Downloads/Desktop (not in its own folder) is usually an installer or a fake; don't tick it.
    const loose = SEARCH.includes(dir);
    const library = require('./library');
    found.push({ path: best.p, name: library.nameFor(best.p), size: best.size, loose, installer: library.looksLikeInstaller(best.p) });
  }
  for (const r of SEARCH) await walk(r, 0);
  return found;
}

// ------------------------------------------------------------------ Mac games
function plistJson(file) {
  return new Promise((res) => execFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], (e, out) => { try { res(e ? null : JSON.parse(out)); } catch { res(null); } }));
}
async function scanMacGames(skipNames) {
  const out = [];
  for (const dir of ['/Applications', path.join(HOME, 'Applications')]) {
    let ents = []; try { ents = await fsp.readdir(dir); } catch { continue; }
    for (const n of ents.filter((x) => x.endsWith('.app'))) {
      const app = path.join(dir, n);
      const p = await plistJson(path.join(app, 'Contents', 'Info.plist'));
      if (!p) continue;
      const cat = String(p.LSApplicationCategoryType || '');
      const name = p.CFBundleDisplayName || p.CFBundleName || n.replace(/\.app$/, '');
      if (!/games/.test(cat)) continue;
      if (/^dev\.hollowbit\.dropexe/.test(p.CFBundleIdentifier || '')) continue; // our own launchers
      if (skipNames.has(name.toLowerCase())) continue; // already there from Steam
      // Steam's Mac shortcuts just open steam://rungameid; Steam covers those.
      if (fs.existsSync(path.join(app, 'Contents', 'MacOS', 'run.sh')) && /steam:\/\//.test(fs.readFileSync(path.join(app, 'Contents', 'MacOS', 'run.sh'), 'utf8'))) continue;
      const icon = p.CFBundleIconFile ? path.join(app, 'Contents', 'Resources', p.CFBundleIconFile.endsWith('.icns') ? p.CFBundleIconFile : p.CFBundleIconFile + '.icns') : null;
      // Emulators and launchers are filed as games too; list them, but unticked.
      const tool = /^(dolphin|openemu|ryujinx|retroarch|heroic|prism launcher|curseforge|steam|whisky|highball|crossover|sikarugir|porting kit|godot|unity hub|mythic|lutris|pcsx2|ppsspp|citra|yuzu|cemu|duckstation|mgba|melonds)/i.test(name);
      out.push({ path: app, name, tool, icon: icon && fs.existsSync(icon) ? icon : null });
    }
  }
  return out;
}

async function scanAll(existing) {
  const steam = await scanMacSteam();
  const exclude = new Set(existing.filter((i) => i.exe).map((i) => i.unixExe).filter(Boolean));
  const exes = await scanExes(exclude);
  const macGames = await scanMacGames(new Set(steam.map((s) => s.name.toLowerCase())));
  return { steam, exes, macGames };
}

module.exports = { init, scanAll, scanMacSteam, localSteamArt, MAC_STEAM };
