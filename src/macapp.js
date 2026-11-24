// Turn a library item into a real Mac app in ~/Applications/DropExe, so it shows in Launchpad, Spotlight and the Dock.
// The little app just opens dropexe://play/<id>; DropExe does the rest.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);

const DIR = path.join(os.homedir(), 'Applications', 'DropExe');
const safe = (n) => n.replace(/[/:\\]/g, '-').replace(/^\.+/, '').slice(0, 60).trim() || 'Windows app';
const appPath = (item) => path.join(DIR, `${safe(item.name)}.app`);

// Square icon from the cover art: crop the middle, round corners like macOS icons.
async function makeIcns(src, outIcns, tmp) {
  const set = path.join(tmp, 'icon.iconset');
  await fsp.mkdir(set, { recursive: true });
  const sq = path.join(tmp, 'square.png');
  // sips can't round corners; a centred square crop of the cover reads well at icon sizes.
  const { stdout } = await run('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src]);
  const w = Number(/pixelWidth: (\d+)/.exec(stdout)[1]), h = Number(/pixelHeight: (\d+)/.exec(stdout)[1]);
  const s = Math.min(w, h);
  await run('/usr/bin/sips', ['-s', 'format', 'png', '-c', String(s), String(s), src, '--out', sq]);
  for (const size of [16, 32, 128, 256, 512]) {
    await run('/usr/bin/sips', ['-z', String(size), String(size), sq, '--out', path.join(set, `icon_${size}x${size}.png`)]);
    await run('/usr/bin/sips', ['-z', String(size * 2), String(size * 2), sq, '--out', path.join(set, `icon_${size}x${size}@2x.png`)]);
  }
  await run('/usr/bin/iconutil', ['-c', 'icns', set, '-o', outIcns]);
}

async function create(item) {
  const app = appPath(item);
  const c = path.join(app, 'Contents');
  await fsp.rm(app, { recursive: true, force: true });
  await fsp.mkdir(path.join(c, 'MacOS'), { recursive: true });
  await fsp.mkdir(path.join(c, 'Resources'), { recursive: true });
  const exe = path.join(c, 'MacOS', 'launch');
  await fsp.writeFile(exe, `#!/bin/sh\n# Made by DropExe. Opens "${item.name.replace(/"/g, '')}" in DropExe.\nexec /usr/bin/open "dropexe://play/${encodeURIComponent(item.id)}"\n`);
  await fsp.chmod(exe, 0o755);
  let icon = '';
  const art = item.art?.cover;
  if (art && fs.existsSync(art)) {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dropexe-icon-'));
    try { await makeIcns(art, path.join(c, 'Resources', 'icon.icns'), tmp); icon = '<key>CFBundleIconFile</key><string>icon</string>'; } catch { /* no icon, still works */ }
    await fsp.rm(tmp, { recursive: true, force: true });
  }
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  await fsp.writeFile(path.join(c, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>${esc(item.name)}</string>
<key>CFBundleDisplayName</key><string>${esc(item.name)}</string>
<key>CFBundleIdentifier</key><string>dev.hollowbit.dropexe.game.${item.id.replace(/[^a-zA-Z0-9.-]/g, '-')}</string>
<key>CFBundleExecutable</key><string>launch</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSUIElement</key><true/>
<key>LSApplicationCategoryType</key><string>public.app-category.games</string>
${icon}
</dict></plist>`);
  // Ask Finder/Launchpad to pick up the new icon.
  run('/usr/bin/touch', [app]).catch(() => {});
  return app;
}

const has = (item) => fs.existsSync(appPath(item));
async function removeApp(item) { await fsp.rm(appPath(item), { recursive: true, force: true }); }

module.exports = { create, has, removeApp, appPath, DIR };
