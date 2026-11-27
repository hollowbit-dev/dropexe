// Real game on several graphics modes: node test/real-game.mjs <userdata> <game.exe> dxmt,d3dmetal
// For each: play, wait 45 s, is it still open, and a screenshot of its own window (<userdata>/real-<mode>.png).
import { _electron as electron } from 'playwright';
import { execFileSync } from 'child_process';
const [ud, exe, modes = 'dxmt,d3dmetal'] = process.argv.slice(2);
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud } });
const w = await app.firstWindow();
const t0 = Date.now(); const T = () => `${((Date.now() - t0) / 1000) | 0}s`;
await w.waitForTimeout(1500);
const [r] = await w.evaluate((f) => window.dx.drop([f]), exe);
const wins = () => execFileSync('swift', [new URL('../scripts/wine-windows.swift', import.meta.url).pathname]).toString().trim().split('\n').filter(Boolean);
for (const g of modes.split(',')) {
  await w.evaluate(([id, g]) => window.dx.setGraphics(id, g), [r.id, g]);
  console.log(T(), g, 'play', JSON.stringify(await w.evaluate((id) => window.dx.play(id), r.id)));
  await w.waitForTimeout(45000);
  const it = (await w.evaluate(() => window.dx.state())).items.find((i) => i.id === r.id);
  const ws = wins();
  console.log(T(), g, 'running:', !!it.running, '| windows:', ws.join(' ; ') || 'none');
  const big = ws.map((l) => l.split('\t')).sort((a, b) => eval(b[1].replace('x', '*')) - eval(a[1].replace('x', '*')))[0];
  if (big) execFileSync('screencapture', ['-x', '-o', '-l', big[0], `${ud}/real-${g}.png`]);
  await w.evaluate((id) => window.dx.stop(id), r.id);
  await w.waitForTimeout(5000);
}
await w.evaluate((id) => window.dx.remove(id), r.id).catch(() => {});
await app.close();
