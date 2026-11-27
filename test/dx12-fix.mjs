// Make it run on a DirectX 12 program: node test/dx12-fix.mjs <userdata>
// Metal (DXMT) can't do DX12, so it should close; Apple's D3DMetal should keep it open and be saved.
import { _electron as electron } from 'playwright';
import fs from 'fs';
import path from 'path';
const ud = process.argv[2];
const dir = path.join(ud, 'dx12-fix'); fs.mkdirSync(dir, { recursive: true });
const exe = path.join(dir, 'dx12stay.exe');
fs.copyFileSync(new URL('./fixtures/dx12test.exe', import.meta.url).pathname, exe);
const app = await electron.launch({ args: ['.'], env: { ...process.env, DROPEXE_USERDATA: ud } });
const w = await app.firstWindow();
const t0 = Date.now(); const T = () => `${((Date.now() - t0) / 1000) | 0}s`;
const until = async (fn, ms, step = 1000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await w.waitForTimeout(step); } return null; };
await w.waitForTimeout(1500);
const [r] = await w.evaluate((f) => window.dx.drop([f]), exe);
// "stay" in its own file name keeps it drawing until it's closed.
const fixes = [];
await w.exposeFunction('__fix', (f) => fixes.push(f));
await w.evaluate(() => window.dx.on.fix((f) => window.__fix(f)));
w.evaluate((id) => window.dx.fix(id), r.id);
const asked = await until(() => fixes.find((f) => f.state === 'ask' || f.state === 'failed'), 300000);
console.log(T(), 'steps:', fixes.map((f) => `${f.step || ''}:${f.state}`).join(' '));
if (asked?.state === 'ask') await w.evaluate(() => window.dx.fixAnswer(true));
await until(() => fixes.find((f) => f.state === 'fixed' || f.state === 'failed'), 30000);
const it = (await w.evaluate(() => window.dx.state())).items.find((i) => i.id === r.id);
console.log(T(), 'fixedWith:', it.fixedWith, JSON.stringify(it.fix));
await w.evaluate((id) => window.dx.stop(id), r.id);
await w.waitForTimeout(3000);
await w.evaluate((id) => window.dx.remove(id), r.id).catch(() => {});
await app.close();
