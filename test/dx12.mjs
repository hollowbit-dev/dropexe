// DirectX 12 test: node test/dx12.mjs <userdata>
// Turns on Apple's engine, drops the tiny DX12 program (test/fixtures/dx12test.exe) in, and plays it with
// D3DMetal, then with Metal (DXMT) as a control that can't do DX12. The program writes dx12test.txt next to itself.
import { _electron as electron } from 'playwright';
import fs from 'fs';
import path from 'path';
const ud = process.argv[2];
const dir = path.join(ud, 'dx12-run');
fs.mkdirSync(dir, { recursive: true });
const exe = path.join(dir, 'dx12test.exe');
fs.copyFileSync(new URL('./fixtures/dx12test.exe', import.meta.url).pathname, exe);
const result = path.join(dir, 'dx12test.txt');

const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud } });
const w = await app.firstWindow();
w.on('pageerror', (e) => console.log('[pageerror]', e.message));
const t0 = Date.now(); const T = () => `${((Date.now() - t0) / 1000) | 0}s`;
const until = async (fn, ms, step = 1000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await w.waitForTimeout(step); } return null; };
await w.waitForTimeout(1500);
console.log(T(), 'gptk before', JSON.stringify((await w.evaluate(() => window.dx.state())).gptk));
console.log(T(), 'accept', JSON.stringify(await w.evaluate(() => window.dx.gptkAccept())));
console.log(T(), 'gptk after', JSON.stringify((await w.evaluate(() => window.dx.state())).gptk));

const [r] = await w.evaluate((f) => window.dx.drop([f]), exe);
console.log(T(), 'drop', JSON.stringify(r));
for (const g of (process.argv[3] || 'd3dmetal,dxmt').split(',')) {
  fs.rmSync(result, { force: true });
  await w.evaluate(([id, g]) => window.dx.setGraphics(id, g), [r.id, g]);
  console.log(T(), g, 'play', JSON.stringify(await w.evaluate((id) => window.dx.play(id), r.id)));
  const txt = await until(() => fs.existsSync(result) && fs.readFileSync(result, 'utf8').includes('\n') && fs.readFileSync(result, 'utf8'), 90000);
  console.log(T(), g, 'result:', txt ? txt.trim() : 'NO RESULT (timed out)');
  if (!txt) console.log('--- log tail ---\n' + (await w.evaluate((id) => window.dx.log(id), r.id)).slice(-2500));
  await w.evaluate((id) => window.dx.stop(id), r.id);
  await w.waitForTimeout(3000);
}
await w.evaluate((id) => window.dx.remove(id), r.id).catch(() => {});
await app.close();
