// "Make it run": the list of things to try, best and cheapest first.
// Each step changes one thing. The first one that keeps the game open (and that the user says looks right) wins
// and is saved on the game, so the next Play just works.
const path = require('path');
const fs = require('fs');
const engine = require('./engine');

const STEPS = [
  { id: 'dxmt', label: 'Metal graphics', detail: 'DirectX 10 and 11 drawn straight with Metal. Fastest on Apple chips.', fix: { graphics: 'dxmt' } },
  { id: 'dxvk', label: 'Vulkan graphics', detail: 'A second DirectX translator. Some games like this one better.', fix: { graphics: 'dxvk' } },
  { id: 'wined3d', label: 'Classic graphics', detail: 'Older OpenGL path. Slower, but works with many old games.', fix: { graphics: 'wined3d' } },
  { id: 'vcredist', label: 'Add Microsoft runtimes', detail: 'Installs the Visual C++ files lots of games need, then tries Metal again.', fix: { graphics: 'dxmt' }, prep: 'vcredist' },
  { id: 'nosync', label: 'Safer timing', detail: 'Turns off a speed trick that some games trip over.', fix: { graphics: 'dxmt', noSync: true } },
  { id: 'win7', label: 'Pretend to be Windows 7', detail: 'For older games that check the Windows version.', fix: { graphics: 'wined3d', winver: 'win7' } },
  { id: 'vdesktop', label: 'Run in a window', detail: 'A fixed-size window instead of full screen. Fixes black or stretched screens.', fix: { graphics: 'dxmt', desktop: '1600x900' } },
];

const VCREDIST = [
  { url: 'https://aka.ms/vs/17/release/vc_redist.x64.exe', file: 'vc_redist.x64.exe' },
  { url: 'https://aka.ms/vs/17/release/vc_redist.x86.exe', file: 'vc_redist.x86.exe' },
];

async function prep(step, bottle, onLog) {
  if (step.prep === 'vcredist') {
    const d = engine.dirs().downloads;
    for (const v of VCREDIST) {
      const f = path.join(d, v.file);
      if (!fs.existsSync(f)) await require('./net').download(v.url, f);
      await engine.runWine(bottle, [f, '/install', '/quiet', '/norestart'], { graphics: 'wined3d' }, onLog).done;
    }
  }
}

// Applied before every launch: one registry import (one Wine start), then the graphics files.
async function applyFix(bottle, fix, onLog) {
  const winver = fix.winver || 'win10';
  const reg = [
    'REGEDIT4', '',
    '[HKEY_CURRENT_USER\\Software\\Wine]', `"Version"="${winver}"`, '',
    // Retina: draw at the screen's full sharpness, and tell Windows the screen is high-DPI so text isn't tiny.
    '[HKEY_CURRENT_USER\\Software\\Wine\\Mac Driver]', `"RetinaMode"="${fix.retina ? 'y' : 'n'}"`, '',
    '[HKEY_CURRENT_USER\\Control Panel\\Desktop]', `"LogPixels"=dword:${fix.retina ? '000000c0' : '00000060'}`, '',
  ].join('\r\n');
  const file = path.join(engine.bottlePath(bottle), 'dropexe-settings.reg');
  fs.writeFileSync(file, reg);
  await engine.runWine(bottle, ['regedit', '/S', file], fix, onLog).done;
  await engine.prepareGraphics(bottle, fix);
}

module.exports = { STEPS, prep, applyFix };
