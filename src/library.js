// The library: stores, games and apps the user has added, saved as JSON.
// Item: { id, kind: 'store'|'game'|'app', name, bottle, exe, args[], cwd?, steamAppId?, launch?, art: {cover, hero}, fix, addedAt, lastPlayed, playMs }
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const engine = require('./engine');

let FILE = null, ART = null;
let items = [];
function init(root) {
  FILE = path.join(root, 'library.json');
  ART = path.join(root, 'art');
  fs.mkdirSync(ART, { recursive: true });
  try { items = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { items = []; }
}
function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 1));
  fs.renameSync(tmp, FILE);
}
const all = () => items;
const get = (id) => items.find((i) => i.id === id);
function upsert(item) {
  const i = items.findIndex((x) => x.id === item.id);
  if (i >= 0) items[i] = { ...items[i], ...item }; else items.push({ addedAt: Date.now(), playMs: 0, ...item });
  save();
  return get(item.id);
}
function remove(id) { items = items.filter((i) => i.id !== id); save(); }
const newId = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex')}`;

// ------------------------------------------------------------------ art
// Steam's public CDN has cover (600x900) and hero (wide) art for every Steam game.
const steamArt = (appid) => ({
  cover: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`,
  hero: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_hero.jpg`,
  header: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
});

async function fetchTo(url, file) {
  const { net } = require('electron');
  const res = await net.fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2000) throw new Error('too small');
  await fsp.writeFile(file, buf);
  return file;
}

// Cache art on disk so the library works offline and never re-downloads.
async function cacheArt(item) {
  const urls = item.steamAppId ? steamArt(item.steamAppId) : item.artUrls;
  if (!urls) return item;
  const art = { ...(item.art || {}) };
  for (const k of ['cover', 'hero']) {
    if (art[k] && (await engine.exists(art[k]))) continue;
    const file = path.join(ART, `${item.id}-${k}.jpg`);
    try { art[k] = await fetchTo(urls[k], file); } catch {
      // Some games have no 600x900 cover; fall back to the wide header.
      if (k === 'cover' && urls.header) { try { art[k] = await fetchTo(urls.header, file); art.coverIsWide = true; } catch { /* none */ } }
    }
  }
  return upsert({ id: item.id, art });
}

// Find Steam art for a game that isn't from Steam, by its name. Only the name is sent.
async function findArtByName(name) {
  const { net } = require('electron');
  try {
    const q = encodeURIComponent(name.replace(/[^\w\s:'-]/g, ' ').trim());
    const res = await net.fetch(`https://store.steampowered.com/api/storesearch/?term=${q}&cc=us&l=en`);
    const j = await res.json();
    const hit = (j.items || [])[0];
    if (!hit) return null;
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!norm(hit.name).includes(norm(name).slice(0, 6)) && !norm(name).includes(norm(hit.name).slice(0, 6))) return null;
    return steamArt(hit.id);
  } catch { return null; }
}

// ------------------------------------------------------------------ scanning stores for installed games
function parseVdf(text) {
  // Just enough of Valve's KeyValues format for appmanifest files: "key" "value"
  const out = {};
  for (const m of text.matchAll(/"([^"]+)"\s+"([^"]*)"/g)) if (!(m[1] in out)) out[m[1]] = m[2];
  return out;
}
const SKIP_STEAM = new Set(['228980', '1070560', '1391110', '1628350', '1493710']); // redistributables, Linux runtimes

async function scanSteam() {
  const store = get('store-steam');
  if (!store) return [];
  const apps = path.join(engine.bottlePath('steam'), 'drive_c', 'Program Files (x86)', 'Steam', 'steamapps');
  let files = [];
  try { files = (await fsp.readdir(apps)).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { return []; }
  const found = [];
  for (const f of files) {
    const m = parseVdf(await fsp.readFile(path.join(apps, f), 'utf8'));
    if (!m.appid || SKIP_STEAM.has(m.appid)) continue;
    // StateFlags 4 = fully installed
    const installed = (Number(m.StateFlags) & 4) === 4;
    const id = `steam-${m.appid}`;
    const prev = get(id);
    found.push(upsert({
      id, kind: 'game', source: 'steam', name: m.name || prev?.name || `Steam game ${m.appid}`, bottle: 'steam',
      steamAppId: m.appid, installdir: m.installdir, installing: !installed,
      exe: store.exe, args: [...store.args, '-silent', '-applaunch', m.appid],
      fix: prev?.fix || { graphics: 'dxmt' },
    }));
  }
  // Games uninstalled from inside Steam leave the library too.
  for (const it of items.filter((i) => i.source === 'steam' && !found.find((f) => f.id === i.id))) remove(it.id);
  return found;
}

async function scanEpic() {
  const store = get('store-epic');
  if (!store) return [];
  const dir = path.join(engine.bottlePath('epic'), 'drive_c', 'ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try { files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.item')); } catch { return []; }
  const found = [];
  for (const f of files) {
    let m; try { m = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8')); } catch { continue; }
    if (!m.AppName || !m.LaunchExecutable) continue;
    const id = `epic-${m.AppName}`;
    const prev = get(id);
    found.push(upsert({
      id, kind: 'game', source: 'epic', name: m.DisplayName || m.AppName, bottle: 'epic',
      exe: `${m.InstallLocation}\\${m.LaunchExecutable}`.replace(/\//g, '\\'),
      args: (m.LaunchCommand || '').split(' ').filter(Boolean),
      fix: prev?.fix || { graphics: 'dxmt' },
    }));
  }
  return found;
}

// ------------------------------------------------------------------ installers
// List .exe files under Program Files, to spot what an installer just added.
async function listExes(bottle) {
  const roots = ['Program Files', 'Program Files (x86)', path.join('users')].map((r) => path.join(engine.bottlePath(bottle), 'drive_c', r));
  const out = new Map();
  const SKIP = /^(unins|uninstall|setup|install|crash|vc_?redist|dxsetup|directx|dotnet|update|helper|report|launcherpatcher|ue4prereq|gup|elevate|7z|curl)/i;
  async function walk(dir, depth) {
    if (depth > 5) return;
    let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (/^(windows|Common Files|Windows NT|Internet Explorer|Windows Media Player|AppData|Temp|updater|_CommonRedist|redist|plugins)$/i.test(e.name)) continue;
        await walk(p, depth + 1);
      } else if (/\.exe$/i.test(e.name) && !SKIP.test(e.name)) {
        try { out.set(p, (await fsp.stat(p)).size); } catch { /* gone */ }
      }
    }
  }
  for (const r of roots) await walk(r, 0);
  return out;
}

// A name for a program: the product name inside the exe if it has one, else its folder, else the file name.
const GENERIC_DIR = /^(bin|bin32|bin64|binaries|win32|win64|x64|x86|game|release|app|program|files|downloads|desktop|cd|disk\d*)$/i;
function nameFor(file) {
  try {
    const v = require('./exeicon').versionInfo(file);
    const n = (v.ProductName || v.FileDescription || '').trim();
    if (n && /^[\x20-\x7e\u00c0-\u024f]+$/.test(n) && n.length <= 60 && !/^(setup|installer|launcher|game|application)$/i.test(n) && !/microsoft|windows/i.test(n)) return n;
  } catch { /* no version info */ }
  const dir = path.basename(path.dirname(file));
  if (dir && !GENERIC_DIR.test(dir) && !/^[a-z]:$/i.test(dir)) return prettyName(dir);
  return prettyName(file);
}
// Turn "MyGame-Win64-Shipping.exe" into "My Game".
function prettyName(file) {
  let n = path.basename(file).replace(/\.(exe|msi)$/i, '');
  n = n.replace(/[-_.](win(32|64)?|x64|x86|shipping|setup|installer|install|launcher|final|v?\d+(\.\d+)+)/gi, ' ');
  n = n.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return n ? n[0].toUpperCase() + n.slice(1) : 'Windows app';
}
const looksLikeInstaller = (file) => /\.msi$/i.test(file) || /(setup|install|installer|_inst)\b/i.test(path.basename(file)) || /^setup/i.test(path.basename(file));

module.exports = { init, all, get, upsert, remove, newId, cacheArt, findArtByName, steamArt, scanSteam, scanEpic, listExes, prettyName, nameFor, looksLikeInstaller };
